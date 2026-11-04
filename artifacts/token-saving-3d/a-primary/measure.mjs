#!/usr/bin/env node
/**
 * TRACK A — primary rewrite measurement for the TokenEconomizer 3-day window.
 *
 * Method (BRIEF.md §2, Lead-verified shape):
 *   a plugin rewrite is a tool/result event carrying
 *   surfaceOp = { op:'replace', startSeq:S, endSeq:S } and sourceEventSeqs = [S];
 *   the original event seq===S is still present in the same append-only log, so
 *   charsBefore / charsAfter are exact text lengths of the two events.
 *
 * Read-only on ~/.dsh. Usage: node measure.mjs [--json report.json]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { createHash } from 'node:crypto'

const START = 1793571849158 // 2026-11-02T07:24:09+09:00
const END = 1793831049158 // 2026-11-05T07:24:09+09:00
const KST = 9 * 3600 * 1000
const CHARS_PER_TOKEN = 3.7
const SESSIONS = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')

const WARM = '[tokeneconomizer] warm tier'
const COLD = '[tokeneconomizer] cold tier'
const POINTER = /^\[Output identical to step (\d+) \(hash: ([0-9a-f]+)\), content omitted to save context\]$/
const PRUNE = /tool result middle pruned/i

const FLOOR = 3700 // tierMinChars: live cordis.patch.yml, raised by d1547b9 (2026-11-02 07:48:05 +09)
const PRIOR_FLOOR = 3000

const textOf = (c) =>
  Array.isArray(c)
    ? c.filter((b) => b && b.type === 'text').map((b) => b.text ?? '').join('\n')
    : typeof c === 'string' ? c : ''
const textsOfEvent = (e) => textOf(e?.data?.message?.content ?? e?.data?.content)
const kst = (ms) => new Date(ms + KST).toISOString().replace('T', ' ').slice(0, 19)
const dayKst = (ms) => new Date(ms + KST).toISOString().slice(0, 10)

/** Latest snapshot per session dir (skip *.bak*). */
function sessionDirs () {
  const out = []
  for (const project of readdirSync(SESSIONS)) {
    const pdir = join(SESSIONS, project)
    if (!statSync(pdir).isDirectory()) continue
    for (const id of readdirSync(pdir)) {
      const dir = join(pdir, id)
      if (!statSync(dir).isDirectory()) continue
      const snaps = readdirSync(dir).filter((f) => f.startsWith('session.v4.jsonl.zstd') && !f.includes('bak')).sort()
      if (!snaps.length) continue
      out.push({ project, id, file: join(dir, snaps.at(-1)), snapshots: snaps.length })
    }
  }
  return out
}

function readEvents (file) {
  const raw = zstdDecompressSync(readFileSync(file)).toString('utf8')
  const evs = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    try { evs.push(JSON.parse(line)) } catch { /* torn tail */ }
  }
  return evs
}

/** Turn number in force at a seq (last turn/start at or before it). */
function turnIndex (events) {
  const starts = events.filter((e) => e.type === 'turn/start').map((e) => ({ seq: e.seq, turn: e.data?.turn })).sort((a, b) => a.seq - b.seq)
  return (seq) => {
    let best = null
    for (const s of starts) { if (s.seq < seq) best = s; else break }
    return best?.turn ?? null
  }
}

const isFixture = (cwd, project) =>
  /^\/tmp\//.test(cwd ?? '') ||
  /(^|\/)(te-side-|benchtest-|ab-current-)/.test(cwd ?? '') ||
  /\bte-side-|\bbenchtest-|\bab-current-/.test(project)

const rewriteUnits = []
const pointerUnits = []
const corpus = []
const fixtureRewrites = []
const excluded = { alreadyTiered: 0, prunerText: 0, duplicateSnapshot: 0 }
const seen = new Set()

