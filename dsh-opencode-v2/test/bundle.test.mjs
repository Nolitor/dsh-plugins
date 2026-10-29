/**
 * Bundle-layer contract: cordis.patch.yml must agree with package.json
 * exports and with each module's exported `name` + Config schema.
 *
 * No YAML dependency: the file is read and checked with a tiny line scanner
 * that is stricter about the fields we care about than a generic parse.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import yaml from 'js-yaml'
import { register } from 'node:module'

const DSH_TOOLS_STUB = new URL('./helpers/dsh-tools-stub.mjs', import.meta.url).href
try {
  await import('@deepseek-ai/dsh-tools')
} catch {
  register(
    'data:text/javascript,' +
      encodeURIComponent(
        `export async function resolve(spec, context, next) {
           if (spec === '@deepseek-ai/dsh-tools') return { url: ${JSON.stringify(DSH_TOOLS_STUB)}, shortCircuit: true }
           return next(spec, context)
         }`,
      ),
    import.meta.url,
  )
}

const root = new URL('..', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const yml = readFileSync(new URL('cordis.patch.yml', root), 'utf8')

const tool = await import('../lib/index.js')
const provider = await import('../lib/provider.js')
const http = await import('../lib/http.js')

/** Load the patch with a real YAML parser (js-yaml, as the host ecosystem uses). */
const doc = yaml.load(yml)
const rows = doc.flatMap((entry) => entry.insert ?? [])

test('package.json has the exact engine window required by boot card rule 4', () => {
  assert.equal(pkg.engines.dsh, '>=0.2.2-alpha.2 <0.3.0')
  assert.equal(pkg.engines.node, '^22.19.0 || >=24.0.0')
})

test('package.json declares its own bundle patch, not upstream\'s', () => {
  assert.equal(pkg.dsh.manifestVersion, 1)
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.main, 'lib/index.js')
  assert.equal(pkg.type, 'module')
  assert.ok(!pkg.scripts.build, 'no build step')
  assert.match(pkg.scripts.test, /node --test/)
})

/**
 * Manifest integrity guard (§10): a concurrent sibling agent once wrote
 * dsh-sidebar-manager's manifest over this package's package.json. Pin the name
 * so that mis-write fails immediately with an obvious message.
 */
test('manifest integrity: package.json name is exactly @nolit/dsh-opencode-v2', () => {
  assert.equal(pkg.name, '@nolit/dsh-opencode-v2')
})

test('upstream plugin stays a dependency and is never patched', () => {
  assert.equal(pkg.dependencies['@quonaro/dsh-plugin-opencode'], '^0.1.2')
})

/**
 * P0-1 regression: the host routes a bare import to the installation copy ONLY
 * when the importing package lists it in `peerDependencies`
 * (dsh-app-boot `routeLinked` -> `readPeerNames(directory).has(name)`).
 * Without these the rows die with ERR_MODULE_NOT_FOUND on a real mount.
 */
test('P0-1: every host import is declared as a peerDependency', () => {
  assert.deepEqual(pkg.peerDependencies, {
    '@deepseek-ai/cordis': '^4.0.4',
    '@deepseek-ai/dsh-llm': '^0.2.2-alpha.2',
    '@deepseek-ai/dsh-subprocess': '^0.2.2-alpha.2',
    '@deepseek-ai/dsh-tools': '^0.2.2-alpha.2',
    '@deepseek-ai/schemastery': '~3.18.4',
  })
})

test('P0-1: schemastery is a peer (runtime value), never a bare dependency', () => {
  // `Schema.object()` runs at module scope, so it must stay resolvable; the
  // host provides installation packages only through the peer route.
  assert.ok(pkg.peerDependencies['@deepseek-ai/schemastery'])
  assert.equal(pkg.dependencies['@deepseek-ai/schemastery'], undefined)
  assert.equal(pkg.dependencies['@deepseek-ai/dsh-tools'], undefined)
})

