/**
 * Provider driver contract: frozen definitions, field-path errors, one surface
 * normaliser for global uniqueness, and leaf-module import hygiene.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  defineProviderDriver,
  effectiveSurfaceNames,
  validateDrivers,
} from '../lib/driver/contract.js'

function makeSpec(overrides = {}) {
  return {
    id: 'demo',
    descriptor: {
      toolCallShape: 'fragmented',
      usage: { totalFormula: 'prompt+output' },
      malformedRecord: 'skip',
    },
    hooks: {
      readEvent: () => null,
      classifyText: () => [],
      mapFinish: () => 'stop',
    },
    surfaces: {
      model: { adapter: true, factory: 'createAdapter' },
      cli: { toolName: 'demo_cli', commandName: 'demo' },
      subagent: { toolRow: 'demo-row', toolName: 'subagent_demo', maxDepth: 2 },
      batch: { toolName: 'demo_batch' },
      tools: ['demo_status'],
      commands: ['demo_status'],
    },
    activation: {
      switches: [{ name: 'demo', module: 'demo-module', role: 'adapter' }],
      readiness: { bridge: 'demo-bridge', catalogLayer: 'layer-1', auth: 'web-auth', health: 'probe' },
    },
    ...overrides,
  }
}

test('a valid driver is returned frozen and its fields survive', () => {
  const driver = defineProviderDriver(makeSpec())

  assert.equal(driver.id, 'demo')
  assert.equal(driver.descriptor.toolCallShape, 'fragmented')
  assert.equal(driver.descriptor.usage.totalFormula, 'prompt+output')
  assert.equal(driver.descriptor.malformedRecord, 'skip')
  assert.equal(driver.hooks.readEvent(), null)
  assert.equal(driver.surfaces.model.factory, 'createAdapter')
  assert.equal(driver.surfaces.cli.commandName, 'demo')
  assert.equal(driver.surfaces.subagent.maxDepth, 2)
  assert.equal(driver.activation.readiness.auth, 'web-auth')

  assert.ok(Object.isFrozen(driver))
  assert.ok(Object.isFrozen(driver.descriptor))
  assert.ok(Object.isFrozen(driver.descriptor.usage))
  assert.ok(Object.isFrozen(driver.surfaces))
  assert.ok(Object.isFrozen(driver.surfaces.model))
  assert.ok(Object.isFrozen(driver.surfaces.cli))
  assert.ok(Object.isFrozen(driver.surfaces.subagent))
  assert.ok(Object.isFrozen(driver.surfaces.batch))
  assert.ok(Object.isFrozen(driver.surfaces.tools))
  assert.ok(Object.isFrozen(driver.activation))
  assert.ok(Object.isFrozen(driver.activation.switches))
  assert.ok(Object.isFrozen(driver.activation.readiness))
})

test('missing hooks.readEvent throws with the field path', () => {
  const spec = makeSpec()
  delete spec.hooks.readEvent

  assert.throws(() => defineProviderDriver(spec), (error) => {
    assert.ok(error instanceof Error)
    assert.match(error.message, /hooks\.readEvent/)
    return true
  })
})

test('a present but non-function hook throws with the field path', () => {
  const spec = makeSpec()
  spec.hooks.mapFinish = 'stop'

  assert.throws(() => defineProviderDriver(spec), /hooks\.mapFinish/)
})

test('unknown toolCallShape throws with the field path', () => {
  const spec = makeSpec()
  spec.descriptor.toolCallShape = 'streamed'

  assert.throws(() => defineProviderDriver(spec), /descriptor\.toolCallShape/)
})

test('unknown usage formula and malformed policy name their field paths', () => {
  const formula = makeSpec()
  formula.descriptor.usage.totalFormula = 'sum'
  assert.throws(() => defineProviderDriver(formula), /descriptor\.usage\.totalFormula/)

  const policy = makeSpec()
  policy.descriptor.malformedRecord = 'ignore'
  assert.throws(() => defineProviderDriver(policy), /descriptor\.malformedRecord/)
})

test('empty model.factory throws with the field path', () => {
  const spec = makeSpec()
  spec.surfaces.model.factory = '   '

  assert.throws(() => defineProviderDriver(spec), /surfaces\.model\.factory/)
})

test('two drivers with the same id throw', () => {
  const drivers = [makeSpec(), makeSpec({ id: 'demo', surfaces: {
    model: { adapter: true, factory: 'createAdapter' },
    tools: ['other_status'],
  } })]

  assert.throws(() => validateDrivers(drivers), (error) => {
    assert.match(error.message, /driver\[1\]\.id/)
    return true
  })
})

test('two drivers sharing a tool name throw via effectiveSurfaceNames', () => {
  const first = makeSpec({
    id: 'a',
    surfaces: {
      model: { adapter: true, factory: 'createAdapter' },
      cli: { toolName: 'shared_tool' },
    },
  })
  const second = makeSpec({
    id: 'b',
    surfaces: {
      model: { adapter: true, factory: 'createAdapter' },
      tools: ['shared_tool'],
    },
  })

  assert.throws(() => validateDrivers([first, second]), (error) => {
    assert.match(error.message, /driver\[1\]\.surfaces\.tools\[0\]/)
    return true
  })
})

test('two drivers sharing a command name throw, cli tool rows do not collide with commands', () => {
  const first = makeSpec({
    id: 'a',
    surfaces: {
      model: { adapter: true, factory: 'createAdapter' },
      cli: { toolName: 'a_cli', commandName: 'same_cmd' },
    },
  })
  const second = makeSpec({
    id: 'b',
    surfaces: {
      model: { adapter: true, factory: 'createAdapter' },
      commands: ['same_cmd'],
    },
  })

  assert.throws(() => validateDrivers([first, second]), /driver\[1\]\.surfaces\.commands\[0\]/)

  const clean = makeSpec({
    id: 'c',
    surfaces: {
      model: { adapter: true, factory: 'createAdapter' },
      cli: { toolName: 'only_cmd', commandName: 'cmd_name' },
    },
  })
  const drivers = validateDrivers([clean])
  assert.equal(drivers.length, 1)
  assert.ok(Object.isFrozen(drivers))
})

test('effectiveSurfaceNames unions cli.toolName + subagent.toolName + tools[] and de-dups', () => {
  const driver = defineProviderDriver(makeSpec({
    id: 'union',
    surfaces: {
      model: { adapter: true, factory: 'createAdapter' },
      cli: { toolName: 'cli_tool', commandName: 'cli_cmd' },
      subagent: { toolRow: 'row', toolName: 'subagent_tool', maxDepth: 1 },
      batch: { toolName: 'batch_tool' },
      tools: ['list_tool', 'cli_tool'],
      commands: ['list_cmd', 'cli_cmd'],
    },
  }))

  const names = effectiveSurfaceNames(driver)

  assert.deepEqual(names.tools, ['batch_tool', 'cli_tool', 'list_tool', 'subagent_tool'])
  assert.deepEqual(names.commands, ['cli_cmd', 'list_cmd'])
  assert.equal(new Set(names.tools).size, names.tools.length)
  assert.deepEqual(names.tools, [...names.tools].sort())
})

test('effectiveSurfaceNames is empty for a model-only driver', () => {
  const driver = defineProviderDriver(makeSpec({
    id: 'model-only',
    surfaces: { model: { adapter: true, factory: 'createAdapter' } },
    activation: { switches: [] },
  }))

  assert.deepEqual(effectiveSurfaceNames(driver), { tools: [], commands: [] })
})

test('a readiness with an unknown auth value throws', () => {
  const spec = makeSpec()
  spec.activation.readiness.auth = 'cookie'

  assert.throws(() => defineProviderDriver(spec), (error) => {
    assert.match(error.message, /activation\.readiness\.auth/)
    return true
  })
})

test('a missing top-level field names its path inside validateDrivers', () => {
  const spec = makeSpec()
  delete spec.activation

  assert.throws(() => validateDrivers([makeSpec({ id: 'ok' }), spec]), /driver\[1\]\.activation/)
})

test('the module imports nothing from index.js, presets.js or vendor', async () => {
  const source = await readFile(new URL('../lib/driver/contract.js', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /lib\/index|lib\/presets|vendor\//)
  assert.doesNotMatch(source, /^\s*import\s/m)
  assert.doesNotMatch(source, /\brequire\s*\(/)
})