for (const s of sessionDirs()) {
  const evs = readEvents(s.file)
  if (!evs.length) continue
  const header = evs.find((e) => e.type === 'session') ?? {}
  const cwd = header.cwd ?? ''
  const fixture = isFixture(cwd, s.project)
  const bySeq = new Map()
  for (const e of evs) if (e.seq !== undefined) bySeq.set(e.seq, e)
  const at = turnIndex(evs)

  for (const e of evs) {
    if (e.surfaceOp?.op !== 'replace') continue
    const key = s.project + '|' + s.id + '|' + e.seq
    if (seen.has(key)) { excluded.duplicateSnapshot++; continue }
    seen.add(key)
    if (!(e.time >= START && e.time <= END)) continue
    const after = textsOfEvent(e)
    const src = e.sourceEventSeqs?.[0] ?? e.surfaceOp.startSeq
    const orig = bySeq.get(src)
    if (!orig) continue
    const before = textsOfEvent(orig)
    if (before.startsWith('[tokeneconomizer]')) { excluded.alreadyTiered++; continue }
    if (PRUNE.test(after)) { excluded.prunerText++; continue }

    const kind = after.startsWith(WARM) ? 'te-warm'
      : after.startsWith(COLD) ? 'te-cold'
        : POINTER.test(after.trim()) ? 'te-dedup-pointer'
          : 'other'
    const rec = {
      project: s.project, session: s.id, cwd, fixture,
      seq: e.seq, src, time: e.time, at: kst(e.time), kind,
      charsBefore: before.length, charsAfter: after.length,
      delta: before.length - after.length,
      turnAge: (at(e.seq) !== null && at(orig.seq) !== null) ? at(e.seq) - at(orig.seq) : null,
      head: after.slice(0, 80).replace(/\s+/g, ' '),
      laterRequests: evs.filter((x) => x.type === 'assistant/message' && x.seq > e.seq && x.time <= END).length,
    }
    ;(fixture ? fixtureRewrites : rewriteUnits).push(rec)
  }

  // dedup pointers: exact pointer text as the whole event text
  for (const e of evs) {
    if (!(e.time >= START && e.time <= END)) continue
    const t = textsOfEvent(e)
    if (t.length !== t.trim().length) continue
    const m = POINTER.exec(t)
    if (!m) continue
    const step = Number(m[1])
    const cands = evs.filter((x) => x.type === 'tool/result' && x.data?.step === step && x.seq < e.seq)
    let dupChars = null
    let matchedSeq = null
    for (let i = cands.length - 1; i >= 0; i--) {
      const ct = textsOfEvent(cands[i])
      if (ct.length < 200) continue
      if (createHash('sha256').update(ct).digest('hex').startsWith(m[2])) { dupChars = ct.length; matchedSeq = cands[i].seq; break }
    }
    pointerUnits.push({
      project: s.project, session: s.id, seq: e.seq, time: e.time, at: kst(e.time), fixture,
      pointerChars: t.length, dupChars, matchedSeq,
      savedChars: dupChars === null ? null : dupChars - t.length,
      laterRequests: evs.filter((x) => x.type === 'assistant/message' && x.seq > e.seq && x.time <= END).length,
    })
  }

  const u = { project: s.project, session: s.id, cwd, fixture, origin: header.origin ?? '', requests: 0, promptTokens: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }
  for (const e of evs) {
    if (e.type !== 'assistant/message') continue
    if (!(e.time >= START && e.time <= END)) continue
    const g = e.data?.usage
    if (!g) continue
    u.requests++
    u.inputTokens += g.inputTokens ?? 0
    u.cacheReadTokens += g.cacheReadTokens ?? 0
    u.cacheWriteTokens += g.cacheWriteTokens ?? 0
    u.outputTokens += g.outputTokens ?? 0
    u.promptTokens += (g.inputTokens ?? 0) + (g.cacheReadTokens ?? 0) + (g.cacheWriteTokens ?? 0)
  }
  if (u.requests) corpus.push(u)
}

const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0)
const te = rewriteUnits.filter((r) => r.kind === 'te-warm' || r.kind === 'te-cold')
const warm = te.filter((r) => r.kind === 'te-warm')
const cold = te.filter((r) => r.kind === 'te-cold')
const other = rewriteUnits.filter((r) => r.kind === 'other')

