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
  const end = source.indexOf('\n    const STYLE_ID', start)
  return eval('(' + source.slice(start, end).replace(/,\s*$/, '') + ')')
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

test('the surface is exactly one additive settings section, never a composer or view seat', () => {
  assert.equal((code.match(/ctx\.slots\.register\(/g) ?? []).length, 1, 'one registration only')
  assert.match(code, /name: 'settings\.section'/)
  assert.match(code, /id: 'tokeneconomizer-devstats'/)
  assert.match(code, /order: 62/)
  for (const forbidden of ['conversation.input.', 'conversation.view', 'conversation.header']) {
    assert.equal(code.includes(forbidden), false, 'must not register into ' + forbidden)
  }
})

test('the card is read-only: it only reads the statistics route', () => {
  assert.match(code, /const DEVSTATS_URL = '\/api\/local\/tokeneconomizer\/devstats'/)
  const calls = [...code.matchAll(/fetch\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
  assert.deepEqual(calls, ['DEVSTATS_URL'])
  assert.match(code, /method: 'POST'/)
  // No write path: no settings mutation, no tool call, no local route other than the camera.
  assert.equal(code.includes('/api/local/tokeneconomizer/'), true)
  assert.equal((code.match(/\/api\/local\//g) ?? []).length, 1)
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
