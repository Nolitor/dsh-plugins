import assert from 'node:assert/strict'
import { test } from 'node:test'

import { effortMatchesModel, inlineImage, modelForEffort, requestBody, sanitizeSchema, toContents, toTools } from '../lib/wire.js'

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

test('a real DSH tool message becomes a paired functionResponse', () => {
  // Regression 2026-11-14: the harness sends role:'tool' with the id on the
  // MESSAGE, not a synthetic tool-result block. Claude on this host rejected the
  // history as tool_use without tool_result; Gemini happened to tolerate it.
  const { contents } = toContents([
    { role: 'assistant', content: [{ type: 'tool-call', id: 'toolu_1', name: 'get_weather', arguments: '{"city":"Seoul"}' }] },
    { role: 'tool', toolCallId: 'toolu_1', content: [{ type: 'text', text: 'sunny' }] },
  ])
  assert.deepEqual(contents[1], {
    role: 'user',
    parts: [{
      functionResponse: {
        name: 'get_weather',
        response: { output: 'sunny' },
        id: 'toolu_1',
      },
    }],
  })
})

/** Every path at which `key` occurs anywhere under `value`. */
function pathsOfKey(value, key, path = '$') {
  if (value === null || typeof value !== 'object') return []
  const found = []
  for (const [k, v] of Object.entries(value)) {
    const here = Array.isArray(value) ? `${path}[${k}]` : `${path}.${k}`
    if (k === key) found.push(here)
    found.push(...pathsOfKey(v, key, here))
  }
  return found
}

test('a tool-call thoughtSignature is replayed as a part-level sibling of functionCall', () => {
  // Measured 2026-11-14 (gemini-4-hydrogen-low, isolated home): the inbound part
  // is `{ thoughtSignature, functionCall: { name, args, id } }`, so the replay
  // mirrors it. The old nested shape was rejected with HTTP 400.
  const { contents } = toContents([
    { role: 'assistant', content: [{ type: 'tool-call', id: 'c1', name: 'get_weather', arguments: '{"city":"Seoul"}', thoughtSignature: 'sig' }] },
  ])
  assert.deepEqual(contents[0].parts[0], {
    functionCall: { name: 'get_weather', args: { city: 'Seoul' }, id: 'c1' },
    thoughtSignature: 'sig',
  })
})

test('regression: thoughtSignature never appears inside a functionCall', () => {
  // Live 400 2026-11-14: `Unknown name "thoughtSignature" at
  // 'request.contents[5].parts[0].function_call': Cannot find field.`
  const body = requestBody({
    messages: [
      { role: 'user', content: 'weather in Seoul and Busan?' },
      { role: 'assistant', content: [
        { type: 'text', text: 'checking' },
        { type: 'tool-call', id: 'c1', name: 'get_weather', arguments: '{"city":"Seoul"}', thoughtSignature: 'sig-1' },
        { type: 'tool-call', id: 'c2', name: 'get_weather', arguments: { city: 'Busan' }, thoughtSignature: 'sig-2' },
      ] },
      { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'sunny' }] },
      { role: 'tool', toolCallId: 'c2', content: [{ type: 'text', text: 'rain' }] },
    ],
  }, { model: 'gemini-4-hydrogen-low', project: 'p' })
  const calls = body.request.contents.flatMap((content) => content.parts).filter((part) => part.functionCall)
  assert.equal(calls.length, 2)
  for (const part of calls) {
    assert.ok(!('thoughtSignature' in part.functionCall), 'thoughtSignature must not be a functionCall field')
    assert.equal(typeof part.thoughtSignature, 'string')
  }
  assert.deepEqual(calls.map((part) => part.thoughtSignature), ['sig-1', 'sig-2'])
  // Deep search: the key may only occur directly on a part, never deeper.
  const paths = pathsOfKey(body, 'thoughtSignature')
  assert.equal(paths.length, 2)
  for (const path of paths) {
    assert.match(path, /^\$\.request\.contents\[\d+\]\.parts\[\d+\]\.thoughtSignature$/)
    assert.doesNotMatch(path, /functionCall/)
  }
})

test('a tool-call without a signature carries no thoughtSignature key at all', () => {
  const { contents } = toContents([
    { role: 'assistant', content: [{ type: 'tool-call', id: 'c1', name: 'f', arguments: '{}' }] },
  ])
  assert.deepEqual(pathsOfKey(contents, 'thoughtSignature'), [])
})

