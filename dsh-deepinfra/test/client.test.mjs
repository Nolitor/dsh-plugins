import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

/**
 * Client-half contract tests.
 *
 * The client module is a browser bundle entry: it is served verbatim and evaluated
 * by window.__ModuleLoader__, so it is a CommonJS factory, not an ES module. It
 * cannot be imported here; these tests read the shipped source and assert the
 * CONTRACT facts the host depends on.
 *
 * Two failures were measured in an isolated web boot on 2026-11-04, both printed
 * as "web boot: 1 entry did not activate / @nolit/dsh-deepinfra: import failed":
 *   - an `import ... with { type: 'json' }` statement -> "Cannot use import
 *     statement outside a module";
 *   - ESM `export` statements -> "Unexpected token 'export'".
 * Only the real browser boot exposed them; node --check and the unit suite
 * passed throughout.
 */
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
/** The file with comments removed, so prose about imports is not matched. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('the client is a CommonJS module-loader factory', () => {
  assert.match(code, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(code, /id: '@nolit\/dsh-deepinfra'/)
  assert.match(code, /factory: \(require\) => \{/)
  assert.match(code, /return module\.exports/)
})

test('the client contains no ES module syntax', () => {
  assert.equal(/^\s*import\s/m.test(code), false, 'no import statements')
  assert.equal(/^\s*export\s/m.test(code), false, 'no export statements')
})

test('the factory exports apply and inject through module.exports', () => {
  assert.match(code, /exports\.apply = apply/)
  assert.match(code, /exports\.inject = inject/)
  assert.match(code, /const inject = \['slots', 'locale'\]/)
})

test('every ctx service the client reads is declared', () => {
  const declared = new Set(['slots', 'locale'])
  // Framework members are not services.
  const framework = new Set(['effect', 'logger'])
  const reads = new Set([...code.matchAll(/\bctx\??\.([a-zA-Z_][a-zA-Z0-9_]*)/g)].map((m) => m[1]))
  const missing = [...reads].filter((name) => !declared.has(name) && !framework.has(name))
  assert.deepEqual(missing, [], 'undeclared client service(s): ' + missing.join(', '))
})

test('the cost chip occupies conversation.input.activity, not the model label seat', () => {
  // Measured in opencode-v2: contributing to conversation.input.model.label
  // REPLACES the model name in the UI.
  assert.match(code, /ctx\.slots\.inject\('conversation\.input\.activity'/)
  assert.equal(code.includes("ctx.slots.inject('conversation.input.model.label'"), false)
})

test('the chip releases composer expansion on mount AND unmount', () => {
  // InputActivityOwnerProps: its occupant must release expansion on unmount, or
  // the composer can stay expanded and hide the model selector.
  const effect = code.slice(code.indexOf('function CostPill'), code.indexOf('function DeepInfraSection'))
  assert.match(effect, /onActiveChange\(false\)[\s\S]*?return \(\) => onActiveChange\(false\)/)
})

test('the chip is gated on the provider id, never a model id', () => {
  assert.match(code, /const OWN_PROVIDER_IDS = \['deepinfra'\]/)
  const gate = code.slice(code.indexOf('function usingOwnRoute'), code.indexOf('function watchRoute'))
  assert.match(gate, /getAttribute\('data-provider-id'\)/)
  assert.equal(/OWN_PROVIDER_IDS\.includes\([^)]*model/i.test(gate), false)
})

test('a non-own route occupies no seat (returns null)', () => {
  assert.match(code, /if \(!onRoute\) return null/)
})

test('sections declare the mandatory 14px/22px root', () => {
  assert.match(code, /\.difSection\{[^}]*font-size:14px;line-height:22px/)
})

test('no external font import or non-token palette', () => {
  assert.equal(/@import/.test(code), false)
  assert.equal(/fonts\.googleapis|@font-face/.test(code), false)
  const colourLiterals = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
  assert.deepEqual(colourLiterals, [], 'literal colours: ' + colourLiterals.join(','))
  assert.equal(/\brgb\(/.test(code), false)
  assert.equal(/\bcolor-mix\(/.test(code), false)
})

test('the stylesheet is injected once, keyed by a plugin css tag', () => {
  assert.match(code, /data-plugin-css/)
  assert.match(code, /querySelector\('style\[data-plugin-css=/)
})

test('the inlined message tables match the locale files exactly', () => {
  const en = JSON.parse(readFileSync(new URL('../locale/en.json', import.meta.url), 'utf8'))
  const ko = JSON.parse(readFileSync(new URL('../locale/ko.json', import.meta.url), 'utf8'))
  for (const table of [en, ko]) {
    for (const value of Object.values(table)) {
      if (typeof value === 'string') {
        assert.ok(code.includes(JSON.stringify(value)), 'not inlined: ' + value)
      } else {
        for (const text of Object.values(value)) assert.ok(code.includes(JSON.stringify(text)), 'not inlined: ' + text)
      }
    }
  }
})

test('every message key the client asks for exists in both locales', () => {
  const en = JSON.parse(readFileSync(new URL('../locale/en.json', import.meta.url), 'utf8'))
  const ko = JSON.parse(readFileSync(new URL('../locale/ko.json', import.meta.url), 'utf8'))
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ko).sort())
  assert.equal(en.nav, 'DeepInfra')
  assert.equal(ko.nav, '딥인프라')
  // A CSS selector ending in "t(" is not a message lookup, hence the lookbehind.
  const used = new Set([...code.matchAll(/(?<![a-zA-Z.-])t\('([a-zA-Z]+)'/g)].map((m) => m[1]))
  for (const key of used) {
    assert.ok(key in en, 'missing en key: ' + key)
    assert.ok(key in ko, 'missing ko key: ' + key)
  }
})

test('the settings section label follows the host language', () => {
  assert.match(code, /ctx\.slots\.inject\('settings\.section'/)
  assert.match(code, /currentLang\(\) === 'ko' \? '딥인프라' : 'DeepInfra'/)
})

test('the client subscribes to host locale changes', () => {
  assert.match(code, /ctx\.locale\.subscribe/)
})
