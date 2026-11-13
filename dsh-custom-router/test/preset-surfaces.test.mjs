/**
 * Surface matrix pin — the FOUR surfaces of `CUSTOM-ROUTER-SURFACE-CONTRACT.md`
 * (CLI worker, subagent provider, tool/command, skill) measured per preset
 * against the vendored code that must serve them.
 *
 * WHY THIS FILE EXISTS (owner instruction 2026-11-14)
 *   "프로필 기본이 서브에이전트화 및 cli가 있는지 여부 체크해서 등록하게 해야지" —
 * every preset must have its subagent/CLI surfaces CHECKED and REGISTERED. The
 * check is the drift gate's job; this file pins the MEASURED answer so the
 * question cannot silently go stale again:
 *
 *   - `verify-presets.mjs` compares a DECLARED surface against the runtime
 *     registry, but it is blind in one direction: a preset that declares
 *     `subagent: null` while its vendor starts registering a provider still
 *     passes, because nothing is declared to be missing. Conversely a vendor
 *     that LOSES its registration while the declaration keeps the flag fails
 *     the runtime gate — but only when that preset is enabled in the profile
 *     being booted, so an opt-in preset can hide it.
 *   - This file closes both directions statically, from the source of truth:
 *     the declaration (`lib/presets.js`) vs the vendor `lib/` that must back it.
 *
 * MEASURED 2026-11-14 (the baseline these assertions encode):
 *
 *   preset       subagent provider          CLI worker / tool+command      skill
 *   antigravity  yes  index.js:683          agy_worker + /agy :585,:598    none
 *                                         (opt-in agy_cli :627)
 *   opencode     yes  index.js:920          cli_worker + opencode + /ocode none
 *                                         :151 (workers), :799, :812
 *   deepinfra    NO   —                      NO  —
 *   exaone       NO   —                      NO  —
 *
 * DeepInfra and EXAONE are pure MODEL routes: they register one adapter and
 * nothing else. That is a measured absence, not a missing registration, and the
 * contract forbids inventing a surface the code cannot serve (§3/§4/§6).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { PRESETS, findPreset } from '../lib/presets.js'
import { surfacesOf } from '../lib/preset-derive.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Read a vendored module's source, so a registration can be counted. */
function vendorSource(vendor, file) {
  return readFileSync(join(ROOT, 'vendor', vendor, 'lib', file), 'utf8')
}

/**
 * Count the registration calls a vendor's `lib/` makes for one surface.
 *
 * The pattern is the CONTRACT's own seam (`CUSTOM-ROUTER-SURFACE-CONTRACT.md`
 * §9 verification): `grep` for `registerProvider`, `tools.register`,
 * `commands.register`, `skills.register`. Counting calls (not files) is what
 * makes the `provider-mounted` yield and the gated batch tool visible.
 * @param {string} vendor - directory under `vendor/`.
 * @param {string[]} files - module files that may register the surface.
 * @param {RegExp} pattern - the registration call to count.
 * @returns {number} how many matches the vendor source carries.
 */
