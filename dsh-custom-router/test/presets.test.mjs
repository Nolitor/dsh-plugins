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
  TOOL_SUBAGENT_ROW,
  findPreset,
  validateEntries,
  validatePreset,
  validatePresets,
} from '../lib/presets.js'
import { planApplications, presetEntries } from '../lib/index.js'
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
    assert.match(preset.package, /^@[a-z0-9-]+\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/)
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

// ---- entries: the rows one preset mounts (2026-11-07) ----------------------

test('every package preset declares its measured entry set', () => {
  const antigravity = findPreset('antigravity')
  assert.deepEqual(antigravity.entries.map((entry) => entry.row), ['dsh-antigravity', 'tool-subagent-antigravity'])
  // The shared row is the host's own package, not the vendor's.
  assert.equal(antigravity.entries[1].specifier, TOOL_SUBAGENT_ROW)
  assert.deepEqual(
    { ...antigravity.entries[1].config },
    { provider: 'antigravity', toolName: 'subagent_antigravity', maxDepth: 'provider-managed', modelSelection: true },
  )

  const opencode = findPreset('opencode')
  assert.deepEqual(
    opencode.entries.map((entry) => entry.row),
    ['dsh-opencode-v2', 'dsh-opencode-v2-http', 'tool-subagent-opencode'],
  )
  // The /http row is the SAME package under a different export subpath: it is
  // the native model router, and mounting only the index row drops
  // `opencode-http-agent` entirely (measured 2026-11-07).
  assert.equal(opencode.entries[1].specifier, '@nolit/dsh-opencode-v2/http')
  assert.equal(opencode.entries[2].specifier, TOOL_SUBAGENT_ROW)

  // A single-package preset still carries one entry, so every preset has the
  // same shape and the router has one code path.
  assert.deepEqual(findPreset('deepinfra').entries.map((entry) => entry.row), ['dsh-deepinfra'])
})

test('an entry without a specifier inherits the preset package', () => {
  for (const preset of PRESETS) {
    for (const entry of preset.entries ?? []) {
      if (entry.specifier === undefined) assert.equal(typeof preset.package, 'string')
    }
  }
})

test('entry validation rejects duplicate rows and empty package presets', () => {
  const duplicate = structuredClone(PRESETS[0])
  duplicate.entries = [{ row: 'dsh-antigravity' }, { row: 'dsh-antigravity' }]
  const duplicateVerdict = validatePreset(duplicate)
  assert.equal(duplicateVerdict.ok, false)
  assert.match(duplicateVerdict.errors.join(' '), /declared twice/)

  const empty = structuredClone(PRESETS[0])
  empty.entries = []
  assert.match(validatePreset(empty).errors.join(' '), /at least one entry/)

  const badRow = structuredClone(PRESETS[0])
  badRow.entries = [{ row: 'Not A Row' }]
  assert.match(validatePreset(badRow).errors.join(' '), /loader row id/)

  const badConfig = structuredClone(PRESETS[0])
  badConfig.entries = [{ row: 'dsh-antigravity', config: 'nope' }]
  assert.match(validatePreset(badConfig).errors.join(' '), /entry\.config must be an object/)
})

test('a declaration preset declares no entries and a package preset without entries stays valid', () => {
  const declared = structuredClone(DECLARATION_EXAMPLE)
  declared.entries = [{ row: 'some-row' }]
  assert.match(validatePreset(declared).errors.join(' '), /must not declare entries/)

  // Back-compat: a preset predating `entries` still validates.
  const legacy = structuredClone(PRESETS[2])
  delete legacy.entries
  assert.deepEqual(validatePreset(legacy).errors, [])
})

test('the JSON Schema mirror documents entries', () => {
  const entries = PRESET_JSON_SCHEMA.properties.entries
  assert.equal(entries.type, 'array')
  assert.deepEqual([...entries.items.required], ['row'])
  assert.equal(entries.items.properties.specifier.minLength, 1)
})

// ---- entry validation and cross-preset row ownership (2026-11-08) ----------

test('a package preset must name a package', () => {
  // `validateEntries` never checked this: a package preset with no `package`
  // validated cleanly, and `presetEntries()` then synthesised nothing — a
  // preset that mounts zero rows while claiming to be code-backed.
  const candidate = structuredClone(PRESETS[0])
  delete candidate.package
  const verdict = validatePreset(candidate)
  assert.equal(verdict.ok, false)
  assert.match(verdict.errors.join(' '), /must name a package/)

  // The same rule holds for an entry-less legacy preset: the fallback mount is
  // "this preset's own package", which cannot exist without the name.
  const legacy = structuredClone(PRESETS[2])
  delete legacy.entries
  delete legacy.package
  assert.match(validatePreset(legacy).errors.join(' '), /must name a package/)

  // An empty string is not a package name either.
  const empty = structuredClone(PRESETS[0])
  empty.package = ''
  assert.match(validatePreset(empty).errors.join(' '), /must name a package/)
})

