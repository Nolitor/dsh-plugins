/**
 * Preset declaration contract (M13–M16 as data).
 *
 * These tests pin the three measured declarations, the lane rule (a `pi-ai`
 * route requires a protocol the host implements) and the cross-preset
 * uniqueness the host tool/command registries demand. They also pin the module
 * property the contract states: it registers nothing.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'

import * as presetsModule from '../lib/presets.js'
import {
  DECLARATION_EXAMPLE,
  DSH_PROTOCOLS,
  PRESETS,
  findPreset,
  validatePreset,
  validatePresets,
} from '../lib/presets.js'
import { PRESET_JSON_SCHEMA } from '../lib/preset-schema.js'

test('the three measured presets validate cleanly', () => {
  const verdict = validatePresets(PRESETS)
  assert.deepEqual(verdict.errors, [])
  assert.equal(verdict.ok, true)
})

test('each preset names its measured protocol lane', () => {
  assert.equal(findPreset('antigravity').endpoint.protocol, 'google-generative-sse')
  assert.equal(findPreset('antigravity').endpoint.route, 'own')
  assert.equal(findPreset('opencode').endpoint.protocol, 'openai-completions')
  assert.equal(findPreset('deepinfra').endpoint.protocol, 'openai-completions')
  assert.deepEqual([...DSH_PROTOCOLS], ['openai-completions', 'openai-responses', 'anthropic-messages'])
})

test('a pi-ai route is rejected on a wire the host does not implement', () => {
  const candidate = structuredClone(PRESETS[0])
  candidate.endpoint.route = 'pi-ai'
  const verdict = validatePreset(candidate)
  assert.equal(verdict.ok, false)
  assert.match(verdict.errors.join(' '), /requires a host protocol/)
})

test('a pi-ai route is accepted on a DSH protocol', () => {
  const candidate = structuredClone(PRESETS[1])
  candidate.endpoint.route = 'pi-ai'
  const verdict = validatePreset(candidate)
  assert.deepEqual(verdict.errors, [])
})

test('subagent rows follow the host shared-row shape', () => {
  const candidate = structuredClone(PRESETS[0])
  candidate.surfaces.subagent.toolRow = '@nolit/some-other-tool'
  const verdict = validatePreset(candidate)
  assert.equal(verdict.ok, false)
  assert.match(verdict.errors.join(' '), /shared tool/)
})

test('a CLI tool must be listed in tools and differ from the batch tool', () => {
  const candidate = structuredClone(PRESETS[0])
  candidate.surfaces.tools = ['agy_worker']
  const verdict = validatePreset(candidate)
  assert.match(verdict.errors.join(' '), /batch\.toolName must appear/)
})

test('cross-preset tool and command collisions are errors', () => {
  const first = structuredClone(PRESETS[2])
  const second = structuredClone(PRESETS[2])
  second.id = 'deepinfra-copy'
  second.providerId = 'deepinfra-copy'
  second.surfaces.tools = ['shared_tool']
  first.surfaces.tools = ['shared_tool']
  const verdict = validatePresets([first, second])
  assert.equal(verdict.ok, false)
  assert.match(verdict.errors.join(' '), /claimed by both/)
})

test('a skill declaration must carry its invocation policy', () => {
  const candidate = structuredClone(PRESETS[2])
  candidate.surfaces.skill = { name: 'deepinfra-cli' }
  const verdict = validatePreset(candidate)
  assert.equal(verdict.ok, false)
  assert.match(verdict.errors.join(' '), /modelInvocable/)
})

test('the module registers nothing: no apply, no context, frozen data', async () => {
  assert.equal(typeof presetsModule.apply, 'undefined')
  assert.ok(Object.isFrozen(PRESETS))
  assert.ok(Object.isFrozen(PRESETS[0]))
  const source = await readFile(new URL('../lib/presets.js', import.meta.url), 'utf8')
  assert.equal(/ctx\.|cordis|register\(/.test(source), false)
})

test('every preset declares its package, row and switches', () => {
  for (const preset of PRESETS) {
    assert.match(preset.package, /^@[a-z0-9-]+\/[a-z0-9-]+$/)
    assert.match(preset.row, /^[a-z0-9-]+$/)
    assert.ok(Array.isArray(preset.switches))
  }
  const opencode = findPreset('opencode')
  assert.deepEqual([...opencode.surfaces.commands], ['ocode'])
  const modelSwitch = opencode.switches.find((item) => item.role === 'model')
  assert.equal(modelSwitch.name, 'modelServing')
  assert.equal(modelSwitch.module, 'http')
  const master = opencode.switches.find((item) => item.role === 'master')
  assert.equal(master.name, 'enabled')
})

test('a malformed switch declaration is rejected', () => {
  const candidate = structuredClone(PRESETS[0])
  candidate.switches = [{ name: 'Model Serving', module: 'index', role: 'model' }]
  const verdict = validatePreset(candidate)
  assert.equal(verdict.ok, false)
  assert.match(verdict.errors.join(' '), /camelCase/)
})

test('the common data model covers delivery, auth and endpoint for every preset', () => {
  for (const preset of PRESETS) {
    assert.equal(preset.kind, 'package')
    assert.ok(['api-key', 'web-auth', 'local-socket', 'none'].includes(preset.auth.mode))
    assert.ok(['http', 'local-http', 'daemon'].includes(preset.endpoint.mode))
    assert.ok(preset.endpoint.protocol.length > 0)
    assert.ok(Array.isArray(preset.auth.sources))
  }
  const deepinfra = findPreset('deepinfra')
  assert.equal(deepinfra.auth.mode, 'api-key')
  assert.deepEqual(deepinfra.auth.sources.map((source) => source.kind), ['secret-field', 'env'])
  const antigravity = findPreset('antigravity')
  assert.equal(antigravity.auth.mode, 'web-auth')
  assert.equal(antigravity.auth.sources[0].kind, 'token-file')
})

test('a JSON declaration preset validates without a package', () => {
  const verdict = validatePreset(PRESETS.length > 0 ? DECLARATION_EXAMPLE : null)
  assert.deepEqual(verdict.errors, [])
  assert.equal(DECLARATION_EXAMPLE.kind, 'declaration')
  assert.equal(DECLARATION_EXAMPLE.endpoint.mode, 'local-http')
  assert.equal(DECLARATION_EXAMPLE.auth.mode, 'none')
})

test('a declaration preset may not name a package', () => {
  const candidate = structuredClone(DECLARATION_EXAMPLE)
  candidate.package = '@nolit/not-allowed'
  const verdict = validatePreset(candidate)
  assert.equal(verdict.ok, false)
  assert.match(verdict.errors.join(' '), /must not name a package/)
})

test('local-socket auth requires a local endpoint', () => {
  const candidate = structuredClone(DECLARATION_EXAMPLE)
  candidate.endpoint.mode = 'http'
  candidate.endpoint.baseUrl = 'https://example.test/v1'
  candidate.auth = { mode: 'local-socket', sources: [{ kind: 'daemon-endpoint', name: '/api/credential' }] }
  const verdict = validatePreset(candidate)
  assert.equal(verdict.ok, false)
  assert.match(verdict.errors.join(' '), /local-http/)
})

test('the JSON Schema mirror names the required fields', () => {
  assert.deepEqual(
    [...PRESET_JSON_SCHEMA.required].sort(),
    ['auth', 'catalog', 'endpoint', 'id', 'kind', 'providerId', 'row', 'usage'].sort(),
  )
  assert.equal(PRESET_JSON_SCHEMA.properties.endpoint.properties.protocol.enum.includes('google-generative-sse'), true)
})
