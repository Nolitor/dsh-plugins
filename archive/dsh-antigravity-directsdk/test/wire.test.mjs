import assert from 'node:assert/strict'
import { test } from 'node:test'

import { requestBody, sanitizeSchema, thinkingLevel, toContents, toTools } from '../lib/wire.js'

test('system message is hoisted into systemInstruction', () => {
  const { contents, systemInstruction } = toContents(
    [
      { role: 'system', content: 'You are terse.' },
      { role: 'user', content: 'hi' },
    ],
    undefined,
  )
  assert.equal(contents.length, 1)
  assert.equal(contents[0].role, 'user')
  assert.equal(systemInstruction.parts[0].text, 'You are terse.')
})

test('explicit system is prepended to hoisted system', () => {
  const { systemInstruction } = toContents([{ role: 'user', content: 'hi' }], 'one-shot rules')
  assert.match(systemInstruction.parts[0].text, /one-shot rules/)
})

test('assistant role maps to model', () => {
  const { contents } = toContents([
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'b' },
    { role: 'user', content: 'c' },
  ])
  assert.deepEqual(contents.map((c) => c.role), ['user', 'model', 'user'])
})

test('reasoning blocks are not echoed back', () => {
  const { contents } = toContents([
    { role: 'assistant', content: [{ type: 'reasoning', text: 'secret' }, { type: 'text', text: 'visible' }] },
  ])
  assert.equal(JSON.stringify(contents).includes('secret'), false)
  assert.equal(JSON.stringify(contents).includes('visible'), true)
})

test('tool-call and tool-result become functionCall/functionResponse', () => {
  const { contents } = toContents([
    { role: 'assistant', content: [{ type: 'tool-call', id: 'c1', name: 'get_weather', arguments: '{"city":"Seoul"}' }] },
    { role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', name: 'get_weather', content: 'sunny' }] },
  ])
  assert.deepEqual(contents[0].parts[0].functionCall.args, { city: 'Seoul' })
  assert.equal(contents[1].parts[0].functionResponse.response.output, 'sunny')
})

test('tools map to functionDeclarations', () => {
  const tools = toTools([{ name: 'f', description: 'd', parameters: { type: 'object', properties: { a: { type: 'string' } } } }])
  assert.equal(tools[0].functionDeclarations[0].name, 'f')
  assert.equal(tools[0].functionDeclarations[0].parameters.type, 'object')
})

test('sanitizeSchema drops additionalProperties', () => {
  const out = sanitizeSchema({ type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } })
  assert.equal('additionalProperties' in out, false)
  assert.equal(out.properties.a.type, 'string')
})

test('thinkingLevel maps high family to HIGH', () => {
  assert.equal(thinkingLevel('high'), 'HIGH')
  assert.equal(thinkingLevel('max'), 'HIGH')
  assert.equal(thinkingLevel('low'), 'LOW')
  assert.equal(thinkingLevel(undefined), 'LOW')
})

test('requestBody carries the required top-level model', () => {
  const body = requestBody(
    { provider: 'antigravity', model: 'gemini-3.8-flash-low', messages: [{ role: 'user', content: 'hi' }] },
    { model: 'gemini-3.8-flash-low', project: 'aicode-consumers', sessionId: 's1' },
  )
  assert.equal(body.model, 'gemini-3.8-flash-low')
  assert.equal(body.project, 'aicode-consumers')
  assert.equal(body.request.sessionId, 's1')
  assert.equal(body.request.generationConfig.thinkingConfig.includeThoughts, true)
})

test('requestBody rejects an empty conversation', () => {
  assert.throws(() => requestBody({ messages: [] }, { model: 'm', project: 'p' }), /no content/)
})
