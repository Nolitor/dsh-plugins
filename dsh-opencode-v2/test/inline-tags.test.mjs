/**
 * Router for transcript-style tags that leak into `delta.content`.
 *
 * Every case here comes from a measured session record (2026-10-31): literal
 * `<thinking>` blocks, `[tool call …]: {…}` lines, and `<invoke …>` /
 * `antml:invoke` blocks that the adapter used to store as plain assistant text.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createInlineTagRouter, hasInlineTags, sanitizeProtocolText } from '../lib/inline-tags.js'

const tools = new Set(['bash', 'read'])

test('plain text is forwarded unchanged', () => {
  const router = createInlineTagRouter({ toolNames: tools })
  assert.deepEqual(router.push('Hello HTTP'), [{ kind: 'text', text: 'Hello HTTP' }])
  assert.deepEqual(router.flush(), [])
  assert.equal(router.stats.stripped, 0)
})

test('hasInlineTags matches the three measured forms only', () => {
  assert.equal(hasInlineTags('<thinking>x'), true)
  assert.equal(hasInlineTags('[tool call bash #call_1]: {}'), true)
  assert.equal(hasInlineTags('<invoke name="bash">'), true)
  assert.equal(hasInlineTags('<antml:invoke name="bash">'), true)
  assert.equal(hasInlineTags('plain [tool] text'), false)
  assert.equal(hasInlineTags(''), false)
})

test('a complete thinking block becomes reasoning, the rest stays text', () => {
  const router = createInlineTagRouter({ toolNames: tools })
  const parts = router.push('<thinking>plan</thinking>answer')
  assert.deepEqual(parts, [
    { kind: 'reasoning', text: 'plan' },
    { kind: 'text', text: 'answer' },
  ])
  assert.equal(router.stats.thinking, 1)
})

test('a tag split across deltas is held until it completes', () => {
  const router = createInlineTagRouter({ toolNames: tools })
  assert.deepEqual(router.push('a<thin'), [{ kind: 'text', text: 'a' }])
  assert.deepEqual(router.push('king>plan'), [])
  assert.deepEqual(router.push(' more</thin'), [])
  assert.deepEqual(router.push('king>b'), [
    { kind: 'reasoning', text: 'plan more' },
    { kind: 'text', text: 'b' },
  ])
})

test('an unterminated thinking block is preserved as reasoning, never as a literal tag', () => {
  const router = createInlineTagRouter({ toolNames: tools })
  router.push('<thinking>only thinking')
  const flushed = router.flush()
  assert.deepEqual(flushed, [{ kind: 'reasoning', text: 'only thinking' }])
  assert.equal(router.stats.unterminatedThinking, 1)
  assert.ok(!JSON.stringify(flushed).includes('<thinking>'))
})

test('a literal bracket call becomes a tool call for a declared tool', () => {
  const router = createInlineTagRouter({ toolNames: tools })
  const parts = router.push('[tool call bash #call_9]: {"command":"ls"}')
  assert.deepEqual(parts, [{ kind: 'tool-call', id: 'call_9', name: 'bash', arguments: '{"command":"ls"}' }])
  assert.equal(router.stats.calls, 1)
})

test('a literal call split mid-JSON is held, then resolved', () => {
  const router = createInlineTagRouter({ toolNames: tools })
  assert.deepEqual(router.push('[tool call bash #call_9]: {"comm'), [])
  assert.deepEqual(router.push('and":"ls -la"}'), [
    { kind: 'tool-call', id: 'call_9', name: 'bash', arguments: '{"command":"ls -la"}' },
  ])
})

test('an undeclared tool name is never executed and never shown as notation', () => {
  const router = createInlineTagRouter({ toolNames: tools })
  const parts = [...router.push('[tool call rm #call_1]: {"path":"/"}'), ...router.flush()]
  assert.equal(parts.filter((part) => part.kind === 'tool-call').length, 0)
  const text = parts.map((part) => part.text ?? '').join('')
  assert.ok(!text.includes('[tool call '), `notation survived: ${JSON.stringify(text)}`)
  assert.equal(text.trim(), '')
})

test('invoke and antml:invoke blocks become tool calls with named arguments', () => {
  const plain = createInlineTagRouter({ toolNames: tools })
  assert.deepEqual(plain.push('<invoke name="bash"><parameter name="command">ls</parameter></invoke>'), [
    { kind: 'tool-call', id: '', name: 'bash', arguments: '{"command":"ls"}' },
  ])

  const antml = createInlineTagRouter({ toolNames: tools })
  assert.deepEqual(
    antml.push('<antml:invoke name="bash"><antml:parameter name="command">pwd</antml:parameter></antml:invoke>'),
    [{ kind: 'tool-call', id: '', name: 'bash', arguments: '{"command":"pwd"}' }],
  )
})

test('a literal call that never completes is released as text at the hold limit', () => {
  const router = createInlineTagRouter({ toolNames: tools, maxHold: 32 })
  const parts = router.push(`[tool call bash #call_1]: {"command":"${'x'.repeat(40)}`)
  assert.equal(parts[0].kind, 'text')
  assert.equal(router.stats.calls, 0)
})

test('empty deltas and flush idempotence keep the router safe', () => {
  const router = createInlineTagRouter({ toolNames: tools })
  assert.deepEqual(router.push(''), [])
  assert.deepEqual(router.push(undefined), [])
  assert.deepEqual(router.push('done'), [{ kind: 'text', text: 'done' }])
  assert.deepEqual(router.flush(), [])
  assert.deepEqual(router.flush(), [])
})

// --- the shapes that were still visible on screen (measured 2026-10-31 23:17) ---

const NO_MARKERS = /\[tool call |<\/?(?:antml:)?thinking>/

test('a stray closing tag is removed, the prose survives', () => {
  const router = createInlineTagRouter({ toolNames: tools })
  const out = [...router.push('결론입니다.</thinking>계속 진행합니다.'), ...router.flush()]
  assert.deepEqual(out, [{ kind: 'text', text: '결론입니다.계속 진행합니다.' }])
  assert.ok(!NO_MARKERS.test(out.map((part) => part.text ?? '').join('')))
})

test('a marker with no JSON payload is stripped and the prose is kept', () => {
  const router = createInlineTagRouter({ toolNames: tools })
  const out = [...router.push('[tool call chatcmpl-0]: measure the adapter </thinking>'), ...router.flush()]
  const text = out.map((part) => part.text ?? '').join('')
  assert.equal(text.trim(), 'measure the adapter')
  assert.ok(!NO_MARKERS.test(text))
})

test('a marker with broken JSON never leaves notation behind', () => {
  const router = createInlineTagRouter({ toolNames: tools })
  const out = [...router.push('[tool call bash #call_1]: {"command":"ls "unterminated'), ...router.flush()]
  const text = out.map((part) => part.text ?? '').join('')
  assert.ok(!text.includes('[tool call '))
  assert.ok(!NO_MARKERS.test(text))
})

test('a marker in the middle of a sentence is fixed in place', () => {
  const router = createInlineTagRouter({ toolNames: tools })
  const out = [...router.push('앞 [tool call bash #call_9]: {"command":"ls"} 뒤'), ...router.flush()]
  assert.equal(out.filter((part) => part.kind === 'tool-call').length, 1)
  const text = out.map((part) => part.text ?? '').join('')
  assert.ok(!NO_MARKERS.test(text))
})

test('the exact leaked session block yields only tool calls and whitespace', () => {
  // Copied verbatim from the stored assistant text of the interrupted session.
  const blob = '\n\n[tool call bash #call_1]: {"command":"grep -c \\"llm-retry\\" x.yml"}'
    + '\n[tool call bash #call_2]: {"command":"cd /x && echo \\"=== y ===\\""}'
    + '\n[tool call bash #call_3]: {"command":"grep -c \\"z\\" x.yml"}'
    + '\n</thinking>\n[tool call bash #call_4]: {"command":"echo done"}'
  const router = createInlineTagRouter({ toolNames: tools })
  const out = [...router.push(blob), ...router.flush()]
  assert.equal(out.filter((part) => part.kind === 'tool-call').length, 4)
  const text = out.filter((part) => part.kind === 'text').map((part) => part.text).join('')
  assert.ok(!NO_MARKERS.test(text), `notation survived: ${JSON.stringify(text)}`)
  assert.equal(text.trim(), '')
})

test('sanitizeProtocolText is idempotent and leaves clean prose alone', () => {
  assert.equal(sanitizeProtocolText('정상 문장'), '정상 문장')
  const once = sanitizeProtocolText('a </thinking> b [tool call bash #c]: {"x":1} c')
  assert.equal(sanitizeProtocolText(once), once)
  assert.ok(!NO_MARKERS.test(once))
})

// --- split-marker hold (the live 0.7.5 leak, 2026-10-31) ---
// A marker is almost never delivered in one SSE chunk. v0.7.5 released the
// partial marker as text and the notation reached the screen; these cases pin
// the hold that fixes it.

test('a call marker split before its closing bracket is held, never released as text', () => {
  const router = createInlineTagRouter({ toolNames: tools })
  const out = [
    ...router.push('[tool call bash #'),
    ...router.push('c1'),
    ...router.push(']: {"command":"ls"}'),
    ...router.flush(),
  ]
  assert.deepEqual(out.filter((part) => part.kind === 'tool-call'), [
    { kind: 'tool-call', id: 'c1', name: 'bash', arguments: '{"command":"ls"}' },
  ])
  const text = out.filter((part) => part.kind === 'text').map((part) => part.text).join('')
  assert.equal(text, '')
  assert.equal(router.stats.calls, 1)
})

test('a call marker split right after the tool name is held too', () => {
  const router = createInlineTagRouter({ toolNames: tools })
  const out = [
    ...router.push('[tool call bash'),
    ...router.push(' #c1]: {"command":"ls"}'),
    ...router.flush(),
  ]
  assert.equal(out.filter((part) => part.kind === 'tool-call').length, 1)
  assert.equal(out.filter((part) => part.kind === 'text').map((part) => part.text).join(''), '')
})

test('the recorded live delta split yields one tool call and no notation', () => {
  // Boundaries copied from the stored stream of session e9c75e9a (2026-10-31).
  const deltas = [
    'Now I will look.\n\n',
    '[tool call bash #',
    'chatcmpl-t',
    'ool-f82',
    'dc4b5b1582ac5',
    ']: {"command":"ls -la"}',
  ]
  const router = createInlineTagRouter({ toolNames: tools })
  const out = []
  for (const delta of deltas) out.push(...router.push(delta))
  out.push(...router.flush())
  assert.equal(out.filter((part) => part.kind === 'tool-call').length, 1)
  const text = out.filter((part) => part.kind === 'text').map((part) => part.text).join('')
  assert.equal(text, 'Now I will look.\n\n')
  assert.ok(!NO_MARKERS.test(text))
})

test('an <invoke> tag without name= is stripped and the prose kept', () => {
  const router = createInlineTagRouter({ toolNames: tools })
  const out = [...router.push('A <invoke>raw</invoke> B'), ...router.flush()]
  const text = out.filter((part) => part.kind === 'text').map((part) => part.text).join('')
  assert.ok(!/<(?:antml:)?(?:invoke|parameter)/i.test(text), `notation survived: ${JSON.stringify(text)}`)
})

test('a bracket call past maxHold does not leak its argument payload', () => {
  const router = createInlineTagRouter({ toolNames: tools, maxHold: 32 })
  const out = [...router.push('[tool call bash #c1]: {"command":"' + 'y'.repeat(80)), ...router.flush()]
  const text = out.filter((part) => part.kind === 'text').map((part) => part.text).join('')
  assert.ok(!NO_MARKERS.test(text), `notation survived: ${JSON.stringify(text.slice(0, 120))}`)
})
