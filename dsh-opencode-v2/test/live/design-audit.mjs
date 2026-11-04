import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = '/home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-opencode-v2'

// 1) Every export in lib/, and whether anything outside its own test imports it.
const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) walk(p)
    else if (name.endsWith('.js')) files.push(p)
  }
}
walk(join(ROOT, 'lib'))

const sources = new Map()
for (const f of files) sources.set(f, readFileSync(f, 'utf8'))
const testFiles = readdirSync(join(ROOT, 'test')).filter((n) => n.endsWith('.mjs')).map((n) => join(ROOT, 'test', n))
const testSrc = testFiles.map((f) => readFileSync(f, 'utf8')).join('\n')

console.log('=== exports never imported by production code ===')
for (const [f, src] of sources) {
  const names = [...src.matchAll(/^export (?:async )?function ([A-Za-z0-9_]+)|^export const ([A-Za-z0-9_]+)/gm)]
    .map((m) => m[1] ?? m[2])
  for (const name of names) {
    const re = new RegExp('\\b' + name + '\\b')
    let prod = 0
    for (const [other, otherSrc] of sources) {
      if (other === f) continue
      if (re.test(otherSrc)) prod += 1
    }
    const inTests = re.test(testSrc)
    if (prod === 0) {
      console.log((inTests ? '  test-only  ' : '  DEAD       ') + f.replace(ROOT + '/', '') + '  ->  ' + name)
    }
  }
}

// 2) Duplicated helper names across modules.
console.log('\n=== duplicate function names across lib/ ===')
const seen = new Map()
for (const [f, src] of sources) {
  for (const m of src.matchAll(/^(?:export )?(?:async )?function ([A-Za-z0-9_]+)/gm)) {
    const list = seen.get(m[1]) ?? []
    list.push(f.replace(ROOT + '/lib/', ''))
    seen.set(m[1], list)
  }
}
for (const [name, where] of seen) if (where.length > 1) console.log('  ' + name + ': ' + where.join(', '))

// 3) Module sizes and import edges.
console.log('\n=== module graph (lines, imports) ===')
for (const [f, src] of [...sources].sort((a, b) => b[1].split('\n').length - a[1].split('\n').length)) {
  const imports = [...src.matchAll(/^import .*from '\.\/(.+?)\.js'/gm)].map((m) => m[1])
  console.log(String(src.split('\n').length).padStart(5) + '  ' + f.replace(ROOT + '/lib/', '').padEnd(22) + ' -> ' + imports.join(' '))
}
