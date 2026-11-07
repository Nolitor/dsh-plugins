import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  Config,
  DEFAULT_FORWARD_ENV,
  DEFAULT_TOOL_NAME,
  RESERVED_TOOL_NAMES,
  TOOL_DESCRIPTION,
  apply,
  createToolDefinition,
  mount,
  mountedProviderFor,
  outputSchema,
  registrationYield,
  selectedBackend,
  toolParameters,
} from '../lib/index.js'
import { DEFAULT_AUTO_ORDER } from '../lib/backends.js'
import { configValue } from '../lib/config.js'
import { EN, KO, SUPPORTED_LOCALES, TABLES, format, renderResult, tableFor } from '../lib/locales.js'
import { emptyResult } from '../lib/worker.js'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SIGNAL = new AbortController().signal

/**
 * Read and parse a JSON file.
 * @param {string} path - absolute path.
 * @returns {Promise<object>} parsed JSON.
 */
async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

/**
 * Build a fake Cordis context that records tool registration.
 * @param {object} [options] - fake behaviour.
 * @returns {object} fake context and recorder.
 */
function fakeContext(options = {}) {
  const registered = []
  const injections = []
  const effects = []
  const warnings = []
  const existingTools = new Map(Object.entries(options.existingTools ?? {}))
  const ctx = {
    tools: {
      get(name) {
        return existingTools.get(name)
      },
      register(definition, registrationOptions) {
        registered.push({ definition, registrationOptions })
        return () => {}
      },
    },
    logger: { warn: (message) => warnings.push(message) },
    effect(dispose) {
      effects.push(dispose)
    },
  }
  if (options.withInject) {
    ctx.inject = (services, callback) => {
      injections.push(services)
      callback(options.subagents ? { subagents: options.subagents } : {})
    }
  }
  if (options.subprocess) ctx.subprocess = options.subprocess
  return { ctx, registered, injections, effects, warnings, existingTools }
}

/**
 * A fake one-shot subprocess that returns fixed stdout.
 * @param {string} stdout - stdout text.
 * @returns {object} subprocess service.
 */
function fakeSubprocess(stdout = '') {
  return {
    async resolveExecutable(command) {
      return `/fake/bin/${command}`
    },
    spawn(spec) {
      return {
        stdin: { on() {}, end() {} },
        collected: {
          stdout: { readFrom: () => ({ text: stdout, nextOffset: stdout.length, lossy: false }) },
          stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
        },
        done: Promise.resolve({ exitCode: 0, signal: null }),
        terminate() {},
        spec,
      }
    },
  }
}

test('schema defaults: English, auto backend, the unique default tool name', () => {
  const config = Config({})
  assert.equal(configValue(config, 'enabled'), true)
  assert.equal(configValue(config, 'toolName'), DEFAULT_TOOL_NAME)
  assert.equal(configValue(config, 'backend'), 'auto')
  assert.equal(configValue(config, 'locale'), 'en')
  assert.equal(configValue(config, 'timeoutMs'), 600000)
  assert.equal(configValue(config, 'artifactDir'), '')
  assert.equal(configValue(config, 'yieldToMountedTool'), true)
  assert.deepEqual(configValue(config, 'autoOrder'), [...DEFAULT_AUTO_ORDER])
  assert.deepEqual(configValue(config, 'forwardEnv'), [...DEFAULT_FORWARD_ENV])
  assert.deepEqual(configValue(config, 'yieldToProviders'), {})
  for (const backend of DEFAULT_AUTO_ORDER) assert.equal(config.backends[backend].enabled, true)
  assert.equal(config.backends.antigravity.path, 'agy')
  assert.equal(config.backends.antigravity.model, 'gemini-3.8-flash-low')
  assert.equal(config.backends.antigravity.effort, 'low')
  assert.equal(config.backends.antigravity.mode, 'accept-edits')
  for (const backend of ['opencode', 'codex', 'claude']) assert.equal(config.backends[backend].path, backend)
  assert.equal(config.backends.opencode.model, '')
  assert.deepEqual(config.backends.codex.extraArgs, [])
  assert.equal(DEFAULT_TOOL_NAME, 'delegate_local')
})