function countRegistrations(vendor, files, pattern) {
  let total = 0
  for (const file of files) {
    const source = vendorSource(vendor, file)
    total += (source.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')) ?? []).length
  }
  return total
}

/**
 * Whether a preset DECLARES one surface.
 *
 * `surfacesOf()` normalizes an absent surface to `{}` on purpose (the page must
 * render "no CLI surface" without a vendor branch), so "declared" is "carries
 * at least one own key", not "is not null".
 * @param {object} surfaces - the derived surface map.
 * @param {string} name - surface name.
 * @returns {boolean} true when the preset declares it.
 */
function declares(surfaces, name) {
  return Object.keys(surfaces[name] ?? {}).length > 0
}

/** The vendor modules each preset's surface may be registered from. */
const VENDOR_FILES = Object.freeze({
  antigravity: ['index.js'],
  opencode: ['index.js', 'http.js', join('workers', 'index.js')],
  deepinfra: ['index.js', 'anthropic-adapter.js', 'adapter.js'],
  exaone: ['index.js', 'adapter.js'],
})

/** The measured surface matrix. A change here requires a re-measurement. */
const MEASURED = Object.freeze({
  // Async activation (`agy_worker`): the child runs the `agy` CLI through this
  // provider's own start(), so the provider is the CLI's real owner.
  antigravity: Object.freeze({ subagent: true, cli: true, batch: true }),
  // The CLI/delegation surface lives on the index row and the model route on
  // `/http`; both are mounted by the same preset (three entries).
  opencode: Object.freeze({ subagent: true, cli: true, batch: false }),
  // A model route only: one adapter, no delegation and no CLI.
  deepinfra: Object.freeze({ subagent: false, cli: false, batch: false }),
  exaone: Object.freeze({ subagent: false, cli: false, batch: false }),
})

test('every preset declares the four-surface contract shape', () => {
  for (const preset of PRESETS) {
    const surfaces = surfacesOf(preset)
    // `surfacesOf` normalizes an absent surface to an empty object, so the page
    // can render "no CLI surface" without a vendor branch (SURFACE §7).
    for (const name of ['model', 'subagent', 'cli', 'batch', 'skill']) {
      assert.equal(typeof surfaces[name], 'object', `${preset.id}: surfaces.${name} must be data, never undefined`)
    }
    assert.ok(Array.isArray(surfaces.tools), `${preset.id}: surfaces.tools must be an array`)
    assert.ok(Array.isArray(surfaces.commands), `${preset.id}: surfaces.commands must be an array`)
    // No preset invents a skill surface: SURFACE §6 measured it as absent for
    // every CLI-less provider, and §6.3 documents the host validation trap.
    assert.equal(declares(surfaces, 'skill'), false, `${preset.id}: no preset may declare a skill surface until one is implemented`)
  }
})

test('the declaration and the vendored registrations agree, in BOTH directions', () => {
  for (const preset of PRESETS) {
    const measured = MEASURED[preset.id]
    assert.ok(measured !== undefined, `${preset.id}: no measured surface baseline — re-measure before declaring it`)
    const declared = surfacesOf(preset)
    const files = VENDOR_FILES[preset.id]
    assert.ok(files !== undefined, `${preset.id}: no vendored source map — re-measure before declaring it`)

    // --- subagent provider (SURFACE §4): `registerProvider` is the only seam.
    const providerCalls = countRegistrations(preset.id, files, /registerProvider\(/)
    assert.equal(declares(declared, 'subagent'), measured.subagent,
      `${preset.id}: surfaces.subagent declared=${declares(declared, 'subagent')} but measured ${measured.subagent}`)
    assert.equal(providerCalls > 0, measured.subagent,
      `${preset.id}: vendor registers ${providerCalls} subagent provider(s) but the measured baseline says ${measured.subagent}`
        + ' — a vendor that gained a provider needs its declaration updated (and vice versa)')

    // --- CLI worker (SURFACE §3): a declared CLI must have a tool to call.
    const toolCalls = countRegistrations(preset.id, files, /tools\.register\(/)
    assert.equal(declares(declared, 'cli'), measured.cli,
      `${preset.id}: surfaces.cli declared=${declares(declared, 'cli')} but measured ${measured.cli}`)
    assert.equal(toolCalls > 0, measured.cli,
      `${preset.id}: vendor registers ${toolCalls} tool(s) but the measured CLI baseline says ${measured.cli}`)

    // --- commands: the tool/command pair for one service shares a prefix
    // (§5 rule 2). A CLI surface with no command is a half-declared surface.
    const commandCalls = countRegistrations(preset.id, files, /commands\.register\(/)
    assert.equal(commandCalls > 0, measured.cli,
      `${preset.id}: vendor registers ${commandCalls} command(s) but the measured CLI baseline says ${measured.cli}`)
    if (declares(declared, 'cli')) {
      assert.ok(declared.commands.includes(declared.cli.commandName),
        `${preset.id}: cli.commandName "${declared.cli.commandName}" must appear in surfaces.commands`)
    }

    // --- batch (the sync one-shot shape) is opt-in and must stay opt-in: an
    // undeclared batch must not be registered as a live tool, and a declared one
    // must ship OFF so a default profile does not gain a second tool name.
    assert.equal(declares(declared, 'batch'), measured.batch,
      `${preset.id}: surfaces.batch declared=${declares(declared, 'batch')} but measured ${measured.batch}`)
    if (declares(declared, 'batch')) {
      assert.equal(declared.batch.default, false, `${preset.id}: a batch tool must ship off by default (SURFACE §3 rule 1)`)
    }
  }
})

test('a pure MODEL route declares no delegation surface and registers none', () => {
  // The two measured "model only" presets are the ones the owner question is
  // really about: they are NOT broken, they have nothing to run a CLI with.
  for (const id of ['deepinfra', 'exaone']) {
    const preset = findPreset(id)
    assert.ok(preset !== undefined, `${id}: preset must exist`)
    const surfaces = surfacesOf(preset)
    assert.equal(declares(surfaces, 'subagent'), false, `${id}: no subagent provider may be declared`)
    assert.equal(declares(surfaces, 'cli'), false, `${id}: no CLI worker may be declared`)
    assert.deepEqual([...surfaces.tools], [], `${id}: no tool may be declared`)
    assert.deepEqual([...surfaces.commands], [], `${id}: no command may be declared`)
    // The model surface is what they DO declare, and it is the only one.
    assert.equal(surfaces.model.adapter, true, `${id}: the model adapter surface must be declared`)

    // No registration seam is reachable from these vendors at all — the
    // absence is structural, not a forgotten call site.
    const files = VENDOR_FILES[id]
    for (const [label, pattern] of [
      ['subagent provider', /registerProvider\(/],
      ['tool', /tools\.register\(/],
      ['command', /commands\.register\(/],
      ['skill', /skills\.register\(/],
    ]) {
      assert.equal(countRegistrations(id, files, pattern), 0,
        `${id}: vendor gained a ${label} registration — the preset must declare it before it can be used`)
    }
    // And it does register its adapter, so "no surface" never means "no plugin".
    assert.ok(countRegistrations(id, files, /registerAdapter\(/) > 0, `${id}: vendor must register its model adapter`)
  }
})

test('the model-selection route ids a child would call are the preset providerIds', () => {
  // A preset can only be picked as a child's model route when the host allowlist
  // (`subagent-model-selection-settings.allowedModels`) names its PROVIDER id.
  // This pins the id the router declares, so the owner-side allowlist edit has
  // one unambiguous target. The live allowlist itself is NOT read here: the repo
  // must never depend on `~/.dsh`.
  const expected = {
    antigravity: 'antigravity',
    opencode: 'opencode-http-agent',
    deepinfra: 'deepinfra',
    exaone: 'exaone',
  }
  for (const [id, providerId] of Object.entries(expected)) {
    const preset = findPreset(id)
    assert.equal(preset.providerId, providerId,
      `${id}: providerId is the route id a subagent allowlist entry must name`)
    assert.ok(preset.modelPrefixes.includes(providerId) || id === 'opencode',
      `${id}: modelPrefixes must be able to route an id that starts with the provider id`)
  }
})
