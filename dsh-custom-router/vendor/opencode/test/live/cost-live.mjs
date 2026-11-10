/**
 * Live: one real generation through the cost parser, using the exact payload the
 * backend streams. Proves parseCost + the ledger agree with the wire, no fixtures.
 */
import { readFileSync } from 'node:fs'
import { parseCost, createCostLedger, describeCost } from '../../lib/cost.js'

const svc = JSON.parse(readFileSync(process.env.HOME + '/.local/state/opencode/service.json', 'utf8'))
const auth = 'Basic ' + Buffer.from('opencode:' + svc.password).toString('base64')
const cred = await (await fetch(svc.url + '/api/credential', { headers: { authorization: auth } })).json()
const token = (cred.data ?? []).find((e) => e.active && e.value?.type === 'oauth')?.value?.access

const ledger = createCostLedger()
const routes = [
  ['opencode-go', 'deepseek-v4.1-flash', 'session-live-go'],
  ['opencode-go', 'minimax-m3.1-flash', 'session-live-go2'],
]
for (const [provider, model, sessionId] of routes) {
  const res = await fetch('https://opencode.ai/inference/go/openai/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'x-opencode-session': sessionId, 'x-opencode-org-id': 'org_01M4C03H8AYRTHKPE247B8803V' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'say ok' }], max_tokens: 4, stream: true, stream_options: { include_usage: true } }),
  })
  const text = await res.text()
  let usage = null
  for (const ev of text.split('\n\n')) {
    const line = ev.split('\n').find((l) => l.startsWith('data:'))
    if (!line) continue
    const payload = line.slice(5).trim()
    if (payload === '[DONE]') continue
    try { const j = JSON.parse(payload); if (j.usage) usage = j.usage } catch { /* partial */ }
  }
  if (!usage) { console.log(provider + '/' + model, 'NO USAGE CHUNK'); continue }
  const cost = parseCost(usage)
  ledger.record(sessionId, provider + '/' + model, cost)
  console.log(provider + '/' + model, '->', describeCost(cost))
}
const s = ledger.summary()
console.log('\nsummary:', JSON.stringify({ sessions: s.sessions, requests: s.requests, costUsd: s.costUsd, listCostUsd: s.listCostUsd, allowanceUsd: s.allowanceUsd }, null, 1))
for (const row of s.bySession) console.log(' ', row.sessionId, 'req', row.requests, 'allowance', row.allowanceUsd)