test('schema rejects a locale outside the shipped tables', () => {
  assert.throws(() => Config({ locale: 'ja' }))
  assert.equal(configValue(Config({ locale: 'ko' }), 'locale'), 'ko')
})

test('selectedBackend: per-call override wins, configured backend is the fallback', () => {
  assert.equal(selectedBackend(Config({}), 'codex'), 'codex')
  assert.equal(selectedBackend(Config({}), 'auto'), '')
  assert.equal(selectedBackend(Config({ backend: 'claude' }), ''), 'claude')
  assert.equal(selectedBackend(Config({ backend: 'claude' }), 'opencode'), 'opencode')
})

test('registration yields on a reserved tool name and never registers', async () => {
  const { ctx, registered, warnings } = fakeContext()
  for (const reserved of RESERVED_TOOL_NAMES) {
    const state = await mount(ctx, Config({ toolName: reserved }))
    assert.equal(state.registered, false, `${reserved} should yield`)
    assert.equal(state.yielded.reason, 'reserved-name')
    assert.match(state.yielded.detail, /reserved/)
    assert.equal(registered.length, 0)
    assert.equal(warnings.length > 0, true)
  }
  assert.ok(RESERVED_TOOL_NAMES.includes('subagent_oar'))
  assert.equal(RESERVED_TOOL_NAMES.includes(DEFAULT_TOOL_NAME), false)
})

test('registration yields when the tool name is already mounted instead of hard-failing', async () => {
  const { ctx, registered, warnings } = fakeContext({
    existingTools: { delegate_local: { name: 'delegate_local' } },
  })
  const state = await mount(ctx, Config({}))
  assert.equal(state.registered, false)
  assert.equal(state.yielded.reason, 'tool-name-taken')
  assert.equal(registered.length, 0)
  assert.match(warnings[0], /already registered/)
})

test('registration yields when the plugin is disabled', async () => {
  const { ctx, registered } = fakeContext()
  const state = await mount(ctx, Config({ enabled: false }))
  assert.equal(state.registered, false)
  assert.equal(state.yielded.reason, 'disabled')
  assert.equal(registered.length, 0)
})

test('apply obeys the Cordis effect contract: it returns nothing (no Invalid effect)', async () => {
  const { ctx } = fakeContext()
  assert.equal(await apply(ctx, Config({})), undefined)
})

test('registration registers the rc.1 tool shape with output and a when condition', async () => {
  const { ctx, registered, effects } = fakeContext({ withInject: true, subagents: null })
  const config = Config({})
  const state = await mount(ctx, config)
  assert.equal(state.registered, true)
  assert.equal(registered.length, 1)
  const { definition, registrationOptions } = registered[0]
  assert.equal(definition.name, 'delegate_local')
  assert.equal(definition.description, TOOL_DESCRIPTION)
  assert.equal(typeof definition.execute, 'function')
  assert.equal(typeof definition.output.render, 'function')
  assert.equal(definition.output.schema.type, 'object')
  assert.equal(typeof registrationOptions.when, 'function')
  assert.equal(await registrationOptions.when(), true)
  assert.equal(effects.length, 1)
})

test('the when condition follows enabled live and the execute guard matches it', async () => {
  const { ctx, registered } = fakeContext()
  const config = Config({})
  await mount(ctx, config)
  config.enabled = false
  assert.equal(await registered[0].registrationOptions.when(), false)
})

test('output schema covers exactly the canonical result fields', () => {
  const schema = outputSchema()
  const result = emptyResult('antigravity')
  assert.deepEqual(Object.keys(schema.properties).sort(), Object.keys(result).sort())
  for (const [key, value] of Object.entries(schema.properties)) {
    if (value && value.required) assert.equal(key in result, true, `${key} must exist on the canonical result`)
  }
  assert.deepEqual(Object.keys(schema.properties.usage.properties).sort(), Object.keys(result.usage).sort())
})

