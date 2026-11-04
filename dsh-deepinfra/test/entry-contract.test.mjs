import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

/**
 * Activation contract for the SERVER entry.
 *
 * Failure ledger F-1: an entry that read a service it did not declare took the
 * whole plugin down. Measured again on THIS entry 2026-11-04: reading
 * `ctx.profileDir` without declaring it produced
 *
 *   dsh-deepinfra (@nolit/dsh-deepinfra): Error: cannot get property "profileDir"
 *   without inject
 *   dsh: warning: 1 entry did not activate
 *
 * in an isolated web boot. A syntax check, a unit suite and --dump-config all
 * passed; only the real boot exposed it.
 */
const source = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')

test('only llm is required; web-only services must not gate the route', () => {
  // Measured 2026-11-04 in an isolated HEADLESS boot: declaring connection and
  // settings made the entry wait forever for a service that profile lacks —
  // "pending (waiting for service: connection)" — so NO adapter registered at
  // all and every turn failed with NO_ADAPTER. A web-only service must never gate
  // the model route.
  const declared = new Set(['llm'])
  // Match real property reads, not the words inside comments or strings.
  const body = source.slice(source.indexOf('export function apply'))
  const reads = new Set()
  for (const match of body.matchAll(/\bctx\.([a-zA-Z_][a-zA-Z0-9_]*)/g)) reads.add(match[1])
  // These are framework members, not services: `inject` is cordis's deferred
  // sub-context (used to wait for the connection seam), `on`/`emit` the event
  // bus, `effect` disposal, `logger` diagnostics.
  const framework = new Set(['effect', 'logger', 'on', 'emit', 'get', 'set', 'inject'])
  const missing = [...reads].filter((name) => !declared.has(name) && !framework.has(name))
  assert.deepEqual(missing, [], 'undeclared service read(s): ' + missing.join(', '))
})

test('a service that may be absent is read through the optional() guard', () => {
  // profileDir is not a declared service and must never be read directly.
  assert.match(source, /function optional\(ctx, name\)/)
  assert.match(source, /optional\(ctx, 'profileDir'\)/)
  const body = source.slice(source.indexOf('export function apply'))
  assert.equal(/ctx\.profileDir/.test(body), false, 'profileDir must go through optional()')
})

test('the entry exports name, inject, Config and apply', async () => {
  const mod = await import('../lib/index.js')
  assert.equal(mod.name, 'dsh-deepinfra')
  assert.deepEqual(mod.inject, ['llm'])
  assert.equal(typeof mod.apply, 'function')
  assert.equal(typeof mod.Config, 'function')
  assert.equal(mod.PROVIDER_ID, 'deepinfra')
})

test('the API key field is declared as a secret', async () => {
  const { Config } = await import('../lib/index.js')
  const { redactSecrets } = await import(
    '/home/minami/.local/nodejs/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-settings/lib/index.js'
  )
  const value = { baseURL: 'https://api.deepinfra.com/v1/openai', apiKey: 'sk-di-must-not-leak', turnMaxTokens: 16384 }
  const redacted = redactSecrets(Config, value)
  assert.equal('apiKey' in redacted.value, false, 'the key must be stripped from every wire projection')
  assert.equal(JSON.stringify(redacted.value).includes('sk-di-must-not-leak'), false)
  assert.deepEqual(redacted.secrets, [{ path: ['apiKey'], set: true }])
})

test('every config field is VOLATILE, so the settings UI can write it', async () => {
  // This is the whole credential story. Measured 2026-11-04 in the installed
  // dsh-settings service: SettingsForms.write() refuses a namespace whose schema
  // exposes no volatile field —
  //   const form = volatileForm(schema)
  //   if (form === undefined) throw new Error('Plugin entry "..." has no volatile
  //   fields')
  // Without `.volatile()` a key typed into the Web UI could never be persisted,
  // and the operator had to edit a systemd unit instead.
  const { Config } = await import('../lib/index.js')
  function volatileForm(schema) {
    if (schema.meta?.volatile) return schema
    if (schema.type === 'object') {
      const dict = Object.fromEntries(Object.entries(schema.dict ?? {}).flatMap(([k, c]) => {
        const f = volatileForm(c)
        return f === undefined ? [] : [[k, f]]
      }))
      return Object.keys(dict).length === 0 ? undefined : { type: 'object', dict }
    }
    return undefined
  }
  const form = volatileForm(Config)
  assert.notEqual(form, undefined, 'no volatile fields => the settings UI cannot save anything')
  for (const field of ['baseURL', 'apiKey', 'turnMaxTokens', 'contextWindow', 'catalogTtlMs', 'defaultEffort', 'enabledModels']) {
    assert.equal(form.dict[field]?.meta?.volatile, true, field + ' must be volatile')
  }
  // The key stays a redacted secret AND is writable.
  assert.equal(form.dict.apiKey.meta.role, 'secret')
})

test('the plugin declares a web client half in its manifest', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.dsh.manifestVersion, 1)
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.exports['./client'])
  assert.equal(pkg.name, '@nolit/dsh-deepinfra')
})
