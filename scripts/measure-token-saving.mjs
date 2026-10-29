/**
 * Measure what the TokenEconomizer bridge actually saved, and where the corpus
 * token cost really sits.
 *
 * Reads the harness's own session logs (~/.dsh/sessions, read-only) and the
 * engine's state (~/.tokeneconomizer, read-only) and prints:
 *
 *   1. corpus cost: requests, prompt tokens, cache-read share, per provider
 *   2. the bridge's own levers: tool-mask proposal, injected facts, nudges,
 *      and the tool calls the loop guard actually saw
 *   3. the host-local dedup: pointer events in the logs, and the duplicate
 *      outputs it would have replaced
 *   4. the cost structure: context growth, tool-output share, pruner reach
 *
 * Usage: node scripts/measure-token-saving.mjs [--json <file>]
 *         DSH_HOME=... TOKENECONOMIZER_HOME=... node scripts/measure-token-saving.mjs
 */
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { createHash } from 'node:crypto'

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const TE_HOME = process.env.TOKENECONOMIZER_HOME ?? join(homedir(), '.tokeneconomizer')
const SESSIONS = join(DSH_HOME, 'sessions')
const POINTER = /\[Output identical to step (\d+) \(hash: ([0-9a-f]+)\), content omitted to save context\]/
const PRUNE_MARKER = 'tool result middle pruned'
/** Characters per token, measured from the corpus (see the report). */
const CHARS_PER_TOKEN = 3.7

function textOf (content) {
  if (!Array.isArray(content)) return ''
  return content.map((b) => (b && b.type === 'text' ? b.text ?? '' : '')).filter(Boolean).join('\n')
}

