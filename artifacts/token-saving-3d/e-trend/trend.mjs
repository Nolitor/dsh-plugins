/**
 * TRACK E — per-day trend and regime timeline for the DSH TokenEconomizer plugin.
 *
 * Independent day/hour time series over the shared 3-day window, built from the
 * harness session logs only (read-only). Method is the one in
 * artifacts/token-saving-3d/BRIEF.md: attribute every rewrite by the replacement
 * event's time, take charsBefore from the original tool/result event that the
 * surfaceOp points at, classify the replacement text strictly, and never count
 * the harness pruner as plugin saving.
 *
 * Usage: node trend.mjs [--json out.json] [--csv daily.csv]
 * Env:   DSH_HOME (default ~/.dsh), START_MS, END_MS
 */
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const SESSIONS = join(DSH_HOME, 'sessions')
const START_MS = Number(process.env.START_MS ?? 1793571849158)
const END_MS = Number(process.env.END_MS ?? 1793831049158)
const CHARS_PER_TOKEN = 3.7
const KST = 9 * 3600 * 1000 // Asia/Seoul has no DST

/** Text of an event's message content, in log order. */
const textOf = (e) => (e?.data?.message?.content ?? [])
  .map((b) => (b && b.type === 'text' ? b.text ?? '' : ''))
  .filter(Boolean).join('\n')

const WARM = /^\[tokeneconomizer\] warm tier:/
const COLD = /^\[tokeneconomizer\] cold tier:/
const POINTER = /^\[Output identical to step (\d+) \(hash: ([0-9a-f]+)\), content omitted to save context\]/
const PRUNE = 'tool result middle pruned'
const TE_PREFIX = '[tokeneconomizer]'

/** Fixture projects that are not real user traffic (BRIEF section 6). */
const FIXTURE_PROJECT = /(^|\/)(te-side-.*|benchtest-.*|ab-current-.*|tmp-.*|te-.*)$/

function readSessionLog (dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl.zstd')).sort()
  if (!files.length) return { events: [], files: [] }
  const path = join(dir, files.at(-1))
  const raw = zstdDecompressSync(readFileSync(path)).toString('utf8')
  return { events: raw.split('\n').filter(Boolean).map((l) => JSON.parse(l)), files }
}

function collectSessions () {
  const out = []
  if (!existsSync(SESSIONS)) return out
  for (const project of readdirSync(SESSIONS)) {
    const pdir = join(SESSIONS, project)
    try { if (!statSync(pdir).isDirectory()) continue } catch { continue }
    for (const id of readdirSync(pdir)) {
      const dir = join(pdir, id)
      try { if (!statSync(dir).isDirectory()) continue } catch { continue }
      let rec
      try { rec = readSessionLog(dir) } catch { continue }
      if (!rec.events.length) continue
      const header = rec.events.find((e) => e.type === 'session')
      out.push({
        project, id, dir,
        events: rec.events,
        files: rec.files,
        cwd: header?.cwd ?? '',
        createdAt: header?.createdAt ?? null,
        fixture: FIXTURE_PROJECT.test(project) || (header?.cwd ?? '').startsWith('/tmp/'),
      })
    }
  }
  return out
}

function base (e, session) {
  return {
    project: session.project,
    sessionId: session.id,
    cwd: session.cwd,
    fixture: session.fixture,
    seq: e.seq,
    sourceSeq: e.surfaceOp.startSeq,
    time: e.time,
    sessionTurn: null,
  }
}

/** One replacement row per surfaceOp replace, with both sides measured. */
function measureRewrites (session) {
  const bySeq = new Map()
  for (const e of session.events) if (!bySeq.has(e.seq)) bySeq.set(e.seq, e)
  const rows = []
  for (const e of session.events) {
    if (e.type !== 'tool/result') continue
    const op = e.surfaceOp
    if (!op || op.op !== 'replace') continue
    if (op.startSeq !== op.endSeq) continue
    const orig = bySeq.get(op.startSeq)
    if (!orig) continue
    const before = textOf(orig)
    const after = textOf(e)
    if (before.includes(PRUNE) || after.includes(PRUNE)) {
      rows.push({ ...base(e, session), kind: 'harness-prune', charsBefore: before.length, charsAfter: after.length })
      continue
    }
    if (before.startsWith(TE_PREFIX)) {
      rows.push({ ...base(e, session), kind: 'already-tiered', charsBefore: before.length, charsAfter: after.length })
      continue
    }
    let kind = 'other'
    if (WARM.test(after)) kind = 'warm'
    else if (COLD.test(after)) kind = 'cold'
    else if (POINTER.test(after)) kind = 'dedup-pointer'
    rows.push({ ...base(e, session), kind, charsBefore: before.length, charsAfter: after.length })
  }
  return rows
}

