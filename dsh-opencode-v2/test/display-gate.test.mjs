import assert from 'node:assert/strict'
import test from 'node:test'
import { createReasoningGate, createTextGate } from '../lib/display-clean.js'

test('reasoning gate removes a token split across deltas', () => {
  const g = createReasoningGate()
  let out = ''
  for (const chunk of ['abc <thi', 'nking> deep', ' </thin', 'king> tail']) out += g.push(chunk).emit
  out += g.finish().emit
  assert.equal(out, 'abc  deep  tail')
})

test('reasoning gate holds at most 11 chars for plain text', () => {
  const g = createReasoningGate()
  const first = g.push('plain prose here')
  assert.equal(first.emit, 'plain prose here')
  assert.equal(g.finish().emit, '')
})

test('text gate streams prose with no delay beyond the line probe', () => {
  const g = createTextGate()
  const a = g.push('hello world')
  assert.equal(a.emit, 'hello world')
  const b = g.push(' more\nnext line')
  assert.equal(b.emit, ' more\nnext line')
  assert.equal(g.finish([]).emit, '')
})

test('text gate holds a line that starts with the echo prefix and drops a matching echo', () => {
  const calls = [{ id: 'r1', name: 'run_code', arguments: '{"code":"x"}' }]
  const g = createTextGate()
  let out = ''
  out += g.push('prose line\n[tool call run_code #echo]: {"code":').emit
  out += g.push('"x"}').emit
  const fin = g.finish(calls)
  out += fin.emit
  assert.equal(fin.dropped, true)
  assert.equal(out, 'prose line\n')
})

test('text gate releases a held line that turns out not to be an echo', () => {
  const g = createTextGate()
  const held = g.push('[tool call run_code #x]: not json at all')
  assert.equal(held.emit, '')
  const fin = g.finish([])
  assert.equal(fin.dropped, false)
  assert.equal(fin.emit, '[tool call run_code #x]: not json at all')
})
