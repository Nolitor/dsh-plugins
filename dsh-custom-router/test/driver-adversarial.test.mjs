/**
 * Adversarial review of the provider driver contract (lib/driver/contract.js).
 *
 * This file never modifies the contract or the author's own suite. Every test
 * asserts the behaviour the validator ACTUALLY exhibits, so the suite stays
 * green. Where the validator accepts something it arguably should reject, or
 * where its error message omits the offending field path, the test carries a
 * `WEAKNESS:` comment naming the finding.
 *
 * The `WEAKNESS:` lines are the deliverable — this file is a report, not a
 * failing test suite.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

import {
  defineProviderDriver,
  effectiveSurfaceNames,
  validateDrivers,
} from '../lib/driver/contract.js'

const CONTRACT_URL = new URL('../lib/driver/contract.js', import.meta.url).href

/** A minimal valid spec; every adversarial case overrides one slice of it. */
function makeSpec(overrides = {}) {
  return {
    id: 'demo',
    descriptor: {
      toolCallShape: 'fragmented',
      usage: { totalFormula: 'prompt+output' },
      malformedRecord: 'skip',
    },
    hooks: { readEvent: () => null },
    surfaces: { model: { adapter: true, factory: 'createAdapter' } },
    activation: { switches: [] },
    ...overrides,
  }
}

/** Model-only spec: no cli / subagent / batch / tools / commands. */
function modelOnlySpec(id) {
  return makeSpec({ id, surfaces: { model: { adapter: true, factory: 'createAdapter' } } })
}

/** Capture the message of the error thrown by `fn`, or null if it did not throw. */
function messageOf(fn) {
  try {
    fn()
    return null
  } catch (error) {
    return error.message
  }
}

// ---------------------------------------------------------------------------
// 1. Duplicate id — case sensitivity and surrounding whitespace
// ---------------------------------------------------------------------------

test('a duplicate id differing only in case is ACCEPTED as two distinct drivers', () => {
  // WEAKNESS: id uniqueness is exact-string only, so 'DeepInfra' and
  // 'deepinfra' are two different drivers; a case-insensitive registry key
  // would treat them as the same provider and collide at mount time.
  const built = validateDrivers([
    makeSpec({ id: 'DeepInfra' }),
    makeSpec({ id: 'deepinfra' }),
  ])

  assert.equal(built.length, 2)
  assert.deepEqual(built.map((d) => d.id), ['DeepInfra', 'deepinfra'])
})

test('a duplicate id differing only in surrounding whitespace is ACCEPTED', () => {
  // WEAKNESS: ids are compared verbatim, so 'demo' and ' demo ' are two
  // drivers; the validator trims only to test for emptiness, never to
  // normalise the stored id, so the padded id is kept as ' demo '.
  const built = validateDrivers([
    makeSpec({ id: 'demo' }),
    makeSpec({ id: ' demo ' }),
  ])

  assert.equal(built.length, 2)
  assert.deepEqual(built.map((d) => d.id), ['demo', ' demo '])
})

test('an exactly duplicated id is rejected and names both driver positions', () => {
  assert.throws(
    () => validateDrivers([makeSpec({ id: 'demo' }), makeSpec({ id: 'demo' })]),
    (error) => {
      assert.match(error.message, /driver\[1\]\.id/)
      assert.match(error.message, /duplicate id 'demo'/)
      assert.match(error.message, /driver\[0\]\.id/)
      return true
    },
  )
})

test('a whitespace-only id is rejected as a non-empty string', () => {
  assert.throws(
    () => defineProviderDriver(makeSpec({ id: '   ' })),
    /id: must be a non-empty string/,
  )
})

test('ids that shadow Object.prototype members are accepted and tracked correctly', () => {
  // WEAKNESS: ids are stored in a Map, so '__proto__' / 'constructor' are
  // safe as *keys* (no pollution), but the contract imposes no id shape at
  // all — dots, slashes, spaces and unicode all pass.
  const built = validateDrivers([
    makeSpec({ id: '__proto__' }),
    makeSpec({ id: 'constructor' }),
    makeSpec({ id: 'a.b' }),
    makeSpec({ id: 'a b' }),
  ])

  assert.deepEqual(built.map((d) => d.id), ['__proto__', 'constructor', 'a.b', 'a b'])
  assert.equal(Object.prototype.polluted, undefined)
})

// ---------------------------------------------------------------------------
// 2. The same name as a tool in one driver and a command in another is LEGAL
// ---------------------------------------------------------------------------

