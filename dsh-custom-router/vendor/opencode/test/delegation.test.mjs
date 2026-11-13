/**
 * Managed child-session delegation: pure helpers and the activation spec.
 *
 * These tests pin the owner-decided contract (2026-11-05): the `opencode` tool
 * and `/ocode` delegate to `subagents.startActivation` with this package's
 * provider and `delivery: 'parent'`, return the child id immediately, and never
 * spawn a bare process by default. No child process, network, or ~/.dsh access:
 * the subagent service is a recording fake.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CHILD_DELIVERY,
  CHILD_UNSUPPORTED_ARGS,
  DEFAULT_PROVIDER_NAME,
  DelegationError,
  FALLBACK_ENV,
  activationLabel,
  activationText,
  fallbackEnabled,
  fallbackText,
  labelFromPrompt,
  promptBlocks,
  providerNameOf,
  startChildSession,
  unavailableMessage,
  unsupportedChildArgs,
} from '../lib/delegation.js'

/** A config object exposing schemastery Volatiles (`.get()` readers). */
function configWith(values) {
  return new Proxy({}, {
    get(_target, key) {
      return { get: () => values[key] }
    },
  })
}

/** A subagents service that records every activation and never settles its result. */
function recordingSubagents(options = {}) {
  const starts = []
  const service = {
    starts,
    providers: options.providers ?? [{ name: 'opencode' }],
    getProvider(name) {
      return this.providers.find((provider) => provider.name === name)
    },
    registerProvider() {
      return () => {}
    },
    async startActivation(spec) {
      starts.push(spec)
      if (options.throwOnStart) throw new Error(options.throwOnStart)
      return {
        childId: options.childId ?? 'child-1',
        // Never resolved on purpose: startChildSession must not await the result.
        result: new Promise(() => {}),
        dispose: async () => {},
      }
    },
  }
  return service
}

/** One parent agent identity; only reference equality matters here. */
const PARENT = Object.freeze({ session: { id: 'parent-1' } })

test('the provider name comes from config, with the registered default', () => {
  assert.equal(providerNameOf(configWith({ subagentProviderName: 'opencode' })), 'opencode')
  assert.equal(providerNameOf(configWith({ subagentProviderName: '  custom  ' })), 'custom')
  assert.equal(providerNameOf(configWith({ subagentProviderName: '' })), DEFAULT_PROVIDER_NAME)
  assert.equal(providerNameOf(configWith({})), DEFAULT_PROVIDER_NAME)
  assert.equal(providerNameOf(null), DEFAULT_PROVIDER_NAME)
})

test('the emergency fallback is opt-in only', () => {
  assert.equal(fallbackEnabled({}), false)
  assert.equal(fallbackEnabled({ [FALLBACK_ENV]: '0' }), false)
  assert.equal(fallbackEnabled({ [FALLBACK_ENV]: 'false' }), false)
  assert.equal(fallbackEnabled({ [FALLBACK_ENV]: ' 1 ' }), true)
  assert.equal(fallbackEnabled({ [FALLBACK_ENV]: 'YES' }), true)
  assert.equal(fallbackEnabled({ [FALLBACK_ENV]: 'on' }), true)
})

test('the label is the title, else the prompt first line, always bounded', () => {
  assert.equal(activationLabel({ title: ' Fix   the  parser ', prompt: 'task text' }), 'Fix the parser')
  assert.equal(activationLabel({ prompt: 'one\ntwo' }), 'one two')
  assert.equal(activationLabel({ prompt: '' }), 'opencode delegation')
  const long = 'x'.repeat(200)
  assert.equal(labelFromPrompt(long).length, 80)
  assert.ok(labelFromPrompt(long).endsWith('…'))
})

test('a prompt is one text content block; empty prompts are refused', () => {
  assert.deepEqual(promptBlocks('  do work  '), [{ type: 'text', text: 'do work' }])
  assert.throws(() => promptBlocks('   '), (error) => error instanceof DelegationError && error.code === 'empty-prompt')
  assert.throws(() => promptBlocks(undefined), DelegationError)
})

test('per-call options child mode cannot honor are detected, not ignored', () => {
  assert.deepEqual(unsupportedChildArgs({ prompt: 'x' }), [])
  assert.deepEqual(unsupportedChildArgs({ model: '', agent: '', files: [], continueLast: false }), [])
  assert.deepEqual(unsupportedChildArgs({ model: 'opencode/x' }), ['model'])
  assert.deepEqual(
    unsupportedChildArgs({ model: 'm', agent: 'build', session: 'ses_1', continueLast: true, auto: true, thinking: false, files: ['a'] }),
    ['model', 'agent', 'session', 'continueLast', 'auto', 'files'],
  )
  for (const name of CHILD_UNSUPPORTED_ARGS) {
    const value = name === 'files' ? ['a'] : 'set'
    assert.ok(unsupportedChildArgs({ [name]: value }).includes(name), name + ' must be detected when supplied')
  }
})