test('a disabled plugin returns a disabled result from the tool body', async () => {
  const { ctx } = fakeContext()
  const config = Config({})
  const definition = await createToolDefinition(ctx, config, { subagents: null })
  config.enabled = false
  const result = await definition.execute({ task: 'x', cwd: PACKAGE_ROOT }, { signal: SIGNAL, agent: undefined })
  assert.equal(result.ok, false)
  assert.equal(result.errorKind, 'disabled')
  assert.equal(result.summary, '')
})

test('a task with no resolvable cwd is rejected before any process starts', async () => {
  const { ctx } = fakeContext()
  const definition = await createToolDefinition(ctx, Config({}), { subagents: null })
  await assert.rejects(
    () => definition.execute({ task: 'x' }, { signal: SIGNAL, agent: undefined }),
    /cannot resolve a child cwd/,
  )
  await assert.rejects(
    () => definition.execute({ task: '' }, { signal: SIGNAL, agent: { session: { header: { cwd: '/tmp' } } } }),
    /non-empty task/,
  )
})

test('provider yield: a mounted mapped provider stops the raw CLI and says so', async () => {
  const provider = { name: 'oar' }
  const { ctx } = fakeContext({
    withInject: true,
    subagents: { getProvider: (name) => (name === 'oar' ? provider : undefined) },
  })
  const state = { subagents: null }
  ctx.inject(['subagents'], (scoped) => {
    state.subagents = scoped.subagents
  })
  const config = Config({ yieldToProviders: { codex: 'oar' } })
  assert.equal(mountedProviderFor(state, config, 'codex'), 'oar')
  assert.equal(mountedProviderFor(state, config, 'antigravity'), '')

  const definition = await createToolDefinition(ctx, config, state)
  const result = await definition.execute(
    { task: 'x', cwd: PACKAGE_ROOT, backend: 'codex' },
    { signal: SIGNAL, agent: undefined },
  )
  assert.equal(result.ok, false)
  assert.equal(result.errorKind, 'provider-mounted')
  assert.equal(result.yieldedProvider, 'oar')
  assert.match(result.diagnostic, /served by the mounted provider "oar"/)
})

test('a call delegates through the resolved backend and returns canonical facts', async () => {
  const stdout = JSON.stringify({ status: 'SUCCESS', response: 'delegated answer', usage: { input_tokens: 7, output_tokens: 3 } })
  const { ctx } = fakeContext({ subprocess: fakeSubprocess(stdout) })
  const definition = await createToolDefinition(ctx, Config({}), { subagents: null })
  const result = await definition.execute(
    { task: 'do the thing', cwd: PACKAGE_ROOT, backend: 'antigravity' },
    { signal: SIGNAL, agent: undefined },
  )
  assert.equal(result.ok, true)
  assert.equal(result.backend, 'antigravity')
  assert.equal(result.summary, 'delegated answer')
  assert.equal(result.usage.inputTokens, 7)
})

test('parameter schema exposes one tool for four backends plus auto', () => {
  const config = Config({})
  const parameters = toolParameters(config)
  assert.equal(parameters.task.required, true)
  assert.deepEqual(parameters.backend.enum, ['auto', 'antigravity', 'opencode', 'codex', 'claude'])
  assert.equal(parameters.collect.items.type, 'string')
  assert.match(parameters.backend.description, /auto/)
})

test('locale tables have key parity and English is the only default', () => {
  assert.deepEqual([...SUPPORTED_LOCALES], ['en', 'ko'])
  assert.deepEqual(Object.keys(KO).sort(), Object.keys(EN).sort())
  assert.deepEqual(TABLES.en, EN)
  assert.equal(tableFor('ko'), KO)
  for (const locale of ['en', 'fr', 'ja', undefined]) assert.equal(tableFor(locale), EN)
  assert.equal(format('hello {name}', { name: 'world' }), 'hello world')
  assert.equal(format('{missing} stays', {}), '{missing} stays')
})

