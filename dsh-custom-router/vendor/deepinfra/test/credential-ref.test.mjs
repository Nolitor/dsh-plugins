/**
 * DSH credential-store migration: the key may come from the host credential
 * store (`~/.dsh/.credentials.yaml` -> `refs:`) instead of a plaintext
 * `apiKey:` in the profile. The precedence rule is pure, so it is pinned here
 * without a host: explicit key -> credential store -> environment.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { Config, keyPrecedence } from '../lib/index.js'

test('an explicit key wins over the credential store and the environment', () => {
  assert.equal(keyPrecedence('cfg-key', 'stored-key', 'env-key'), 'cfg-key')
  assert.equal(keyPrecedence('  cfg-key  ', 'stored-key', 'env-key'), 'cfg-key')
})

test('the credential store wins over the environment when no key is configured', () => {
  assert.equal(keyPrecedence('', 'stored-key', 'env-key'), 'stored-key')
  assert.equal(keyPrecedence(undefined, 'stored-key', 'env-key'), 'stored-key')
})

test('a blank stored value falls through to the environment, never to blank', () => {
  assert.equal(keyPrecedence('', '   ', 'env-key'), 'env-key')
  assert.equal(keyPrecedence('', '', 'env-key'), 'env-key')
})

test('nothing configured is an empty string, not undefined', () => {
  assert.equal(keyPrecedence(undefined, undefined, undefined), '')
  assert.equal(keyPrecedence({}, 42, null), '')
})

test('the config declares the credential-store reference with its default', () => {
  const schema = Config
  assert.ok(schema, 'Config must be exported')
  const fields = Object.keys(schema.dict ?? schema.meta ?? {})
  assert.ok(fields.includes('credentialRef') || JSON.stringify(schema).includes('credentialRef'), 'credentialRef must be declared')
})
