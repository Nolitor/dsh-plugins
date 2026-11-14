/**
 * Measure what the TokenEconomizer bridge actually saved, and where the corpus
 * token cost really sits.
 *
 * Reads the harness's own session logs (~/.dsh/sessions, read-only) and the
 * engine's state (~/.tokeneconomizer, read-only) and prints:
 *
 *   1. corpus facts that exist whether or not this plugin ran: requests, prompt
 *      tokens, cache-read share, per provider, tool-output volume, and the
 *      harness's own compaction/prune records
 *   2. this plugin's own levers: surface rewrites, dedup pointers, duplicate
 *      outputs, injected facts, nudges, and the tool calls the loop guard saw
 *   3. the last 24h / 7d slice of those levers, so a stale total cannot be
 *      mistaken for current activity
 *
 * Counting rule (the reason this script exists): a rewrite is counted from the
 * event's surface structure, `surfaceOp.op === 'replace'` on a `tool/result`,
 * never from the pruner's marker string. The marker also appears in the user's
 * own grep/bash output, so a marker-only count under-reports real rewrites and
 * invents activity that never happened. `compaction/prune` is a separate,
 * log-only shadow-price record and is counted as such.
 *
 * Two numbers must never be read as the same thing:
 *   - cache read is the provider's prompt cache at work, NOT this plugin's saving
 *   - duplicateSavedChars is an upper bound that assumes every later request
 *     re-sent the duplicate; duplicateChars is the measured replacement cost
 *
 * READ-ONLY against whatever DSH_HOME is set: this script only reads session logs and
 * never launches DSH. Running it against the live home reads the owner's logs but writes
 * nothing there; --json must point OUTSIDE the read home. See docs/DSH-HOME-ISOLATION.md.
 *
 * Usage: node scripts/measure-token-saving.mjs [--json <file>]
 *         DSH_HOME=... TOKENECONOMIZER_HOME=... node scripts/measure-token-saving.mjs
 */
// dsh-isolation: read-only-live-home — reads session logs, launches nothing.
import { readdirSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, sep } from 'node:path'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { createHash } from 'node:crypto'

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const READING_LIVE_HOME = process.env.DSH_HOME === undefined
if (READING_LIVE_HOME) {
  console.error('[measure] DSH_HOME unset: READING the live home ' + DSH_HOME + ' (read-only; no DSH is launched)')
}
const TE_HOME = process.env.TOKENECONOMIZER_HOME ?? join(homedir(), '.tokeneconomizer')
const SESSIONS = join(DSH_HOME, 'sessions')
const POINTER = /\[Output identical to step (\d+) \(hash: ([0-9a-f]+)\), content omitted to save context\]/
/** The harness pruner's own marker. A classification hint, never a count basis. */
const PRUNE_MARKER = 'tool result middle pruned'
/** Every replacement this plugin writes starts with this, before its tier label. */
const TE_PREFIX = '[tokeneconomizer]'
const TE_WARM = /^\[tokeneconomizer\] warm tier:/
const TE_COLD = /^\[tokeneconomizer\] cold tier:/
/** Characters per token, measured from the corpus (see the report). */
const CHARS_PER_TOKEN = 3.7
const HOUR_MS = 3600 * 1000
const DAY_MS = 24 * HOUR_MS
const NOW = Date.now()

function textOf (content) {
  if (!Array.isArray(content)) return ''
  return content.map((b) => (b && b.type === 'text' ? b.text ?? '' : '')).filter(Boolean).join('\n')
}

/**
 * The newest real log in one session directory.
 *
 * Session directories can hold several generations plus backups; the newest
 * non-backup `.jsonl.zstd` is the live one. Returns null when a directory has no
 * readable log, and the file mtime is kept as the timestamp of last resort.
 */
function readSessionLog (dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl.zstd') && !f.includes('bak')).sort()
  if (!files.length) return null
  const path = join(dir, files.at(-1))
  const mtimeMs = statSync(path).mtimeMs
  const events = zstdDecompressSync(readFileSync(path)).toString('utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l))
  return { events, path, mtimeMs }
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
      let log
      try { log = readSessionLog(dir) } catch { continue }
      if (!log || !log.events.length) continue
      sessions.push({ project, id, events: log.events, mtimeMs: log.mtimeMs })
    }
  }
  return sessions
}

/**
 * When an event happened: its own `time` first, the session log's mtime second.
 * Returns null when neither exists, and the caller reports it as untimed rather
 * than guessing.
 */
function timeOf (e, mtimeMs, rec) {
  if (typeof e.time === 'number' && Number.isFinite(e.time)) return e.time
  if (typeof mtimeMs === 'number' && Number.isFinite(mtimeMs)) {
    rec.mtimeFallbacks += 1
    return mtimeMs
  }
  rec.untimedEvents += 1
  return null
}

