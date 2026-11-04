#!/usr/bin/env node
/**
 * TRACK C — cost attribution and counterfactual for the TokenEconomizer 3-day window.
 *
 * Adapted from scripts/measure-token-saving.mjs (copied into this dir as
 * measure-baseline-copy.mjs, unmodified). Changes made here:
 *   1. every usage sample is filtered to START_MS..END_MS;
 *   2. the plugin's rewrites are classified with the strict event-pairing rule and
 *      measured as chars removed (Track-A style), so the cost model has a real
 *      context-delta to price instead of a text grep;
 *   3. prices come from ~/.dsh/deepinfra-session-cost.json, fitted by least squares
 *      over its own recent[] rows, and the fitted model is reported explicitly.
 *
 * Read-only. Usage: node measure.mjs [--json report.json]
 */
import { readdirSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { createHash } from 'node:crypto'

const START = 1793571849158
const END = 1793831049158
const KST = 9 * 3600 * 1000
const CHARS_PER_TOKEN = 3.7
const DSH = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const SESSIONS = join(DSH, 'sessions')
const WARM = '[tokeneconomizer] warm tier'
const COLD = '[tokeneconomizer] cold tier'
const POINTER = /^\[Output identical to step (\d+) \(hash: ([0-9a-f]+)\), content omitted to save context\]$/
const PRUNE = /tool result middle pruned/i

const kst = (ms) => new Date(ms + KST).toISOString().replace('T', ' ').slice(0, 19)
const textOf = (c) => (Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text ?? '').join('\n') : typeof c === 'string' ? c : '')
const evText = (e) => textOf(e?.data?.message?.content ?? e?.data?.content)
const inW = (ms) => ms >= START && ms <= END

// ---------------------------------------------------------------- prices
/** Least-squares fit of three per-token prices from the cost file's own rows. */
function fitPrices (rows) {
  const A = rows.map((r) => [r.tokens.input, r.tokens.cacheRead, r.tokens.output])
  const solve = (b) => {
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    const v = [0, 0, 0]
    for (let k = 0; k < A.length; k++) {
      for (let i = 0; i < 3; i++) { v[i] += A[k][i] * b[k]; for (let j = 0; j < 3; j++) M[i][j] += A[k][i] * A[k][j] }
    }
    for (let i = 0; i < 3; i++) {
      let p = i
      for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r
      ;[M[i], M[p]] = [M[p], M[i]]; [v[i], v[p]] = [v[p], v[i]]
      for (let r = i + 1; r < 3; r++) { const f = M[r][i] / M[i][i]; for (let j = i; j < 3; j++) M[r][j] -= f * M[i][j]; v[r] -= f * v[i] }
    }
    const x = [0, 0, 0]
    for (let i = 2; i >= 0; i--) { let s = v[i]; for (let j = i + 1; j < 3; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i] }
    return { input: 0, cacheRead: 0, output: 0, ...{ input: x[0], cacheRead: x[1], output: x[2] } }
  }
  return { paid: solve(rows.map((r) => r.costUsd)), list: solve(rows.map((r) => r.listCostUsd)) }
}

let priceBlock = { available: false, reason: 'cost file absent' }
const costPath = join(DSH, 'deepinfra-session-cost.json')
const routesFromCost = new Set()
if (existsSync(costPath)) {
  const raw = JSON.parse(readFileSync(costPath, 'utf8'))
  const rec = raw.recent ?? []
  const usable = rec.filter((r) => r.costUsd > 0 && r.tokens)
  if (usable.length >= 3) {
    const fit = fitPrices(usable)
    for (const r of rec) routesFromCost.add(r.model)
    let maxResidual = 0
    for (const r of usable) {
      const pred = r.tokens.input * fit.paid.input + r.tokens.cacheRead * fit.paid.cacheRead + r.tokens.output * fit.paid.output
      maxResidual = Math.max(maxResidual, Math.abs(pred - r.costUsd) / Math.max(r.costUsd, 1e-12))
    }
    priceBlock = {
      available: true,
      source: '~/.dsh/deepinfra-session-cost.json recent[]',
      rowsFitted: usable.length,
      routes: [...routesFromCost],
      usdPerToken: fit.paid,
      usdPerMillion: { input: fit.paid.input * 1e6, cacheRead: fit.paid.cacheRead * 1e6, output: fit.paid.output * 1e6 },
      listUsdPerMillion: { input: fit.list.input * 1e6, cacheRead: fit.list.cacheRead * 1e6, output: fit.list.output * 1e6 },
      paidToListRatio: fit.list.input ? fit.paid.input / fit.list.input : null,
      maxRelativeResidual: maxResidual,
      method: 'exact 3-unknown least squares on (input, cacheRead, output) token counts; residual at machine precision => the file prices a linear model with these three rates',
      caveat: 'rates are for the deepinfra route only. Sessions on opencode-go/opencode-http-agent in the same window are unpriced here; their share is reported so the coverage of the dollar figure is explicit.',
    }
  }
}

