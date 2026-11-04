/**
 * Mutual-exclusion guard tests.
 *
 * The guard exists because the stable and beta packages register the same tool,
 * commands, worker and model route: both loaded is a broken profile, not a
 * degraded one. These tests cover the claim file, staleness, and the live-sibling
 * check, all without a host.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CLAIM_FILE,
  EXCLUSIVE_PACKAGES,
  claimActivation,
  detectSibling,
  isLiveClaim,
  readClaim,
  releaseClaim,
  resolveClaimPath,
} from '../lib/exclusion.js'

const STABLE = '@nolit/dsh-opencode-v2'
const BETA = '@nolit/dsh-opencode-v2-beta'

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'dsh-exclusion-'))
}

test('the claim path follows the catalog rule: explicit, then DSH_HOME, then nothing', () => {
  assert.equal(resolveClaimPath({ explicit: '/x/claim.json' }), '/x/claim.json')
  assert.equal(resolveClaimPath({ dshHome: '/home' }), join('/home', 'cache', CLAIM_FILE))
  assert.equal(resolveClaimPath({}), '')
  assert.equal(resolveClaimPath({ explicit: '', dshHome: '' }), '')
})

test('the first package claims the profile', () => {
  const path = join(tempHome(), 'cache', CLAIM_FILE)
  const claim = claimActivation({ owner: STABLE, path })
  assert.equal(claim.ok, true)
  assert.equal(claim.code, 'claimed')
  const stored = readClaim(path)
  assert.equal(stored.owner, STABLE)
  assert.equal(stored.pid, process.pid)
  assert.ok(Date.parse(stored.at) > 0)
})

test('the same package re-claiming is a no-op, not a conflict', () => {
  const path = join(tempHome(), 'cache', CLAIM_FILE)
  claimActivation({ owner: STABLE, path })
  const again = claimActivation({ owner: STABLE, path })
  assert.equal(again.ok, true)
  assert.equal(again.code, 'already-claimed')
})

test('a LIVE sibling claim refuses activation with an actionable message', () => {
  const path = join(tempHome(), 'cache', CLAIM_FILE)
  claimActivation({ owner: STABLE, path })
  const refused = claimActivation({ owner: BETA, path })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'OPENCODE_EXCLUSIVE_CONFLICT')
  assert.equal(refused.owner, STABLE)
  assert.match(refused.message, /cannot activate/)
  assert.match(refused.message, /Disable one of the two packages/)
  assert.equal(readClaim(path).owner, STABLE, 'the claim must not be stolen')
})

test('a claim left by a DEAD process is taken over', () => {
  const home = tempHome()
  const path = join(home, 'cache', CLAIM_FILE)
  // pid 2^31-1 is not a live process on Linux (max_pid is far below it).
  mkdirSync(join(home, 'cache'), { recursive: true })
  writeFileSync(path, JSON.stringify({ owner: STABLE, pid: 2147483646, at: new Date().toISOString() }))
  const claim = claimActivation({ owner: BETA, path })
  assert.equal(claim.ok, true)
  assert.equal(claim.code, 'stale-claim-taken-over')
  assert.equal(readClaim(path).owner, BETA)
})

test('isLiveClaim treats this process as live and a bogus pid as not', () => {
  assert.equal(isLiveClaim({ pid: process.pid }), true)
  assert.equal(isLiveClaim({ pid: 2147483646 }), false)
  assert.equal(isLiveClaim(null), false)
  assert.equal(isLiveClaim({ pid: 'x' }), false)
})

test('release only removes a claim this package owns', () => {
  const path = join(tempHome(), 'cache', CLAIM_FILE)
  claimActivation({ owner: STABLE, path })
  assert.equal(releaseClaim(path, BETA), false)
  assert.equal(readClaim(path).owner, STABLE)
  assert.equal(releaseClaim(path, STABLE), true)
  assert.equal(readClaim(path), null)
  assert.equal(releaseClaim(path, STABLE), false)
})

test('an unwritable claim path never blocks activation', () => {
  // A path under a file (not a directory) cannot be created.
  const home = tempHome()
  const file = join(home, 'blocker')
  writeFileSync(file, 'x')
  const path = join(file, 'cache', CLAIM_FILE)
  const claim = claimActivation({ owner: STABLE, path })
  assert.equal(claim.ok, true)
  assert.equal(claim.code, 'claim-unwritable')
})

test('an empty path disables the file guard without throwing', () => {
  const claim = claimActivation({ owner: STABLE, path: '' })
  assert.equal(claim.ok, true)
})

test('a corrupt claim file is treated as "no claim"', () => {
  const home = tempHome()
  const path = join(home, 'cache', CLAIM_FILE)
  mkdirSync(join(home, 'cache'), { recursive: true })
  writeFileSync(path, 'not json')
  assert.equal(readClaim(path), null)
  assert.equal(claimActivation({ owner: BETA, path }).code, 'claimed')
})

test('the live-sibling check reads the provider registry and the tool table', () => {
  // A shared provider id cannot name an owner, so registration alone is not
  // evidence; a FOREIGN id that is registered is.
  const shared = detectSibling({ owner: BETA, llm: { listProviders: () => [{ id: 'opencode-http-agent' }] } })
  assert.equal(shared.conflict, false)
  const foreign = detectSibling({
    owner: BETA,
    llm: { listProviders: () => [{ id: 'opencode-go' }] },
    foreignProviderIds: ['opencode-go'],
  })
  assert.equal(foreign.conflict, true)
  assert.match(foreign.evidence.join(' '), /provider "opencode-go"/)

  const toolsHit = detectSibling({ owner: BETA, tools: { get: (name) => (name === 'opencode' ? {} : undefined) } })
  assert.equal(toolsHit.conflict, true)
  assert.match(toolsHit.evidence.join(' '), /tool "opencode"/)

  assert.equal(detectSibling({ owner: BETA, llm: { listProviders: () => [] }, tools: { get: () => undefined } }).conflict, false)
})

test('an unreadable registry is not evidence of a collision', () => {
  const broken = detectSibling({ owner: BETA, llm: { listProviders: () => { throw new Error('nope') } }, tools: { get: () => { throw new Error('nope') } } })
  assert.equal(broken.conflict, false)
})

test('both packages are declared exclusive of each other', () => {
  assert.deepEqual([...EXCLUSIVE_PACKAGES].sort(), [STABLE, BETA].sort())
  assert.equal(claimActivation({ owner: STABLE, path: '' }).ok, true)
})

test('the runtime check matches the host API the plugin actually calls', () => {
  // Regression: the first implementation read llm.adapters(), which this host does
  // not provide, so the live-sibling guard could never fire. The registry is
  // llm.listProviders() (measured in dsh-llm LlmRuntime).
  const withProviders = detectSibling({
    owner: BETA,
    llm: { listProviders: () => [{ id: 'opencode-go' }] },
    foreignProviderIds: ['opencode-go'],
  })
  assert.equal(withProviders.conflict, true)
  const adaptersOnly = detectSibling({
    owner: BETA,
    llm: { adapters: () => [{ provider: 'opencode-go' }] },
    foreignProviderIds: ['opencode-go'],
  })
  assert.equal(adaptersOnly.conflict, false, 'a made-up method must not be trusted as evidence')
})