test('a package preset with no entries and no package is rejected in one pass', () => {
  // The dead double-`return []` branch is gone: both rules now report.
  const candidate = structuredClone(PRESETS[0])
  delete candidate.package
  candidate.entries = []
  const errors = validateEntries(candidate)
  assert.deepEqual(errors, ['a package preset must name a package', 'a package preset requires at least one entry'])
})

test('presetEntries refuses to synthesise a mount for a declaration preset with a package', () => {
  // The validator rejects this shape, but the export is callable unvalidated.
  const declared = { ...structuredClone(DECLARATION_EXAMPLE), package: '@nolit/sneaky' }
  assert.deepEqual(presetEntries(declared), [])
  // A declaration preset with well-formed entries is refused too.
  assert.deepEqual(presetEntries({ ...declared, entries: [{ row: 'some-row' }] }), [])
})

test('two presets may not claim the same loader row', () => {
  const first = structuredClone(PRESETS[2])
  const second = structuredClone(PRESETS[2])
  second.id = 'deepinfra-copy'
  second.providerId = 'deepinfra-copy'
  // Same row id, different preset: one settings namespace, two owners.
  const verdict = validatePresets([first, second])
  assert.equal(verdict.ok, false)
  assert.match(verdict.errors.join(' '), /row "dsh-deepinfra" is claimed by both "deepinfra" and "deepinfra-copy"/)
})

test('a row collision is reported by the plan, not silently mounted twice', () => {
  const first = structuredClone(PRESETS[2])
  const second = structuredClone(PRESETS[2])
  second.id = 'deepinfra-copy'
  second.providerId = 'deepinfra-copy'
  const plan = planApplications({ presets: { deepinfra: true, 'deepinfra-copy': true } }, [first, second])
  assert.equal(plan.errors.length > 0, true)
  assert.match(plan.errors.join(' '), /row "dsh-deepinfra" is declared by both/)
})

test('the measured presets claim disjoint rows', () => {
  // The real declarations must stay collision-free: the three vendors own
  // different rows, and only the SHARED subagent package is reused (under
  // distinct row ids).
  const rows = PRESETS.flatMap((preset) => preset.entries.map((entry) => entry.row))
  assert.equal(new Set(rows).size, rows.length)
  assert.deepEqual(validatePresets(PRESETS).errors, [])
})

test('the OpenCode CLI surface is declared LIVE (the profile ships it on)', () => {
  // Corrected 2026-11-08. An earlier revision of this test asserted `default:
  // false` on the strength of a migration step that switched the surface off;
  // the switch was withdrawn because it also removed `/ocode` and the
  // `opencode` tool that users call. The declaration now matches the shipping
  // profile, and `gates` still names the extra tools the ONE vendor switch
  // (`cliOn`) takes down, so a profile that DOES set `cli: false` stays honest.
  const opencode = findPreset('opencode')
  assert.equal(opencode.surfaces.cli.default, undefined, 'the CLI surface ships ON')
  assert.deepEqual([...opencode.surfaces.cli.gates], ['opencode'])
  assert.equal(opencode.surfaces.cli.toolName, 'cli_worker')
  assert.equal(opencode.surfaces.cli.commandName, 'ocode')
})

test('gating the OpenCode CLI surface does not touch model serving', () => {
  // The HTTP route is the row this very session's model arrives on. A migration
  // step that silently took it down would be indistinguishable from an outage.
  const opencode = findPreset('opencode')
  assert.equal(opencode.surfaces.model.adapter, true)
  assert.equal(opencode.providerId, 'opencode-http-agent')
  assert.equal(opencode.row, 'dsh-opencode-v2')
  // The /http row is a separate entry with its own config.
  const rows = opencode.entries.map((entry) => entry.row)
  assert.ok(rows.includes('dsh-opencode-v2-http'), 'the model row stays declared')
})

test('the subagent surface is independent of the CLI switch', () => {
  // `subagent` and `cli` are separate vendor switches; only the latter moved.
  const opencode = findPreset('opencode')
  assert.equal(opencode.surfaces.subagent.toolName, 'subagent_opencode')
  assert.equal(opencode.surfaces.subagent.maxDepth, 'provider-managed')
})

test('every provider package agrees with the router version it peers on', async () => {
  // Measured defect (pre-existing, fixed 2026-11-08): both vendor packages pinned
  // `@nolit/dsh-custom-router@0.0.1-rc.2` while the router had reached rc.9. A peer
  // range that is not the shipped version makes a strict resolver refuse the
  // installation, and the failure surfaces at mount time rather than here.
  const { readFile } = await import('node:fs/promises')
  const routerPkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const peers = [
    new URL('../vendor/antigravity/package.json', import.meta.url),
    new URL('../../dsh-opencode-v2/package.json', import.meta.url),
  ]
  for (const url of peers) {
    const pkg = JSON.parse(await readFile(url, 'utf8'))
    assert.equal(
      pkg.peerDependencies['@nolit/dsh-custom-router'],
      routerPkg.version,
      `${pkg.name} must peer on @nolit/dsh-custom-router@${routerPkg.version}`,
    )
  }
})