/** Add one timestamped observation to the 24h / 7d windows. */
function addToWindow (window, t, kind) {
  if (t === null) return false
  const age = NOW - t
  const inDay = age <= DAY_MS
  const inWeek = age <= 7 * DAY_MS
  if (kind === 'pointer') {
    if (inDay) window.pointer24h += 1
    if (inWeek) window.pointer7d += 1
    return true
  }
  // A rewrite is split by who wrote it: this plugin's tiering, the harness's own
  // tool-result pruner (same surfaceOp shape), or text neither lever claims.
  const prefix = kind === 'harnessPruner' ? 'harness' : kind === 'unattributed' ? 'unattributed' : 'plugin'
  if (inDay) window[`${prefix}Rewrite24h`] += 1
  if (inWeek) window[`${prefix}Rewrite7d`] += 1
  return true
}

/**
 * Which lever wrote this replacement, judged by the text it wrote.
 *
 * Attribution only — the count already happened when the event's surfaceOp was
 * read. Text is used here because both levers append a `tool/result` with
 * `surfaceOp.op === 'replace'` and only their body tells them apart.
 */
function attribute (text) {
  if (TE_WARM.test(text)) return 'tierWarm'
  if (TE_COLD.test(text)) return 'tierCold'
  if (text.startsWith(TE_PREFIX)) return 'tierOther'
  if (text.includes(PRUNE_MARKER)) return 'harnessPruner'
  return 'unattributed'
}