test('two tool results merge into one user turn', () => {
  // Anthropic requires every tool_result for one assistant turn in the SAME
  // user message; Gemini also expects the responses grouped. The old loop made
  // one user content per result, which is rejected by the Anthropic lane.
  const { contents } = toContents([
    { role: 'assistant', content: [
      { type: 'tool-call', id: 'c1', name: 'a', arguments: '{}' },
      { type: 'tool-call', id: 'c2', name: 'b', arguments: '{}' },
    ] },
    { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'one' }] },
    { role: 'tool', toolCallId: 'c2', content: [{ type: 'text', text: 'two' }] },
  ])
  const userTurns = contents.filter((content) => content.role === 'user')
  assert.equal(userTurns.length, 1)
  assert.deepEqual(userTurns[0].parts.map((part) => part.functionResponse.name), ['a', 'b'])
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

/**
 * Effort is the MODEL ID SUFFIX, not a generationConfig field.
 *
 * Measured 2026-11-05: flash-low with thinkingLevel=HIGH and flash-high with
 * thinkingLevel=LOW produced identical output, while flash-high with no
 * thinkingConfig at all produced 1620 thinking chars. The server ignores
 * thinkingLevel, so an adapter that maps effort onto it changes nothing.
 */
test('effortMatchesModel reads the id suffix', () => {
  assert.equal(effortMatchesModel('gemini-3.8-flash-low', 'low'), true)
  assert.equal(effortMatchesModel('gemini-3.8-flash-high', 'low'), false)
  assert.equal(effortMatchesModel('gemini-3.8-flash-high', 'high'), true)
  // A model with no suffix has one fixed level, so any effort is honoured.
  assert.equal(effortMatchesModel('gemini-2.5-pro', 'high'), true)
})

test('modelForEffort selects the suffixed id when the catalog serves it', () => {
  const available = ['gemini-3.8-flash-low', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-high']
  assert.equal(modelForEffort('gemini-3.8-flash-low', 'high', available), 'gemini-3.8-flash-high')
  // Catalog order is high, medium, low; "no effort" must still mean LOW.
  assert.equal(
    modelForEffort('gemini-3.8-flash', undefined, ['gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low']),
    'gemini-3.8-flash-low',
    'the default effort is the lowest served level, not the first catalog row',
  )
  assert.equal(modelForEffort('gemini-3.8-flash-low', 'medium', available), 'gemini-3.8-flash-medium')
  // xhigh and max collapse onto high: the API exposes no finer level.
  assert.equal(modelForEffort('gemini-3.8-flash-low', 'max', available), 'gemini-3.8-flash-high')
  // No matching variant: keep what the caller asked for.
  assert.equal(modelForEffort('gemini-2.5-pro', 'high', ['gemini-2.5-pro']), 'gemini-2.5-pro')
})

test('modelForEffort maps Gemini 3.5 Lite efforts onto the three alias ids', () => {
  const available = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash-thinking']
  assert.equal(modelForEffort('gemini-3.5-flash-lite', 'low', available), 'gemini-2.5-flash-lite')
  assert.equal(modelForEffort('gemini-3.5-flash-lite', 'medium', available), 'gemini-2.5-flash')
  assert.equal(modelForEffort('gemini-3.5-flash-lite', 'high', available), 'gemini-2.5-flash-thinking')
  assert.equal(modelForEffort('gemini-3.5-flash-lite', undefined, available), 'gemini-2.5-flash-lite')
  assert.equal(modelForEffort('gemini-2.5-flash', undefined, available), 'gemini-2.5-flash')
  assert.equal(modelForEffort('gemini-2.5-flash', 'high', available), 'gemini-2.5-flash-thinking')
})

test('requestBody does not send a misleading thinkingLevel', () => {
  const body = requestBody(
    { model: 'gemini-3.8-flash-low', reasoningEffort: 'high', messages: [{ role: 'user', content: 'hi' }] },
    { model: 'gemini-3.8-flash-high', project: 'p' },
  )
  assert.equal('thinkingLevel' in body.request.generationConfig.thinkingConfig, false,
    'the server ignores thinkingLevel; sending it implies control that does not exist')
  assert.equal(body.request.generationConfig.thinkingConfig.includeThoughts, true)
})

test('image blocks become inlineData', () => {
  assert.deepEqual(inlineImage({ type: 'image', data: 'AAA', mimeType: 'image/png' }), { mimeType: 'image/png', data: 'AAA' })
  assert.deepEqual(inlineImage({ type: 'image', source: { data: 'BBB', mediaType: 'image/webp' } }), { mimeType: 'image/webp', data: 'BBB' })
  assert.deepEqual(inlineImage({ type: 'image', url: 'data:image/jpeg;base64,CCC' }), { mimeType: 'image/jpeg', data: 'CCC' })
  assert.equal(inlineImage({ type: 'image', url: 'https://example.com/a.png' }), undefined)
})

test('an image block reaches contents as inlineData', () => {
  const { contents } = toContents([{ role: 'user', content: [{ type: 'text', text: 'what is this' }, { type: 'image', data: 'ZZZ', mimeType: 'image/png' }] }])
  const parts = contents[0].parts
  assert.equal(parts.some((p) => p.inlineData?.data === 'ZZZ'), true)
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