/** Host-local dedup pointers are not surfaceOp rewrites: counted separately. */
function measurePointers (session) {
  const rows = []
  for (const e of session.events) {
    if (e.type !== 'tool/result') continue
    if (e.surfaceOp && e.surfaceOp.op === 'replace') continue
    const text = textOf(e)
    const m = POINTER.exec(text)
    if (!m) continue
    rows.push({
      project: session.project, sessionId: session.id, cwd: session.cwd,
      fixture: session.fixture, seq: e.seq, step: Number(m[1]), time: e.time,
      chars: text.length,
    })
  }
  return rows
}

const sessions = collectSessions()
const rewrites = []
const pointers = []
for (const s of sessions) {
  const userTurns = s.events.filter((e) => e.type === 'user/message')
  for (const r of measureRewrites(s)) {
    const idx = userTurns.findIndex((u) => u.time <= r.time)
    r.sessionTurn = idx === -1 ? userTurns.length : idx + 1
    r.totalTurns = userTurns.length
    rewrites.push(r)
  }
  pointers.push(...measurePointers(s))
}

const inWindow = (r) => r.time >= START_MS && r.time < END_MS

const dayKey = (t) => new Date(t + KST).toISOString().slice(0, 10)
const hourKey = (t) => new Date(t + KST).toISOString().slice(0, 13)
const days = []
for (let t = START_MS; t < END_MS; t += 86400000) days.push(dayKey(t))
const hours = []
for (let t = START_MS; t < END_MS; t += 3600000) hours.push(hourKey(t))

function empty () {
  return { rewrites: 0, charsBefore: 0, charsAfter: 0, inflating: 0, charsAdded: 0, warm: 0, cold: 0, pointers: 0, pointerChars: 0, sessions: new Set(), other: 0, harnessPrune: 0, alreadyTiered: 0 }
}
function add (b, r) {
  b.sessions.add(r.sessionId)
  if (r.kind === 'warm') b.warm++
  else if (r.kind === 'cold') b.cold++
  else if (r.kind === 'dedup-pointer') { b.pointers++; b.pointerChars += r.chars; return }
  else if (r.kind === 'harness-prune') { b.harnessPrune++; return }
  else if (r.kind === 'already-tiered') { b.alreadyTiered++; return }
  b.rewrites++
  b.charsBefore += r.charsBefore
  b.charsAfter += r.charsAfter
  if (r.charsAfter > r.charsBefore) { b.inflating++; b.charsAdded += r.charsAfter - r.charsBefore }
}
const net = (b) => b.charsBefore - b.charsAfter

function bucket (rows, keys, keyFn) {
  const map = new Map(keys.map((k) => [k, empty()]))
  for (const r of rows) {
    const b = map.get(keyFn(r.time))
    if (b) add(b, r)
  }
  return map
}

const realRows = rewrites.filter((r) => !r.fixture && (r.kind === 'warm' || r.kind === 'cold' || r.kind === 'other'))
const realPointers = pointers.filter((p) => !p.fixture)

const byDay = bucket(realRows, days, dayKey)
const byHour = bucket(realRows, hours, hourKey)
const ptrByDay = bucket(realPointers, days, dayKey)
const ptrByHour = bucket(realPointers, hours, hourKey)

const allReal = realRows.slice().sort((a, b) => a.time - b.time)
const warmAll = allReal.filter((r) => r.kind === 'warm')

const gradedInputs = warmAll.map((r) => r.charsBefore).sort((a, b) => a - b)
const minGraded = gradedInputs[0] ?? null
const maxGraded = gradedInputs.at(-1) ?? null
const minGradedByDay = {}
for (const r of warmAll) {
  const d = dayKey(r.time)
  if (minGradedByDay[d] === undefined || r.charsBefore < minGradedByDay[d]) minGradedByDay[d] = r.charsBefore
}

const warmByTurn = {}
for (const r of warmAll) warmByTurn[r.sessionTurn] = (warmByTurn[r.sessionTurn] ?? 0) + 1
const earliestWarmTurn = warmAll.length ? Math.min(...warmAll.map((r) => r.sessionTurn)) : null
const contradictHot = warmAll.filter((r) => r.sessionTurn <= 6)