function readSessionLog (dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl.zstd'))
  if (!files.length) return []
  const path = join(dir, files.sort().at(-1))
  return zstdDecompressSync(readFileSync(path)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

/** Read every session log under the harness session store. */
function readSessions () {
  const sessions = []
  if (!existsSync(SESSIONS)) return sessions
  for (const project of readdirSync(SESSIONS)) {
    const projectDir = join(SESSIONS, project)
    if (!existsSync(projectDir)) continue
    for (const id of readdirSync(projectDir)) {
      const dir = join(projectDir, id)
      if (!existsSync(dir)) continue
      let events
      try { events = readSessionLog(dir) } catch { continue }
      if (!events.length) continue
      sessions.push({ project, id, events })
    }
  }
  return sessions
}

/** Per-session usage, context growth, tool-output size and duplicate outputs. */
function measureSession ({ project, id, events }) {
  const header = events.find((e) => e.type === 'session')
  const rec = {
    id: header?.id ?? id, project, origin: header?.origin ?? '',
    requests: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0,
    promptTokens: 0, maxPrompt: 0, provider: '', model: '',
    toolResults: 0, toolChars: 0, pointerEvents: 0, prunedResults: 0,
    duplicateChars: 0, duplicateSavedChars: 0, duplicates: 0,
    routes: new Map(),
  }
  const seen = new Map()
  // Every request's sequence, so a duplicate output can be priced by the
  // requests that would have carried it again.
  const assistantSeqs = events.filter((e) => e.type === 'assistant/message').map((e) => e.seq)
  for (const e of events) {
    const d = e.data ?? {}
    if (e.type === 'assistant/message') {
      const u = d.usage ?? {}
      const prompt = (u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0)
      rec.requests += 1
      rec.promptTokens += prompt
      rec.maxPrompt = Math.max(rec.maxPrompt, prompt)
      rec.input += u.inputTokens ?? 0
      rec.cacheRead += u.cacheReadTokens ?? 0
      rec.cacheWrite += u.cacheWriteTokens ?? 0
      rec.output += u.outputTokens ?? 0
      const route = `${d.message?.source?.provider ?? '?'} / ${d.message?.source?.model ?? '?'}`
      const agg = rec.routes.get(route) ?? { requests: 0, prompt: 0 }
      agg.requests += 1
      agg.prompt += prompt
      rec.routes.set(route, agg)
    } else if (e.type === 'tool/result') {
      const text = textOf(d.message?.content)
      rec.toolResults += 1
      rec.toolChars += text.length
      if (text.includes(PRUNE_MARKER)) rec.prunedResults += 1
      if (POINTER.test(text)) { rec.pointerEvents += 1; continue }
      if (text.length < 200) continue
      const digest = createHash('sha256').update(text).digest('hex')
      if (!seen.has(digest)) { seen.set(digest, text.length); continue }
      rec.duplicates += 1
      rec.duplicateChars += text.length
      const laterRequests = assistantSeqs.filter((s) => s > e.seq).length
      rec.duplicateSavedChars += Math.max(0, text.length - 90) * laterRequests
    }
  }
  rec.routeList = [...rec.routes].map(([route, agg]) => ({ route, ...agg }))
  return rec
}

/** The engine's own state: proposals, injections, nudges, guard tool calls. */
function measureEngine () {
  const out = { repos: [], proposals: [], injectedChars: 0, nudges: 0, turnSummaries: 0, turnsWithToolCalls: 0, toolCalls: 0 }
  const reposDir = join(TE_HOME, 'repos')
  if (!existsSync(reposDir)) return out
  for (const repo of readdirSync(reposDir)) {
    const hostDir = join(reposDir, repo, 'dsh')
    if (!existsSync(hostDir)) continue
    const entry = { repo, proposal: [], injectedChars: 0, nudges: 0, turnSummaries: 0, turnsWithToolCalls: 0, toolCalls: 0 }
    const untoolPath = join(hostDir, 'untool.json')
    if (existsSync(untoolPath)) {
      const untool = JSON.parse(readFileSync(untoolPath, 'utf8'))
      entry.proposal = untool.proposal ?? []
      entry.catalog = (untool.catalog_tools ?? []).length
      entry.unusedStreaks = Object.entries(untool.streaks ?? {})
        .filter(([tool, streak]) => !untool.used_tools?.includes(tool) && streak > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
      out.proposals.push({ repo, proposal: entry.proposal, unusedStreaks: entry.unusedStreaks })
    }
    const eventsPath = join(hostDir, 'events.jsonl')
    if (existsSync(eventsPath)) {
      for (const line of readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean)) {
        const event = JSON.parse(line)
        if (event.kind !== 'turn') continue
        entry.turnSummaries += 1
        entry.toolCalls += event.tool_calls ?? 0
        if ((event.tool_calls ?? 0) > 0) entry.turnsWithToolCalls += 1
        entry.nudges += event.nudges ?? 0
      }
    }
    const sessionsDir = join(hostDir, 'sessions')
    if (existsSync(sessionsDir)) {
      for (const file of readdirSync(sessionsDir)) {
        const state = JSON.parse(readFileSync(join(sessionsDir, file), 'utf8'))
        entry.injectedChars += state.injected_chars ?? 0
        entry.nudges += state.nudges ?? 0
      }
    }
    out.injectedChars += entry.injectedChars
    out.nudges += entry.nudges
    out.turnSummaries += entry.turnSummaries
    out.turnsWithToolCalls += entry.turnsWithToolCalls
    out.toolCalls += entry.toolCalls
    out.repos.push(entry)
  }
  return out
}

const sessions = readSessions().map(measureSession)
const engine = measureEngine()
const sum = (f) => sessions.reduce((a, s) => a + f(s), 0)
const promptTokens = sum((s) => s.promptTokens)
const cacheRead = sum((s) => s.cacheRead)
const outputTokens = sum((s) => s.output)

const byProvider = new Map()
for (const s of sessions) {
  for (const route of s.routeList) {
    const agg = byProvider.get(route.route) ?? { requests: 0, prompt: 0, over1M: 0 }
    agg.requests += route.requests
    agg.prompt += route.prompt
    if (s.maxPrompt > 1_000_000) agg.over1M += 1
    byProvider.set(route.route, agg)
  }
}

const report = {
  corpus: {
    sessions: sessions.length,
    requests: sum((s) => s.requests),
    promptTokens,
    inputTokens: sum((s) => s.input),
    cacheReadTokens: cacheRead,
    cacheWriteTokens: sum((s) => s.cacheWrite),
    outputTokens,
    cacheReadShare: promptTokens ? cacheRead / promptTokens : 0,
    meanPromptPerRequest: sessions.length ? Math.round(promptTokens / Math.max(1, sum((s) => s.requests))) : 0,
    toolResults: sum((s) => s.toolResults),
    toolOutputChars: sum((s) => s.toolChars),
    prunedResults: sum((s) => s.prunedResults),
  },
  bridge: {
    pointerEvents: sum((s) => s.pointerEvents),
    duplicateOutputs: sum((s) => s.duplicates),
    duplicateChars: sum((s) => s.duplicateChars),
    duplicateSavedChars: sum((s) => s.duplicateSavedChars),
    injectedChars: engine.injectedChars,
    nudges: engine.nudges,
    turnSummaries: engine.turnSummaries,
    turnsWithToolCalls: engine.turnsWithToolCalls,
    guardToolCalls: engine.toolCalls,
    proposals: engine.proposals,
  },
  providers: [...byProvider].map(([k, v]) => ({ route: k, ...v })).sort((a, b) => b.prompt - a.prompt),
  topSessions: [...sessions].sort((a, b) => b.cacheRead - a.cacheRead).slice(0, 10)
    .map((s) => ({ id: s.id, project: s.project, requests: s.requests, cacheRead: s.cacheRead, maxPrompt: s.maxPrompt, toolChars: s.toolChars })),
}

console.log('== corpus ==')
console.log(`sessions ${report.corpus.sessions}  requests ${report.corpus.requests}`)
console.log(`prompt tokens ${promptTokens.toLocaleString()}  (cache read ${(report.corpus.cacheReadShare * 100).toFixed(2)}%)`)
console.log(`mean prompt per request ${report.corpus.meanPromptPerRequest.toLocaleString()} tokens`)
console.log(`tool results ${report.corpus.toolResults.toLocaleString()}  chars ${report.corpus.toolOutputChars.toLocaleString()}  pruned ${report.corpus.prunedResults}`)
console.log('\n== bridge levers ==')
console.log(`dedup pointer events ${report.bridge.pointerEvents} of ${report.corpus.toolResults.toLocaleString()} tool results`)
console.log(`duplicate outputs ${report.bridge.duplicateOutputs} (${report.bridge.duplicateChars.toLocaleString()} chars; ${Math.round(report.bridge.duplicateSavedChars / CHARS_PER_TOKEN).toLocaleString()} tokens not re-sent)`)
console.log(`engine injected chars ${report.bridge.injectedChars}  nudges ${report.bridge.nudges}`)
console.log(`guard turns ${report.bridge.turnSummaries}, with tool calls ${report.bridge.turnsWithToolCalls}, tool calls seen ${report.bridge.guardToolCalls}`)
console.log('\n== per repository ==')
for (const repo of engine.repos) {
  console.log(`  ${repo.repo.padEnd(36)} proposal=${JSON.stringify(repo.proposal)} turns=${repo.turnSummaries} turnsWithToolCalls=${repo.turnsWithToolCalls} nudges=${repo.nudges} injectedChars=${repo.injectedChars}`)
}
console.log('\n== per provider route ==')
for (const p of report.providers) console.log(`  ${p.route.padEnd(52)} requests=${String(p.requests).padStart(6)} prompt=${p.prompt.toLocaleString().padStart(16)} over1M=${p.over1M}`)
console.log('\n== top sessions by cache-read cost ==')
for (const s of report.topSessions) {
  console.log(`  ${s.id.slice(0, 26).padEnd(28)} reqs=${String(s.requests).padStart(5)} cacheRead=${s.cacheRead.toLocaleString().padStart(13)} maxPrompt=${s.maxPrompt.toLocaleString().padStart(11)} toolChars=${s.toolChars.toLocaleString()}`)
}

const jsonIndex = process.argv.indexOf('--json')
if (jsonIndex !== -1 && process.argv[jsonIndex + 1]) writeFileSync(process.argv[jsonIndex + 1], `${JSON.stringify(report, null, 1)}\n`)
