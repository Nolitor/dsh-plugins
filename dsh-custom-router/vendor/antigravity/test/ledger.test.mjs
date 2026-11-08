import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AntigravityAdapter } from '../lib/adapter.js'
import { createLedger } from '../lib/server.js'

/** SSE body with one text part and one usage block. */
const body = [
  'data: ' + JSON.stringify({
    response: {
      candidates: [{ content: { parts: [{ text: 'hello' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3, thoughtsTokenCount: 5, cachedContentTokenCount: 2 },
    },
  }) + '\n\n',
  'data: [DONE]\n\n',
].join('')

test('the adapter records measured usage into the shared ledger', async () => {
  const ledger = createLedger()
  const adapter = new AntigravityAdapter({
    settings: () => ({}),
    tokens: { get: async () => 'token', invalidate() {} },
    ledger,
    catalog: async () => ({
      list: async () => [{ id: 'gemini-3.8-flash-low' }],
      find: async (id) => ({ id }),
    }),
    fetch: async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    log: { warn() {}, debug() {} },
  })

  const chunks = []
  for await (const chunk of adapter.stream({
    messages: [{ role: 'user', content: 'hi' }],
    model: 'gemini-3.8-flash-low',
  })) chunks.push(chunk)

  assert.ok(chunks.some((chunk) => chunk.type === 'usage'), 'usage chunk is emitted')
  assert.equal(chunks.at(-1).type, 'finish')
  assert.deepEqual(ledger.summary(), {
    requests: 1,
    inputTokens: 10,
    outputTokens: 3,
    reasoningTokens: 5,
    cacheReadTokens: 2,
  })
})