const dayTable = days.map((d) => {
  const b = byDay.get(d)
  const p = ptrByDay.get(d)
  return {
    day: d,
    rewrites: b.rewrites, warm: b.warm, cold: b.cold,
    charsBefore: b.charsBefore, charsAfter: b.charsAfter,
    net: net(b), grossSaved: net(b) + b.charsAdded, inflating: b.inflating, charsAdded: b.charsAdded,
    pointers: p.pointers, pointerChars: p.pointerChars,
    sessions: b.sessions.size,
    harnessPrune: b.harnessPrune, alreadyTiered: b.alreadyTiered,
    minGradedInput: minGradedByDay[d] ?? null,
  }
})

const totals = empty()
for (const d of dayTable) {
  totals.rewrites += d.rewrites; totals.warm += d.warm; totals.cold += d.cold
  totals.charsBefore += d.charsBefore; totals.charsAfter += d.charsAfter
  totals.inflating += d.inflating; totals.charsAdded += d.charsAdded
  totals.pointers += d.pointers; totals.pointerChars += d.pointerChars
}

function eraAgg (rows) {
  const b = empty()
  for (const r of rows) add(b, r)
  return { rewrites: b.rewrites, warm: b.warm, cold: b.cold, charsBefore: b.charsBefore, charsAfter: b.charsAfter, net: net(b), inflating: b.inflating, charsAdded: b.charsAdded }
}

function chart (rows, width = 52) {
  const max = Math.max(...rows.map((r) => Math.abs(r.net)), 1)
  return rows.map((r) => {
    const bar = Math.round((Math.abs(r.net) / max) * width)
    const s = (r.net >= 0 ? '#' : '-').repeat(bar)
    return `  ${r.day}  ${String(r.net).padStart(9)}  ${s.padEnd(width)}  ${r.rewrites} rw`
  }).join('\n')
}

const report = {
  window: { startMs: START_MS, endMs: END_MS, startIso: new Date(START_MS).toISOString(), endIso: new Date(END_MS).toISOString(), tz: 'Asia/Seoul (+09:00, no DST)' },
  method: 'harness session logs only; every rewrite attributed by the replacement event time; charsBefore from the original tool/result named by surfaceOp.startSeq; harness-prune and already-tiered surfaces excluded from plugin totals; fixture projects (/tmp cwd, te-side-*, benchtest-*, ab-current-*, tmp-*) excluded from real totals',
  totals: {
    sessionsInCorpus: sessions.length,
    realSessions: new Set(realRows.map((r) => r.sessionId)).size,
    realRewrites: totals.rewrites, warm: totals.warm, cold: totals.cold,
    charsBefore: totals.charsBefore, charsAfter: totals.charsAfter,
    net: totals.charsBefore - totals.charsAfter,
    grossSaved: totals.charsBefore - totals.charsAfter + totals.charsAdded,
    inflating: totals.inflating, charsAdded: totals.charsAdded,
    netTokens: Math.round((totals.charsBefore - totals.charsAfter) / CHARS_PER_TOKEN),
    pointers: totals.pointers, pointerChars: totals.pointerChars,
    harnessPrune: rewrites.filter((r) => !r.fixture && r.kind === 'harness-prune').length,
    fixtureRewrites: rewrites.filter((r) => r.fixture && (r.kind === 'warm' || r.kind === 'cold' || r.kind === 'other')).length,
    outOfWindowRewrites: rewrites.filter((r) => !r.fixture && !inWindow(r) && (r.kind === 'warm' || r.kind === 'cold' || r.kind === 'other')).length,
  },
  gradedInputRange: { min: minGraded, max: maxGraded },
  minGradedInputByDay: minGradedByDay,
  hotWindow: {
    earliestWarmTurn,
    warmRewritesBySessionTurn: warmByTurn,
    warmRewritesAtOrBeforeTurn6: contradictHot.length,
    note: 'a warm rewrite on session turn<=6 would contradict a six-turn hot window; measured count is ' + contradictHot.length,
  },
  dayTable,
  hourTable: hours.map((h) => {
    const b = byHour.get(h); const p = ptrByHour.get(h)
    return { hour: h, rewrites: b.rewrites, warm: b.warm, cold: b.cold, charsBefore: b.charsBefore, charsAfter: b.charsAfter, net: net(b), inflating: b.inflating, pointers: p.pointers, sessions: b.sessions.size }
  }),
  inflationCases: allReal.filter((r) => r.charsAfter > r.charsBefore)
    .map((r) => ({ time: r.time, day: dayKey(r.time), kind: r.kind, sessionTurn: r.sessionTurn, charsBefore: r.charsBefore, charsAfter: r.charsAfter, added: r.charsAfter - r.charsBefore, sessionId: r.sessionId }))
    .sort((a, b) => b.added - a.added),
  largestRewrites: allReal.map((r) => ({ time: r.time, day: dayKey(r.time), kind: r.kind, sessionTurn: r.sessionTurn, charsBefore: r.charsBefore, charsAfter: r.charsAfter, net: r.charsBefore - r.charsAfter, sessionId: r.sessionId }))
    .sort((a, b) => b.net - a.net).slice(0, 10),
}

