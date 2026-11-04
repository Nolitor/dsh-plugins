import { readFileSync } from 'node:fs'
const svc = JSON.parse(readFileSync(process.env.HOME + '/.local/state/opencode/service.json', 'utf8'))
const auth = 'Basic ' + Buffer.from('opencode:' + svc.password).toString('base64')
const cred = await (await fetch(svc.url + '/api/credential', { headers: { authorization: auth } })).json()
const token = (cred.data ?? []).find((e) => e.active && e.value?.type === 'oauth')?.value?.access

const res = await fetch('https://opencode.ai/inference/go/openai/v1/chat/completions', {
  method: 'POST',
  headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'x-opencode-session': 'cost-probe', 'x-opencode-org-id': 'org_01M4C03H8AYRTHKPE247B8803V' },
  // exactly how the adapter asks: streaming + final usage chunk
  body: JSON.stringify({ model: 'deepseek-v4.1-flash', messages: [{ role: 'user', content: 'say hi' }], max_tokens: 8, stream: true, stream_options: { include_usage: true } }),
})
const text = await res.text()
const events = text.split('\n\n').filter(Boolean)
console.log('status', res.status, 'events', events.length)
for (const [i, ev] of events.entries()) {
  const line = ev.split('\n').find((l) => l.startsWith('data:')) ?? ev
  const payload = line.slice(5).trim()
  if (payload === '[DONE]') { console.log(i, '[DONE]'); continue }
  let j; try { j = JSON.parse(payload) } catch { continue }
  // print only events that carry usage
  if (j.usage) console.log('USAGE EVENT', i, JSON.stringify(j.usage, null, 1))
  else if (i < 2) console.log(i, JSON.stringify(j).slice(0, 200))
}
