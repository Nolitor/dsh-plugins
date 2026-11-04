import { readFileSync } from 'node:fs'
const svc = JSON.parse(readFileSync(process.env.HOME + '/.local/state/opencode/service.json', 'utf8'))
const auth = 'Basic ' + Buffer.from('opencode:' + svc.password).toString('base64')
const cred = await (await fetch(svc.url + '/api/credential', { headers: { authorization: auth } })).json()
const oauth = (cred.data ?? []).find((e) => e.active && e.value?.type === 'oauth')
const token = oauth?.value?.access

const ENDPOINTS = {
  go: 'https://opencode.ai/inference/go/openai/v1',
  zen: 'https://opencode.ai/inference/openai/v1',
}
const MODELS = {
  'go-owned': 'deepseek-v4.1-flash',
  'zen-only': 'pulse-alpha-free',
}
for (const [plan, base] of Object.entries(ENDPOINTS)) {
  for (const [kind, model] of Object.entries(MODELS)) {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'x-opencode-session': 'plan-probe', 'x-opencode-org-id': 'org_01M4C03H8AYRTHKPE247B8803V' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1, stream: false }),
    })
    const text = await res.text()
    let summary = ''
    try {
      const j = JSON.parse(text)
      summary = j.error ? 'ERR ' + JSON.stringify(j.error).slice(0, 110) : 'OK billing=' + (j.usage?.opencode?.billing_source ?? '?')
    } catch { summary = text.slice(0, 110) }
    console.log((plan + ' endpoint').padEnd(14), (kind + '=' + model).padEnd(30), res.status, summary)
  }
}
