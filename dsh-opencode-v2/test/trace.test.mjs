/**
 * Contract tests for the real-traffic trace (0.0.1-rc.5).
 *
 * The trace exists because a short probe cannot reproduce the leak: the defect
 * needs long, output-heavy turns. These tests pin that the trace is compact,
 * never copies prompts or credentials, and can be switched off.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createTrace, hasMarker, summarizePart, summarizeRequest, MARKER_EXCERPT } from '../lib/trace.js'

const file = () => join(mkdtempSync(join(tmpdir(), 'oc-trace-')), 'trace.jsonl')

test('the trace can be switched off with OPENCODE_V2_TRACE=0', () => {
  const path = file()
  const previous = process.env.OPENCODE_V2_TRACE
  process.env.OPENCODE_V2_TRACE = '0'
  try {
    const trace = createTrace({ path })
    assert.equal(trace.enabled, false)
    trace.request({ model: 'm', messages: 1, chars: 10 })
    assert.equal(existsSync(path), false)
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_V2_TRACE
    else process.env.OPENCODE_V2_TRACE = previous
  }
})

test('request, marker delta and finish are one compact line each', () => {
  const path = file()
  const trace = createTrace({ path })
  trace.request({ model: 'deepseek-v4.1-flash', messages: 12, chars: 4000, tools: 38, hasSystem: true })
  trace.delta({ field: 'content', len: 12, marker: true, excerpt: 'x'.repeat(MARKER_EXCERPT * 2) })
  trace.finish({ finish: 'tool_calls', parts: { content: 3 } })
  const lines = readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.deepEqual(lines.map((line) => line.kind), ['request', 'delta', 'finish'])
  assert.equal(lines[0].tools, 38, 'request shape is recorded')
})

test('a marker excerpt is bounded and bodies are never written', () => {
  const path = file()
  const trace = createTrace({ path })
  const secret = 'PROMPT-BODY-' + 'z'.repeat(5000)
  trace.request({ model: 'm', messages: 1, chars: secret.length })
  trace.delta(summarizePart({ kind: 'text', text: secret + ' <tool call ping #x]: {}' }))
  const raw = readFileSync(path, 'utf8')
  assert.equal(raw.includes(secret), false, 'the prompt body must not be copied')
  const delta = raw.trim().split('\n').map((line) => JSON.parse(line)).find((line) => line.kind === 'delta')
  assert.equal(delta.marker, true)
  assert.ok(delta.excerpt.length <= MARKER_EXCERPT, 'excerpt is bounded')
})

test('summarizeRequest counts without keeping content', () => {
  const summary = summarizeRequest({
    model: 'm',
    messages: [{ role: 'system', content: 'a'.repeat(10) }, { role: 'user', content: 'b'.repeat(5) }],
    tools: [{}, {}],
    stream: true,
    max_tokens: 256,
    tool_choice: 'auto',
  })
  assert.deepEqual(summary, { model: 'm', messages: 2, chars: 15, tools: 2, hasSystem: true, stream: true, maxTokens: 256, toolChoice: 'auto', effort: null })
})

test('marker families are recognised', () => {
  for (const text of ['<tool call run_code #x]: {}', '<｜DSML｜ parameter>', '<｜thought>', '</thought>', '<parameter name="code">', '<invoke name="bash">', '[tool call bash #x]: {}']) {
    assert.equal(hasMarker(text), true, text)
  }
  assert.equal(hasMarker('plain prose about tools and parameters'), false)
})
