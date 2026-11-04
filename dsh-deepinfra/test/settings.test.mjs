import assert from 'node:assert/strict'
import test from 'node:test'

import { configValue, maskKey, resolveCredentials, trimSlash } from '../lib/settings.js'

/** A cordis-style reactive field, as the loader exposes configured values. */
const reactive = (value) => ({ get: () => value })

test('a key saved in the UI WINS over the environment', () => {
  // The owner's rule: UI first, environment second. A stale export in the unit
  // must never shadow a key the operator just typed.
  const resolved = resolveCredentials(
    { apiKey: reactive('sk-di-from-ui'), baseURL: reactive('') },
    { DEEPINFRA_API_KEY: 'sk-di-from-env' },
  )
  assert.equal(resolved.apiKey, 'sk-di-from-ui')
  assert.equal(resolved.apiKeySource, 'ui')
})

test('an empty UI key falls back to the environment', () => {
  const resolved = resolveCredentials(
    { apiKey: reactive(''), baseURL: reactive('') },
    { DEEPINFRA_API_KEY: 'sk-di-from-env' },
  )
  assert.equal(resolved.apiKey, 'sk-di-from-env')
  assert.equal(resolved.apiKeySource, 'env')
})

test('neither source reports "none" rather than an empty credential', () => {
  const resolved = resolveCredentials({ apiKey: reactive('') }, {})
  assert.equal(resolved.apiKey, '')
  assert.equal(resolved.apiKeySource, 'none')
})

test('a whitespace-only key is not a credential', () => {
  const resolved = resolveCredentials({ apiKey: reactive('   ') }, { DEEPINFRA_API_KEY: 'sk-real' })
  assert.equal(resolved.apiKey, 'sk-real')
  assert.equal(resolved.apiKeySource, 'env')
})

test('plain (non-reactive) config values work too', () => {
  // The adapter reads the live config, but a test and a validated snapshot pass
  // plain values; both must resolve identically.
  assert.equal(configValue({ apiKey: 'plain' }, 'apiKey'), 'plain')
  assert.equal(configValue({ apiKey: reactive('live') }, 'apiKey'), 'live')
  assert.equal(configValue(undefined, 'apiKey'), undefined)
})

test('a throwing config accessor does not throw into a request', () => {
  const hostile = { get apiKey() { throw new Error('disposed') } }
  assert.equal(configValue(hostile, 'apiKey'), undefined)
})

test('base URL precedence and trailing-slash trimming', () => {
  const fromUi = resolveCredentials({ baseURL: reactive('https://gw.example/v1/') }, { DEEPINFRA_BASE_URL: 'https://env.example' })
  assert.equal(fromUi.baseURL, 'https://gw.example/v1')
  assert.equal(fromUi.baseURLSource, 'ui')

  const fromEnv = resolveCredentials({ baseURL: reactive('') }, { DEEPINFRA_BASE_URL: 'https://env.example' })
  assert.equal(fromEnv.baseURL, 'https://env.example')
  assert.equal(fromEnv.baseURLSource, 'env')

  const fallback = resolveCredentials({}, {})
  assert.equal(fallback.baseURL, 'https://api.deepinfra.com/v1/openai')
  assert.equal(fallback.baseURLSource, 'default')
  assert.equal(trimSlash('https://a/b/'), 'https://a/b')
})

test('the masked key never exposes the whole value', () => {
  const key = 'sk-di-0123456789abcdef'
  const masked = maskKey(key)
  assert.equal(masked.includes(key), false)
  assert.ok(masked.includes('0123') === false, 'no contiguous run of the secret body')
  assert.ok(masked.startsWith('sk-di-'))
  assert.ok(masked.endsWith('cdef'))
  assert.equal(maskKey(''), '')
  assert.equal(maskKey('short'), '••••')
})
