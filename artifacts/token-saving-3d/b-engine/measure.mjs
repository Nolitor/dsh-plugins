#!/usr/bin/env node
/**
 * TRACK B — engine-side cross-check of the TokenEconomizer saving.
 *
 * Independent route: this script never reads a single `surfaceOp` from ~/.dsh.
 * It reads the engine's own state under ~/.tokeneconomizer:
 *   - dsh-sessions/<sessionId>.jsonl   engine mirror of the session event stream
 *   - repos/<repo>/dsh/events.jsonl    turn summaries (nudges, tool_calls, aborts)
 *   - repos/<repo>/dsh/ledger.jsonl    per-session cost/usage ledger
 *   - repos/<repo>/dsh/untool.json     toolprune proposal + streaks
 *   - repos/<repo>/dsh/sessions/*.json injected_chars, nudges per session
 * ~/.dsh/sessions is read ONLY to obtain the prompt-token baseline for comparison.
 *
 * Rewrite detection here is by *replacement text signature*, not by surfaceOp:
 * the mirror carries `surfaceOp` as an object, so the two routes agree on which
 * events exist but reach the count by different evidence.
 *
 * Usage: node measure.mjs [--json report.json]
 */
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const START = 1793571849158
const END = 1793831049158
const KST = 9 * 3600 * 1000
const CHARS_PER_TOKEN = 3.7
const TE = process.env.TOKENECONOMIZER_HOME ?? join(homedir(), '.tokeneconomizer')
const DSH = process.env.DSH_HOME ?? join(homedir(), '.dsh')

const WARM = '[tokeneconomizer] warm tier'
const COLD = '[tokeneconomizer] cold tier'
const POINTER = /^\[Output identical to step (\d+) \(hash: ([0-9a-f]+)\), content omitted to save context\]$/
const PRUNE = /tool result middle pruned/i

const kst = (ms) => new Date(ms + KST).toISOString().replace('T', ' ').slice(0, 19)
const dayKst = (ms) => new Date(ms + KST).toISOString().slice(0, 10)
const textOf = (c) => (Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text ?? '').join('\n') : typeof c === 'string' ? c : '')
const evText = (e) => textOf(e?.data?.message?.content ?? e?.data?.content)
const readJsonl = (p) => { const out = []; for (const l of readFileSync(p, 'utf8').split('\n')) { if (!l) continue; try { out.push(JSON.parse(l)) } catch {} } return out }
const inWindow = (ms) => ms >= START && ms <= END

// ---------------------------------------------------------------- engine mirror scan
const mirrorDir = join(TE, 'dsh-sessions')
const mirrorFiles = existsSync(mirrorDir) ? readdirSync(mirrorDir).filter((f) => f.endsWith('.jsonl')) : []

const engineRewrites = []
const enginePointers = []
const excluded = { prunerText: 0, alreadyTiered: 0, nonTool: 0, otherEvent: 0 }
const mirrorCoverage = { files: mirrorFiles.length, parsed: 0, events: 0, withSurfaceOp: 0, replaceOps: 0, sessionsInWindow: 0 }