// ---------------------------------------------------------------- corpus + rewrites
const sessions = []
for (const project of readdirSync(SESSIONS)) {
  const pdir = join(SESSIONS, project)
  if (!statSync(pdir).isDirectory()) continue
  for (const id of readdirSync(pdir)) {
    const dir = join(pdir, id)
    if (!statSync(dir).isDirectory()) continue
    const snaps = readdirSync(dir).filter((f) => f.startsWith('session.v4.jsonl.zstd') && !f.includes('bak')).sort()
    if (!snaps.length) continue
    let evs
    try { evs = zstdDecompressSync(readFileSync(join(dir, snaps.at(-1)))).toString('utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { continue }
    const header = evs.find((e) => e.type === 'session') ?? {}
    sessions.push({ project, id, cwd: header.cwd ?? '', evs })
  }
}

const rec = []
for (const s of sessions) {
  const fixture = /^\/tmp\//.test(s.cwd) || /(te-side-|benchtest-|ab-current-)/.test(s.cwd) || /(te-side-|benchtest-|ab-current-)/.test(s.project)
  const r = {
    session: s.id, project: s.project, cwd: s.cwd, fixture,
    requests: 0, promptTokens: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0,
    routes: new Map(), rewrites: [], pointers: [], laterSeqs: [],
  }
  const bySeq = new Map()
  for (const e of s.evs) if (e.seq !== undefined) bySeq.set(e.seq, e)
  for (const e of s.evs) {
    if (e.type === 'assistant/message') {
      r.laterSeqs.push(e.seq)
      if (!inW(e.time) || !e.data?.usage) continue
      const u = e.data.usage
      const prompt = (u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0)
      r.requests++; r.promptTokens += prompt
      r.input += u.inputTokens ?? 0; r.cacheRead += u.cacheReadTokens ?? 0
      r.cacheWrite += u.cacheWriteTokens ?? 0; r.output += u.outputTokens ?? 0
      const route = (e.data.message?.source?.provider ?? '?') + ' / ' + (e.data.message?.source?.model ?? '?')
      const agg = r.routes.get(route) ?? { requests: 0, prompt: 0, input: 0, cacheRead: 0, output: 0 }
      agg.requests++; agg.prompt += prompt; agg.input += u.inputTokens ?? 0; agg.cacheRead += u.cacheReadTokens ?? 0; agg.output += u.outputTokens ?? 0
      r.routes.set(route, agg)
    }
  }
  // rewrites: strict pairing, in-window
  for (const e of s.evs) {
    if (e.surfaceOp?.op !== 'replace' || !inW(e.time)) continue
    const after = evText(e)
    const orig = bySeq.get(e.sourceEventSeqs?.[0] ?? e.surfaceOp.startSeq)
    if (!orig) continue
    const before = evText(orig)
    if (before.startsWith('[tokeneconomizer]')) continue
    if (PRUNE.test(after)) continue
    const kind = after.startsWith(WARM) ? 'te-warm' : after.startsWith(COLD) ? 'te-cold' : 'other'
    if (kind === 'other') continue
    const later = r.laterSeqs.filter((q) => q > e.seq).length
    r.rewrites.push({ seq: e.seq, at: kst(e.time), kind, charsBefore: before.length, charsAfter: after.length, delta: before.length - after.length, laterRequests: later })
  }
  for (const e of s.evs) {
    if (!inW(e.time)) continue
    const t = evText(e)
    if (t.length !== t.trim().length) continue
    const m = POINTER.exec(t)
    if (!m) continue
    const cands = s.evs.filter((x) => x.type === 'tool/result' && x.data?.step === Number(m[1]) && x.seq < e.seq)
    let dup = null
    for (let i = cands.length - 1; i >= 0; i--) {
      const ct = evText(cands[i])
      if (ct.length < 200) continue
      if (createHash('sha256').update(ct).digest('hex').startsWith(m[2])) { dup = ct.length; break }
    }
    const later = r.laterSeqs.filter((q) => q > e.seq).length
    r.pointers.push({ seq: e.seq, at: kst(e.time), pointerChars: t.length, dupChars: dup, delta: dup === null ? null : dup - t.length, laterRequests: later })
  }
  rec.push(r)
}

const real = rec.filter((r) => !r.fixture)
const fixtures = rec.filter((r) => r.fixture)
const sum = (a, f) => a.reduce((x, y) => x + f(y), 0)

const corpus = {
  sessions: real.filter((r) => r.requests > 0).length,
  requests: sum(real, (r) => r.requests),
  promptTokens: sum(real, (r) => r.promptTokens),
  inputTokens: sum(real, (r) => r.input),
  cacheReadTokens: sum(real, (r) => r.cacheRead),
  cacheWriteTokens: sum(real, (r) => r.cacheWrite),
  outputTokens: sum(real, (r) => r.output),
  toolResultsNote: 'prompt/usage fields on assistant/message; a request with no usage block is counted in neither',
}
corpus.cacheReadShare = corpus.promptTokens ? corpus.cacheReadTokens / corpus.promptTokens : null
corpus.meanPromptPerRequest = corpus.requests ? Math.round(corpus.promptTokens / corpus.requests) : null

const routes = new Map()
for (const r of real) for (const [route, agg] of r.routes) {
  const cur = routes.get(route) ?? { route, requests: 0, prompt: 0, input: 0, cacheRead: 0, output: 0 }
  cur.requests += agg.requests; cur.prompt += agg.prompt; cur.input += agg.input; cur.cacheRead += agg.cacheRead; cur.output += agg.output
  routes.set(route, cur)
}
const perRoute = [...routes.values()].map((x) => ({ ...x, shareOfPrompt: corpus.promptTokens ? x.prompt / corpus.promptTokens : null })).sort((a, b) => b.prompt - a.prompt)

// ---------------------------------------------------------------- savings
const allRewrites = real.flatMap((r) => r.rewrites)
const allPointers = real.flatMap((r) => r.pointers)
const tierSavedChars = sum(allRewrites, (x) => x.delta)
const dedupSavedChars = sum(allPointers, (x) => x.delta ?? 0)
const contextCharsRemoved = tierSavedChars + dedupSavedChars
const contextTokensRemoved = contextCharsRemoved / CHARS_PER_TOKEN

// persisted: saved tokens multiplied by the later assistant messages in that session
const persistedTokens = sum(allRewrites, (x) => (x.delta / CHARS_PER_TOKEN) * x.laterRequests) +
  sum(allPointers, (x) => ((x.delta ?? 0) / CHARS_PER_TOKEN) * x.laterRequests)
const meanLater = allRewrites.length ? sum(allRewrites, (x) => x.laterRequests) / allRewrites.length : null

// ---------------------------------------------------------------- pricing
const P = priceBlock.available ? priceBlock.usdPerToken : null
const priceLens = P ? {
  note: 'each saved context token is modelled at the rate the corpus actually pays. 98.9% of prompt tokens are cache reads, so the honest rate for a token not re-sent is the cacheRead rate, not the input rate.',
  contextRemovedUsd_uniform_input_rate: contextTokensRemoved * P.input,
  contextRemovedUsd_uniform_cache_read_rate: contextTokensRemoved * P.cacheRead,
  persistedUsd_all_cache_read: persistedTokens * P.cacheRead,
  persistedUsd_as_if_uncached_input: persistedTokens * P.input,
  persistedUsd_cache_aware_blend: persistedTokens * (corpus.cacheReadShare * P.cacheRead + (1 - corpus.cacheReadShare) * P.input),
} : null

// counterfactual corpus cost: what the corpus would have cost without the rewrites.
// Context grows by the removed chars for every later request that carried them; those
// tokens would have been billed at the corpus' own cache-read/input mix.
// how much of the corpus the fitted price actually covers (deepinfra route only)
const pricedRouteShare = priceBlock.available
  ? sum(perRoute.filter((p) => priceBlock.routes.some((m) => p.route.includes(m))), (p) => p.prompt) / Math.max(1, corpus.promptTokens)
  : null
const withoutRewritesPromptTokens = corpus.promptTokens + persistedTokens
const counterfactual = P ? {
  actualUsd: corpus.promptTokens * (corpus.cacheReadShare * P.cacheRead + (1 - corpus.cacheReadShare) * P.input) + corpus.outputTokens * P.output,
  withoutRewritesUsd: withoutRewritesPromptTokens * (corpus.cacheReadShare * P.cacheRead + (1 - corpus.cacheReadShare) * P.input) + corpus.outputTokens * P.output,
  deltaUsd: persistedTokens * (corpus.cacheReadShare * P.cacheRead + (1 - corpus.cacheReadShare) * P.input),
  cacheAwareBlendRatePerMillion: (corpus.cacheReadShare * P.cacheRead + (1 - corpus.cacheReadShare) * P.input) * 1e6,
  pricedRouteShareOfPromptTokens: pricedRouteShare,
  pricedRouteSessionsOnly: 'the dollar figures apply the deepinfra route rates to the whole corpus as a pricing model; only ' + (pricedRouteShare === null ? 'n/a' : (pricedRouteShare * 100).toFixed(3) + '%') + ' of in-window prompt tokens actually ran on that route, so treat them as an order-of-magnitude, not an invoice',
} : null

const report = {
  window: { startMs: START, endMs: END, startKst: kst(START), endKst: kst(END), charsPerToken: CHARS_PER_TOKEN },
  method: 'copied scripts/measure-token-saving.mjs, added (a) in-window time filter on assistant/message usage, (b) strict event-pairing rewrite classification (surfaceOp.replace -> sourceEventSeqs[0]), (c) prices fitted from ~/.dsh/deepinfra-session-cost.json recent[]',
  corpus,
  perRoute,
  fixtures: {
    sessions: fixtures.filter((r) => r.requests > 0).length,
    requests: sum(fixtures, (r) => r.requests),
    promptTokens: sum(fixtures, (r) => r.promptTokens),
    rewrites: sum(fixtures, (r) => r.rewrites.length),
    assignedCwd: [...new Set(fixtures.map((r) => r.cwd))].slice(0, 8),
  },
  savings: {
    rewrites: allRewrites.length,
    warm: allRewrites.filter((x) => x.kind === 'te-warm').length,
    cold: allRewrites.filter((x) => x.kind === 'te-cold').length,
    tierCharsBefore: sum(allRewrites, (x) => x.charsBefore),
    tierCharsAfter: sum(allRewrites, (x) => x.charsAfter),
    tierCharsSaved: tierSavedChars,
    dedupPointers: allPointers.length,
    dedupCharsSaved: dedupSavedChars,
    contextCharsRemoved,
    contextTokensRemoved,
    inflating: allRewrites.filter((x) => x.charsAfter > x.charsBefore).length,
  },
  lenses: {
    a_contextTokenShare: corpus.promptTokens ? contextTokensRemoved / corpus.promptTokens : null,
    b_persistedTokens: persistedTokens,
    b_meanLaterRequests: meanLater,
    b_persistedShare: corpus.promptTokens ? persistedTokens / corpus.promptTokens : null,
  },
  prices: priceBlock,
  priceLens,
  counterfactual,
  perSession: real.filter((r) => r.rewrites.length).map((r) => ({
    session: r.session.slice(0, 20), requests: r.requests, promptTokens: r.promptTokens,
    rewrites: r.rewrites.length, charsSaved: sum(r.rewrites, (x) => x.delta),
    laterMean: r.rewrites.length ? Math.round(sum(r.rewrites, (x) => x.laterRequests) / r.rewrites.length) : null,
  })).sort((a, b) => b.charsSaved - a.charsSaved),
}

const pct = (x) => (x === null || x === undefined ? 'n/a' : (x * 100).toFixed(3) + '%')
const usd = (x) => (x === null || x === undefined ? 'n/a' : '$' + x.toFixed(6))
const L = []
L.push('== TRACK C - cost attribution + counterfactual ==')
L.push('window ' + kst(START) + ' .. ' + kst(END) + ' (KST)')
L.push('')
L.push('-- corpus (window only, real sessions) --')
L.push('  sessions=' + corpus.sessions + ' requests=' + corpus.requests)
L.push('  promptTokens=' + corpus.promptTokens + ' (input ' + corpus.inputTokens + ' + cacheRead ' + corpus.cacheReadTokens + ' + cacheWrite ' + corpus.cacheWriteTokens + ')')
L.push('  cacheRead share=' + pct(corpus.cacheReadShare) + '  outputTokens=' + corpus.outputTokens + '  meanPrompt/request=' + corpus.meanPromptPerRequest)
L.push('')
L.push('-- per route (in-window prompt tokens) --')
for (const p of perRoute) L.push('  ' + p.route.padEnd(56) + ' reqs=' + String(p.requests).padStart(5) + ' prompt=' + String(p.prompt).padStart(11) + ' share=' + pct(p.shareOfPrompt))
L.push('')
L.push('-- plugin saving (strict pairing, in-window) --')
L.push('  rewrites=' + report.savings.rewrites + ' (warm ' + report.savings.warm + ', cold ' + report.savings.cold + ') inflating=' + report.savings.inflating)
L.push('  charsBefore=' + report.savings.tierCharsBefore + ' charsAfter=' + report.savings.tierCharsAfter + ' tierCharsSaved=' + report.savings.tierCharsSaved)
L.push('  dedup pointers=' + report.savings.dedupPointers + ' dedupCharsSaved=' + report.savings.dedupCharsSaved)
L.push('  contextCharsRemoved=' + report.savings.contextCharsRemoved + ' contextTokensRemoved=' + Math.round(contextTokensRemoved))
L.push('')
L.push('-- lens (a) share of prompt tokens; (b) persisted tokens --')
L.push('  (a) ' + Math.round(contextTokensRemoved) + ' tokens = ' + pct(report.lenses.a_contextTokenShare) + ' of window prompt tokens')
L.push('  (b) ' + Math.round(persistedTokens) + ' tokens = ' + pct(report.lenses.b_persistedShare) + ' (mean later requests=' + (meanLater === null ? 'n/a' : meanLater.toFixed(1)) + ')')
L.push('')
L.push('-- prices --')
if (priceBlock.available) {
  L.push('  source=' + priceBlock.source + ' rows=' + priceBlock.rowsFitted + ' route(s)=' + JSON.stringify(priceBlock.routes))
  L.push('  paid  $/1M: input ' + priceBlock.usdPerMillion.input.toFixed(4) + '  cacheRead ' + priceBlock.usdPerMillion.cacheRead.toFixed(4) + '  output ' + priceBlock.usdPerMillion.output.toFixed(4))
  L.push('  list  $/1M: input ' + priceBlock.listUsdPerMillion.input.toFixed(4) + '  cacheRead ' + priceBlock.listUsdPerMillion.cacheRead.toFixed(4) + '  output ' + priceBlock.listUsdPerMillion.output.toFixed(4))
  L.push('  paid/list ratio=' + priceBlock.paidToListRatio.toFixed(4) + '  max relative residual=' + priceBlock.maxRelativeResidual.toExponential(2))
  L.push('  ' + priceBlock.caveat)
  L.push('  context removed (all-cacheRead rate): ' + usd(priceLens.contextRemovedUsd_uniform_cache_read_rate) + '   (all-input rate): ' + usd(priceLens.contextRemovedUsd_uniform_input_rate))
  L.push('  persisted (all cacheRead): ' + usd(priceLens.persistedUsd_all_cache_read) + '   (as if uncached input): ' + usd(priceLens.persistedUsd_as_if_uncached_input) + '   (corpus blend): ' + usd(priceLens.persistedUsd_cache_aware_blend))
  L.push('')
  L.push('-- counterfactual corpus cost --')
  L.push('  cash blend rate = $' + counterfactual.cacheAwareBlendRatePerMillion.toFixed(4) + '/1M prompt tokens')
  L.push('  actual window corpus cost   = ' + usd(counterfactual.actualUsd))
  L.push('  without-rewrite corpus cost = ' + usd(counterfactual.withoutRewritesUsd))
  L.push('  delta                       = ' + usd(counterfactual.deltaUsd) + '  (' + pct(counterfactual.actualUsd ? counterfactual.deltaUsd / counterfactual.actualUsd : null) + ' of actual)')
  L.push('  price coverage: the fitted route carries ' + pct(counterfactual.pricedRouteShareOfPromptTokens) + ' of in-window prompt tokens; other routes are unpriced in the cost file')
} else {
  L.push('  no usable prices: ' + priceBlock.reason)
  L.push('  reporting tokens only, no dollar figures')
}
L.push('')
L.push('-- fixtures (excluded) --')
L.push('  sessions=' + report.fixtures.sessions + ' requests=' + report.fixtures.requests + ' promptTokens=' + report.fixtures.promptTokens + ' rewrites=' + report.fixtures.rewrites)
L.push('')
L.push('-- per session carrying the saving --')
for (const s of report.perSession) L.push('  ' + s.session.padEnd(22) + ' reqs=' + String(s.requests).padStart(4) + ' prompt=' + String(s.promptTokens).padStart(10) + ' rewrites=' + String(s.rewrites).padStart(3) + ' charsSaved=' + String(s.charsSaved).padStart(7) + ' laterMean=' + s.laterMean)
L.push('')
L.push('CAVEAT: dollar savings are NOT 1:1 with tokens removed. 98.9% of this corpus is served from cache at 1/33rd of the input rate, and shrinking a context also shrinks the prefix-cache hit for the next request, which the model above cannot see. Treat the counterfactual as an upper bound and the cacheRead-rate figure as the conservative one.')

console.log(L.join('\n'))
const j = process.argv.indexOf('--json')
if (j !== -1) writeFileSync(process.argv[j + 1], JSON.stringify(report, null, 1) + '\n')