test('Korean result text is used only when locale=ko; the answer body stays verbatim', () => {
  const result = {
    ...emptyResult('antigravity'),
    ok: true,
    summary: 'the CLI answer',
    model: 'gemini-3.8-flash-low',
    elapsedMs: 12,
    usage: { inputTokens: 1, outputTokens: 2, thinkingTokens: 3, cacheReadTokens: 4 },
  }
  const english = renderResult(result, 'en')
  const korean = renderResult(result, 'ko')
  const fallback = renderResult(result, 'fr')
  assert.match(english, /antigravity finished/)
  assert.match(korean, /작업이 끝났습니다/)
  assert.equal(fallback, english)
  for (const rendered of [english, korean]) assert.match(rendered, /the CLI answer/)
  assert.match(english, /\[tokens: input 1, output 2, thinking 3, cached 4\]/)
  assert.match(korean, /\[토큰: 입력 1, 출력 2, 사고 3, 캐시 4\]/)
})

test('package manifest is rc.1-shaped and consistent with the bundle patch', async () => {
  const pkg = await readJson(join(PACKAGE_ROOT, 'package.json'))
  assert.equal(pkg.name, '@nolit/dsh-subagent-local')
  assert.match(pkg.version, /^0\.0\.1-rc\.\d+$/)
  assert.equal(pkg.version, '0.0.1-rc.1')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.main, 'lib/index.js')
  assert.equal(pkg.dsh.manifestVersion, 1)
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.engines.node, '>=24.9')
  assert.match(pkg.engines.dsh, />=0\.2\.2-alpha\.2 <0\.3\.0/)
  assert.match(pkg.peerDependencies['@deepseek-ai/cordis'], /\^4\.1\.0/)
  for (const subpath of ['.', './cordis.patch.yml', './package.json', './locale/*.json', './icon.svg']) {
    assert.ok(pkg.exports[subpath], `exports is missing ${subpath}`)
  }
  assert.equal(pkg.icon, './icon.svg')
  assert.equal(pkg.dsh.client, undefined, 'this package must not declare a client half it does not ship')

  const patch = await readFile(join(PACKAGE_ROOT, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /id: dsh-subagent-local/)
  assert.match(patch, /name: '@nolit\/dsh-subagent-local'/)
  assert.match(patch, /toolName: delegate_local/)
  for (const backend of DEFAULT_AUTO_ORDER) assert.match(patch, new RegExp(`${backend}:`))
  assert.doesNotMatch(patch, /@nolit\/dsh-subagent-antigravity/)

  await stat(join(PACKAGE_ROOT, 'icon.svg'))
  for (const locale of SUPPORTED_LOCALES) {
    const dict = await readJson(join(PACKAGE_ROOT, 'locale', `${locale}.json`))
    assert.equal(typeof dict.meta.title, 'string')
    assert.equal(typeof dict['tool.delegate_local.name'], 'string')
    assert.equal(typeof dict['tool.delegate_local.description'], 'string')
  }
  const en = await readJson(join(PACKAGE_ROOT, 'locale', 'en.json'))
  const ko = await readJson(join(PACKAGE_ROOT, 'locale', 'ko.json'))
  assert.deepEqual(Object.keys(ko).sort(), Object.keys(en).sort())
})

test('this package registers no provider and no command surface', async () => {
  const { ctx } = fakeContext()
  ctx.commands = {
    register() {
      throw new Error('subagent-local must not register a command')
    },
  }
  Object.defineProperty(ctx, 'subagents', {
    get() {
      throw new Error('subagent-local must not read ctx.subagents directly')
    },
  })
  const state = await mount(ctx, Config({}))
  assert.equal(state.registered, true)
})
