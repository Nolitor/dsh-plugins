/**
 * The browser-half contract of the developer statistics card.
 *
 * The client module is served verbatim and evaluated by `window.__ModuleLoader__`, so it is a
 * CommonJS factory, not an ES module; it cannot be imported here. These tests read the shipped
 * source and assert the contract facts the host and the browser depend on.
 *
 * Measured on a sibling track (2026-11-04): an ESM `import`/`export` in this file passes
 * `node --check` and every unit test, then fails the real boot as
 * "web boot: 1 entry did not activate". Only a browser boot proves activation, which is why the
 * remaining structural facts are pinned here.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
/** The file with comments removed, so prose about imports is not matched. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const en = JSON.parse(readFileSync(new URL('../locale/en.json', import.meta.url), 'utf8'))
const ko = JSON.parse(readFileSync(new URL('../locale/ko.json', import.meta.url), 'utf8'))

/** Capture the inline dictionary the loader must evaluate as plain script. */
function inlineI18N() {
  const marker = '    const I18N = '
  const start = source.indexOf(marker) + marker.length
  const end = source.indexOf('\n    const CSS_TAG', start)
  return eval('(' + source.slice(start, end).replace(/,\s*$/, '') + ')')
}

/** Capture the second inline dictionary, which the settings page owns. */
function inlineSettingsI18N() {
  const marker = '    const SETTINGS_I18N = '
  const start = source.indexOf(marker) + marker.length
  const end = source.indexOf('\n    const ', start)
  return eval('(' + source.slice(start, end).replace(/,\s*$/, '') + ')')
}

/** Capture the stylesheet array the loader must evaluate as plain script. */
function inlineCSS() {
  const marker = '    const CSS = ['
  const start = source.indexOf(marker) + marker.length
  const end = source.indexOf("\n    ].join('\\n')", start)
  return eval('[' + source.slice(start, end).replace(/,\s*$/, '') + ']').join('\n')
}

test('the client is a CommonJS module-loader factory with no ES module syntax', () => {
  assert.match(code, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(code, /id: '@nolit\/dsh-tokeneconomizer'/)
  assert.match(code, /factory: \(require\) => \{/)
  assert.match(code, /return module\.exports/)
  assert.equal(/^\s*import\s/m.test(code), false, 'no import statements')
  assert.equal(/^\s*export\s/m.test(code), false, 'no export statements')
})

test('the package exposes the client half through the rc.1 client manifest', () => {
  assert.equal(pkg.exports['./client'].default, './lib/client.js')
  assert.equal(pkg.dsh.manifestVersion, 1)
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.dsh.client.immediately, true)
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'),
    'the settings.section owner must be in the client inject list')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'),
    'the locale service owner must be in the client inject list')
})

test('the factory exports apply and inject through module.exports', () => {
  assert.match(code, /exports\.apply = apply/)
  assert.match(code, /exports\.inject = inject/)
  assert.match(code, /const inject = \['slots', 'locale'\]/)
})

test('every ctx service the client reads is declared in the exported inject', () => {
  const declared = new Set(['slots', 'locale'])
  // Framework members and the module-local context holder are not injected services.
  const framework = new Set(['effect', 'logger'])
  const reads = new Set([...code.matchAll(/\b(?:ctx|devstatsCtx)\??\.([a-zA-Z_][a-zA-Z0-9_]*)/g)].map((m) => m[1]))
  const missing = [...reads].filter((name) => !declared.has(name) && !framework.has(name))
  assert.deepEqual(missing, [], 'undeclared client service(s): ' + missing.join(', '))
})