console.log('=== TRACK E - TokenEconomizer per-day trend, 3-day window ===')
console.log('window ' + new Date(START_MS).toISOString() + ' .. ' + new Date(END_MS).toISOString() + ' (KST day keys)')
console.log('corpus sessions ' + sessions.length + '  real sessions in window ' + report.totals.realSessions)
console.log('real rewrites ' + totals.rewrites + ' (warm ' + totals.warm + ' / cold ' + totals.cold + ')  out-of-window ' + report.totals.outOfWindowRewrites + '  fixture ' + report.totals.fixtureRewrites + '  harness-prune ' + report.totals.harnessPrune)
console.log('charsBefore ' + totals.charsBefore + '  charsAfter ' + totals.charsAfter + '  net ' + (totals.charsBefore - totals.charsAfter))
console.log('inflating ' + totals.inflating + ' (+' + totals.charsAdded + ' chars)  net tokens ' + report.totals.netTokens + ' @3.7 chars/token')
console.log('dedup pointers ' + totals.pointers + ' (' + totals.pointerChars + ' chars replaced)')
console.log('graded warm input range ' + minGraded + ' .. ' + maxGraded + '  min by day ' + JSON.stringify(minGradedByDay))
console.log('hot-window probe: earliest warm session turn ' + earliestWarmTurn + ', warm rewrites at turn<=6: ' + contradictHot.length)
console.log('')
console.log('--- net chars saved per KST day ---')
console.log(chart(dayTable))
console.log('')
console.log('--- per day ---')
console.log('day          rw  warm cold  charsBefore charsAfter       net   infl  +chars  ptr  ptrChars  sess')
for (const d of dayTable) {
  console.log(d.day + ' ' + String(d.rewrites).padStart(4) + ' ' + String(d.warm).padStart(5) + ' ' + String(d.cold).padStart(4) + ' ' + String(d.charsBefore).padStart(12) + ' ' + String(d.charsAfter).padStart(10) + ' ' + String(d.net).padStart(9) + ' ' + String(d.inflating).padStart(6) + ' ' + String(d.charsAdded).padStart(7) + ' ' + String(d.pointers).padStart(5) + ' ' + String(d.pointerChars).padStart(9) + ' ' + String(d.sessions).padStart(5))
}
console.log('')
console.log('--- per KST hour ---')
for (const h of report.hourTable) {
  if (h.rewrites === 0 && h.pointers === 0) continue
  console.log(h.hour + ':00  rw ' + String(h.rewrites).padStart(3) + '  net ' + String(h.net).padStart(8) + '  warm ' + h.warm + ' cold ' + h.cold + '  infl ' + h.inflating + '  ptr ' + h.pointers)
}
console.log('')
console.log('--- top inflation cases (real, in window) ---')
for (const c of report.inflationCases.slice(0, 10)) {
  console.log(new Date(c.time).toISOString() + ' ' + c.kind + ' turn' + c.sessionTurn + ' ' + c.charsBefore + ' -> ' + c.charsAfter + ' (+' + c.added + ')')
}
console.log('')
console.log('--- top net-saving rewrites ---')
for (const r of report.largestRewrites) {
  console.log(new Date(r.time).toISOString() + ' ' + r.kind + ' turn' + r.sessionTurn + ' ' + r.charsBefore + ' -> ' + r.charsAfter + ' (net ' + r.net + ')')
}

const jsonIdx = process.argv.indexOf('--json')
if (jsonIdx !== -1 && process.argv[jsonIdx + 1]) writeFileSync(process.argv[jsonIdx + 1], JSON.stringify(report, null, 1) + '\n')
const csvIdx = process.argv.indexOf('--csv')
if (csvIdx !== -1 && process.argv[csvIdx + 1]) {
  const lines = ['day,rewrites,warm,cold,charsBefore,charsAfter,net,inflating,charsAdded,pointers,pointerChars,sessions,harnessPrune,alreadyTiered,minGradedInput']
  for (const d of dayTable) lines.push([d.day, d.rewrites, d.warm, d.cold, d.charsBefore, d.charsAfter, d.net, d.inflating, d.charsAdded, d.pointers, d.pointerChars, d.sessions, d.harnessPrune, d.alreadyTiered, d.minGradedInput ?? ''].join(','))
  writeFileSync(process.argv[csvIdx + 1], lines.join('\n') + '\n')
}
