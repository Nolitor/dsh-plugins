/**
 * Static gate: an ENTRY module must never read a service it did not declare.
 *
 * The 2026-11-04 regression was not a logic error — it was `ctx?.tools` in an entry
 * whose `inject` does not list `tools`. cordis throws on that read, the row dies,
 * and the profile boots with "1 entry did not activate". A unit test with a plain
 * object cannot catch it (plain objects never throw), so this test reads the
 * SOURCE and refuses any undeclared service read in a module that the host mounts.
 *
 * Scope: modules that export BOTH `apply` and `inject` — those are the mount
 * surfaces, and `inject` is the declaration that governs them. Library modules
 * (`exclusion.js`, `shared.js`, …) receive a context from their caller, whose
 * declaration is the one that applies; the client bundle (`client.js`) runs on the
 * browser context, not the server one.
 *
 * Rule enforced:
 *   - `ctx.<name>` / `ctx?.<name>` in an entry module MUST be in its `inject` list;
 *   - an undeclared service MUST be read through `optionalService(ctx, '<name>')`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const LIB = new URL('../lib', import.meta.url).pathname

/** cordis core members — always readable, never services. */
const CORE_MEMBERS = new Set([
  'on', 'get', 'effect', 'provide', 'plugin', 'logger', 'inject', 'emit', 'parallel',
  'emitSync', 'bail', 'waterfall', 'serial', 'scope', 'set', 'event', 'lifecycle',
])

/** Browser-side modules: a different context contract. */
const CLIENT_MODULES = new Set(['client.js'])

/** Every .js under lib/, recursively. */
function libFiles(dir = LIB, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) libFiles(path, out)
    else if (entry.name.endsWith('.js')) out.push(path)
  }
  return out
}

/** The `inject` list of a module source, or [] when it declares none. */
function declaredInjects(source) {
  const match = source.match(/export const inject = \[([^\]]*)\]/)
  if (!match) return []
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1])
}

/** `ctx.<name>` and `ctx?.<name>` reads in the source. */
function serviceReads(source) {
  const reads = new Set()
  for (const match of source.matchAll(/\bctx\??\.([A-Za-z_$][\w$]*)/g)) reads.add(match[1])
  return reads
}

/** Whether a module is a mount surface (`export function apply` + `export const inject`). */
function isEntryModule(source) {
  return /export (async )?function apply\s*\(/.test(source) && /export const inject = \[/.test(source)
}

test('no entry module reads an undeclared service through ctx', () => {
  const violations = []
  for (const file of libFiles()) {
    if (CLIENT_MODULES.has(file.split('/').pop())) continue
    const source = readFileSync(file, 'utf8')
    if (!isEntryModule(source)) continue
    const declared = new Set(declaredInjects(source))
    for (const name of serviceReads(source)) {
      if (CORE_MEMBERS.has(name) || declared.has(name)) continue
      violations.push(`${file.replace(LIB + '/', 'lib/')}: ctx.${name} is not in inject [${[...declared].join(', ')}]`)
    }
  }
  assert.deepEqual(violations, [], `undeclared service reads (cordis throws on these):\n${violations.join('\n')}`)
})

test('at least the two known entries are actually covered by this gate', () => {
  const entries = libFiles()
    .filter((file) => !CLIENT_MODULES.has(file.split('/').pop()))
    .filter((file) => isEntryModule(readFileSync(file, 'utf8')))
    .map((file) => file.replace(LIB + '/', 'lib/'))
    .sort()
  assert.deepEqual(entries, ['lib/http.js', 'lib/index.js'])
})

test('the http entry declares exactly what it needs and reads nothing else', () => {
  const source = readFileSync(join(LIB, 'http.js'), 'utf8')
  assert.deepEqual(declaredInjects(source).sort(), ['connection', 'llm', 'sessions', 'settings', 'subprocess'])
  // The historical failure was `ctx?.tools` here; the guard that needed it is gone,
  // so the rule is simply "do not read it at all".
  assert.doesNotMatch(source, /ctx\??\.tools\b/, 'a direct ctx.tools read kills the whole row')
})
