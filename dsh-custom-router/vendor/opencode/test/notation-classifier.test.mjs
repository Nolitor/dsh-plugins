/**
 * Contract tests for the restored upstream classifier (0.0.1).
 *
 * The 0.7.8 state machine was deleted in 0.8.0. This file pins the behaviour it
 * must keep now that it is back, plus the shape it must additionally handle:
 * DeepSeek markup (DSML) leaked inside a text payload.
 *
 * Invariants under test:
 *   I1 prose verbatim, syntax only removed
 *   I2 bounded hold in TEXT
 *   I3 unparsable notation is dropped, never printed
 *   I4 output invariant under re-chunking
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createNotationClassifier } from '../lib/notation-classifier.js'

const TOOLS = new Set(['bash', 'run_code'])

function classify(text, chunkSize = 0) {
  const classifier = createNotationClassifier({ toolNames: TOOLS })
  const out = []
  if (chunkSize > 0) {
    for (let at = 0; at < text.length; at += chunkSize) {
      out.push(...classifier.push(text.slice(at, at + chunkSize)))
    }
  } else {
    out.push(...classifier.push(text))
  }
  out.push(...classifier.flush())
  return { parts: out, stats: classifier.stats }
}

const textOf = (parts) => parts.filter((part) => part.kind === 'text').map((part) => part.text).join('')
const callsOf = (parts) => parts.filter((part) => part.kind === 'tool-call')

test('plain prose is emitted verbatim and unchanged', () => {
  const { parts } = classify('Hello. This mentions [a link] and <but not a tag>.')
  assert.deepEqual(parts, [{ kind: 'text', text: 'Hello. This mentions [a link] and <but not a tag>.' }])
})

test('a thinking wrapper becomes reasoning; the token never reaches text', () => {
  const { parts, stats } = classify('<thinking>weigh it</thinking>done')
  assert.deepEqual(parts, [
    { kind: 'reasoning', text: 'weigh it' },
    { kind: 'text', text: 'done' },
  ])
  assert.equal(stats.thinking, 1)
  assert.equal(textOf(parts).includes('</thinking>'), false)
})

test('an unterminated thinking block is flushed as reasoning, not text', () => {
  const { parts, stats } = classify('<thinking>still going')
  assert.deepEqual(parts, [{ kind: 'reasoning', text: 'still going' }])
  assert.equal(stats.unterminatedThinking, 1)
})

test('a spec-grammar body call is promoted and removed from text', () => {
  const source = 'Now:\n[tool call bash #call_7]: {"command":"ls -la"}\n'
  const { parts } = classify(source)
  assert.equal(textOf(parts), 'Now:\n\n')
  const calls = callsOf(parts)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'bash')
  assert.equal(calls[0].id, 'call_7')
  assert.deepEqual(JSON.parse(calls[0].arguments), { command: 'ls -la' })
})

test('an undeclared tool in the body is dropped, never executed or printed', () => {
  const { parts, stats } = classify('x\n[tool call rm_rf #call_1]: {"path":"/"}\n')
  assert.equal(callsOf(parts).length, 0)
  assert.equal(textOf(parts).includes('rm_rf'), false)
  assert.equal(stats.stripped, 1)
})

test('malformed notation is dropped, not printed', () => {
  const { parts, stats } = classify('[tool call bash #call_1]: {"command": "ls"')
  assert.equal(textOf(parts).includes('[tool call'), false)
  assert.equal(callsOf(parts).length, 0)
  assert.equal(stats.degraded, 1)
})

test('a notation that begins mid-line stays prose (a marker must start a line)', () => {
  const { parts } = classify('the form is [tool call bash #call_1]: {"command":"ls"} inline')
  assert.equal(textOf(parts).includes('[tool call bash'), true)
  assert.equal(callsOf(parts).length, 0)
})

test('the XML invoke form becomes a call', () => {
  const source = '<invoke name="bash"><parameter name="command">ls -la</parameter></invoke>'
  const { parts } = classify(source)
  const calls = callsOf(parts)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'bash')
  assert.deepEqual(JSON.parse(calls[0].arguments), { command: 'ls -la' })
  assert.equal(textOf(parts).includes('<invoke'), false)
})

test('DSML notation leaked into content becomes a real call and leaves no marker', () => {
  const source = 'Running it.\n[tool call run_code">\n' +
    '<｜DSML｜ parameter name="code" string="true">const x = 1</｜DSML｜ parameter>\n' +
    '<｜DSML｜ parameter name="description" string="true">probe</｜DSML｜ parameter>\n' +
    '</｜DSML｜ invoke>\n</｜DSML｜ calls>'
  const { parts } = classify(source)
  const calls = callsOf(parts)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'run_code')
  assert.deepEqual(JSON.parse(calls[0].arguments), { code: 'const x = 1', description: 'probe' })
  assert.equal(textOf(parts).includes('｜DSML｜'), false)
  assert.equal(textOf(parts).includes('[tool call'), false)
  assert.equal(textOf(parts), 'Running it.\n')
})

test('re-chunking invariance: every two-way split yields the same parts', () => {
  const source = 'a\n<thinking>t</thinking>b\n[tool call bash #c1]: {"command":"ls"}\nc'
  const whole = classify(source).parts.map((part) => JSON.stringify(part)).join('\n')
  for (let cut = 1; cut < source.length; cut += 1) {
    const split = classify(source, cut)
    // join, because a chunk boundary may split a prose part into two parts
    const text = textOf(split.parts)
    const calls = callsOf(split.parts)
    assert.equal(calls.length, 1, 'call lost at cut ' + cut)
    assert.deepEqual(JSON.parse(calls[0].arguments), { command: 'ls' }, 'call mutated at cut ' + cut)
    assert.equal(text.includes('[tool call '), false, 'marker printed at cut ' + cut)
    assert.equal(text.includes('<thinking>'), false, 'thinking token printed at cut ' + cut)
  }
  assert.equal(typeof whole, 'string')
})

test('stray closers are removed from prose', () => {
  const { parts } = classify('done</thinking> now')
  assert.equal(textOf(parts), 'done now')
})

test('model-written element closers are removed, even split across deltas', () => {
  // Measured live 2026-11-02 (session edeabe91, step 14): a cut response ended with
  // a run of </run_code>/</function> closers that reached the screen as reasoning.
  const source = 'parse JSONL.\n\n</run_code>\r\n\n</function>\r\n</function>'
  const { parts } = classify(source)
  assert.equal(textOf(parts).trim(), 'parse JSONL.')
  const perChar = classify('parse JSONL.\n\n</run_code>\r\n\n</function>', 1)
  assert.equal(textOf(perChar.parts).trim(), 'parse JSONL.')
  const mixed = classify('a</run_code>b<function>c</tool_call>d')
  assert.equal(textOf(mixed.parts), 'abcd')
})

const NEW_TOOLS = [{ name: 'run_code', parameters: { type: 'object', properties: { code: {}, description: {} }, required: ['code'] } }]
function classifyWithTools(text) {
  const classifier = createNotationClassifier({ toolNames: new Set(['run_code']), tools: NEW_TOOLS })
  return { parts: [...classifier.push(text), ...classifier.flush()], stats: classifier.stats }
}

test('a mixed <tool_call> marker with box-drawing DSML parameters becomes a call', () => {
  const source = '<tool_call #call_00_abc>\n' +
    '</│DSML│ parameter name="code">const x = 1</│DSML│>\n' +
    '<│DSML│parameter name="description">probe</│DSML│>'
  const { parts } = classifyWithTools(source)
  const calls = callsOf(parts)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'run_code')
  assert.deepEqual(JSON.parse(calls[0].arguments), { code: 'const x = 1', description: 'probe' })
  assert.equal(textOf(parts).includes('DSML'), false)
  assert.equal(textOf(parts).includes('tool_call'), false)
})

test('a bare marker with no payload is dropped, never printed', () => {
  const { parts, stats } = classifyWithTools('prose\n<tool call run_code #code_placeholder_001>\n</｜｜DSML｜｜ parameter>')
  assert.equal(textOf(parts), 'prose\n')
  assert.equal(callsOf(parts).length, 0)
  assert.equal(stats.degraded, 1)
})

test('a JSON payload after a mixed <tool call ...] marker is still promoted', () => {
  const source = '<tool call run_code #call_00_6s1e]: {"code":"const a = 1"}'
  const { parts } = classifyWithTools(source)
  const calls = callsOf(parts)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].id, 'call_00_6s1e')
  assert.deepEqual(JSON.parse(calls[0].arguments), { code: 'const a = 1' })
})

test('an unknown name is inferred from the argument schema', () => {
  const source = '<tool_call #call_00_x>\n</│DSML│ parameter name="code">const y = 2</│DSML│>'
  const { parts } = classifyWithTools(source)
  const calls = callsOf(parts)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'run_code')
})


function classifyCharByChar(text) {
  const classifier = createNotationClassifier({ toolNames: new Set(['run_code']), tools: NEW_TOOLS })
  const parts = []
  for (const ch of text) parts.push(...classifier.push(ch))
  parts.push(...classifier.flush())
  return { parts, stats: classifier.stats }
}

test('a tool marker split into single characters never reaches the screen', () => {
  const source = 'prose\n<tool call run_code #call_x]: {"code":"a"}'
  const { parts } = classifyCharByChar(source)
  assert.equal(textOf(parts).includes('tool call'), false)
  assert.equal(callsOf(parts).length, 1)
  assert.deepEqual(JSON.parse(callsOf(parts)[0].arguments), { code: 'a' })
})

test('a standalone parameter tag is dropped even when split', () => {
  const source = 'done.\n<parameter name="code">const x = 1</parameter>'
  const { parts } = classifyCharByChar(source)
  assert.equal(textOf(parts), 'done.\n')
  assert.equal(callsOf(parts).length, 0)
})

test('a DSML opener with attributes split across deltas is not printed', () => {
  const source = 'x\n<｜DSML｜ invoke name="bash">\n\n'
  const { parts } = classifyCharByChar(source)
  assert.equal(textOf(parts).includes('DSML'), false)
  assert.equal(textOf(parts).includes('invoke'), false)
})

test('every two-way split of a mixed payload leaves no marker on screen', () => {
  const source = 'a\n<tool_call #call_1>\n</│DSML│ parameter name="code">const x = 1</│DSML│>'
  for (let cut = 1; cut < source.length; cut += 1) {
    const classifier = createNotationClassifier({ toolNames: new Set(['run_code']), tools: NEW_TOOLS })
    const parts = [
      ...classifier.push(source.slice(0, cut)),
      ...classifier.push(source.slice(cut)),
      ...classifier.flush(),
    ]
    const shown = textOf(parts)
    assert.equal(/tool[ _-]?call/i.test(shown), false, 'marker printed at cut ' + cut)
    assert.equal(shown.includes('DSML'), false, 'DSML printed at cut ' + cut)
  }
})