const block = (rows) => {
  const before = sum(rows, (r) => r.charsBefore)
  const after = sum(rows, (r) => r.charsAfter)
  const infl = rows.filter((r) => r.charsAfter > r.charsBefore)
  return {
    rewrites: rows.length,
    charsBefore: before,
    charsAfter: after,
    netCharsSaved: before - after,
    savedTokens: (before - after) / CHARS_PER_TOKEN,
    inflating: infl.length,
    inflatingCharsAdded: sum(infl, (r) => r.charsAfter - r.charsBefore),
    meanCharsBefore: rows.length ? before / rows.length : null,
    minCharsBefore: rows.length ? Math.min(...rows.map((r) => r.charsBefore)) : null,
  }
}

// ---- cross-check: the harness emits one compaction/prune per surface replace,
// shadowing the ORIGINAL seq. A 1:1 signature is a second, independent witness of
// how many surfaces were replaced at all (TE and harness together).
const pruneSignature = (() => {
  let pruneEvents = 0; let shadowingTeOriginal = 0; let unmatched = 0
  const teSrc = new Set(rewriteUnits.filter((r) => r.kind === 'te-warm' || r.kind === 'te-cold').map((r) => r.src))
  for (const s of sessionDirs()) {
    let evs
    try { evs = readEvents(s.file) } catch { continue }
    for (const e of evs) {
      if (e.type !== 'compaction/prune') continue
      if (!(e.time >= START && e.time <= END)) continue
      pruneEvents++
      const seqs = e.data?.shadowedSeqs ?? []
      if (seqs.some((q) => teSrc.has(q))) shadowingTeOriginal++
      else unmatched++
    }
  }
  return { pruneEvents, shadowingTeOriginal, unmatched, minPerSourceEvent: 0 }
})()

const ltFloor = te.filter((r) => r.charsBefore < FLOOR)
const floorCheck = {
  floorAssumed: FLOOR,
  rewritesBelowFloor: ltFloor.length,
  minCharsBefore: te.length ? Math.min(...te.map((r) => r.charsBefore)) : null,
  note: 'floor bounds the INPUT; a rewrite with charsBefore < tierMinChars proves the older, lower floor was still live at that instant',
}

const ageHist = {}
for (const r of warm) ageHist[r.turnAge] = (ageHist[r.turnAge] ?? 0) + 1
const age5 = warm.filter((r) => r.turnAge !== null && r.turnAge <= 5)
const age6 = warm.filter((r) => r.turnAge !== null && r.turnAge >= 6)
const eraRow = (name, rows, evidence) => ({
  name,
  from: rows.length ? kst(Math.min(...rows.map((r) => r.time))) : null,
  to: rows.length ? kst(Math.max(...rows.map((r) => r.time))) : null,
  boundaryEvidence: evidence,
  ...block(rows),
})
const eras = [
  eraRow('E1 hot5+floor3700', age5, 'warm rewrites whose original turn is <=5 turns back: pre-5fba56a five-turn hot window'),
  eraRow('E2 hot6+floor3700', age6, 'warm rewrites at turn age >=6: six-turn hot window (5fba56a 08:42:19) live'),
]

const days = [...new Set(te.map((r) => dayKst(r.time)))].sort().map((d) => ({ day: d, ...block(te.filter((r) => dayKst(r.time) === d)) }))
const perProject = [...new Set(te.map((r) => r.project))].sort().map((p) => ({ project: p, ...block(te.filter((r) => r.project === p)) }))

const realCorpus = corpus.filter((c) => !c.fixture)
const fixtureCorpus = corpus.filter((c) => c.fixture)
const cov = {
  sessions: realCorpus.length,
  requests: sum(realCorpus, (c) => c.requests),
  promptTokens: sum(realCorpus, (c) => c.promptTokens),
  inputTokens: sum(realCorpus, (c) => c.inputTokens),
  cacheReadTokens: sum(realCorpus, (c) => c.cacheReadTokens),
  cacheWriteTokens: sum(realCorpus, (c) => c.cacheWriteTokens),
  outputTokens: sum(realCorpus, (c) => c.outputTokens),
}
cov.cacheReadShare = cov.promptTokens ? cov.cacheReadTokens / cov.promptTokens : null