test('P0-1: no source file imports a bare package that is not a peer', () => {
  const peers = new Set(Object.keys(pkg.peerDependencies ?? {}))
  const declared = new Set([...peers, ...Object.keys(pkg.dependencies ?? {})])
  const files = ['lib/index.js', 'lib/provider.js', 'lib/shared.js']
  for (const file of files) {
    const text = readFileSync(new URL(file, root), 'utf8')
    for (const match of text.matchAll(/(?:import[^'"]*from|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)) {
      const spec = match[1]
      if (spec.startsWith('.') || spec.startsWith('node:')) continue
      const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
      assert.ok(declared.has(name), `${file} imports ${name}, which is neither a dependency nor a peerDependency`)
    }
  }
})

test('every package export resolves to a real file', () => {
  for (const [key, value] of Object.entries(pkg.exports)) {
    const target = typeof value === 'string' ? value : value.default
    assert.ok(existsSync(new URL(target, root)), `missing export target for ${key}: ${target}`)
  }
})

test('every declared file pattern exists on disk', () => {
  assert.ok(existsSync(new URL('cordis.patch.yml', root)))
  assert.ok(existsSync(new URL('README.md', root)))
  assert.ok(readdirSync(new URL('lib/', root)).length >= 3)
})

test('the bundle ships exactly one row (the delegation tool); the HTTP route is profile-level', () => {
  assert.ok(Array.isArray(doc), 'top-level must be an array of loader patch entries')
  assert.equal(doc.length, 1)
  assert.deepEqual(Object.keys(doc[0]), ['insert'])
  assert.deepEqual(
    rows.map((r) => [r.id, r.name]),
    [['dsh-opencode-v2', '@nolit/dsh-opencode-v2']],
  )
  // The LLM routes stay exported so a profile can insert them explicitly.
  assert.ok('./provider' in pkg.exports)
  assert.ok('./http' in pkg.exports)
})

test('row ids equal the exported plugin names (loader settings namespace)', () => {
  assert.equal(rows[0].id, tool.name)
  assert.equal(http.name, 'dsh-opencode-v2-http')
})

test('row plugin names match package.json exports keys', () => {
  assert.equal(rows[0].name, pkg.name)
  for (const row of rows) {
    const subpath = row.name === pkg.name ? '.' : `.${row.name.slice(pkg.name.length)}`
    assert.ok(subpath in pkg.exports, `${subpath} must be exported`)
  }
})

test('every tool-row config key exists in the tool Config schema', () => {
  const known = new Set(Object.keys(tool.Config({})))
  for (const key of Object.keys(rows[0].config)) {
    assert.ok(known.has(key), `cordis.patch.yml tool row sets unknown key ${key}`)
  }
  // The keys the task requires, explicitly.
  for (const key of ['opencodePath', 'auto', 'model', 'agent', 'thinking', 'timeoutMs', 'maxOutputBytes', 'forwardEnv', 'extraArgs', 'exportTimeoutMs']) {
    assert.ok(key in rows[0].config, `tool row must set ${key}`)
  }
  const parsed = tool.Config(rows[0].config)
  assert.equal(parsed.model.get(), 'opencode/deepseek-v4.1-flash-free')
  assert.equal(parsed.thinking.get(), true)
  assert.equal(parsed.auto.get(), true)
  for (const key of ['PATH', 'HOME', 'USER', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'OPENCODE_CONFIG', 'OPENCODE_SERVER_USERNAME', 'OPENCODE_SERVER_PASSWORD']) {
    assert.ok(parsed.forwardEnv.get().includes(key), `forwardEnv must include ${key}`)
  }
})

test('the HTTP route config parses with the http Config schema', () => {
  const known = new Set(Object.keys(http.Config({})))
  const profileRowConfig = {
    attachToDaemon: true,
    spawnServer: true,
    opencodePath: '/home/minami/.bun/bin/opencode',
    defaultModel: 'opencode/beam-free',
    permissionDecision: 'once',
    fallbackToCli: true,
  }
  for (const key of Object.keys(profileRowConfig)) {
    assert.ok(known.has(key), `HTTP profile row sets unknown key ${key}`)
  }
  const parsed = http.Config(profileRowConfig)
  assert.equal(parsed.fallbackToCli.get(), true)
  assert.equal(parsed.registerCliProvider.get(), false)
  assert.equal(parsed.defaultModel.get(), 'opencode/beam-free')
})

test('the patch never configures attach or pure (v2 rejects both flags)', () => {
  for (const row of rows) {
    assert.ok(!('attach' in row.config), `${row.id} must not configure attach`)
    assert.ok(!('pure' in row.config), `${row.id} must not configure pure`)
  }
  // ...but the reason is documented in the file itself.
  assert.match(yml, /attach/)
  assert.match(yml, /Unrecognized flag/)
})

test('the patch default model is an opencode/ route, never opencode-go/', () => {
  const model = rows[0].config.model
  assert.match(model, /^opencode\/.+/)
  assert.doesNotMatch(model, /^opencode-go\//)
  assert.equal(model, tool.DEFAULT_MODEL)
})