test('the same name as a tool in one driver and a command in another is ALLOWED', () => {
  // Legal by design: tools and commands live in separate namespaces, so the
  // contract must not reject this. Asserted as allowed, not rejected.
  const toolOwner = makeSpec({
    id: 'tool-owner',
    surfaces: { model: { adapter: true, factory: 'createAdapter' }, tools: ['shared_name'] },
  })
  const commandOwner = makeSpec({
    id: 'command-owner',
    surfaces: { model: { adapter: true, factory: 'createAdapter' }, commands: ['shared_name'] },
  })

  const built = validateDrivers([toolOwner, commandOwner])

  assert.equal(built.length, 2)
  assert.deepEqual(effectiveSurfaceNames(built[0]).tools, ['shared_name'])
  assert.deepEqual(effectiveSurfaceNames(built[0]).commands, [])
  assert.deepEqual(effectiveSurfaceNames(built[1]).commands, ['shared_name'])
  assert.deepEqual(effectiveSurfaceNames(built[1]).tools, [])
})

test('the tool/command namespace split holds in the reverse declaration order too', () => {
  const commandOwner = makeSpec({
    id: 'command-owner',
    surfaces: { model: { adapter: true, factory: 'createAdapter' }, commands: ['shared_name'] },
  })
  const toolOwner = makeSpec({
    id: 'tool-owner',
    surfaces: { model: { adapter: true, factory: 'createAdapter' }, tools: ['shared_name'] },
  })

  const built = validateDrivers([commandOwner, toolOwner])

  assert.equal(built.length, 2)
})

test('a cli.commandName colliding with another driver\'s tool name is ALLOWED', () => {
  const cliOwner = makeSpec({
    id: 'cli-owner',
    surfaces: {
      model: { adapter: true, factory: 'createAdapter' },
      cli: { toolName: 'cli_tool', commandName: 'shared_name' },
    },
  })
  const toolOwner = makeSpec({
    id: 'tool-owner',
    surfaces: { model: { adapter: true, factory: 'createAdapter' }, tools: ['shared_name'] },
  })

  assert.equal(validateDrivers([cliOwner, toolOwner]).length, 2)
})

// ---------------------------------------------------------------------------
// 3. Tool-name collisions created only through different source fields
// ---------------------------------------------------------------------------

test('a cross-driver tool collision created only through cli.toolName vs subagent.toolName is rejected', () => {
  assert.throws(
    () => validateDrivers([
      makeSpec({
        id: 'a',
        surfaces: { model: { adapter: true, factory: 'createAdapter' }, cli: { toolName: 'T' } },
      }),
      makeSpec({
        id: 'b',
        surfaces: {
          model: { adapter: true, factory: 'createAdapter' },
          subagent: { toolRow: 'row', toolName: 'T', maxDepth: 1 },
        },
      }),
    ]),
    /driver\[1\]\.surfaces\.subagent\.toolName: tool name 'T' already declared at driver\[0\]\.surfaces\.cli\.toolName/,
  )
})

test('a cross-driver tool collision created only through batch.toolName vs tools[] is rejected', () => {
  assert.throws(
    () => validateDrivers([
      makeSpec({
        id: 'a',
        surfaces: { model: { adapter: true, factory: 'createAdapter' }, batch: { toolName: 'T' } },
      }),
      makeSpec({
        id: 'b',
        surfaces: { model: { adapter: true, factory: 'createAdapter' }, tools: ['T'] },
      }),
    ]),
    /driver\[1\]\.surfaces\.tools\[0\]: tool name 'T' already declared at driver\[0\]\.surfaces\.batch\.toolName/,
  )
})

test('every cli/subagent/batch/tools pairing is rejected across two drivers', () => {
  const sources = {
    'surfaces.cli.toolName': { model: { adapter: true, factory: 'f' }, cli: { toolName: 'T' } },
    'surfaces.subagent.toolName': {
      model: { adapter: true, factory: 'f' },
      subagent: { toolRow: 'row', toolName: 'T', maxDepth: 1 },
    },
    'surfaces.batch.toolName': { model: { adapter: true, factory: 'f' }, batch: { toolName: 'T' } },
    'surfaces.tools[0]': { model: { adapter: true, factory: 'f' }, tools: ['T'] },
  }
  const entries = Object.entries(sources)

  for (const [firstSource, firstSurfaces] of entries) {
    for (const [secondSource, secondSurfaces] of entries) {
      if (firstSource === secondSource) continue
      assert.throws(
        () => validateDrivers([
          makeSpec({ id: 'a', surfaces: firstSurfaces }),
          makeSpec({ id: 'b', surfaces: secondSurfaces }),
        ]),
        /tool name 'T' already declared/,
        `expected ${secondSource} to collide with ${firstSource}`,
      )
    }
  }
})

