import assert from 'node:assert/strict'
import test from 'node:test'
import { stripThinkingTags, parseToolCallEcho, dropEchoTail, cleanParts } from '../lib/display-clean.js'

test('thinking tokens are removed wherever they sit, rest preserved', () => {
  const src = 'opener text <thinking> inner </thinking> closer text'
  const r = stripThinkingTags(src)
  assert.equal(r.removed, 2)
  assert.equal(r.text, 'opener text  inner  closer text')
})

test('reasoning without tokens is untouched', () => {
  const src = 'plain reasoning, no tags'
  const r = stripThinkingTags(src)
  assert.equal(r.removed, 0)
  assert.equal(r.text, src)
})

test('pure tool-call echo parses', () => {
  const e = parseToolCallEcho('[tool call run_code #call_abc]: {"code":"1"}')
  assert.equal(e.name, 'run_code')
  assert.equal(e.id, 'call_abc')
  assert.deepEqual(e.value, { code: '1' })
})

test('prose mentioning a tool call is not an echo', () => {
  assert.equal(parseToolCallEcho('I will use [tool call run_code] next'), null)
})

test('echo tail after one prose line is dropped, prose kept byte-identical', () => {
  const calls = [{ kind: 'tool-call', id: 'real', name: 'run_code', arguments: '{"code":"x"}' }]
  const text = '작업을 시작합니다.\n[tool call run_code #echo]: {"code":"x"}'
  const r = dropEchoTail(text, calls)
  assert.equal(r.dropped > 0, true)
  assert.equal(r.text, '작업을 시작합니다.')
})

test('whole-part echo is dropped entirely', () => {
  const calls = [{ kind: 'tool-call', id: 'real', name: 'read', arguments: '{"p":1}' }]
  const r = cleanParts([{ kind: 'text', text: '[tool call read #e]: {"p":1}' }, calls[0]])
  assert.equal(r.dropped, 1)
  assert.deepEqual(r.parts.map((p) => p.kind), ['tool-call'])
})

test('echo is kept when no structured call backs it', () => {
  const r = cleanParts([{ kind: 'text', text: '[tool call read #e]: {"p":1}' }, { kind: 'tool-call', id: 'z', name: 'read', arguments: '{"p":2}' }])
  assert.equal(r.dropped, 0)
  assert.equal(r.parts.length, 2)
})

test('non-echo text is byte-identical and order is preserved', () => {
  const text = 'plain prose, no notation'
  const r = cleanParts([
    { kind: 'reasoning', text: '<thinking>think</thinking>' },
    { kind: 'text', text },
  ])
  assert.deepEqual(r.parts.map((p) => p.kind), ['reasoning', 'text'])
  assert.equal(r.parts[1].text, text)
  assert.equal(r.parts[0].text, 'think')
})
