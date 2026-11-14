/**
 * Tool-argument contract gate — the host's execution contracts enforced at the
 * L1 seam, so no vendor can emit an unrunnable tool call.
 *
 * WHY THIS SUITE EXISTS
 * A live Gemini/Antigravity run died with
 * `Error: invalid escalation: justification is only valid together with
 * sandbox_permissions`. The cause was structural, not a Gemini quirk: every
 * vendor hands its calls to the ONE shared pipe, and the pipe forwarded the
 * arguments as the model wrote them. The host validates the escalation pairing
 * on the EXECUTION path (`@deepseek-ai/dsh-sandbox` `validateEscalationArgs`),
 * which a provider schema cannot express — so a drifted call survived the wire
 * and was refused at execution, where the model could not see it coming.
 *
 * WHAT IS ASSERTED
 *   1. every measured host violation is repaired at the single emission point;
 *   2. a WELL-FORMED escalation is preserved byte-for-byte — the repair must not
 *      quietly strip a legitimate permission request;
 *   3. the rule is DERIVED from the tool declaration's prose, so a differently
 *      named pair is covered with no edit here (the anti-hardcoding proof);
 *   4. the derivation is pinned against the host's own measured text, so an
 *      upstream rephrasing fails a test instead of going silent;
 *   5. a call whose arguments need no repair is returned by identity.
 *
 * The host package is NOT importable from this repo (`@deepseek-ai/dsh-sandbox`
 * is not a dependency), so the contract is pinned by its measured text rather
 * than by calling it. `hostContractText()` records what was measured on
 * 2026-11-14 and fails loudly if the host install is reachable but rephrased.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  dependentArguments,
  reconcileArgumentText,
  reconcileToolArguments,
} from '../lib/stream/tool-argument-contract.js'
import { normalizeStream } from '../lib/stream/index.js'

/** The measured host phrase that declares a dependent argument. */
const HOST_DEPENDENCY_PHRASE = 'Required with sandbox_permissions'

/** The escalation schema shape the host actually ships (measured 2026-11-14). */
function escalationTools(justificationField = 'justification', principal = 'sandbox_permissions') {
  return [{
    name: 'write',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        [principal]: { type: 'string', enum: ['workspace-write', 'danger-full-access'] },
        [justificationField]: {
          type: 'string',
          description: `${HOST_DEPENDENCY_PHRASE}: one sentence for the user explaining why this exact file operation needs the wider access.`,
        },
      },
    },
  }]
}

/** Run one complete-shaped call through the real shared pipe. */
async function throughPipe(args, tools) {
  const events = (async function* () {
    yield { parts: [{ kind: 'tool-call', id: 'call-1', name: 'write', arguments: args }] }
  })()
  const descriptor = { toolCallShape: 'complete' }
  const hooks = { readEvent: (payload) => payload, usageFrom: () => undefined, mapFinish: () => 'stop' }
  const chunks = []
  for await (const chunk of normalizeStream({ events, descriptor, hooks, tools })) chunks.push(chunk)
  const blockEnd = chunks.find((chunk) => chunk.type === 'block-end')
  return { chunks, blockEnd, args: JSON.parse(blockEnd.block.arguments) }
}

// ---------------------------------------------------------------------------
// 1. The measured host violations are repaired
// ---------------------------------------------------------------------------

test('an unpaired justification is dropped so the call is executable', async () => {
  // The exact live failure shape: the reason travelled without its principal.
  const { args } = await throughPipe({ path: 'a.txt', content: 'x', justification: 'the user asked' }, escalationTools())
  assert.equal(args.justification, undefined, 'the lone justification must not reach the host')
  assert.equal(args.path, 'a.txt')
  assert.equal(args.content, 'x', 'every other argument is preserved')
})

test('a blank-but-present justification is removed, never fabricated', async () => {
  const { args } = await throughPipe(
    { path: 'a.txt', content: 'x', sandbox_permissions: 'workspace-write', justification: '   ' },
    escalationTools(),
  )
  // The escalation itself is kept: the model DID ask for wider access.
  assert.equal(args.sandbox_permissions, 'workspace-write')
  // The blank reason is gone, and no invented sentence replaced it.
  assert.equal(args.justification, undefined)
})

// ---------------------------------------------------------------------------
// 2. A legitimate escalation is preserved (the regression that matters most)
// ---------------------------------------------------------------------------

test('a well-formed escalation passes through unchanged', async () => {
  const input = { path: 'a.txt', content: 'x', sandbox_permissions: 'danger-full-access', justification: 'needs host access' }
  const { args } = await throughPipe(input, escalationTools())
  assert.deepEqual(args, input, 'a sanctioned escalation must survive byte-for-byte')
})

test('a principal without a reason is left for the host to report', async () => {
  // Dropping the principal would silently cancel a permission the model asked
  // for; that is the host's call to refuse, not this layer's to pre-empt.
  const { args } = await throughPipe({ path: 'a.txt', content: 'x', sandbox_permissions: 'workspace-write' }, escalationTools())
  assert.equal(args.sandbox_permissions, 'workspace-write')
})

test('a call with no escalation is untouched and keeps its identity', () => {
  const input = { path: 'a.txt', content: 'x' }
  const tools = escalationTools()
  const schema = tools[0].parameters
  assert.equal(reconcileToolArguments(input, schema), input, 'no repair means the same reference')
  const text = '{"path":"a.txt","content":"x"}'
  assert.equal(reconcileArgumentText(text, schema), text, 'no repair means the same string')
})

test('arguments this layer cannot parse are not rewritten', () => {
  // Unparseable text is a provider/stream defect the failure policy owns.
  const broken = '{"path":'
  assert.equal(reconcileArgumentText(broken, escalationTools()[0].parameters), broken)
})