test('a command collision across cli.commandName and commands[] is rejected and names both sources', () => {
  assert.throws(
    () => validateDrivers([
      makeSpec({
        id: 'a',
        surfaces: {
          model: { adapter: true, factory: 'createAdapter' },
          cli: { toolName: 'cli_tool', commandName: 'C' },
        },
      }),
      makeSpec({
        id: 'b',
        surfaces: { model: { adapter: true, factory: 'createAdapter' }, commands: ['C'] },
      }),
    ]),
    /driver\[1\]\.surfaces\.commands\[0\]: command name 'C' already declared at driver\[0\]\.surfaces\.cli\.commandName/,
  )
})

test('an INTRA-driver tool-name collision across source fields is ACCEPTED', () => {
  // WEAKNESS: collision detection only runs across drivers; a single driver
  // may declare the same tool name in cli.toolName, subagent.toolName,
  // batch.toolName and tools[] at once, so one driver can claim one tool
  // name on four different surfaces.
  const driver = defineProviderDriver(makeSpec({
    id: 'intra',
    surfaces: {
      model: { adapter: true, factory: 'createAdapter' },
      cli: { toolName: 'T' },
      subagent: { toolRow: 'row', toolName: 'T', maxDepth: 1 },
      batch: { toolName: 'T' },
      tools: ['T'],
    },
  }))

  assert.deepEqual(effectiveSurfaceNames(driver), { tools: ['T'], commands: [] })
  assert.deepEqual(Object.keys(driver.surfaces), ['model', 'cli', 'subagent', 'batch', 'tools'])
})

test('an INTRA-driver command collision across cli.commandName and commands[] is ACCEPTED', () => {
  // WEAKNESS: same intra-driver hole on the command side.
  const driver = defineProviderDriver(makeSpec({
    id: 'intra-cmd',
    surfaces: {
      model: { adapter: true, factory: 'createAdapter' },
      cli: { toolName: 'cli_tool', commandName: 'C' },
      commands: ['C'],
    },
  }))

  assert.deepEqual(effectiveSurfaceNames(driver), { tools: ['cli_tool'], commands: ['C'] })
})

test('a duplicated entry inside one driver\'s tools[] survives into the built driver', () => {
  // WEAKNESS: the raw duplicate is preserved in the frozen driver; only
  // effectiveSurfaceNames de-duplicates it, so two consumers reading
  // driver.surfaces.tools directly would see the tool twice.
  const driver = defineProviderDriver(makeSpec({
    id: 'dup',
    surfaces: { model: { adapter: true, factory: 'createAdapter' }, tools: ['T', 'T'] },
  }))

  assert.deepEqual(driver.surfaces.tools, ['T', 'T'])
  assert.deepEqual(effectiveSurfaceNames(driver).tools, ['T'])
})

test('tool names differing only in whitespace do not collide across drivers', () => {
  // WEAKNESS: names are compared verbatim, so 'T' and ' T ' are distinct
  // tools even though the host trims command names before registering them.
  const built = validateDrivers([
    makeSpec({
      id: 'a',
      surfaces: { model: { adapter: true, factory: 'createAdapter' }, tools: ['T'] },
    }),
    makeSpec({
      id: 'b',
      surfaces: { model: { adapter: true, factory: 'createAdapter' }, tools: [' T '] },
    }),
  ])

  assert.equal(built.length, 2)
  assert.deepEqual(built[1].surfaces.tools, [' T '])
})

// ---------------------------------------------------------------------------
// 4. Readiness — valid auth with missing bridge / catalogLayer, unknown auth
// ---------------------------------------------------------------------------

test('a readiness with a valid auth but a missing bridge is rejected naming the bridge path', () => {
  assert.throws(
    () => defineProviderDriver(makeSpec({
      activation: { switches: [], readiness: { catalogLayer: 'layer-1', auth: 'web-auth' } },
    })),
    /activation\.readiness\.bridge: must be a string/,
  )
})

test('a readiness with a valid auth but a missing catalogLayer is rejected naming the catalogLayer path', () => {
  assert.throws(
    () => defineProviderDriver(makeSpec({
      activation: { switches: [], readiness: { bridge: 'bridge-1', auth: 'web-auth' } },
    })),
    /activation\.readiness\.catalogLayer: must be a string or a number/,
  )
})

