import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = '/home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-opencode-v2'
const libs = readdirSync(join(ROOT, 'lib')).filter((f) => f.endsWith('.js'))
const prod = libs.map((f) => [f, readFileSync(join(ROOT, 'lib', f), 'utf8')])
const tests = readdirSync(join(ROOT, 'test')).filter((f) => f.endsWith('.mjs'))
  .map((f) => [f, readFileSync(join(ROOT, 'test', f), 'utf8')])
const bundle = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
const pkg = readFileSync(join(ROOT, 'package.json'), 'utf8')

// A symbol is removable only if NO production file, test, patch or manifest names it.
const candidates = process.argv.slice(2)
for (const spec of candidates) {
  const [file, name] = spec.split(':')
  const re = new RegExp('\\b' + name + '\\b')
  const inProd = prod.filter(([f, s]) => f !== file && re.test(s)).map(([f]) => f)
  const inTest = tests.filter(([, s]) => re.test(s)).map(([f]) => f)
  const inPatch = re.test(bundle) || re.test(pkg)
  const verdict = inProd.length === 0 && inTest.length === 0 && !inPatch ? 'REMOVABLE' : 'IN USE'
  console.log(verdict.padEnd(10), (file + ':' + name).padEnd(42), inProd.length || inTest.length || inPatch ? 'prod=' + inProd.join(',') + ' test=' + inTest.join(',') + ' patch=' + inPatch : '')
}