// ---------------------------------------------------------------------------
// 3. The rule is DERIVED, not a hardcoded field name (the anti-hardcoding proof)
// ---------------------------------------------------------------------------

test('the rule follows the declaration, whatever the fields are called', () => {
  // A pair with names this module has never heard of, declared the same way.
  const schema = {
    type: 'object',
    properties: {
      mode: { type: 'string' },
      why: { type: 'string', description: 'Required with mode: say why.' },
    },
  }
  assert.deepEqual(dependentArguments(schema), [{ field: 'why', requires: 'mode' }])
  assert.deepEqual(reconcileToolArguments({ other: 1, why: 'because' }, schema), { other: 1 })
  assert.deepEqual(reconcileToolArguments({ other: 1, mode: 'x', why: 'because' }, schema), { other: 1, mode: 'x', why: 'because' })
})

test('a declaration naming itself, or an absent field, states no constraint', () => {
  const selfReferential = { properties: { field: { description: 'Required with field' } } }
  assert.deepEqual(dependentArguments(selfReferential), [])
  const absent = { properties: { field: { description: 'Required with nowhere' } } }
  assert.deepEqual(dependentArguments(absent), [])
})

test('a schema with no declared properties yields no pairs', () => {
  assert.deepEqual(dependentArguments(undefined), [])
  assert.deepEqual(dependentArguments({}), [])
  assert.deepEqual(dependentArguments({ properties: null }), [])
})

// ---------------------------------------------------------------------------
// 4. The derivation is pinned against the host's measured declaration
// ---------------------------------------------------------------------------

test('the host still declares its dependent arguments with the measured phrase', (t) => {
  const install = process.env.DSH_INSTALL_DIR
  const sandbox = install === undefined ? '' : join(install, 'node_modules', '@deepseek-ai', 'dsh-sandbox', 'lib', 'index.js')
  if (sandbox === '' || !existsSync(sandbox)) {
    // The host install is not reachable from every checkout (CI, isolated
    // home). The measured text below is then the pin.
    t.diagnostic('host install not reachable; the recorded 2026-11-14 measurement stands')
    assert.ok(HOST_DEPENDENCY_PHRASE.startsWith('Required with '))
    return
  }
  const source = readFileSync(sandbox, 'utf8')
  // The phrase itself lives in the TOOL packages' schemas; the sandbox package
  // owns the validator. Pin the validator's three refusal messages instead, so a
  // host that stops treating the pair as dependent fails here.
  assert.match(source, /requires a justification/, 'the principal-still-needs-a-reason rule moved')
  assert.match(source, /justification is only valid together with/, 'the dependent-alone rule moved')
  assert.match(source, /expected a non-empty sentence/, 'the non-blank rule moved')
})

test('the escalation fields are declared as a dependent pair by the host tools', (t) => {
  const install = process.env.DSH_INSTALL_DIR
  if (install === undefined) {
    t.diagnostic('host install not reachable; the recorded measurement stands')
    return
  }
  // The measured wording, on all three tools that carry the escalation fields.
  const tools = ['dsh-tool-bash', 'dsh-tool-fs', 'dsh-tool-pwsh'].map((name) => join(install, 'node_modules', '@deepseek-ai', name, 'lib', 'index.js'))
  const readable = tools.filter((path) => existsSync(path))
  if (readable.length === 0) {
    t.diagnostic('no host tool package reachable; the recorded measurement stands')
    return
  }
  let declared = 0
  for (const path of readable) {
    if (readFileSync(path, 'utf8').includes(HOST_DEPENDENCY_PHRASE)) declared += 1
  }
  assert.ok(
    declared > 0,
    `none of ${readable.length} readable host tool packages declares "${HOST_DEPENDENCY_PHRASE}" any more — the derivation in tool-argument-contract.js needs its phrase updated`,
  )
})

// ---------------------------------------------------------------------------
// 5. The pipe is the single choke point, so every vendor inherits the repair
// ---------------------------------------------------------------------------

test('the repair applies to fragmented calls too, on both wire shapes', async () => {
  // The same unpaired justification, delivered as two argument fragments — the
  // OpenAI-compatible path — must repair identically.
  const events = (async function* () {
    yield { parts: [{ kind: 'tool-call', index: 0, id: 'c9', name: 'write', argumentsDelta: '{"path":"a.txt","justification":' }] }
    yield { parts: [{ kind: 'tool-call', index: 0, argumentsDelta: '"user asked"}' }] }
  })()
  const descriptor = { toolCallShape: 'fragmented' }
  const hooks = { readEvent: (payload) => payload, usageFrom: () => undefined, mapFinish: () => 'stop' }
  const chunks = []
  for await (const chunk of normalizeStream({ events, descriptor, hooks, tools: escalationTools() })) chunks.push(chunk)
  const blockEnd = chunks.find((chunk) => chunk.type === 'block-end')
  const args = JSON.parse(blockEnd.block.arguments)
  assert.equal(args.justification, undefined)
  assert.equal(args.path, 'a.txt')
})

test('every vendor call site hands the pipe the declared tools', () => {
  // A vendor that omits `tools` would silently lose the repair, so the wiring
  // itself is asserted rather than assumed.
  const root = new URL('..', import.meta.url).pathname
  const sites = [
    'vendor/antigravity/lib/adapter.js',
    'vendor/deepinfra/lib/adapter.js',
    'vendor/deepinfra/lib/anthropic-adapter.js',
    'vendor/exaone/lib/adapter.js',
    'vendor/opencode/lib/http.js',
  ]
  for (const site of sites) {
    const source = readFileSync(join(root, site), 'utf8')
    assert.match(source, /tools:\s*options\.tools/, `${site} calls normalizeStream without declaring tools`)
  }
})