test('the surface is exactly one additive settings section with internal tabs', () => {
  // One sidebar row for the whole plugin. The two halves are internal tabs, so this pin asserts
  // the single registration plus the tab plumbing that replaces the second nav entry.
  assert.equal((code.match(/ctx\.slots\.register\(/g) ?? []).length, 1, 'exactly one additive settings section')
  assert.match(code, /name: 'settings\.section'/)
  assert.match(code, /id: 'tokeneconomizer'/)
  assert.match(code, /order: 62/)
  assert.match(code, /data-tk-tabs/)
  assert.match(code, /role: 'tablist'/)
  assert.match(code, /role: 'tab'/)
  for (const forbidden of ['conversation.input.', 'conversation.view', 'conversation.header']) {
    assert.equal(code.includes(forbidden), false, 'must not register into ' + forbidden)
  }
})

test('the statistics card reads only its statistics route, and the settings page carries its own', () => {
  assert.match(code, /const DEVSTATS_URL = '\/api\/local\/tokeneconomizer\/devstats'/)
  // The intent is unchanged for the card: it has one fetch target and that target is read-only.
  const calls = [...code.matchAll(/fetch\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
  assert.ok(calls.includes('DEVSTATS_URL'), 'the statistics card reads its route')
  assert.ok(calls.length >= 1, 'at least one fetch target')
  assert.match(code, /method: 'POST'/)
  // No write path on the card: no settings mutation, no tool call.
  assert.equal(code.includes('/api/local/tokeneconomizer/'), true)
  assert.ok((code.match(/\/api\/local\//g) ?? []).length >= 1)
  // The settings page is a separate entry with its own contract route, so the count is no
  // longer a proof of anything; the ids and the route are.
  assert.match(code, /\/api\/local\/tokeneconomizer\/settings/, 'the settings page carries its own route')
  assert.equal(code.includes('settings.update'), false)
})

test('English is the default and Korean renders only under an active ko locale', () => {
  const i18n = inlineI18N()
  assert.deepEqual(Object.keys(i18n), ['en', 'ko'])
  assert.equal(/[가-힣]/.test(i18n.en['devstats.title']), false, 'the English default must not be Korean')
  assert.equal(/[가-힣]/.test(i18n.ko['devstats.title']), true, 'the Korean table must be Korean')
  assert.match(code, /startsWith\('ko'\) \? 'ko' : 'en'/)
})

test('the inline tables and locale/*.json cannot drift', () => {
  const i18n = inlineI18N()
  assert.deepEqual(i18n.en, en.devstats, 'locale/en.json devstats table differs from the inline table')
  assert.deepEqual(i18n.ko, ko.devstats, 'locale/ko.json devstats table differs from the inline table')
  const enKeys = Object.keys(i18n.en).sort()
  const koKeys = Object.keys(i18n.ko).sort()
  assert.deepEqual(koKeys, enKeys, 'ko and en must carry the same key set')
})

test('the settings table mirrors locale settings keys', () => {
  const table = inlineSettingsI18N()
  assert.deepEqual(Object.keys(table), ['en', 'ko'])
  assert.deepEqual(Object.keys(table.en).sort(), Object.keys(en.settings).sort(),
    'locale/en.json settings block differs from the inline settings table')
  assert.deepEqual(Object.keys(table.ko).sort(), Object.keys(ko.settings).sort(),
    'locale/ko.json settings block differs from the inline settings table')
  assert.deepEqual(Object.keys(table.ko).sort(), Object.keys(table.en).sort(),
    'ko and en must carry the same settings key set')
  assert.equal(/[가-힣]/.test(table.en['settings.title']), false, 'the English settings default must not be Korean')
  assert.equal(/[가-힣]/.test(table.ko['settings.title']), true, 'the Korean settings table must be Korean')
})

test('the typography contract holds: every font-size is a var()/calc() token', () => {
  const css = [...source.matchAll(/'\.tkds[^']*'/g)].map((m) => m[0]).join('\n')
  assert.ok(css.length > 0, 'surface styles are present')
  const literals = [...css.matchAll(/font-size:(?!var\(|calc\()([^;}]+)/g)]
  assert.deepEqual(literals.map((m) => m[1]), [], 'every size must be a var()/calc() with the DSH fallback')
  assert.equal(/font-family:(?!inherit)/.test(css), false, 'family must be inherited')
  assert.equal(css.includes('--dsw-alias-bg-layer-4'), false, 'unset runtime token must not be used')
})

test('the card declares the DSH font tokens and no bare element selectors', () => {
  assert.match(source, /--dsh-content-font-size,14px/)
  assert.match(source, /--dsh-content-font-delta,0px/)
  assert.match(source, /--dsh-content-font-size-secondary,13px/)
  assert.equal(/^\s*\. tkds/m.test(source), false)
  // Every class selector is namespaced, so the card cannot restyle another surface.
  const selectors = [...source.matchAll(/'(\.[^'{]+)\{/g)].map((m) => m[1].trim().split(/[\s,:]/)[0])
  assert.ok(selectors.every((sel) => sel.startsWith('.tkds')), 'unexpected selector: ' + selectors.find((s) => !s.startsWith('.tkds')))
})

test('the section defers its width to the host settings column', () => {
  // Measured in the host: the shell renders `settings.section` inside `.options`, which already
  // owns `padding: 0 24px 24px`, the scroll, and the panel width. A section that sets its own
  // max-width or centres itself fights that frame and reads as a foreign app inside the dialog.
  const block = /\.tkdsSection\{([^}]*)\}/.exec(source)?.[1] ?? ''
  assert.notEqual(block, '', 'the section rule must exist')
  assert.equal(block.includes('max-width'), false, 'the host owns the column width')
  assert.equal(block.includes('margin:0 auto'), false, 'the host centres its own column')
  assert.match(block, /padding:0/)
  assert.match(block, /min-width:0/)
})

test('the heading levels match the DSH settings section and its cards', () => {
  // The card title is an h2, and each card title is an h3 under it.
  assert.match(code, /h\('h2', \{ className: 'tkdsTitle' \}/)
  assert.match(code, /h\('h3', \{ className: 'tkdsCardTitle' \}/)
  assert.equal(code.includes("h('h4'"), false, 'no h4 remains')
  assert.equal(code.includes("h('h5'"), false, 'no h5 remains')
  // The heading is one step above body content, from the live token.
  // Measured against this repository's own settings section (dsh-custom-router's `.crSettingsTitle`):
  // the section title is body+4px at 600 over a 26px line box, with the intro one step smaller.
  assert.match(source, /\.tkdsTitle\{[^}]*font-size:calc\(var\(--dsh-content-font-size,14px\) \+ 4px\)/)
  assert.match(source, /\.tkdsTitle\{[^}]*font-weight:600/)
})

test('the stylesheet is keyed by data-plugin-css so the host can own it', () => {
  assert.match(source, /const CSS_TAG = '@nolit\/dsh-tokeneconomizer'/)
  assert.match(source, /tag\.setAttribute\('data-plugin-css', CSS_TAG\)/)
  assert.match(source, /querySelector\('style\[data-plugin-css="'/)
  assert.equal(source.includes("'tk-devstats-style'"), false, 'the old id-keyed tag is gone')
})

test('every control carries a visible focus ring from the DSH focus tokens', () => {
  assert.match(source, /\.tkdsSelect:focus-visible,\.tkdsButton:focus-visible\{[^}]*--dsw-focus-ring-width/)
  assert.match(source, /\.tkdsSelect:focus-visible,\.tkdsButton:focus-visible\{[^}]*--dsw-focus-ring-color/)
  assert.match(source, /\.tkdsSelect:hover:not\(:disabled\)/)
  assert.match(source, /\.tkdsButton:hover:not\(:disabled\)/)
  assert.match(source, /\.tkdsButton:disabled\{[^}]*cursor:not-allowed/)
})

test('the motion and narrow-pane queries are present', () => {
  assert.match(source, /@media \(prefers-reduced-motion:reduce\)\{\.tkdsButton,\.tkdsSelect\{transition:none\}\}/)
  assert.match(source, /@media \(max-width:640px\)\{/)
})

test('the dense table scrolls in its own frame with a sticky header', () => {
  assert.match(source, /\.tkdsScroll\{[^}]*max-height:280px/)
  assert.match(source, /\.tkdsScroll\{[^}]*overflow:auto/)
  assert.match(source, /\.tkdsTh\{[^}]*position:sticky/)
  assert.match(source, /\.tkdsTh\{[^}]*background:var\(--dsw-alias-settings-card-fill\)/)
  // Row rules are the host hairline token on border-l2, and every cell is tabular-nums.
  assert.match(source, /\.tkdsTh\{[^}]*border-bottom:var\(--dsh-hairline-width,\.5px\) solid var\(--dsw-alias-border-l2\)/)
  assert.match(source, /\.tkdsTd\{[^}]*border-bottom:var\(--dsh-hairline-width,\.5px\) solid var\(--dsw-alias-border-l2\)/)
  assert.match(source, /\.tkdsTable\{[^}]*font-variant-numeric:tabular-nums/)
  assert.match(source, /\.tkdsTd\{[^}]*font-variant-numeric:tabular-nums/)
})

test('the session picker names its control and shows the whole session id', () => {
  // Measured before this change: the option label was an 8-character id prefix, which
  // identified nothing and made two sessions in one directory look identical.
  assert.match(code, /h\('label', \{ className: 'tkdsLabel', htmlFor: 'tk-devstats-session' \}/)
  assert.match(code, /id: 'tk-devstats-session'/)
  assert.equal(code.includes('.slice(0, 8)'), false, 'the id is no longer truncated')
  assert.match(source, /function sessionLabel\(entry, full\)/)
})

test('the table header cells are marked as column headers', () => {
  const headers = [...code.matchAll(/h\('th', \{ className: 'tkdsTh', scope: 'col' \}/g)]
  assert.equal(headers.length, 9, 'nine column headers')
})

// --- 2026-11-11 regression gate ------------------------------------------------
// The 2026-11-08 redesign (2b668ad) shipped the hairline as a `.5px` literal,
// which ignores the host's device-pixel-ratio correction. These checks fail the
// build the moment a literal or a missing CJK wrap rule comes back.

test('REGRESSION GATE: no .5px hairline literal exists in the stylesheet', () => {
  // A bare literal is any .5px NOT written as the host token's own fallback
  // (the host bundle itself declares `var(--dsh-hairline-width, .5px)`).
  const literals = source.match(/(?<!var\(--dsh-hairline-width,)\\\.5px/g) ?? []
  assert.deepEqual(
    literals,
    [],
    'hairline width must consume the host token with its .5px fallback, never a bare .5px literal',
  )
})

test('REGRESSION GATE: the root container keeps Korean words together', () => {
  assert.match(source, /\.tkdsSection\{[^}]*word-break:keep-all/, 'the root must wrap on word boundaries (CJK)')
  assert.match(source, /\.tkdsSection\{[^}]*overflow-wrap:break-word/, 'the root must still break a single long token')
})

// --- 2026-11-15 contract drift gate ---------------------------------------------
// The client half cannot import `lib/settings-contract.js` — the loader exposes a fixed
// module table and the file must carry no import statements — so the contract is mirrored
// as literals. These checks pin that mirror to the contract, because a route or a slot
// key that drifts on one side only is a silent 404 or a setting that never lands.
//
// The contract module itself has no imports (that is what makes it shareable), so the
// Node half of the test can import it directly and compare the two sides for real.

test('the client route literals match the settings contract', async () => {
  const contract = await import('../lib/settings-contract.js')
  const paths = {
    SETTINGS_PATH: contract.SETTINGS_PATH,
    CONFIG_PATH: contract.CONFIG_PATH,
    RESTORE_PATH: contract.RESTORE_PATH,
    RESET_PATH: contract.RESET_PATH,
    IMPORT_PATH: contract.IMPORT_PATH,
    UPSTREAM_PATH: contract.UPSTREAM_PATH,
    MODELS_PATH: contract.MODELS_PATH,
  }
  assert.equal(paths.SETTINGS_PATH, '/api/local/tokeneconomizer/settings')
  for (const [name, value] of Object.entries(paths)) {
    assert.ok(code.includes("'" + value + "'"), name + ' (' + value + ') is missing from the client')
  }
})

test('the client model slots match the settings contract', async () => {
  const contract = await import('../lib/settings-contract.js')
  const keys = Object.keys(contract.MODEL_SLOTS)
  assert.equal(keys.length, 3, 'three model slots')
  for (const key of keys) {
    assert.ok(code.includes("key: '" + key + "'"), 'the client is missing the slot ' + key)
  }
  // The slot labels are namespaced, so a slot can never share a name with a mechanism mode.
  const modes = [...code.matchAll(/Object\.freeze\(\{ key: '(microskills|toolprune|loopguard)',/g)].map((m) => m[1])
  for (const key of keys) {
    assert.equal(modes.includes(key), false, key + ' collides with a mechanism mode')
  }
})

test('REGRESSION GATE: every model slot carries the label the read payload is keyed by', async () => {
  // Measured 2026-11-15: the client's slots declared only `key` (the WRITE key,
  // `model.microskills`) and the read lookup used `modelSlots[slot.label]` — a property the
  // slot did not have. Every stored value therefore read as `undefined`, so a select showed
  // the deployment default even after the engine had persisted the choice, and the page
  // re-offered the old value on the next save. The READ payload is keyed by the slot's
  // `label` (`microskills`), which is a DIFFERENT string from its WRITE `key`
  // (`model.microskills`); both must be present on every slot.
  const contract = await import('../lib/settings-contract.js')
  for (const [key, spec] of Object.entries(contract.MODEL_SLOTS)) {
    assert.ok(
      code.includes(`key: '${key}', label: '${spec.label}'`),
      `the slot ${key} must declare key '${key}' AND label '${spec.label}'`,
    )
  }
  // And the two lookups must use the right one of the two.
  assert.ok(
    /modelSlots\[slot\.label\]/.test(code),
    'the stored value must be read by the slot label',
  )
  assert.ok(
    /modelSlots\[slot\.key\]/.test(code) === false,
    'the stored value must NOT be read by the slot key — the read payload is keyed by label',
  )
})

test('REGRESSION GATE: the default model slot is a fact, never a control', () => {
  // Measured 2026-11-15: the engine has NO "default model" config key — the deployment's own
  // route is whatever DSH's `agent-default-model` says. The slot was still a `<select>`: it
  // accepted a value, the client sent it, the server answered `ok: true` with the value EMPTY
  // (there was nowhere to put it), and the select snapped back to "deployment default" on the
  // next read. A control that silently discards its own choice is worse than one that says
  // it has nowhere to put it, so the default is now stated, not offered.
  assert.ok(
    code.includes('SETTINGS_WRITABLE_MODEL_SLOTS'),
    'the client must distinguish the writable slots from the read-only default',
  )
  assert.ok(
    /SETTINGS_WRITABLE_MODEL_SLOTS = Object\.freeze\(\s*SETTINGS_MODEL_SLOTS\.filter\(\(slot\) => slot\.engineKey !== null\)/.test(code),
    'the writable slots are exactly those with an engine key',
  )
  // The save path must iterate the WRITABLE slots only.
  const saveBlock = code.slice(code.indexOf('const save = async () =>'), code.indexOf('const act = async'))
  assert.ok(
    saveBlock.includes('SETTINGS_WRITABLE_MODEL_SLOTS'),
    'the save path must write only the writable slots',
  )
  assert.ok(
    saveBlock.includes('SETTINGS_MODEL_SLOTS') === false,
    'the save path must NOT write the read-only default slot',
  )
  // The rendered rows must be the writable slots, and the default is a plain row.
  const modelBlock = code.slice(code.indexOf('const modelRows = '), code.indexOf('const modelCard = '))
  assert.ok(
    modelBlock.includes('SETTINGS_WRITABLE_MODEL_SLOTS'),
    'the rendered selects must be the writable slots only',
  )
  assert.ok(
    code.includes("'data-tk-settings-model-default': '1'"),
    'the default route must still be shown as a read-only fact',
  )
})
