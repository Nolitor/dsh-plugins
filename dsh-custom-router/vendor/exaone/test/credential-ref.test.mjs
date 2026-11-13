/**
 * DSH credential-store migration for EXAONE: the key may come from the host
 * credential store (`~/.dsh/.credentials.yaml` -> `refs:`) instead of a
 * plaintext `apiKey:`. Precedence is pure and pinned without a host.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { Config, keyPrecedence } from '../lib/index.js'

test('an explicit key wins over the credential store and the environment', () => {
  assert.equal(keyPrecedence('cfg-key', 'stored-key', 'env-key'), 'cfg-key')
})

test('the credential store wins over the environment when no key is configured', () => {
  assert.equal(keyPrecedence('', 'stored-key', 'env-key'), 'stored-key')
})

test('a blank stored value falls through to the environment', () => {
  assert.equal(keyPrecedence('', '   ', 'env-key'), 'env-key')
})

test('nothing configured is an empty string', () => {
  assert.equal(keyPrecedence(undefined, undefined, undefined), '')
})

test('the config declares the credential-store reference with its default', () => {
  assert.ok(Config, 'Config must be exported')
  assert.ok(JSON.stringify(Config).includes('credentialRef'), 'credentialRef must be declared')
})