test('an unknown auth mode is rejected and the message lists the allowed modes', () => {
  assert.throws(
    () => defineProviderDriver(makeSpec({
      activation: { switches: [], readiness: { bridge: 'bridge-1', catalogLayer: 'layer-1', auth: 'cookie' } },
    })),
    (error) => {
      assert.match(error.message, /activation\.readiness\.auth/)
      assert.match(error.message, /'web-auth' \| 'api-key' \| 'daemon'/)
      assert.match(error.message, /received "cookie"/)
      return true
    },
  )
})

test('a missing auth mode is rejected naming the auth path', () => {
  assert.throws(
    () => defineProviderDriver(makeSpec({
      activation: { switches: [], readiness: { bridge: 'bridge-1', catalogLayer: 'layer-1' } },
    })),
    /activation\.readiness\.auth: must be one of .*received undefined/,
  )
})

test('a catalogLayer that is NaN or Infinity is ACCEPTED as a number', () => {
  // WEAKNESS: the catalogLayer check is `typeof === 'number'`, so NaN and
  // Infinity pass; both serialise to null over JSON, silently changing the
  // layer id to null.
  for (const value of [NaN, Infinity, -Infinity]) {
    const driver = defineProviderDriver(makeSpec({
      activation: { switches: [], readiness: { bridge: 'bridge-1', catalogLayer: value, auth: 'api-key' } },
    }))
    assert.equal(driver.activation.readiness.catalogLayer, value)
    assert.equal(JSON.stringify(driver.activation.readiness.catalogLayer), 'null')
  }
})

test('a readiness that is not an object is rejected naming the readiness path', () => {
  assert.throws(
    () => defineProviderDriver(makeSpec({ activation: { switches: [], readiness: 'yes' } })),
    /activation\.readiness: must be an object/,
  )
})

test('an empty readiness.bridge is rejected as a non-empty string', () => {
  assert.throws(
    () => defineProviderDriver(makeSpec({
      activation: { switches: [], readiness: { bridge: '  ', catalogLayer: 'layer-1', auth: 'api-key' } },
    })),
    /activation\.readiness\.bridge: must be a non-empty string/,
  )
})

test('a readiness without health is accepted and the field is omitted from the built driver', () => {
  const driver = defineProviderDriver(makeSpec({
    activation: { switches: [], readiness: { bridge: 'bridge-1', catalogLayer: 'layer-1', auth: 'daemon' } },
  }))

  assert.deepEqual(driver.activation.readiness, {
    bridge: 'bridge-1',
    catalogLayer: 'layer-1',
    auth: 'daemon',
  })
  assert.ok(!('health' in driver.activation.readiness))
})

// ---------------------------------------------------------------------------
// 5. activation.switches — duplicate names, missing module / role
// ---------------------------------------------------------------------------

test('duplicate switch names in one driver are ACCEPTED', () => {
  // WEAKNESS: switch names are not unique-checked, so one driver can declare
  // the same switch name twice with different module/role pairs; the second
  // switch silently shadows or duplicates the first at mount time.
  const driver = defineProviderDriver(makeSpec({
    activation: {
      switches: [
        { name: 'deepinfra', module: 'module-a', role: 'adapter' },
        { name: 'deepinfra', module: 'module-b', role: 'bridge' },
      ],
    },
  }))

  assert.equal(driver.activation.switches.length, 2)
  assert.deepEqual(driver.activation.switches.map((sw) => sw.name), ['deepinfra', 'deepinfra'])
})

test('the same switch name declared by two different drivers is ACCEPTED', () => {
  // WEAKNESS: switch names are not unique-checked across drivers either, so
  // two drivers can both claim the switch 'enabled' in the same module.
  const built = validateDrivers([
    makeSpec({
      id: 'switch-owner-a',
      activation: { switches: [{ name: 'enabled', module: 'config', role: 'master' }] },
    }),
    makeSpec({
      id: 'switch-owner-b',
      activation: { switches: [{ name: 'enabled', module: 'other', role: 'master' }] },
    }),
  ])

  assert.equal(built.length, 2)
})

test('a switch missing module is rejected naming the switch index and field', () => {
  assert.throws(
    () => defineProviderDriver(makeSpec({
      activation: { switches: [{ name: 'deepinfra', role: 'adapter' }] },
    })),
    /activation\.switches\[0\]\.module: must be a string/,
  )
})

test('a switch missing role is rejected naming the switch index and field', () => {
  assert.throws(
    () => defineProviderDriver(makeSpec({
      activation: { switches: [{ name: 'deepinfra', module: 'deepinfra-module' }] },
    })),
    /activation\.switches\[0\]\.role: must be a string/,
  )
})