test('a started child carries the flat activation spec the 0.2.1-rc.2+ seam expects', async () => {
  const service = recordingSubagents()
  const controller = new AbortController()
  const started = await startChildSession({
    subagents: service,
    providerName: 'opencode',
    label: 'Fix parser',
    prompt: 'do the task',
    parent: PARENT,
    signal: controller.signal,
  })
  assert.equal(started.childId, 'child-1')
  assert.equal(started.provider, 'opencode')
  assert.equal(service.starts.length, 1)
  const spec = service.starts[0]
  assert.equal(spec.provider, 'opencode')
  assert.equal(spec.label, 'Fix parser')
  assert.equal(spec.delivery, CHILD_DELIVERY)
  assert.equal(spec.delivery, 'parent')
  assert.equal(spec.signal, controller.signal)
  // Regression 2026-11-13: the host removed the nested `request` field in DSH
  // 0.2.1-rc.2 and reads `spec.parent.id` first. The old nested shape made every
  // `opencode` call fail with "Cannot read properties of undefined (reading 'id')".
  assert.equal(Object.hasOwn(spec, 'request'), false, 'the removed nested `request` field must not be sent')
  assert.equal(spec.parent, PARENT)
  assert.equal(spec.parent.session.id, 'parent-1', 'the live service resolves spec.parent.id before any provider')
  assert.deepEqual(spec.prompt, [{ type: 'text', text: 'do the task' }])
  assert.equal(Object.hasOwn(spec, 'cwd'), false, 'omitted cwd inherits the parent directory')
})

test('an explicit cwd is forwarded; a missing signal gets a live one', async () => {
  const service = recordingSubagents({ childId: 'child-9' })
  const started = await startChildSession({
    subagents: service,
    providerName: 'opencode',
    label: 'x',
    prompt: 'p',
    parent: PARENT,
    cwd: '/repo/sub',
  })
  assert.equal(started.childId, 'child-9')
  assert.equal(service.starts[0].cwd, '/repo/sub')
  assert.ok(service.starts[0].signal instanceof AbortSignal)
  assert.equal(service.starts[0].signal.aborted, false)
})

test('no subagents service is a clear refusal, not a spawn', async () => {
  await assert.rejects(
    () => startChildSession({ subagents: null, providerName: 'opencode', label: 'x', prompt: 'p', parent: PARENT }),
    (error) => error instanceof DelegationError
      && error.code === 'unavailable'
      && /Refusing to spawn an untracked opencode process/.test(error.message)
      && error.message.includes(FALLBACK_ENV),
  )
})

test('a missing calling agent is refused', async () => {
  await assert.rejects(
    () => startChildSession({ subagents: recordingSubagents(), providerName: 'opencode', label: 'x', prompt: 'p', parent: undefined }),
    (error) => error.code === 'no-parent',
  )
})

test('an unregistered provider is refused instead of delegating to a stranger', async () => {
  const service = recordingSubagents({ providers: [{ name: 'someone-else' }] })
  await assert.rejects(
    () => startChildSession({ subagents: service, providerName: 'opencode', label: 'x', prompt: 'p', parent: PARENT }),
    (error) => error.code === 'provider-missing' && /not registered/.test(error.message),
  )
  assert.equal(service.starts.length, 0)
})

test('an aborted signal starts nothing', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    () => startChildSession({
      subagents: recordingSubagents(),
      providerName: 'opencode',
      label: 'x',
      prompt: 'p',
      parent: PARENT,
      signal: controller.signal,
    }),
    (error) => error.code === 'aborted',
  )
})

test('a backend start failure is wrapped with its cause', async () => {
  const service = recordingSubagents({ throwOnStart: 'provider exploded' })
  await assert.rejects(
    () => startChildSession({ subagents: service, providerName: 'opencode', label: 'x', prompt: 'p', parent: PARENT }),
    (error) => error.code === 'start-failed'
      && /provider exploded/.test(error.message)
      && error.cause instanceof Error,
  )
})

test('an activation without a child id is rejected', async () => {
  const service = recordingSubagents({ childId: '' })
  await assert.rejects(
    () => startChildSession({ subagents: service, providerName: 'opencode', label: 'x', prompt: 'p', parent: PARENT }),
    (error) => error.code === 'no-child-id',
  )
})

test('outcome text names the child and the completion notice, and labels fallback work', () => {
  const text = activationText({ provider: 'opencode', childId: 'child-7' })
  assert.match(text, /child-7/)
  assert.match(text, /completion notice/)
  assert.match(unavailableMessage('opencode'), /no `subagents` service/)
  const fallback = fallbackText('opencode finished successfully.')
  assert.match(fallback, new RegExp(FALLBACK_ENV + '=1'))
  assert.match(fallback, /will not appear as a child session/)
  assert.match(fallback, /finished successfully\./)
})
