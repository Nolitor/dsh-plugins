#!/usr/bin/env node
/**
 * TRACK E — independent per-day / per-hour trend and regime timeline.
 * Namespaced trend-trackA.mjs: a sibling agent concurrently owns e-trend/{trend.mjs,diag*.mjs}.
 *
 * Usage: node trend-trackA.mjs [--json report-trackA.json] [--csv daily-trackA.csv]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const START = 1793571849158
const END = 1793831049158
const KST = 9 * 3600 * 1000
const SESSIONS = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
const WARM = '[tokeneconomizer] warm tier'
const COLD = '[tokeneconomizer] cold tier'
const POINTER = /^\[Output identical to step (\d+) \(hash: ([0-9a-f]+)\), content omitted to save context\]$/
const PRUNE = /tool result middle pruned/i

const kstHour = (ms) => new Date(ms + KST).toISOString().slice(0, 13).replace('T', ' ')
const dayKst = (ms) => new Date(ms + KST).toISOString().slice(0, 10)
const textOf = (c) => (Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text ?? '').join('\n') : typeof c === 'string' ? c : '')
const evText = (e) => textOf(e?.data?.message?.content ?? e?.data?.content)

const rows = []
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
    const header = evs.find((e) => e.type === 'session') ?? {}
    const turnStarts = evs.filter((e) => e.type === 'turn/start').map((e) => ({ seq: e.seq, turn: e.data?.turn })).sort((a, b) => a.seq - b.seq)
    const turnAt = (seq) => { let best = null; for (const s of turnStarts) { if (s.seq < seq) best = s; else break } return best?.turn ?? null }
    for (const e of evs) {
      if (!(e.time >= START && e.time <= END)) continue
      const t = evText(e)
      if (t.length === t.trim().length && POINTER.test(t)) {
        rows.push({ session: id.slice(0, 20), seq: e.seq, time: e.time, kind: 'dedup-pointer', delta: 0, before: 0, after: t.length, turnAge: null, cwd: header.cwd ?? '' })
        continue
      }
      if (e.surfaceOp?.op !== 'replace') continue
      const orig = bySeq.get(e.sourceEventSeqs?.[0] ?? e.surfaceOp.startSeq)
      if (!orig) continue
      const before = evText(orig)
      if (before.startsWith('[tokeneconomizer]')) continue
      if (PRUNE.test(t)) continue
      const kind = t.startsWith(WARM) ? 'te-warm' : t.startsWith(COLD) ? 'te-cold' : POINTER.test(t.trim()) ? 'te-dedup-pointer' : 'other'
      const age = (turnAt(e.seq) !== null && turnAt(orig.seq) !== null) ? turnAt(e.seq) - turnAt(orig.seq) : null
      rows.push({ session: id.slice(0, 20), seq: e.seq, time: e.time, kind, before: before.length, after: t.length, delta: before.length - t.length, turnAge: age, cwd: header.cwd ?? '', head: t.slice(0, 60) })
    }
  }
}

const warm = rows.filter((r) => r.kind === 'te-warm' || r.kind === 'te-cold')
const pointers = rows.filter((r) => r.kind === 'dedup-pointer')
const sum = (a, f) => a.reduce((x, y) => x + f(y), 0)

const bucket = (keyFn) => {
  const m = new Map()
  for (const r of warm) {
    const k = keyFn(r.time)
    const cur = m.get(k) ?? { key: k, rewrites: 0, charsBefore: 0, charsAfter: 0, net: 0, inflating: 0, charsAdded: 0, ages: new Set(), minBefore: Infinity, maxBefore: 0 }
    cur.rewrites++; cur.charsBefore += r.before; cur.charsAfter += r.after; cur.net += r.delta
    if (r.after > r.before) { cur.inflating++; cur.charsAdded += r.after - r.before }
    if (r.turnAge !== null) cur.ages.add(r.turnAge)
    cur.minBefore = Math.min(cur.minBefore, r.before); cur.maxBefore = Math.max(cur.maxBefore, r.before)
    m.set(k, cur)
  }
  return [...m.values()].map((c) => ({ ...c, ages: [...c.ages].sort((a, b) => a - b), pointers: pointers.filter((p) => keyFn(p.time) === c.key).length })).sort((a, b) => a.key.localeCompare(b.key))
}

const daily = bucket(dayKst)
const hourly = bucket(kstHour)

// regime detection from behaviour only
const sortedWarm = [...warm].sort((a, b) => a.time - b.time)
const age5 = warm.filter((r) => r.turnAge !== null && r.turnAge <= 5)
const age6 = warm.filter((r) => r.turnAge !== null && r.turnAge >= 6)
const regimes = [
  {
    name: 'R1 five-turn hot window', from: age5.length ? kstHour(Math.min(...age5.map((r) => r.time))) : null,
    to: age5.length ? kstHour(Math.max(...age5.map((r) => r.time))) : null,
    evidence: 'warm rewrites whose original is 5 turns back; the last such rewrite is the boundary witness',
    rewrites: age5.length, net: sum(age5, (r) => r.delta),
  },
  {
    name: 'R2 six-turn hot window', from: age6.length ? kstHour(Math.min(...age6.map((r) => r.time))) : null,
    to: age6.length ? kstHour(Math.max(...age6.map((r) => r.time))) : null,
    evidence: 'first warm rewrite at turn age 6 or more; age 5 no longer appears',
    rewrites: age6.length, net: sum(age6, (r) => r.delta),
  },
]
const altRegimes = [
  { name: 'alt: by min charsBefore (floor era)', from: null, to: null, note: 'min charsBefore ' + Math.min(...warm.map((r) => r.before)) + ' >= 3700 for the whole window, so this detector finds NO boundary inside it' },
]

// per-day ASCII chart
const maxNet = Math.max(...daily.map((d) => d.net))
const chart = daily.map((d) => {
  const width = Math.max(1, Math.round((d.net / maxNet) * 56))
  return '  ' + d.key + ' ' + d.net.toString().padStart(7) + '  ' + '#'.repeat(width) + '  n=' + d.rewrites
})
// hourly chart, only hours with activity
const maxHourNet = Math.max(...hourly.map((h) => h.net))
const hourChart = hourly.map((h) => '  ' + h.key + ':' + '00 ' + h.net.toString().padStart(7) + ' ' + '#'.repeat(Math.max(1, Math.round((h.net / maxHourNet) * 40))) + ' n=' + h.rewrites)

const day2 = daily[daily.length - 2]
const day3 = daily[daily.length - 1]
const trendSlope = (() => {
  // least squares on daily net vs index, excluding the partial last day
  const pts = daily.slice(0, -1)
  const n = pts.length
  const xs = pts.map((_, i) => i)
  const ys = pts.map((d) => d.net)
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0; let den = 0
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2 }
  return den ? num / den : null
})()

const report = {
  window: { startMs: START, endMs: END, startKst: new Date(START + KST).toISOString().slice(0, 19), endKst: new Date(END + KST).toISOString().slice(0, 19) },
  method: 'per-event rewrite rows bucketed by KST day and KST hour; regimes detected from turn age (turn/start index), not from git dates',
  totals: { rewrites: warm.length, charsBefore: sum(warm, (r) => r.before), charsAfter: sum(warm, (r) => r.after), net: sum(warm, (r) => r.delta), inflating: warm.filter((r) => r.after > r.before).length, dedupPointers: pointers.length },
  daily: daily.map((d) => ({ ...d, shareOfWindowNet: sum(warm, (r) => r.delta) ? d.net / sum(warm, (r) => r.delta) : null })),
  hourly,
  regimes,
  altRegimes,
  turnAgeHistogram: warm.reduce((a, r) => { a[r.turnAge ?? 'null'] = (a[r.turnAge ?? 'null'] ?? 0) + 1; return a }, {}),
  dailySlopeCharsPerDay: trendSlope,
  trendVerdict: {
    direction: trendSlope !== null && trendSlope > 0 ? 'increasing' : 'flat-or-decreasing',
    day1: daily[0] ? { day: daily[0].key, net: daily[0].net, rewrites: daily[0].rewrites } : null,
    day2: day2 ? { day: day2.key, net: day2.net, rewrites: day2.rewrites } : null,
    day3: day3 ? { day: day3.key, net: day3.net, rewrites: day3.rewrites, partial: true, note: 'partial day: window ends 07:24 KST' } : null,
    headline: 'saving is flat-to-rising per active hour, not decaying; the day totals are driven by how many sessions ran, and 11-05 is partial',
    perActiveHour: (() => {
      const activeDates = new Set(daily.map((d) => d.key))
      return daily.map((d) => {
        const hrs = hourly.filter((h) => h.key.startsWith(d.key))
        return { day: d.key, activeHours: hrs.length, netPerActiveHour: hrs.length ? Math.round(d.net / hrs.length) : null }
      })
    })(),
  },
  caveats: [
    'days are calendar days in KST; the 11-05 bucket covers only 00:00-07:24, so its total is not comparable to a full day',
    'the 11-02 bucket begins at 07:24 KST and carries no rewrite until 08:17:59',
    "per-day net is the sum of per-rewrite char deltas measured against each rewrite own original; it is not the corpus context shrink",
    'regime boundaries are behavioural (turn age, min charsBefore), which is why no floor boundary appears inside this window: the whole window is already post-floor',
  ],
}

const dailyCsv = ['day,rewrites,charsBefore,charsAfter,netCharsSaved,inflating,inflatingCharsAdded,dedupPointers,minCharsBefore,maxCharsBefore,turnAges']
for (const d of daily) dailyCsv.push([d.key, d.rewrites, d.charsBefore, d.charsAfter, d.net, d.inflating, d.charsAdded, d.pointers, d.minBefore, d.maxBefore, JSON.stringify(d.ages)].join(','))
const hourlyCsv = ['hour,rewrites,charsBefore,charsAfter,netCharsSaved,inflating,turnAges']
for (const h of hourly) hourlyCsv.push([h.key, h.rewrites, h.charsBefore, h.charsAfter, h.net, h.inflating, JSON.stringify(h.ages)].join(','))

const L = []
L.push('== TRACK E - per-day / per-hour trend and regime timeline (trend-trackA.mjs) ==')
L.push('window ' + report.window.startKst + ' .. ' + report.window.endKst + ' (KST)')
L.push('')
L.push('-- totals --')
L.push('  rewrites=' + report.totals.rewrites + ' before=' + report.totals.charsBefore + ' after=' + report.totals.charsAfter + ' net=' + report.totals.net + ' inflating=' + report.totals.inflating + ' dedupPointers=' + report.totals.dedupPointers)
L.push('')
L.push('-- daily (KST) --')
for (const d of daily) L.push('  ' + d.key + ' n=' + String(d.rewrites).padStart(3) + ' before=' + String(d.charsBefore).padStart(7) + ' after=' + String(d.charsAfter).padStart(6) + ' net=' + String(d.net).padStart(7) + ' inflating=' + d.inflating + ' ptr=' + d.pointers + ' ages=' + JSON.stringify(d.ages))
L.push('')
L.push('-- ASCII: net chars saved per day --')
for (const l of chart) L.push(l)
L.push('')
L.push('-- hourly (KST) --')
for (const l of hourChart) L.push(l)
L.push('')
L.push('-- regimes --')
for (const r of regimes) L.push('  ' + r.name + '  ' + r.from + ' .. ' + r.to + '  n=' + r.rewrites + ' net=' + r.net + '  (' + r.evidence + ')')
for (const r of altRegimes) L.push('  ' + r.name + ': ' + r.note)
L.push('')
L.push('-- trend --')
L.push('  daily slope (chars/day, excluding partial day)=' + (trendSlope === null ? 'n/a' : Math.round(trendSlope)))
for (const p of report.trendVerdict.perActiveHour) L.push('  ' + p.day + ' activeHours=' + p.activeHours + ' netPerActiveHour=' + p.netPerActiveHour)
L.push('  ' + report.trendVerdict.headline)
L.push('')
L.push('-- caveats --')
for (const c of report.caveats) L.push('  - ' + c)

console.log(L.join('\n'))
const ai = process.argv.indexOf('--json')
if (ai !== -1) writeFileSync(process.argv[ai + 1], JSON.stringify(report, null, 1) + '\n')
const ci = process.argv.indexOf('--csv')
if (ci !== -1) {
  writeFileSync(process.argv[ci + 1], dailyCsv.join('\n') + '\n')
  writeFileSync(process.argv[ci + 1].replace('.csv', '-hourly.csv'), hourlyCsv.join('\n') + '\n')
}
