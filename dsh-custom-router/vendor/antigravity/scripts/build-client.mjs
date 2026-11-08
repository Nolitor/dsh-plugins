#!/usr/bin/env node
/**
 * Bake lib/locale-table.js into lib/client.js.
 *
 * The browser loader evaluates client.js as a plain script, so it cannot import
 * the locale module. This script replaces the ONE assignment placeholder with the
 * literal table.
 *
 * BUG THIS FIXES (measured 2026-11-05): the first version used a plain
 * `src.replace('__AG_I18N__', ...)`, which matched the placeholder inside the
 * explanatory COMMENT above the assignment and left `const I18N = __AG_I18N__`
 * untouched. The browser then read `globalThis.__AG_I18N__` (undefined -> {}) and
 * every `t()` call threw, so the settings section crashed on first render and
 * never appeared. The replacement is now anchored to the assignment line, and
 * the build FAILS if the placeholder survives.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcPath = join(root, 'lib', 'client.src.js')
const outPath = join(root, 'lib', 'client.js')

// First run: treat the checked-in client.js as the source.
if (!existsSync(srcPath)) copyFileSync(outPath, srcPath)

const src = readFileSync(srcPath, 'utf8')
const ASSIGNMENT = /const I18N = __AG_I18N__/
if (!ASSIGNMENT.test(src)) {
  console.error('build-client: client.src.js has no "const I18N = __AG_I18N__" assignment')
  process.exit(1)
}

// Strip the module wrapper from the generated table and keep only the object.
const generated = readFileSync(join(root, 'lib', 'locale-table.js'), 'utf8')
const match = /export const I18N = ([\s\S]*)$/.exec(generated)
if (!match) {
  console.error('build-client: lib/locale-table.js has no "export const I18N = ..."')
  process.exit(1)
}
const literal = match[1].trim().replace(/;\s*$/, '')

const out = src.replace(ASSIGNMENT, 'const I18N = ' + literal)
if (/__AG_I18N__/.test(out.replace(/\/\/[^\n]*/g, ''))) {
  console.error('build-client: placeholder survived the replacement')
  process.exit(1)
}
writeFileSync(outPath, out)
console.log('build-client: wrote lib/client.js')