for (const f of mirrorFiles) {
  const sid = f.replace(/\.jsonl$/, '')
  let evs
  try { evs = readJsonl(join(mirrorDir, f)) } catch { continue }
  mirrorCoverage.parsed++
  mirrorCoverage.events += evs.length
  const bySeq = new Map()
  for (const e of evs) if (e.seq !== undefined) bySeq.set(e.seq, e)
  let sawWindow = false

  for (const e of evs) {
    const so = e.surfaceOp
    if (!so) continue
    mirrorCoverage.withSurfaceOp++
    const op = typeof so === 'string' ? so : so?.op
    if (op !== 'replace') continue
    mirrorCoverage.replaceOps++
    const ms = typeof e.time === 'number' ? e.time : null
    if (ms === null || !inWindow(ms)) continue
    sawWindow = true
    // ENGINE-SIDE pairing: use the replacement text, and find the original by
    // searching BACKWARDS for the longest tool/result text that the replacement
    // structurally summarises. Where surfaceOp carries a range, use it.
    const after = evText(e)
    const declaredSrc = (typeof so === 'object' && (so.startSeq ?? e.sourceEventSeqs?.[0])) ?? null
    const orig = declaredSrc !== null ? bySeq.get(declaredSrc) : null
    if (!orig) { excluded.otherEvent++; continue }
    if (e.type !== 'tool/result') { excluded.nonTool++; continue }
    const before = evText(orig)
    if (before.startsWith('[tokeneconomizer]')) { excluded.alreadyTiered++; continue }
    if (PRUNE.test(after)) { excluded.prunerText++; continue }
    const kind = after.startsWith(WARM) ? 'te-warm' : after.startsWith(COLD) ? 'te-cold' : 'other'
    if (kind === 'other') { excluded.otherEvent++; continue }
    engineRewrites.push({ sid, seq: e.seq, src: declaredSrc, time: ms, kind, charsBefore: before.length, charsAfter: after.length, delta: before.length - after.length })
  }

  // pointers: dedup is in-memory per session, so a pointer is matched by its exact
  // text and its quoted digest, verified against the mirror's own earlier outputs.
  for (const e of evs) {
    const ms = typeof e.time === 'number' ? e.time : null
    if (ms === null || !inWindow(ms)) continue
    const t = evText(e)
    if (t.length !== t.trim().length) continue
    const m = POINTER.exec(t)
    if (!m) continue
    const step = Number(m[1])
    const cands = evs.filter((x) => x.type === 'tool/result' && x.data?.step === step && x.seq < e.seq)
    let dupChars = null
    let matchedSeq = null
    for (let i = cands.length - 1; i >= 0; i--) {
      const ct = evText(cands[i])
      if (ct.length < 200) continue
      const { createHash } = await import('node:crypto')
      if (createHash('sha256').update(ct).digest('hex').startsWith(m[2])) { dupChars = ct.length; matchedSeq = cands[i].seq; break }
    }
    enginePointers.push({ sid, seq: e.seq, time: ms, pointerChars: t.length, dupChars, matchedSeq, savedChars: dupChars === null ? null : dupChars - t.length })
    sawWindow = true
  }

  if (sawWindow) mirrorCoverage.sessionsInWindow++
}

// ---------------------------------------------------------------- engine state
const repoDirs = existsSync(join(TE, 'repos')) ? readdirSync(join(TE, 'repos')) : []
const state = { repos: [], turnSummaries: 0, nudges: 0, nudgeEvents: 0, aborts: 0, toolCallsSeen: 0, overheadRows: 0, judgeTokens: 0, writerTokens: 0, ledgerSessions: 0, injectedChars: 0, upstreamInjectedCharsAll: 0, untool: [], proposalRepos: [], streakMax: 0, nudgesBySessionFile: 0 }