test('a switch missing name is rejected naming the switch index and field', () => {
  assert.throws(
    () => defineProviderDriver(makeSpec({
      activation: { switches: [{ module: 'deepinfra-module', role: 'adapter' }] },
    })),
    /activation\.switches\[0\]\.name: must be a string/,
  )
})

test('a switch that is not an object is rejected naming the switch index', () => {
  assert.throws(
    () => defineProviderDriver(makeSpec({ activation: { switches: ['deepinfra'] } })),
    /activation\.switches\[0\]: must be an object/,
  )
})

test('activation.switches that is not an array is rejected naming the field', () => {
  assert.throws(
    () => defineProviderDriver(makeSpec({ activation: { switches: {} } })),
    /activation\.switches: must be an array/,
  )
})

test('a switch name that is only whitespace is rejected as a non-empty string', () => {
  assert.throws(
    () => defineProviderDriver(makeSpec({
      activation: { switches: [{ name: ' ', module: 'm', role: 'r' }] },
    })),
    /activation\.switches\[0\]\.name: must be a non-empty string/,
  )
})

test('extra switch fields are dropped by the builder', () => {
  const driver = defineProviderDriver(makeSpec({
    activation: { switches: [{ name: 'x', module: 'm', role: 'r', extra: 'ignored' }] },
  }))

  assert.deepEqual(driver.activation.switches, [{ name: 'x', module: 'm', role: 'r' }])
  assert.ok(!('extra' in driver.activation.switches[0]))
})

// ---------------------------------------------------------------------------
// 6. Prototype pollution
// ---------------------------------------------------------------------------

test('an own __proto__ key in hooks is REJECTED before any freeze', () => {
  const spec = makeSpec()
  const hooks = { readEvent: () => null }
  Object.defineProperty(hooks, '__proto__', { value: Object.prototype, enumerable: true, writable: true, configurable: true })
  spec.hooks = hooks
  assert.throws(() => defineProviderDriver(spec), /hooks\.__proto__/)
  assert.equal(Object.isFrozen(Object.prototype), false, 'Object.prototype must never be frozen')
})
test('a JSON-parsed spec with a __proto__ key is REJECTED', () => {
  const parsed = JSON.parse('{"__proto__":{"polluted":"yes"}}')
  parsed.readEvent = () => null
  const spec = makeSpec({ hooks: parsed })
  assert.throws(() => defineProviderDriver(spec), /hooks\.__proto__/)
  assert.equal(Object.prototype.polluted, undefined)
})
test('an own constructor key is REJECTED', () => {
  const spec = makeSpec()
  const hooks = { readEvent: () => null }
  Object.defineProperty(hooks, 'constructor', { value: { evil: true }, enumerable: true, writable: true, configurable: true })
  spec.hooks = hooks
  assert.throws(() => defineProviderDriver(spec), /hooks\.constructor/)
})
test('an own __proto__ key in surfaces is REJECTED', () => {
  const spec = makeSpec()
  const surfaces = { model: { adapter: true, factory: 'f' } }
  Object.defineProperty(surfaces, '__proto__', { value: { polluted: 'yes' }, enumerable: true, writable: true, configurable: true })
  spec.surfaces = surfaces
  assert.throws(() => defineProviderDriver(spec), /surfaces\.__proto__/)
  assert.equal(Object.getPrototypeOf(spec.surfaces), Object.prototype)
})
test('a reserved-key payload is rejected before the builder can freeze it', () => {
  const payload = { polluted: 1 }
  const spec = makeSpec()
  const hooks = { readEvent: () => null }
  Object.defineProperty(hooks, '__proto__', { value: payload, enumerable: true, writable: true, configurable: true })
  spec.hooks = hooks
  assert.throws(() => defineProviderDriver(spec), /__proto__/)
  assert.equal(Object.isFrozen(payload), false, 'the caller payload must not be frozen')
})
test('a spec whose readEvent is inherited rather than own is REJECTED', () => {
  const spec = makeSpec()
  spec.hooks = Object.create({ readEvent: () => 'inherited' })
  spec.hooks.marker = true
  assert.throws(() => defineProviderDriver(spec), /hooks\.readEvent/)
})
test('a non-enumerable own readEvent survives into the built driver', () => {
  const spec = makeSpec()
  spec.hooks = {}
  Object.defineProperty(spec.hooks, 'readEvent', { value: () => 'hidden', enumerable: false, writable: false, configurable: false })
  const driver = defineProviderDriver(spec)
  assert.equal(typeof driver.hooks.readEvent, 'function')
  assert.equal(driver.hooks.readEvent(), 'hidden')
})
test('an inherited optional hook is ignored, not silently validated', () => {
  const hooks = Object.create({ classifyText: () => [] })
  hooks.readEvent = () => null
  const spec = makeSpec({ hooks })
  const driver = defineProviderDriver(spec)
  assert.equal(driver.hooks.classifyText, undefined)
})
test('a hook function object is shared with the caller spec and stays mutable', () => {
  // WEAKNESS: deepFreeze does not freeze function values (typeof
  // 'function' !== 'object'), so the built driver shares the caller's
  // function object and the caller can mutate it after validation.
  const spec = makeSpec()
  spec.hooks.readEvent.tag = 'shared'

  const driver = defineProviderDriver(spec)

  assert.equal(driver.hooks.readEvent, spec.hooks.readEvent)
  assert.equal(Object.isFrozen(driver.hooks.readEvent), false)

  spec.hooks.readEvent.tag = 'MUTATED'
  assert.equal(driver.hooks.readEvent.tag, 'MUTATED')
})

