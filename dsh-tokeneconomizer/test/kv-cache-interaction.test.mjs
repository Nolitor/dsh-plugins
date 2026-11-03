/**
 * KV-cache interaction check against the installed DSH alpha.3 prompt registry.
 *
 * The provider's prompt cache is a prefix cache over the request messages, whose head
 * is the assembled system prompt. This verifies (a) the plugin's section descriptor is
 * valid for the host's PromptSection contract, (b) the pinned text is byte-stable for a
 * whole session, and (c) the plugin owns no storage domain that could collide with the
 * host's session_projcache.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { composePinnedText, pinnedSection, PINNED_SECTION_NAME, DEFAULT_PINNED_RULES_ORDER, THINK_IN_CODE_RULES } from '../lib/prefix.js'

const checks = []
const ok = (name, fn) => { fn(); checks.push(name) }

ok('the section descriptor satisfies the host PromptSection contract', () => {
  const section = pinnedSection('rules', 50)
  assert.equal(typeof section.name, 'string')
  assert.equal(typeof section.order, 'number')
  assert.equal(typeof section.text, 'string')
  assert.equal(section.interpolate, false, 'pinned text must never be interpolated')
  assert.equal(section.complete, undefined, 'the plugin must not claim the whole prompt')
})

ok('the section name is unique and stable', () => {
  assert.equal(PINNED_SECTION_NAME, 'tokeneconomizer:pinned-rules')
  assert.equal(pinnedSection('x', 50).name, PINNED_SECTION_NAME)
})

ok('the composed prefix is byte-stable across calls', () => {
  const a = composePinnedText('always measure', true)
  const b = composePinnedText('always measure', true)
  assert.equal(a, b, 'a varying prefix would reset the provider cache each turn')
  assert.ok(a.includes(THINK_IN_CODE_RULES))
})

ok('the composed prefix carries no per-session or per-turn value', () => {
  for (let turn = 0; turn < 5; turn++) {
    assert.equal(composePinnedText('rules', true), composePinnedText('rules', true))
  }
})

ok('an empty pin mounts no section rather than an empty one', () => {
  assert.equal(composePinnedText('', false), '')
  assert.equal(composePinnedText('   ', false), '')
})

ok('the default order sits inside the host range and is not complete', () => {
  assert.ok(Number.isInteger(DEFAULT_PINNED_RULES_ORDER))
  assert.ok(DEFAULT_PINNED_RULES_ORDER > 0 && DEFAULT_PINNED_RULES_ORDER < 1000)
})

ok('the plugin declares no storage domain, so it cannot collide with session_projcache', () => {
  const root = path.resolve('lib')
  const files = fs.readdirSync(root).filter((f) => f.endsWith('.js'))
  const offenders = []
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    if (/defineDomain\(|storage-domain|sessionProjectionCache|session_projcache/.test(source)) offenders.push(file)
  }
  assert.deepEqual(offenders, [], 'the plugin must read no host cache domain')
})

ok('the plugin injects no storage/cache service', () => {
  const index = fs.readFileSync(path.resolve('lib/index.js'), 'utf8')
  const inject = index.match(/export const inject = \[([^\]]*)\]/)[1]
  const services = inject.split(',').map((s) => s.trim().replace(/['\"]/g, '')).filter(Boolean)
  assert.deepEqual(services, ['tools', 'systemPrompt', 'tokenMeter'])
  for (const forbidden of ['storage', 'sessionProjectionCache', 'sessionQuery', 'llm']) {
    assert.ok(!services.includes(forbidden), 'unexpected injected service: ' + forbidden)
  }
})

console.log('KV-cache interaction: ' + checks.length + '/' + checks.length + ' checks passed')
for (const c of checks) console.log('  ok - ' + c)