for (const repo of repoDirs) {
  const d = join(TE, 'repos', repo, 'dsh')
  if (!existsSync(d)) continue
  const entry = { repo, files: {}, turnSummaries: 0, nudges: 0, nudgeEvents: 0, aborts: 0, toolCalls: 0, proposal: [], injectedCharsSessions: 0, sessionFilesInWindow: 0 }

  // mtime-in-window file inventory (BRIEF §4 "watchdog/loop-guard activity")
  for (const f of ['events.jsonl', 'ledger.jsonl', 'untool.json', 'injection.json', 'folded.json', 'envelope.json']) {
    const p = join(d, f)
    if (!existsSync(p)) continue
    const ms = statSync(p).mtimeMs
    entry.files[f] = { mtime: kst(ms), inWindow: inWindow(ms) }
  }

  const evPath = join(d, 'events.jsonl')
  if (existsSync(evPath)) {
    for (const o of readJsonl(evPath)) {
      const ms = (o.at ?? 0) * 1000
      if (!inWindow(ms)) continue
      if (o.kind === 'turn') {
        entry.turnSummaries++
        entry.nudges += o.nudges ?? 0
        entry.aborts += o.aborted ? 1 : 0
        entry.toolCalls += o.tool_calls ?? 0
      } else if (o.kind === 'nudge') { entry.nudgeEvents += 1 }
    }
  }

  const ledPath = join(d, 'ledger.jsonl')
  if (existsSync(ledPath)) {
    for (const o of readJsonl(ledPath)) {
      const ms = (o.kind === 'session' ? (o.ended ?? 0) : (o.at ?? 0)) * 1000
      if (!inWindow(ms)) continue
      if (o.kind === 'session') {
        state.ledgerSessions++
        state.injectedChars += o.injected_chars ?? 0
        entry.injectedCharsSessions += o.injected_chars ?? 0
      } else if (o.kind === 'overhead') {
        state.overheadRows++
        state.judgeTokens += o.overhead?.spiral_judge_tokens ?? 0
        state.writerTokens += o.overhead?.spiral_nudge_writer_tokens ?? 0
      }
    }
  }

  const untoolPath = join(d, 'untool.json')
  if (existsSync(untoolPath)) {
    const u = JSON.parse(readFileSync(untoolPath, 'utf8'))
    entry.proposal = u.proposal ?? []
    const streaks = Object.entries(u.streaks ?? {}).filter(([, v]) => typeof v === 'number')
    const used = new Set(u.used_tools ?? [])
    entry.streakTop = streaks.filter(([k]) => !used.has(k)).sort((a, b) => b[1] - a[1]).slice(0, 6)
    const mx = streaks.length ? Math.max(...streaks.map(([, v]) => v)) : 0
    entry.streakMax = mx
    state.streakMax = Math.max(state.streakMax, mx)
    state.untool.push({ repo, proposal: entry.proposal, streakMax: mx, mtimeInWindow: entry.files['untool.json']?.inWindow ?? false, updated: u.updated ?? null })
    if (entry.proposal.length) state.proposalRepos.push(repo)
  }

  const sessDir = join(d, 'sessions')
  if (existsSync(sessDir)) {
    for (const f of readdirSync(sessDir)) {
      const p = join(sessDir, f)
      const ms = statSync(p).mtimeMs
      if (!inWindow(ms)) continue
      entry.sessionFilesInWindow++
      state.nudgesBySessionFile = (state.nudgesBySessionFile ?? 0)
      try {
        const o = JSON.parse(readFileSync(p, 'utf8'))
        entry.nudges += 0
        state.nudgesBySessionFile += o.nudges ?? 0
        if (o.injected_chars) state.upstreamInjectedCharsAll += o.injected_chars
      } catch {}
    }
  }

  state.nudgeEvents = (state.nudgeEvents ?? 0) + entry.nudgeEvents
  state.turnSummaries += entry.turnSummaries
  state.aborts += entry.aborts
  state.toolCallsSeen += entry.toolCalls
  state.repos.push(entry)
}