// ---------------------------------------------------------------------------
// 7. Mutating a returned frozen driver
// ---------------------------------------------------------------------------

test('assigning to the top level of a frozen driver throws in strict mode', () => {
  const driver = defineProviderDriver(makeSpec())

  assert.ok(Object.isFrozen(driver))
  assert.throws(() => { driver.id = 'hacked' }, TypeError)
  assert.equal(driver.id, 'demo')
})

test('assigning to a nested frozen descriptor throws in strict mode', () => {
  const driver = defineProviderDriver(makeSpec())

  assert.ok(Object.isFrozen(driver.descriptor))
  assert.ok(Object.isFrozen(driver.descriptor.usage))
  assert.throws(() => { driver.descriptor.usage.totalFormula = 'gemini' }, TypeError)
  assert.equal(driver.descriptor.usage.totalFormula, 'prompt+output')
})

test('mutating a nested frozen surface descriptor throws in strict mode', () => {
  const driver = defineProviderDriver(makeSpec({
    surfaces: {
      model: { adapter: true, factory: 'createAdapter' },
      cli: { toolName: 'cli_tool', commandName: 'cmd' },
      subagent: { toolRow: 'row', toolName: 'sub_tool', maxDepth: 2 },
      batch: { toolName: 'batch_tool' },
    },
  }))

  assert.throws(() => { driver.surfaces.cli.toolName = 'x' }, TypeError)
  assert.throws(() => { driver.surfaces.subagent.maxDepth = 99 }, TypeError)
  assert.throws(() => { driver.surfaces.batch.toolName = 'x' }, TypeError)
  assert.throws(() => { driver.surfaces.model.factory = 'x' }, TypeError)
})

test('mutating a frozen activation descriptor throws in strict mode', () => {
  const driver = defineProviderDriver(makeSpec({
    activation: {
      switches: [{ name: 'x', module: 'm', role: 'r' }],
      readiness: { bridge: 'b', catalogLayer: 'l', auth: 'api-key', health: 'probe' },
    },
  }))

  assert.throws(() => { driver.activation.switches[0].name = 'y' }, TypeError)
  assert.throws(() => { driver.activation.readiness.auth = 'daemon' }, TypeError)
  assert.throws(() => { driver.activation.switches.push({ name: 'z', module: 'm', role: 'r' }) }, TypeError)
  assert.equal(driver.activation.switches[0].name, 'x')
})

test('mutating a frozen surface name array throws in strict mode', () => {
  const driver = defineProviderDriver(makeSpec({
    surfaces: { model: { adapter: true, factory: 'createAdapter' }, tools: ['t1'], commands: ['c1'] },
  }))

  assert.throws(() => driver.surfaces.tools.push('t2'), TypeError)
  assert.throws(() => driver.surfaces.commands.pop(), TypeError)
  assert.throws(() => { driver.surfaces.tools[0] = 'x' }, TypeError)
  assert.deepEqual(driver.surfaces.tools, ['t1'])
})

test('sorting a frozen name array of two or more entries throws, but a single-entry sort is a no-op', () => {
  // The frozen array rejects any write, but Array.prototype.sort on a
  // one-element array performs no write at all, so it silently succeeds.
  const single = defineProviderDriver(makeSpec({
    surfaces: { model: { adapter: true, factory: 'createAdapter' }, tools: ['t1'] },
  }))
  assert.doesNotThrow(() => single.surfaces.tools.sort())
  assert.deepEqual(single.surfaces.tools, ['t1'])

  const multi = defineProviderDriver(makeSpec({
    surfaces: { model: { adapter: true, factory: 'createAdapter' }, tools: ['t2', 't1'] },
  }))
  assert.throws(() => multi.surfaces.tools.sort(), TypeError)
  assert.deepEqual(multi.surfaces.tools, ['t2', 't1'])
})

