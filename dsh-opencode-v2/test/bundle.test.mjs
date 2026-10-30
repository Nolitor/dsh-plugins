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
  assert.match(pkg.scripts.test, /--test\s/)
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

test('the bundle ships the tool row plus the autonomous HTTP router row', async () => {
  assert.ok(Array.isArray(doc), 'top-level must be an array of loader patch entries')
  assert.equal(doc.length, 1)
  assert.deepEqual(Object.keys(doc[0]), ['insert'])
  assert.deepEqual(
    rows.map((r) => [r.id, r.name]),
    [
      ['dsh-opencode-v2', '@nolit/dsh-opencode-v2'],
      ['dsh-opencode-v2-http', '@nolit/dsh-opencode-v2/http'],
    ],
  )
  // The HTTP route is the only conversation pipeline and is mounted natively.
  // `./provider` stays exported as the batch-worker backend, but it registers
  // no LLM adapter and is not a row.
  assert.ok('./provider' in pkg.exports)
  assert.ok('./http' in pkg.exports)
  const worker = await import('../lib/provider.js')
  assert.equal(typeof worker.apply, 'undefined', './provider must not be mountable as a route')
})

test('row ids equal the exported plugin names (loader settings namespace)', () => {
  assert.equal(rows[0].id, tool.name)
  assert.equal(rows[1].id, http.name)
})

test('the HTTP row config parses and pins the native-router settings', () => {
  const row = rows.find((r) => r.id === 'dsh-opencode-v2-http')
  assert.ok(row, 'missing the native HTTP router row')
  const known = new Set(Object.keys(http.Config({})))
  for (const key of Object.keys(row.config)) {
    assert.ok(known.has(key), `HTTP row sets unknown key ${key}`)
  }
  const parsed = http.Config(row.config)
  assert.equal(parsed.opencodePath.get(), '/home/minami/.bun/bin/opencode')
  assert.equal(parsed.attachToDaemon.get(), true)
  assert.equal(parsed.spawnServer.get(), true)
  assert.equal(parsed.autoDiscoverModels.get(), true)
  assert.equal(parsed.conflictPolicy.get(), 'warn')
  assert.match(parsed.cwd.get(), /dsh-workspace/)
  assert.match(parsed.defaultModel.get(), /^opencode(-go)?\//)
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
  assert.equal(parsed.model.get(), tool.DEFAULT_MODEL)
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
    cwd: '',
    defaultModel: 'opencode/beam-free',
    conflictPolicy: 'warn',
    backendProviderId: 'opencode-go',
    reasoningField: 'reasoning_content',
  }
  for (const key of Object.keys(profileRowConfig)) {
    assert.ok(known.has(key), `HTTP profile row sets unknown key ${key}`)
  }
  const parsed = http.Config(profileRowConfig)
  assert.equal(parsed.defaultModel.get(), 'opencode/beam-free')
  assert.equal(known.has('fallbackToCli'), false, 'the CLI is not a conversation fallback')
  assert.equal(known.has('registerCliProvider'), false, 'the CLI is not a conversation provider')
  for (const removed of ['brief', 'sessionMapPath', 'permissionDecision', 'sessionPermissions', 'localSessionTitles']) {
    assert.equal(known.has(removed), false, `${removed} must not exist after de-harnessing`)
  }
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

test('the patch default model is a qualified route with a reasoning level', () => {
  const model = rows[0].config.model
  assert.match(model, /^opencode(-go)?\//)
  assert.equal(model, tool.DEFAULT_MODEL)
  // The suffix is the route's lowest advertised reasoning level.
  assert.match(model, /#low$/)
})

test('the client half is declared as a web bundle entry', () => {
  assert.equal(pkg.exports['./client'].default, './lib/client.js')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'))
  assert.ok(pkg.files.includes('lib/'), 'the client file ships inside lib/')
})

/**
 * Regression (0.6.1): a client half that touches a service must EXPORT the
 * service list. The loader injects only `module.exports.inject`; an array that
 * is declared and used but never exported leaves `ctx.<service>` undefined, so
 * `apply()` throws and the fibre lands in `failed` — which kills the entire web
 * shell (`web boot: N entries did not activate`) with no detail in any log.
 * `--dump-config`, the served bundle returning 200, route probes and
 * `node --check` all pass in that state, so only this contract test catches it.
 */
test('client half exports an inject array covering every ctx service it uses', () => {
  const source = readFileSync(new URL('lib/client.js', root), 'utf8')

  // The shell evaluates the bundle against a scoped window object, never the
  // real global: mirror that so the capture is faithful.
  let registration = null
  new Function('window', source)({ __ModuleLoader__: { load: (reg) => { registration = reg } } })
  assert.ok(registration, 'lib/client.js must register with window.__ModuleLoader__.load')
  assert.equal(registration.id, pkg.name)

  const stub = () => new Proxy(function () {}, {
    get: (_target, key) => (key === Symbol.toPrimitive ? () => 'stub' : key === 'then' ? undefined : stub()),
    apply: () => stub(),
    construct: () => stub(),
  })
  const exportsObj = registration.factory((spec) => {
    assert.equal(spec, 'react', `client half may only require baseline modules, got ${spec}`)
    return stub()
  })

  assert.equal(typeof exportsObj.apply, 'function', 'client half must export apply()')
  assert.ok(Array.isArray(exportsObj.inject), 'exports.inject must be an array (Cordis service injection)')

  const used = new Set([...source.matchAll(/\bctx\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1]))
  assert.ok(used.size > 0, 'the client half should touch at least one service')
  for (const service of used) {
    assert.ok(
      exportsObj.inject.includes(service),
      `ctx.${service} is used in apply() but "${service}" is missing from exports.inject`,
    )
  }
  assert.ok(exportsObj.inject.includes('slots'), "the settings.section registration needs the 'slots' service")
  assert.ok(exportsObj.default?.inject?.includes('slots'), 'the default export face must carry inject as well')
})

/** Load the served client module with a stub React, as the shell would. */
function loadClientExports() {
  const source = readFileSync(new URL('lib/client.js', root), 'utf8')
  let registration = null
  new Function('window', source)({ __ModuleLoader__: { load: (reg) => { registration = reg } } })
  const stub = () => new Proxy(function () {}, {
    get: (_target, key) => (key === Symbol.toPrimitive ? () => 'stub' : key === 'then' ? undefined : stub()),
    apply: () => stub(),
    construct: () => stub(),
  })
  return { exportsObj: registration.factory(() => stub()), source }
}

/**
 * Requirement (2026-10-31): availability is plan-based, so the section must expose
 * a Go/Zen plan choice and must not carry a per-model sweep button any more.
 */
test('client half offers the plan choice and no model sweep', () => {
  const { source, exportsObj } = loadClientExports()
  assert.match(source, /planGo/)
  assert.match(source, /planZen/)
  assert.match(source, /model-settings\/apply/)
  assert.ok(!/model-settings\/measure/.test(source), 'the per-model sweep button must stay removed')
  assert.ok(!/사용 가능 모델 확인|Check usable models/.test(source), 'no sweep label should remain')
  assert.equal(typeof exportsObj.OpenCodeModelSection, 'function')
})

/** Menu names follow the UI language: 오픈코드 V2 (ko) / OpenCode V2 (en). */
test('client half labels the settings tab per locale', () => {
  const { source } = loadClientExports()
  assert.match(source, /nav: '오픈코드 V2'/)
  assert.match(source, /nav: 'OpenCode V2'/)
  assert.ok(!/nav: 'OpenCode v2'/.test(source), 'the lower-case "v2" label must not come back')
})