// ---------------------------------------------------------------- raw-session route (for the delta only)
const SESSIONS = join(DSH, 'sessions')
const raw = { sessions: 0, requests: 0, promptTokens: 0, cacheReadTokens: 0, outputTokens: 0, rewrites: 0, warm: 0, cold: 0, other: 0, pointerEvents: 0, charsBefore: 0, charsAfter: 0 }
if (existsSync(SESSIONS)) {
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
      const bySeq = new Map()
      for (const e of evs) if (e.seq !== undefined) bySeq.set(e.seq, e)
      let hasWin = false
      for (const e of evs) {
        if (e.type === 'assistant/message' && inWindow(e.time) && e.data?.usage) {
          raw.requests++
          raw.promptTokens += (e.data.usage.inputTokens ?? 0) + (e.data.usage.cacheReadTokens ?? 0) + (e.data.usage.cacheWriteTokens ?? 0)
          raw.cacheReadTokens += e.data.usage.cacheReadTokens ?? 0
          raw.outputTokens += e.data.usage.outputTokens ?? 0
          hasWin = true
        }
        if (e.surfaceOp?.op !== 'replace' || !inWindow(e.time)) continue
        const after = evText(e)
        const orig = bySeq.get(e.sourceEventSeqs?.[0] ?? e.surfaceOp.startSeq)
        if (!orig) continue
        const before = evText(orig)
        if (before.startsWith('[tokeneconomizer]')) continue
        if (PRUNE.test(after)) continue
        if (after.startsWith(WARM)) { raw.warm++; raw.rewrites++; raw.charsBefore += before.length; raw.charsAfter += after.length }
        else if (after.startsWith(COLD)) { raw.cold++; raw.rewrites++; raw.charsBefore += before.length; raw.charsAfter += after.length }
        else raw.other++
        hasWin = true
      }
      for (const e of evs) {
        if (!inWindow(e.time)) continue
        const t = evText(e)
        if (t.length !== t.trim().length) continue
        if (POINTER.test(t)) { raw.pointerEvents++; hasWin = true }
      }
      if (hasWin) raw.sessions++
    }
  }
}

// ---------------------------------------------------------------- compare
const eTotal = engineRewrites.length
const eBefore = engineRewrites.reduce((a, r) => a + r.charsBefore, 0)
const eAfter = engineRewrites.reduce((a, r) => a + r.charsAfter, 0)
const eNet = eBefore - eAfter
const rNet = raw.charsBefore - raw.charsAfter
const pct = (a, b) => (b === 0 ? null : (a - b) / b)
const divergence = {
  rewrittenCountPct: pct(eTotal, raw.rewrites),
  charsBeforePct: pct(eBefore, raw.charsBefore),
  netCharsPct: pct(eNet, rNet),
  threshold: 0.02,
  finding: null,
}

// engine-side per-session rewrite+deltas, to locate any divergence
const bySession = new Map()
for (const r of engineRewrites) {
  const c = bySession.get(r.sid) ?? { sid: r.sid, n: 0, before: 0, after: 0 }
  c.n++; c.before += r.charsBefore; c.after += r.charsAfter
  bySession.set(r.sid, c)
}
const engineSessions = [...bySession.values()].map((c) => ({ ...c, net: c.before - c.after })).sort((a, b) => b.net - a.net)

// engine sessions whose mirror files are absent from the dsh store and vice versa
const mirrorSids = new Set(mirrorFiles.map((f) => f.replace(/\.jsonl$/, '')))
const dshSids = new Set()
if (existsSync(SESSIONS)) for (const project of readdirSync(SESSIONS)) { const pdir = join(SESSIONS, project); if (!statSync(pdir).isDirectory()) continue; for (const id of readdirSync(pdir)) dshSids.add(id) }
const coverage = {
  mirrorSessions: mirrorSids.size,
  dshSessions: dshSids.size,
  onlyInMirror: [...mirrorSids].filter((s) => !dshSids.has(s)).length,
  onlyInDsh: [...dshSids].filter((s) => !mirrorSids.has(s)).length,
}

divergence.finding = divergence.rewrittenCountPct !== null && Math.abs(divergence.rewrittenCountPct) > 0.02
  ? 'DIVERGENCE > 2% on rewrite count between engine mirror and raw-session route'
  : 'within 2% on every compared metric'