test('deleting a property of a frozen driver throws in strict mode', () => {
  const driver = defineProviderDriver(makeSpec())

  assert.throws(() => { delete driver.id }, TypeError)
  assert.ok('id' in driver)
})

test('re-prototyping a frozen driver throws in strict mode', () => {
  const driver = defineProviderDriver(makeSpec())

  assert.throws(() => { Object.setPrototypeOf(driver, { evil: true }) }, TypeError)
  assert.equal(driver.evil, undefined)
})

test('the frozen driver array returned by validateDrivers rejects mutation', () => {
  const drivers = validateDrivers([modelOnlySpec('a')])

  assert.ok(Object.isFrozen(drivers))
  assert.ok(Object.isFrozen(drivers[0]))
  assert.throws(() => drivers.push(modelOnlySpec('b')), TypeError)
})

test('the built driver does not alias the caller\'s mutable collections', () => {
  // The name collections ARE copied (tools/commands/switches), so a later
  // push on the caller's array cannot reach the built driver. The copy is
  // shallow though: a hook *function* is shared by reference and stays
  // mutable — see the hook-sharing WEAKNESS test above.
  const spec = makeSpec({
    surfaces: { model: { adapter: true, factory: 'createAdapter' }, tools: ['t1'] },
  })
  const driver = defineProviderDriver(spec)

  spec.surfaces.tools.push('t2')
  spec.activation.switches.push({ name: 'z', module: 'm', role: 'r' })

  assert.deepEqual(driver.surfaces.tools, ['t1'])
  assert.equal(driver.activation.switches.length, 0)
  assert.equal(Object.isFrozen(spec.surfaces.tools), false)
})

// ---------------------------------------------------------------------------
// 8. Model-only drivers
// ---------------------------------------------------------------------------

test('a driver with no surfaces except model has empty effectiveSurfaceNames', () => {
  const driver = defineProviderDriver(modelOnlySpec('model-only'))

  assert.deepEqual(effectiveSurfaceNames(driver), { tools: [], commands: [] })
  assert.deepEqual(Object.keys(driver.surfaces), ['model'])
})

test('two model-only drivers do NOT collide', () => {
  const built = validateDrivers([modelOnlySpec('model-a'), modelOnlySpec('model-b')])

  assert.equal(built.length, 2)
  assert.deepEqual(built.map((d) => d.id), ['model-a', 'model-b'])
  assert.deepEqual(effectiveSurfaceNames(built[0]), { tools: [], commands: [] })
  assert.deepEqual(effectiveSurfaceNames(built[1]), { tools: [], commands: [] })
})

test('a model-only driver with empty tools[] and commands[] arrays is still empty', () => {
  const driver = defineProviderDriver(makeSpec({
    id: 'model-only-arrays',
    surfaces: { model: { adapter: true, factory: 'createAdapter' }, tools: [], commands: [] },
  }))

  assert.deepEqual(effectiveSurfaceNames(driver), { tools: [], commands: [] })
})

test('a driver missing surfaces.model is rejected naming the model path', () => {
  assert.throws(
    () => defineProviderDriver(makeSpec({ surfaces: { cli: { toolName: 'x' } } })),
    /surfaces\.model: must be an object/,
  )
})

test('effectiveSurfaceNames rejects a non-driver object naming the surfaces path', () => {
  assert.throws(() => effectiveSurfaceNames({}), /surfaces: must be an object/)
  assert.throws(() => effectiveSurfaceNames(null), /surfaces: must be an object/)
})

// ---------------------------------------------------------------------------
// Cross-cutting: error-message quality and the host-level name rules
// ---------------------------------------------------------------------------

test('a missing top-level field names its path with the driver index inside validateDrivers', () => {
  const spec = makeSpec()
  delete spec.activation

  assert.throws(
    () => validateDrivers([modelOnlySpec('ok'), spec]),
    /driver\[1\]\.activation: must be an object/,
  )
})

test('validateDrivers rejects a non-array and a non-object entry', () => {
  assert.throws(() => validateDrivers('nope'), /drivers: must be an array/)
  assert.throws(() => validateDrivers([null]), /driver\[0\]: must be an object/)
})

test('a driver id that is an empty string is rejected naming the id path', () => {
  assert.throws(() => defineProviderDriver(makeSpec({ id: '' })), /id: must be a non-empty string/)
})