/** Per-session usage, context growth, tool-output size and duplicate outputs. */
function measureSession ({ project, id, events, mtimeMs }) {
  const header = events.find((e) => e.type === 'session')
  const rec = {
    id: header?.id ?? id, project, origin: header?.origin ?? '',
    requests: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0,
    promptTokens: 0, maxPrompt: 0, provider: '', model: '',
    toolResults: 0, toolChars: 0,
    pointerEvents: 0, duplicates: 0, duplicateChars: 0, duplicateSavedChars: 0,
    // Structural rewrite counts: the trustworthy ones.
    rewrittenResults: 0, compactionPruneEvents: 0, otherSurfaceReplaces: 0,
    tierWarm: 0, tierCold: 0, tierOther: 0, harnessPruner: 0, unattributed: 0,
    // Reference only, demoted from saving: marker mentions and the echo subset.
    markerMentions: 0, markerEcho: 0,
    window: {
      pluginRewrite24h: 0, pluginRewrite7d: 0,
      harnessRewrite24h: 0, harnessRewrite7d: 0,
      unattributedRewrite24h: 0, unattributedRewrite7d: 0,
      pointer24h: 0, pointer7d: 0,
    },
    untimedEvents: 0, mtimeFallbacks: 0, untimedRewrites: 0,
    routes: new Map(),
  }
  const seen = new Map()
  // Every request's sequence, so a duplicate output can be priced by the
  // requests that would have carried it again.
  const assistantSeqs = events.filter((e) => e.type === 'assistant/message').map((e) => e.seq)
  for (const e of events) {
    const d = e.data ?? {}
    // A non-tool-result surface replace is session compaction rewriting the
    // prompt, not a tool result the tiering lever touched. A plain string op
    // ('append') only adds to the surface and replaces nothing.
    const op = e.surfaceOp ?? d.surfaceOp
    const opObject = typeof op === 'object' && op !== null
    const replaced = opObject && op.op === 'replace'
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
    } else if (e.type === 'compaction/prune') {
      // Log-only shadow price for one prune replacement: a record, not a saving.
      rec.compactionPruneEvents += 1
    } else if (e.type === 'tool/result') {
      const text = textOf(d.message?.content)
      rec.toolResults += 1
      rec.toolChars += text.length
      if (replaced) {
        rec.rewrittenResults += 1
        const kind = attribute(text)
        rec[kind] += 1
        if (!addToWindow(rec.window, timeOf(e, mtimeMs, rec), kind)) rec.untimedRewrites += 1
      }
      if (text.includes(PRUNE_MARKER)) {
        // The marker is quoted by the user's own grep/bash too. Kept as a
        // reference indicator so the echo stays visible, never as a saving.
        rec.markerMentions += 1
        if (!replaced) rec.markerEcho += 1
      }
      if (POINTER.test(text)) {
        rec.pointerEvents += 1
        addToWindow(rec.window, timeOf(e, mtimeMs, rec), 'pointer')
        continue
      }
      if (text.length < 200) continue
      const digest = createHash('sha256').update(text).digest('hex')
      if (!seen.has(digest)) { seen.set(digest, text.length); continue }
      rec.duplicates += 1
      rec.duplicateChars += text.length
      const laterRequests = assistantSeqs.filter((s) => s > e.seq).length
      rec.duplicateSavedChars += Math.max(0, text.length - 90) * laterRequests
    } else if (opObject) {
      // A surface replace on a message event is session compaction rewriting the
      // prompt (harness floor), not a tool result the tiering lever touched.
      rec.otherSurfaceReplaces += 1
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
const windowTotal = {
  pluginRewrite24h: sum((s) => s.window.pluginRewrite24h), pluginRewrite7d: sum((s) => s.window.pluginRewrite7d),
  harnessRewrite24h: sum((s) => s.window.harnessRewrite24h), harnessRewrite7d: sum((s) => s.window.harnessRewrite7d),
  unattributedRewrite24h: sum((s) => s.window.unattributedRewrite24h), unattributedRewrite7d: sum((s) => s.window.unattributedRewrite7d),
  pointer24h: sum((s) => s.window.pointer24h), pointer7d: sum((s) => s.window.pointer7d),
}

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
    compactionPruneEvents: sum((s) => s.compactionPruneEvents),
    // Reference indicator only: the marker is also quoted by the user's shell.
    markerMentions: sum((s) => s.markerMentions),
    markerEcho: sum((s) => s.markerEcho),
  },
  levers: {
    /** Structural rewrites: tool/result events carrying surfaceOp.op === 'replace'. */
    rewrittenResults: sum((s) => s.rewrittenResults),
    attribution: {
      tierWarm: sum((s) => s.tierWarm),
      tierCold: sum((s) => s.tierCold),
      tierOther: sum((s) => s.tierOther),
      harnessPruner: sum((s) => s.harnessPruner),
      unattributed: sum((s) => s.unattributed),
    },
    /** Session-compaction rewrites of the prompt: not tool-result rewrites. */
    otherSurfaceReplaces: sum((s) => s.otherSurfaceReplaces),
    pointerEvents: sum((s) => s.pointerEvents),
    duplicateOutputs: sum((s) => s.duplicates),
    /** Exact: characters of every replaced duplicate body. */
    duplicateChars: sum((s) => s.duplicateChars),
    /** Approximate upper bound: assumes every later request re-sent it. */
    duplicateSavedCharsApprox: sum((s) => s.duplicateSavedChars),
    window: windowTotal,
    timestamps: {
      untimedEvents: sum((s) => s.untimedEvents),
      mtimeFallbacks: sum((s) => s.mtimeFallbacks),
      untimedRewrites: sum((s) => s.untimedRewrites),
    },
    injectedChars: engine.injectedChars,
    nudges: engine.nudges,
    turnSummaries: engine.turnSummaries,
    turnsWithToolCalls: engine.turnsWithToolCalls,
    guardToolCalls: engine.toolCalls,
    proposals: engine.proposals,
  },
  providers: [...byProvider].map(([k, v]) => ({ route: k, ...v })).sort((a, b) => b.prompt - a.prompt),
  topSessions: [...sessions].sort((a, b) => b.cacheRead - a.cacheRead).slice(0, 10)
    .map((s) => ({ id: s.id, project: s.project, requests: s.requests, cacheRead: s.cacheRead, maxPrompt: s.maxPrompt, toolChars: s.toolChars, rewrittenResults: s.rewrittenResults })),
}

const pct = (part, whole) => (whole ? ((part / whole) * 100).toFixed(1) : '0.0')
const t = report.levers
const attrib = t.attribution
const pluginRewrites = attrib.tierWarm + attrib.tierCold + attrib.tierOther

console.log('== corpus ==')
console.log('(facts that hold whether or not this plugin ran; none of them is this plugin\'s saving)')
console.log(`sessions ${report.corpus.sessions}  requests ${report.corpus.requests.toLocaleString()}`)
console.log(`prompt tokens ${promptTokens.toLocaleString()}  (cache read ${(report.corpus.cacheReadShare * 100).toFixed(2)}% — provider prompt cache, NOT this plugin's saving)`)
console.log(`mean prompt per request ${report.corpus.meanPromptPerRequest.toLocaleString()} tokens`)
console.log(`tool results ${report.corpus.toolResults.toLocaleString()}  chars ${report.corpus.toolOutputChars.toLocaleString()}`)
console.log(`compaction/prune events ${report.corpus.compactionPruneEvents.toLocaleString()}  (harness log-only prune records)`)

