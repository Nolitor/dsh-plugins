import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = '/home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-opencode-v2'
const libs = readdirSync(join(ROOT, 'lib')).filter((f) => f.endsWith('.js'))
const sources = new Map(libs.map((f) => [f, readFileSync(join(ROOT, 'lib', f), 'utf8')]))
const tests = readdirSync(join(ROOT, 'test')).filter((f) => f.endsWith('.mjs'))

// Where a symbol is referenced: its own file (intra), another lib file (prod), test/.
const usage = (name, owner) => ({
  intra: (sources.get(owner).match(new RegExp('\\b' + name + '\\b', 'g')) ?? []).length - 1,
  prod: [...sources].filter(([f, s]) => f !== owner && new RegExp('\\b' + name + '\\b').test(s)).map(([f]) => f),
  test: tests.filter((t) => new RegExp('\\b' + name + '\\b').test(readFileSync(join(ROOT, 'test', t), 'utf8'))),
})

const dead = []
for (const [owner, src] of sources) {
  const names = [...src.matchAll(/^export (?:async )?function ([A-Za-z0-9_]+)|^export const ([A-Za-z0-9_]+)/gm)].map((m) => m[1] ?? m[2])
  for (const name of names) {
    const u = usage(name, owner)
    if (u.intra <= 0 && u.prod.length === 0) dead.push({ owner, name, ...u })
  }
}
console.log('=== no production reference at all (intra 0, other libs 0) ===')
for (const d of dead) {
  console.log('  ' + (d.test.length ? 'test-only' : 'DEAD     ') + '  ' + d.owner.padEnd(20) + d.name.padEnd(30) + (d.test.length ? 'test: ' + d.test.join(',') : ''))
}
console.log('\ncounts: dead=' + dead.filter((d) => !d.test.length).length + ' test-only=' + dead.filter((d) => d.test.length).length)