const realPointers = pointerUnits.filter((p) => !p.fixture)
const dedupSaved = sum(realPointers, (p) => p.savedChars ?? 0)
const tierSavedChars = sum(te, (r) => r.delta)
const contextTokensRemoved = (tierSavedChars + dedupSaved) / CHARS_PER_TOKEN
const persistedTokens = sum(te, (r) => (r.delta / CHARS_PER_TOKEN) * r.laterRequests) + sum(realPointers, (p) => ((p.savedChars ?? 0) / CHARS_PER_TOKEN) * p.laterRequests)
const dedupTokensNotResent = sum(realPointers, (p) => ((p.savedChars ?? 0) / CHARS_PER_TOKEN) * p.laterRequests)

// ---- classifier validation against the BRIEF §2 verified sample (outside the window)
const validation = (() => {
  const expected = { seq: 1681, src: 35, charsBefore: 3932, charsAfter: 3338 }
  const hits = []
  for (const s of sessionDirs()) {
    let evs
    try { evs = readEvents(s.file) } catch { continue }
    const bySeq = new Map()
    for (const e of evs) if (e.seq !== undefined) bySeq.set(e.seq, e)
    const repl = bySeq.get(expected.seq)
    if (!repl || repl.surfaceOp?.op !== 'replace') continue
    const src = repl.sourceEventSeqs?.[0] ?? repl.surfaceOp.startSeq
    if (src !== expected.src) continue
    const after = textsOfEvent(repl)
    const before = textsOfEvent(bySeq.get(src))
    if (before.length !== expected.charsBefore || after.length !== expected.charsAfter) continue
    hits.push({ session: s.id, at: kst(repl.time), classifiedAs: after.startsWith(WARM) ? 'te-warm' : 'other' })
  }
  return {
    ok: hits.length >= 1,
    expected,
    hits,
    note: 'BRIEF §2 sample reproduced exactly (seq 1681 -> 35, 3932 -> 3338 chars). It lives in session-10518982-466..., NOT in 16358e59-... as the BRIEF states; 16358e59 has no seq 1681 at all (max seq 494). Shape claim holds, session attribution in the BRIEF is wrong.',
  }
})()

const report = {
  window: { startMs: START, endMs: END, startKst: kst(START), endKst: kst(END), charsPerToken: CHARS_PER_TOKEN },
  method: 'event pairing: surfaceOp.replace -> sourceEventSeqs[0] on the latest non-bak session.v4.jsonl.zstd per session dir; strict prefix classifier; attribution by replacement event.time; KST day buckets; fixtures excluded',
  classifierValidation: validation,
  tiering: { total: block(te), warm: block(warm), cold: block(cold) },
  eras,
  days,
  perProject,
  floorCheck,
  pruneSignature,
  turnAgeHistogram: Object.fromEntries(Object.entries(ageHist).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, v]) => [k === 'null' ? 'unknown' : k, v])),
  dedup: {
    pointerEvents: realPointers.length,
    pointerChars: sum(realPointers, (p) => p.pointerChars),
    duplicateCharsReplaced: sum(realPointers, (p) => p.dupChars ?? 0),
    charsSaved: dedupSaved,
    tokensNotReSent: dedupTokensNotResent,
    events: realPointers.map((p) => ({ session: p.session.slice(0, 18), seq: p.seq, at: p.at, dupChars: p.dupChars, savedChars: p.savedChars, laterRequests: p.laterRequests })),
  },
  excludedFromPluginTotals: {
    other: { count: other.length, charsBefore: sum(other, (r) => r.charsBefore), charsAfter: sum(other, (r) => r.charsAfter) },
    otherDetail: other.map((r) => ({ session: r.session.slice(0, 18), seq: r.seq, at: r.at, head: r.head.slice(0, 60), charsBefore: r.charsBefore, charsAfter: r.charsAfter })),
    alreadyTiered: excluded.alreadyTiered,
    prunerText: excluded.prunerText,
    duplicateSnapshot: excluded.duplicateSnapshot,
  },
  fixtures: {
    sessions: fixtureCorpus.length,
    requests: sum(fixtureCorpus, (c) => c.requests),
    promptTokens: sum(fixtureCorpus, (c) => c.promptTokens),
    rewrites: fixtureRewrites.length,
    ...block(fixtureRewrites),
  },
  corpus: cov,
  coverage: {
    tierSavedChars,
    dedupCharsSaved: dedupSaved,
    contextTokensRemoved: Math.round(contextTokensRemoved),
    shareOfPromptTokens: cov.promptTokens ? contextTokensRemoved / cov.promptTokens : null,
    persistedTokensNotResent: Math.round(persistedTokens),
    persistedShareOfPromptTokens: cov.promptTokens ? persistedTokens / cov.promptTokens : null,
    meanLaterRequests: te.length ? sum(te, (r) => r.laterRequests) / te.length : null,
  },
  sessionsWithRewrites: [...new Set(te.map((r) => r.session))].length,
  perSession: [...new Set(te.map((r) => r.session))].map((id) => {
    const rows = te.filter((r) => r.session === id)
    const c = corpus.find((x) => x.session === id)
    return { session: id.slice(0, 20), ...block(rows), promptTokens: c?.promptTokens ?? null, requests: c?.requests ?? null, laterRequestsMean: rows.length ? Math.round(sum(rows, (r) => r.laterRequests) / rows.length) : null }
  }).sort((a, b) => b.netCharsSaved - a.netCharsSaved),
  rewrites: te.map((r) => ({ session: r.session.slice(0, 20), seq: r.seq, src: r.src, at: r.at, kind: r.kind, charsBefore: r.charsBefore, charsAfter: r.charsAfter, turnAge: r.turnAge, laterRequests: r.laterRequests })),
}