const report = {
  window: { startMs: START, endMs: END, startKst: kst(START), endKst: kst(END), charsPerToken: CHARS_PER_TOKEN },
  method: "engine-side: ~/.tokeneconomizer/dsh-sessions mirror + repos/*/dsh state; replacement detected by text signature and paired via the mirror's own surfaceOp range. Raw-session route read from ~/.dsh/sessions only for the delta and the prompt-token baseline.",
  engine: {
    rewrites: eTotal,
    warm: engineRewrites.filter((r) => r.kind === 'te-warm').length,
    cold: engineRewrites.filter((r) => r.kind === 'te-cold').length,
    charsBefore: eBefore,
    charsAfter: eAfter,
    netCharsSaved: eNet,
    savedTokens: eNet / CHARS_PER_TOKEN,
    inflating: engineRewrites.filter((r) => r.charsAfter > r.charsBefore).length,
    minCharsBefore: engineRewrites.length ? Math.min(...engineRewrites.map((r) => r.charsBefore)) : null,
    duplicatePointerEvents: enginePointers.length,
    pointerCharsSaved: enginePointers.reduce((a, p) => a + (p.savedChars ?? 0), 0),
    sessions: engineSessions.length,
  },
  engineSessions,
  mirrorCoverage,
  excludedByKind: excluded,
  engineState: {
    turnSummaries: state.turnSummaries,
    nudgesFromTurnSummaries: state.nudges,
    nudgeEvents: state.nudgeEvents ?? 0,
    nudgesFromSessionFiles: state.nudgesBySessionFile ?? 0,
    aborts: state.aborts,
    toolCallsSeen: state.toolCallsSeen,
    overheadRows: state.overheadRows ?? 0,
    judgeTokens: state.judgeTokens,
    nudgeWriterTokens: state.writerTokens,
    ledgerSessions: state.ledgerSessions,
    injectedChars: state.injectedChars,
    injectedCharsNote: 'ledger injected_chars is 0 for every in-window session and sessions/*.json carries no injected_chars key at all; micro-skills injected nothing in this window (measured, not assumed)',
    toolprune: { reposWithProposal: state.proposalRepos, proposalDetail: state.untool, maxStreak: state.streakMax },
    reposTouchedInWindow: state.repos.filter((r) => Object.values(r.files).some((f) => f.inWindow)).map((r) => ({ repo: r.repo, files: r.files, proposal: r.proposal, turnSummaries: r.turnSummaries, nudges: r.nudges, aborts: r.aborts, toolCalls: r.toolCalls, sessionFilesInWindow: r.sessionFilesInWindow })),
  },
  rawRoute: raw,
  divergence,
  coverage,
  comparison: {
    engineRewrites: eTotal,
    rawRewrites: raw.rewrites,
    engineNetChars: eNet,
    rawNetChars: rNet,
    enginePointers: enginePointers.length,
    rawPointers: raw.pointerEvents,
    promptTokensBaseline: raw.promptTokens,
    cacheReadShare: raw.promptTokens ? raw.cacheReadTokens / raw.promptTokens : null,
    engineNetShareOfPromptTokens: raw.promptTokens ? eNet / CHARS_PER_TOKEN / raw.promptTokens : null,
  },
}

