import { readFileSync } from 'node:fs'
const svc = JSON.parse(readFileSync(process.env.HOME + '/.local/state/opencode/service.json', 'utf8'))
const auth = 'Basic ' + Buffer.from('opencode:' + svc.password).toString('base64')
const cred = await (await fetch(svc.url + '/api/credential', { headers: { authorization: auth } })).json()
const token = (cred.data ?? []).find((e) => e.active && e.value?.type === 'oauth')?.value?.access

// A long, identical prefix twice: the second request should reuse the prefix cache,
// which is the only way to learn whether opencode.tokens.input already excludes it.
const filler = 'The quick brown fox jumps over the lazy dog. '.repeat(600)
const ask = async (tag) => {
  const res = await fetch('https://opencode.ai/inference/go/openai/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'x-opencode-session': 'cache-probe', 'x-opencode-org-id': 'org_01M4C03H8AYRTHKPE247B8803V' },
    body: JSON.stringify({ model: 'deepseek-v4.1-flash', messages: [{ role: 'system', content: filler }, { role: 'user', content: tag }], max_tokens: 4, stream: true, stream_options: { include_usage: true } }),
  })
  const text = await res.text()
  for (const ev of text.split('\n\n')) {
    const line = ev.split('\n').find((l) => l.startsWith('data:'))
    if (!line) continue
    const p = line.slice(5).trim()
    if (p === '[DONE]') continue
    let j; try { j = JSON.parse(p) } catch { continue }
    if (j.usage) return j.usage
  }
  return null
}
const first = await ask('first call')
const second = await ask('second call, same prefix')
for (const [name, u] of [['first', first], ['second', second]]) {
  console.log(name, JSON.stringify({
    prompt_tokens: u.prompt_tokens,
    cached_tokens: u.prompt_tokens_details?.cached_tokens,
    completion: u.completion_tokens,
    reasoning: u.completion_tokens_details?.reasoning_tokens,
    cost: u.cost,
    billing: u.opencode?.billing_source,
    allowance: u.opencode?.allowance,
    list_cost: u.opencode?.list_cost,
    tokens: u.opencode?.tokens,
  }))
}