const pct = (x) => (x === null || x === undefined ? 'n/a' : (x * 100).toFixed(3) + '%')
const L = []
L.push('== TRACK A - TokenEconomizer rewrite measurement ==')
L.push('window ' + kst(START) + ' .. ' + kst(END) + ' (KST)  startMs=' + START + ' endMs=' + END)
L.push('')
L.push('-- tiering (plugin rewrites only, fixtures excluded) --')
for (const pair of [['total', report.tiering.total], ['warm', report.tiering.warm], ['cold', report.tiering.cold]]) {
  const k = pair[0]; const b = pair[1]
  L.push('  ' + k.padEnd(5) + ' rewrites=' + String(b.rewrites).padStart(4) + ' charsBefore=' + String(b.charsBefore).padStart(8) + ' charsAfter=' + String(b.charsAfter).padStart(8) + ' netCharsSaved=' + String(b.netCharsSaved).padStart(8) + ' tokens=' + String(Math.round(b.savedTokens)).padStart(7) + ' inflating=' + b.inflating + ' addedChars=' + b.inflatingCharsAdded)
}
L.push('  meanCharsBefore=' + (report.tiering.total.meanCharsBefore === null ? 'n/a' : report.tiering.total.meanCharsBefore.toFixed(1)) + '  minCharsBefore=' + report.tiering.total.minCharsBefore)
L.push('')
L.push('-- floor check (charsBefore < tierMinChars => older lower floor still live) --')
L.push('  rewritesBelowFloor=' + floorCheck.rewritesBelowFloor + '  minCharsBefore observed=' + floorCheck.minCharsBefore)
L.push('')
L.push('-- prune signature (harness bookkeeping for each surface replace) --')
L.push('  compaction/prune in window=' + pruneSignature.pruneEvents + ' shadowing a TE original=' + pruneSignature.shadowingTeOriginal + ' unmatched=' + pruneSignature.unmatched + '  (1:1 with TE rewrites = ' + (pruneSignature.pruneEvents === report.tiering.total.rewrites) + ')')
L.push('')
L.push('-- eras (derived from turn age, not from git dates) --')
for (const e of eras) L.push('  ' + e.name.padEnd(18) + ' ' + e.from + ' .. ' + e.to + '  n=' + e.rewrites + ' before=' + e.charsBefore + ' after=' + e.charsAfter + ' net=' + e.netCharsSaved + ' inflating=' + e.inflating)
L.push('  turnAge histogram: ' + JSON.stringify(report.turnAgeHistogram))
L.push('')
L.push('-- per day (Asia/Seoul) --')
for (const d of days) L.push('  ' + d.day + '  n=' + String(d.rewrites).padStart(3) + ' before=' + String(d.charsBefore).padStart(7) + ' after=' + String(d.charsAfter).padStart(7) + ' net=' + String(d.netCharsSaved).padStart(7) + ' tokens=' + String(Math.round(d.savedTokens)).padStart(6) + ' inflating=' + d.inflating)
L.push('')
L.push('-- per project --')
for (const p of perProject) L.push('  ' + p.project.replace(/--/g, '').slice(0, 44).padEnd(46) + ' n=' + String(p.rewrites).padStart(3) + ' net=' + String(p.netCharsSaved).padStart(7))
L.push('')
L.push('-- dedup pointers (host-local, exact pointer text only) --')
L.push('  events=' + report.dedup.pointerEvents + ' pointerChars=' + report.dedup.pointerChars + ' duplicateCharsReplaced=' + report.dedup.duplicateCharsReplaced + ' charsSaved=' + report.dedup.charsSaved + ' tokensNotReSent=' + Math.round(report.dedup.tokensNotReSent))
for (const p of report.dedup.events) L.push('    ' + p.at + ' ' + p.session + ' seq=' + p.seq + ' dup=' + p.dupChars + ' saved=' + p.savedChars + ' laterRequests=' + p.laterRequests)
L.push('')
L.push('-- excluded from plugin totals --')
L.push('  other replace ops=' + report.excludedFromPluginTotals.other.count + ' before=' + report.excludedFromPluginTotals.other.charsBefore + ' after=' + report.excludedFromPluginTotals.other.charsAfter)
for (const o of report.excludedFromPluginTotals.otherDetail) L.push('    ' + o.at + ' ' + o.session + ' seq=' + o.seq + ' ' + o.charsBefore + '->' + o.charsAfter + ' ' + JSON.stringify(o.head))
L.push('  harness-pruner-text replacements=' + excluded.prunerText + '  alreadyTiered=' + excluded.alreadyTiered + '  duplicateSnapshots=' + excluded.duplicateSnapshot)
L.push('')
L.push('-- fixtures (excluded, reported separately) --')
L.push('  sessions=' + report.fixtures.sessions + ' requests=' + report.fixtures.requests + ' rewrites=' + report.fixtures.rewrites + ' promptTokens=' + report.fixtures.promptTokens)
L.push('')
L.push('-- corpus baseline (in-window assistant/message usage, real sessions) --')
L.push('  sessions=' + cov.sessions + ' requests=' + cov.requests + ' promptTokens=' + cov.promptTokens + ' cacheRead=' + cov.cacheReadTokens + ' (' + pct(cov.cacheReadShare) + ') input=' + cov.inputTokens + ' output=' + cov.outputTokens)
L.push('')
L.push('-- coverage / two lenses --')
L.push('  (a) context tokens removed = ' + Math.round(contextTokensRemoved) + '  = ' + pct(report.coverage.shareOfPromptTokens) + ' of window prompt tokens')
L.push('  (b) persisted tokens not re-sent = ' + Math.round(persistedTokens) + '  = ' + pct(report.coverage.persistedShareOfPromptTokens) + ' of window prompt tokens')
L.push('      (mean later assistant messages per rewrite = ' + (report.coverage.meanLaterRequests === null ? 'n/a' : report.coverage.meanLaterRequests.toFixed(1)) + ')')
L.push('')
L.push('-- sessions carrying the saving --')
for (const s of report.perSession) L.push('  ' + s.session.padEnd(22) + ' n=' + String(s.rewrites).padStart(3) + ' net=' + String(s.netCharsSaved).padStart(7) + ' prompt=' + s.promptTokens + ' reqs=' + s.requests + ' laterMean=' + s.laterRequestsMean)
L.push('')
L.push('')
L.push('-- classifier validation (BRIEF §2 sample, outside window) --')
L.push('  ' + (validation.ok ? 'PASS' : 'FAIL') + ' ' + JSON.stringify(validation.got ?? validation))
L.push('')
L.push('fixture exclusion rule: cwd under /tmp, or project dir matching te-side-* / benchtest-* / ab-current-*')

console.log(L.join('\n'))
const j = process.argv.indexOf('--json')
if (j !== -1) writeFileSync(process.argv[j + 1], JSON.stringify(report, null, 1) + '\n')