console.log('\n== tokeneconomizer levers ==')
console.log(`rewrittenResults ${t.rewrittenResults.toLocaleString()}  (structural: tool/result with surfaceOp.op === 'replace' of ${report.corpus.toolResults.toLocaleString()} results, ${pct(t.rewrittenResults, report.corpus.toolResults)}%)`)
console.log(`  attributed  warm tier ${attrib.tierWarm.toLocaleString()}  cold tier ${attrib.tierCold.toLocaleString()}  other plugin ${attrib.tierOther.toLocaleString()}  harness pruner ${attrib.harnessPruner.toLocaleString()}  unattributed ${attrib.unattributed.toLocaleString()}`)
console.log(`  this plugin's rewrites ${pluginRewrites.toLocaleString()}  (the harness's own tool-result pruner writes the same surfaceOp shape; its ${attrib.harnessPruner.toLocaleString()} are not this plugin's work)`)
console.log(`non-tool-result surface replaces ${t.otherSurfaceReplaces.toLocaleString()}  (session compaction; not tool-result rewrites)`)
console.log(`dedup pointer results ${t.pointerEvents.toLocaleString()} of ${report.corpus.toolResults.toLocaleString()} tool results`)
console.log(`duplicate outputs ${t.duplicateOutputs.toLocaleString()}  duplicate chars ${t.duplicateChars.toLocaleString()} (exact: the replaced duplicate bodies)`)
console.log(`~${Math.round(t.duplicateSavedCharsApprox / CHARS_PER_TOKEN).toLocaleString()} tokens (approx, upper bound: if every later request had re-sent each duplicate; not a measured saving)`)
console.log(`marker mentions ${report.corpus.markerMentions.toLocaleString()}  of which ${report.corpus.markerEcho.toLocaleString()} no rewrite record = echo of the marker string  (reference only, not a saving)`)
console.log(`engine injected chars ${t.injectedChars.toLocaleString()}  nudges ${t.nudges.toLocaleString()}`)
console.log(`guard turns ${t.turnSummaries.toLocaleString()}, with tool calls ${t.turnsWithToolCalls.toLocaleString()}, tool calls seen ${t.guardToolCalls.toLocaleString()}`)

console.log('\n== windowed activity ==')
console.log(`last 24h  plugin rewrites ${t.window.pluginRewrite24h.toLocaleString()}  (all structural rewrites incl. harness ${(t.window.pluginRewrite24h + t.window.harnessRewrite24h + t.window.unattributedRewrite24h).toLocaleString()})  dedup pointers ${t.window.pointer24h.toLocaleString()}`)
console.log(`last 7d   plugin rewrites ${t.window.pluginRewrite7d.toLocaleString()}  (all structural rewrites incl. harness ${(t.window.pluginRewrite7d + t.window.harnessRewrite7d + t.window.unattributedRewrite7d).toLocaleString()})  dedup pointers ${t.window.pointer7d.toLocaleString()}`)
if (t.timestamps.untimedRewrites > 0 || t.timestamps.untimedEvents > 0) {
  console.log(`no timestamp: ${t.timestamps.untimedRewrites.toLocaleString()} rewrites have neither an event time nor a log mtime (excluded from the windows)`)
} else {
  console.log(`timestamps: event time (ms) with session-log mtime fallback; ${t.timestamps.mtimeFallbacks.toLocaleString()} observations used the fallback`)
}

console.log('\n== per repository ==')
for (const repo of engine.repos) {
  console.log(`  ${repo.repo.padEnd(36)} proposal=${JSON.stringify(repo.proposal)} turns=${repo.turnSummaries} turnsWithToolCalls=${repo.turnsWithToolCalls} nudges=${repo.nudges} injectedChars=${repo.injectedChars}`)
}
console.log('\n== per provider route ==')
for (const p of report.providers) console.log(`  ${p.route.padEnd(52)} requests=${String(p.requests).padStart(6)} prompt=${p.prompt.toLocaleString().padStart(16)} over1M=${p.over1M}`)
console.log('\n== top sessions by cache-read cost ==')
for (const s of report.topSessions) {
  console.log(`  ${s.id.slice(0, 26).padEnd(28)} reqs=${String(s.requests).padStart(5)} cacheRead=${s.cacheRead.toLocaleString().padStart(13)} maxPrompt=${s.maxPrompt.toLocaleString().padStart(11)} toolChars=${s.toolChars.toLocaleString()} rewrites=${s.rewrittenResults}`)
}

const jsonIndex = process.argv.indexOf('--json')
if (jsonIndex !== -1 && process.argv[jsonIndex + 1]) {
  const target = process.argv[jsonIndex + 1]
  // A read-only measurement must not create files inside the home it is reading.
  if (resolve(target).startsWith(resolve(DSH_HOME) + sep)) {
    console.error('[measure] refusing --json inside DSH_HOME (' + target + '); pass an output path outside it')
    process.exit(2)
  }
  writeFileSync(target, `${JSON.stringify(report, null, 1)}\n`)
}