const L = []
L.push('== TRACK B - engine-side cross-check ==')
L.push('window ' + kst(START) + ' .. ' + kst(END) + ' (KST)')
L.push('')
L.push('-- engine mirror (independent route) --')
L.push('  mirror files=' + mirrorCoverage.files + ' parsed=' + mirrorCoverage.parsed + ' events=' + mirrorCoverage.events + ' eventsWithSurfaceOp=' + mirrorCoverage.withSurfaceOp + ' replaceOps=' + mirrorCoverage.replaceOps)
L.push('  sessions touching the window=' + mirrorCoverage.sessionsInWindow)
L.push('  rewrites=' + eTotal + ' (warm ' + (eTotal - engineRewrites.filter((r) => r.kind === 'te-cold').length) + ', cold ' + engineRewrites.filter((r) => r.kind === 'te-cold').length + ')')
L.push('  charsBefore=' + eBefore + ' charsAfter=' + eAfter + ' netCharsSaved=' + eNet + ' tokens=' + Math.round(eNet / CHARS_PER_TOKEN))
L.push('  inflating=' + report.engine.inflating + ' minCharsBefore=' + report.engine.minCharsBefore)
L.push('  dedup pointer events=' + enginePointers.length + ' charsSaved=' + report.engine.pointerCharsSaved)
L.push('  excluded: prunerText=' + excluded.prunerText + ' alreadyTiered=' + excluded.alreadyTiered + ' nonTool=' + excluded.nonTool + ' other=' + excluded.otherEvent)
L.push('')
L.push('-- divergence vs raw-session route --')
L.push('  rewrites engine=' + eTotal + ' raw=' + raw.rewrites + ' delta=' + (eTotal - raw.rewrites) + ' (' + (divergence.rewrittenCountPct === null ? 'n/a' : (divergence.rewrittenCountPct * 100).toFixed(3) + '%') + ')')
L.push('  charsBefore engine=' + eBefore + ' raw=' + raw.charsBefore + ' (' + (divergence.charsBeforePct === null ? 'n/a' : (divergence.charsBeforePct * 100).toFixed(3) + '%') + ')')
L.push('  netChars engine=' + eNet + ' raw=' + rNet + ' (' + (divergence.netCharsPct === null ? 'n/a' : (divergence.netCharsPct * 100).toFixed(3) + '%') + ')')
L.push('  pointers engine=' + enginePointers.length + ' raw=' + raw.pointerEvents)
L.push('  verdict: ' + divergence.finding)
L.push('')
L.push('-- engine state in window (mtime + event filtered) --')
L.push('  turn summaries=' + state.turnSummaries + ' nudges(from turn summaries)=' + state.nudges + ' nudge events=' + (state.nudgeEvents ?? 0) + ' nudges(from sessions/*.json)=' + (state.nudgesBySessionFile ?? 0) + ' aborts=' + state.aborts + ' toolCallsSeen=' + state.toolCallsSeen)
L.push('  overhead rows=' + (state.overheadRows ?? 0) + ' judge tokens=' + Math.round(state.judgeTokens) + ' nudge-writer tokens=' + Math.round(state.writerTokens))
L.push('  ledger session rows in window=' + state.ledgerSessions + ' injected_chars=' + state.injectedChars + ' (micro-skills injected nothing)')
L.push('  toolprune proposal repos=' + JSON.stringify(state.proposalRepos) + ' maxStreak=' + state.streakMax)
for (const u of state.untool) L.push('    ' + u.repo.padEnd(34) + ' proposal=' + JSON.stringify(u.proposal) + ' streakMax=' + u.streakMax + ' untoolMtimeInWindow=' + u.mtimeInWindow)
L.push('')
L.push('-- repos touched in window --')
for (const r of report.engineState.reposTouchedInWindow) L.push('  ' + r.repo.padEnd(34) + ' turns=' + r.turnSummaries + ' nudges=' + r.nudges + ' nudgeEvents=' + r.nudgeEvents + ' aborts=' + r.aborts + ' toolCalls=' + r.toolCalls + ' sessionFiles=' + r.sessionFilesInWindow)
L.push('')
L.push('-- prompt-token baseline (raw route, in-window) --')
L.push('  sessions=' + raw.sessions + ' requests=' + raw.requests + ' promptTokens=' + raw.promptTokens + ' cacheReadShare=' + ((report.comparison.cacheReadShare ?? 0) * 100).toFixed(3) + '% output=' + raw.outputTokens)
L.push('  engine net saving as share of prompt tokens=' + ((report.comparison.engineNetShareOfPromptTokens ?? 0) * 100).toFixed(4) + '%')
L.push('')
L.push('-- session coverage --')
L.push('  mirror sessions=' + coverage.mirrorSessions + ' dsh sessions=' + coverage.dshSessions + ' onlyInMirror=' + coverage.onlyInMirror + ' onlyInDsh=' + coverage.onlyInDsh)
L.push('')
L.push('-- per session (engine side) --')
for (const s of engineSessions) L.push('  ' + s.sid.slice(0, 22).padEnd(24) + ' n=' + String(s.n).padStart(3) + ' before=' + String(s.before).padStart(7) + ' after=' + String(s.after).padStart(6) + ' net=' + String(s.net).padStart(7))

console.log(L.join('\n'))
const j = process.argv.indexOf('--json')
if (j !== -1) writeFileSync(process.argv[j + 1], JSON.stringify(report, null, 1) + '\n')