test('command names that the host would reject are ACCEPTED by the contract', () => {
  // WEAKNESS: the contract imposes no name syntax at all, so a command that
  // the host validates against /^[a-z][a-z0-9_-]*$/u (CUSTOM-ROUTER-
  // SURFACE-CONTRACT §5.2) sails through and fails only at registration.
  const driver = defineProviderDriver(makeSpec({
    id: 'bad-names',
    surfaces: {
      model: { adapter: true, factory: 'createAdapter' },
      cli: { toolName: 'tool_name', commandName: 'DeepInfra' },
      commands: ['not a command!'],
    },
  }))

  assert.equal(driver.surfaces.cli.commandName, 'DeepInfra')
  assert.deepEqual(driver.surfaces.commands, ['not a command!'])
})

test('the reserved subagent tool namespace is ACCEPTED by the contract', () => {
  // WEAKNESS: CUSTOM-ROUTER-SURFACE-CONTRACT §4.3 reserves 'subagent' and
  // 'subagent_*' tool names; the contract does not enforce that reservation.
  for (const toolName of ['subagent', 'subagent_local']) {
    const driver = defineProviderDriver(makeSpec({
      id: 'reserved',
      surfaces: {
        model: { adapter: true, factory: 'createAdapter' },
        subagent: { toolRow: 'row', toolName, maxDepth: 1 },
      },
    }))
    assert.equal(driver.surfaces.subagent.toolName, toolName)
  }
})

test('a non-string tool name in tools[] is rejected naming the array index', () => {
  assert.throws(
    () => defineProviderDriver(makeSpec({
      surfaces: { model: { adapter: true, factory: 'createAdapter' }, tools: [{}] },
    })),
    /surfaces\.tools\[0\]: must be a string/,
  )
})

test('a batch.gate that is neither a function nor a string is rejected naming the field', () => {
  assert.throws(
    () => defineProviderDriver(makeSpec({
      surfaces: { model: { adapter: true, factory: 'createAdapter' }, batch: { toolName: 'b', gate: 42 } },
    })),
    /surfaces\.batch\.gate: must be a string/,
  )
})

test('a subagent.maxDepth that is not a positive integer is rejected naming the field', () => {
  for (const value of [0, -1, 1.5, '2', null]) {
    assert.throws(
      () => defineProviderDriver(makeSpec({
        surfaces: {
          model: { adapter: true, factory: 'createAdapter' },
          subagent: { toolRow: 'row', toolName: 's', maxDepth: value },
        },
      })),
      /surfaces\.subagent\.maxDepth: must be a positive integer/,
      `expected maxDepth ${JSON.stringify(value)} to be rejected`,
    )
  }
})

test('isPlainObject accepts a class instance as a spec, so field checks apply to its own props', () => {
  // WEAKNESS: isPlainObject only excludes arrays and null, so class
  // instances, Dates and Maps pass the "must be an object" gate; the
  // contract's type checks then cover only the fields it happens to read.
  class Weird {
    constructor() {
      this.readEvent = () => null
    }
  }

  const driver = defineProviderDriver(makeSpec({ hooks: new Weird() }))

  assert.equal(typeof driver.hooks.readEvent, 'function')
})

test('the error for a colliding tool name names both the offender and the previous owner', () => {
  const message = messageOf(() => validateDrivers([
    makeSpec({
      id: 'a',
      surfaces: { model: { adapter: true, factory: 'createAdapter' }, tools: ['T'] },
    }),
    makeSpec({
      id: 'b',
      surfaces: { model: { adapter: true, factory: 'createAdapter' }, cli: { toolName: 'T' } },
    }),
  ]))

  assert.equal(message, "driver[1].surfaces.cli.toolName: tool name 'T' already declared at driver[0].surfaces.tools[0]")
})

test('the error for an offending driver that declares the name twice reports only one source', () => {
  // WEAKNESS: sourceOf() returns the FIRST provenance hit, and provenance
  // lists surfaces.tools[] before cli/subagent/batch, so the message names
  // only one of the two colliding declarations; the cli.toolName collision
  // is invisible in the error the user sees.
  const message = messageOf(() => validateDrivers([
    makeSpec({
      id: 'a',
      surfaces: { model: { adapter: true, factory: 'createAdapter' }, tools: ['T'] },
    }),
    makeSpec({
      id: 'b',
      surfaces: {
        model: { adapter: true, factory: 'createAdapter' },
        cli: { toolName: 'T' },
        tools: ['T'],
      },
    }),
  ]))

  assert.equal(message, "driver[1].surfaces.tools[0]: tool name 'T' already declared at driver[0].surfaces.tools[0]")
})
