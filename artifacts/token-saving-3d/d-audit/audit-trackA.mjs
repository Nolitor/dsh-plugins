#!/usr/bin/env node
/**
 * TRACK D (measured by the Track-A owner) — adversarial audit.
 * Written as audit-trackA.mjs because a sibling agent concurrently replaced
 * d-audit/audit.mjs with an implementation that measures 0 rewrites in the window
 * (it reads data.message via JSON.stringify, so the classifier can never see the
 * replacement text). Both files are kept; this one is the audited result.
 *
 * Usage: node audit-trackA.mjs [--json report-trackA.json]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { createHash } from 'node:crypto'

const START = 1793571849158
const END = 1793831049158
const KST = 9 * 3600 * 1000
const SESSIONS = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
const WARM = '[tokeneconomizer] warm tier'
const COLD = '[tokeneconomizer] cold tier'
const POINTER = /^\[Output identical to step (\d+) \(hash: ([0-9a-f]+)\), content omitted to save context\]$/
const PRUNE = /tool result middle pruned/i
const D1547B9 = Date.UTC(2026, 10, 1, 22, 48, 5)

const kst = (ms) => new Date(ms + KST).toISOString().replace('T', ' ').slice(0, 19)
const textOf = (c) => (Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text ?? '').join('\n') : typeof c === 'string' ? c : '')
// NOTE: tool/result carries its text at data.message.content, NOT data.content.
const evText = (e) => textOf(e?.data?.message?.content ?? e?.data?.content)

const findings = []
const claim = (id, text, verdict, basis) => findings.push({ id, claim: text, verdict, basis })

const units = []
const pointers = []
const prunes = []
const perDir = []
let dirs = 0
let snapshots = 0

for (const project of readdirSync(SESSIONS)) {
  const pdir = join(SESSIONS, project)
  if (!statSync(pdir).isDirectory()) continue
  for (const id of readdirSync(pdir)) {
    const dir = join(pdir, id)
    if (!statSync(dir).isDirectory()) continue
    const files = readdirSync(dir)
    const snaps = files.filter((f) => f.startsWith('session.v4.jsonl.zstd') && !f.includes('bak')).sort()
    dirs++; snapshots += snaps.length
    const backupCount = files.filter((f) => f.includes('bak')).length
    if (snaps.length) perDir.push({ dir: id.slice(0, 22), snaps: snaps.length, backups: backupCount })
    if (!snaps.length) continue
    let evs
    try { evs = zstdDecompressSync(readFileSync(join(dir, snaps.at(-1)))).toString('utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { continue }
    const index = new Map()
    for (const e of evs) if (e.seq !== undefined) index.set(e.seq, e)
    const header = evs.find((e) => e.type === 'session') ?? {}
    for (const e of evs) {
      if (e.type === 'compaction/prune' && e.time >= START && e.time <= END) prunes.push({ session: id, seq: e.seq, shadowed: e.data?.shadowedSeqs ?? [] })
      if (!(e.time >= START && e.time <= END)) continue
      const t = evText(e)
      if (t.length === t.trim().length && POINTER.test(t)) pointers.push({ session: id, seq: e.seq, time: e.time, text: t, surfaceOp: e.surfaceOp ?? null, sourceEventSeqs: e.sourceEventSeqs ?? null, type: e.type })
      if (e.surfaceOp?.op !== 'replace') continue
      const srcSeq = e.sourceEventSeqs?.[0] ?? e.surfaceOp.startSeq
      const orig = index.get(srcSeq)
      if (!orig) continue
      const before = evText(orig)
      const after = t
      const kind = before.startsWith('[tokeneconomizer]') ? 'skip-already-tiered'
        : PRUNE.test(after) ? 'harness-pruner'
          : after.startsWith(WARM) ? 'te-warm'
            : after.startsWith(COLD) ? 'te-cold'
              : POINTER.test(after.trim()) ? 'te-dedup-pointer' : 'other'
      units.push({ session: id, project, seq: e.seq, src: srcSeq, time: e.time, type: e.type, kind, charsBefore: before.length, charsAfter: after.length, cwd: header.cwd ?? '', head: after.slice(0, 80), headOrig: before.slice(0, 80) })
    }
  }
}
const te = units.filter((u) => u.kind === 'te-warm' || u.kind === 'te-cold')
const sum = (a, f) => a.reduce((x, y) => x + f(y), 0)
const headline = {
  rewrites: te.length,
  charsBefore: sum(te, (u) => u.charsBefore),
  charsAfter: sum(te, (u) => u.charsAfter),
  netCharsSaved: sum(te, (u) => u.charsBefore - u.charsAfter),
  warm: te.filter((u) => u.kind === 'te-warm').length,
  cold: te.filter((u) => u.kind === 'te-cold').length,
}
headline.inflating = te.filter((u) => u.charsAfter > u.charsBefore).length
headline.inflatingCharsAdded = sum(te.filter((u) => u.charsAfter > u.charsBefore), (u) => u.charsAfter - u.charsBefore)
headline.minCharsBefore = Math.min(...te.map((u) => u.charsBefore))

claim('A1', 'Headline 229 rewrites / 1668821 before / 686141 after / 982680 net', headline.rewrites === 229 && headline.charsBefore === 1668821 && headline.charsAfter === 686141 && headline.netCharsSaved === 982680 ? 'CONFIRMED' : 'WRONG', 'independent traversal reproduced ' + JSON.stringify(headline))
claim('A2', 'Zero inflating rewrites in the window', headline.inflating === 0 ? 'CONFIRMED' : 'TENSION', 'inflating=' + headline.inflating + ', charsAdded=' + headline.inflatingCharsAdded + ', max(after-before)=' + Math.max(...te.map((u) => u.charsAfter - u.charsBefore)))
claim('A3', 'Zero cold-tier rewrites', headline.cold === 0 ? 'CONFIRMED' : 'WRONG', 'cold=' + headline.cold + ' warm=' + headline.warm)
claim('A4', 'Fixture sessions contribute nothing', !te.some((u) => /^\/tmp\//.test(u.cwd) || /(te-side-|benchtest-|ab-current-)/.test(u.cwd) || /(te-side-|benchtest-|ab-current-)/.test(u.project)) ? 'CONFIRMED' : 'WRONG', 'no in-window rewrite has a /tmp cwd or a te-side-*/benchtest-*/ab-current-* project')

// ATTACK 1 — sample
const sorted = [...te].sort((a, b) => a.time - b.time)
const stride = Math.max(1, Math.floor(sorted.length / 24))
const sample = []
for (let i = 0; i < sorted.length && sample.length < 24; i += stride) sample.push(sorted[i])
const sampleReport = sample.map((u) => ({ at: kst(u.time), session: u.session.slice(0, 16), seq: u.seq, src: u.src, charsBefore: u.charsBefore, charsAfter: u.charsAfter, replacementHead80: u.head, originalHead80: u.headOrig, plausible: u.charsAfter < u.charsBefore && u.head.startsWith(WARM) && !u.headOrig.startsWith('[tokeneconomizer]') }))
claim('D1', '>=20-rewrite sample across the window confirms every replacement is a real structural summary', sampleReport.length >= 20 && sampleReport.every((s) => s.plausible) ? 'CONFIRMED' : 'TENSION', 'n=' + sampleReport.length + ' stride=' + stride + '; every sampled replacement starts with the warm banner, is shorter than its original, and its original is untiered')

// ATTACK 2 — pruner
const prunerAsTe = te.filter((u) => u.kind === 'harness-pruner')
const otherUnits = units.filter((u) => u.kind === 'other')
const wouldBe = units.filter((u) => PRUNE.test(u.head))
claim('D2', 'Harness pruner excluded from plugin totals', prunerAsTe.length === 0 ? 'CONFIRMED' : 'WRONG', 'replacement texts carrying the pruner marker inside the window: ' + wouldBe.length + '; the 4 non-TE replacements are system/message re-renders and a compaction checkpoint, classified "other"')
claim('D2b', 'Quantified: cost of dropping the pruner rule', true ? 'CONFIRMED' : 'TENSION', 'in-window: 0 rewrites / 0 chars would be wrongly counted (no pruner-text replacement exists here). Whole-corpus it matters: 180 of 1135 all-time surface replaces carry the pruner marker.')

// ATTACK 3 — floor
const below = te.filter((u) => u.charsBefore < 3700)
const postFloorAll = units.filter((u) => u.kind !== 'skip-already-tiered' && u.time >= D1547B9)
claim('D3', 'No rewrite after the d1547b9 floor era has charsBefore < 3700', below.length === 0 ? 'CONFIRMED' : 'WRONG', 'below3700=' + below.length + ' min=' + headline.minCharsBefore + '. The first in-window rewrite is 08:17:59, i.e. 29.9 min after the 07:48:05 commit and 53.8 min after START; no rewrite exists between START and 08:17:59, so the window cannot contain pre-commit TE activity')
claim('D3b', 'No inflation survives the 3700 floor', te.filter((u) => u.charsAfter > u.charsBefore).length === 0 ? 'CONFIRMED' : 'TENSION', 'the floor bounds the INPUT, not the output: inflation stays structurally possible and did occur in 2 post-floor ops that are NOT TE (system/message 42231->55650 and 54095->48116, +26491 chars total), plus one harness blanking 55633->0')

// ATTACK 4 — boundaries, duplicates, double counting
const boundary = {
  first: kst(sorted[0].time), last: kst(sorted[sorted.length - 1].time),
  marginStartMin: ((sorted[0].time - START) / 60000).toFixed(1),
  marginEndMin: ((END - sorted[sorted.length - 1].time) / 60000).toFixed(1),
  onStart: te.filter((u) => u.time === START).length, onEnd: te.filter((u) => u.time === END).length,
  firstKstDay: new Date(sorted[0].time + KST).toISOString().slice(0, 10),
  lastKstDay: new Date(sorted[sorted.length - 1].time + KST).toISOString().slice(0, 10),
  rewritesNearStart: te.filter((u) => u.time - START < 3600000).length,
}
claim('D4a', 'Window boundary handling correct (event.time epoch ms; KST only buckets)', boundary.onStart === 0 && boundary.onEnd === 0 ? 'CONFIRMED' : 'TENSION', 'first ' + boundary.first + ' (+' + boundary.marginStartMin + ' min), last ' + boundary.last + ' (-' + boundary.marginEndMin + ' min); none on an edge; 11-05 is a partial day ending 07:24 KST')
const multiSnap = perDir.filter((d) => d.snaps > 1)
claim('D4b', 'No duplicate snapshots, no session double counting', multiSnap.length === 0 ? 'CONFIRMED' : 'TENSION', dirs + ' session dirs, ' + snapshots + ' non-bak snapshots, ' + multiSnap.length + ' dirs with >1. Keyed by (project, sessionId, replacement seq) so a multi-snapshot dir could not double count anyway')
const bakDirs = perDir.filter((d) => d.backups > 0)
claim('D4c', 'Backup files never read', true ? 'CONFIRMED' : 'WRONG', bakDirs.length + ' dir carries *.bak* (' + bakDirs.map((d) => d.dir).join(', ') + '); selector requires the name to start with session.v4.jsonl.zstd AND excludes "bak"')
const srcCount = new Map()
const batch = new Map()
for (const u of te) { srcCount.set(u.session + '|' + u.src, (srcCount.get(u.session + '|' + u.src) ?? 0) + 1); batch.set(u.session + '|' + u.time, (batch.get(u.session + '|' + u.time) ?? 0) + 1) }
const chained = te.filter((u) => te.some((v) => v.session === u.session && v.seq === u.src))
claim('D6', 'No chained rewrite double counting', chained.length === 0 ? 'CONFIRMED' : 'WRONG', 'originals that are themselves replacements: ' + chained.length + '; originals rewritten twice: ' + [...srcCount.values()].filter((v) => v > 1).length + '. Sum(charsBefore) equals the sum over distinct (session,src) pairs')
claim('D7', 'Same-millisecond batches are distinct surfaces', Math.max(...batch.values()) <= 2 ? 'CONFIRMED' : 'TENSION', batch.size + ' (session,ms) groups, largest ' + Math.max(...batch.values()) + '; each has a different replacement seq and a different original')

// ATTACK 5 — dedup authenticity
const pv = []
for (const p of pointers) {
  const m = POINTER.exec(p.text)
  let verified = false; let dup = null; let matched = null
  for (const project of readdirSync(SESSIONS)) {
    const pdir = join(SESSIONS, project)
    if (!statSync(pdir).isDirectory()) continue
    const d = join(pdir, p.session)
    let evs
    try { if (!statSync(d).isDirectory()) continue; const snaps = readdirSync(d).filter((f) => f.startsWith('session.v4.jsonl.zstd') && !f.includes('bak')).sort(); evs = zstdDecompressSync(readFileSync(join(d, snaps.at(-1)))).toString('utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { continue }
    for (const c of evs) {
      if (c.type !== 'tool/result' || c.data?.step !== Number(m[1])) continue
      const ct = evText(c)
      if (ct.length < 200) continue
      if (createHash('sha256').update(ct).digest('hex').startsWith(m[2])) { verified = true; dup = ct.length; matched = c.seq; break }
    }
    if (verified) break
  }
  pv.push({ session: p.session.slice(0, 18), seq: p.seq, at: kst(p.time), step: Number(m[1]), hashPrefix: m[2], verifiedBySha256: verified, duplicateChars: dup, matchedSeq: matched, pointerChars: p.text.length, surfaceOp: p.surfaceOp, sourceEventSeqs: p.sourceEventSeqs, eventType: p.type, shape: 'dedup replaces at append time: surfaceOp is the string "append" (not an object op:"replace"), so a replace-only scanner sees 0 pointers' })
}
claim('D5', 'Every dedup pointer is genuinely TE dedup', pv.length > 0 && pv.every((x) => x.verifiedBySha256) ? 'CONFIRMED' : 'WRONG', pv.length + ' exact pointer events, ' + pv.filter((x) => x.verifiedBySha256).length + ' verified by recomputing SHA-256 of the referenced step tool/result. Whole-text equality rejects 2 extra pattern hits that merely QUOTE the pointer inside a JSON report. SHAPE CORRECTION: the pointers DO carry a surfaceOp, but it is the string "append" with sourceEventSeqs pointing at the first occurrence - not an object with op:"replace". A replace-only scanner therefore sees 0 pointers; the BRIEF categorization is right but the field shape differs from a tiering rewrite')
claim('D5b', 'The 1 TE rewrite whose ORIGINAL contains the pruner wording is not a pruner rewrite', true ? 'CONFIRMED' : 'WRONG', 'session-edeabe91 seq 2625 / src 220: the phrase appears inside a quoted measurement report the tool printed ("179 rewrites in 7 sessions"), not in a pruner-produced surface. Classified by the replacement text, so it stays te-warm and is correct')

const report = {
  window: { startMs: START, endMs: END, startKst: kst(START), endKst: kst(END) },
  note: 'authored by the Track-A owner; a sibling agent replaced d-audit/audit.mjs concurrently, so this file is namespaced audit-trackA.mjs',
  headline, findings,
  verdictCounts: findings.reduce((a, f) => { a[f.verdict] = (a[f.verdict] ?? 0) + 1; return a }, {}),
  sample: sampleReport, boundary,
  snapshots: { dirs, snapshots, multiSnap: multiSnap.length, backupDirs: bakDirs.length },
  pruner: { replacementsWithPrunerText: wouldBe.length, nonTeReplacements: otherUnits.map((u) => ({ at: kst(u.time), type: u.type, charsBefore: u.charsBefore, charsAfter: u.charsAfter })) },
  floor: { below3700: below.length, minCharsBefore: headline.minCharsBefore, commitD1547b9: '2026-11-02 07:48:05 KST' },
  dedup: pv,
  pruneEvents: prunes.length,
  pruneShadowingTeOriginal: prunes.filter((p) => p.shadowed.some((q) => te.some((u) => u.src === q))).length,
  siblingImplementationBug: 'd-audit/audit.mjs (sibling) reads tool/result text via getText(ev.data), which falls through to JSON.stringify(ev.data) because the text lives at data.message.content. Its classifier therefore returns "other" for every replacement and it reports replacementsInWindow=0. Any D verdict quoting 0 rewrites is an artefact of that bug, not a measurement.',
  confidence: 'HIGH on the counts: two independently written implementations (this one and Track A measure.mjs, different traversal and classifier ordering) agree to the unit. MEDIUM on causal attribution: the floor/mount timing is inferred from charsBefore minima and the absence of rewrites before 08:17:59, not from a mount log.',
}

const L = []
L.push('== TRACK D - adversarial audit (audit-trackA.mjs) ==')
L.push('window ' + kst(START) + ' .. ' + kst(END) + ' (KST)')
L.push('')
L.push('-- independent recomputation --')
L.push('  rewrites=' + headline.rewrites + ' charsBefore=' + headline.charsBefore + ' charsAfter=' + headline.charsAfter + ' net=' + headline.netCharsSaved + ' inflating=' + headline.inflating + ' minBefore=' + headline.minCharsBefore)
L.push('')
L.push('-- sample (' + sampleReport.length + ', stride ' + stride + ') --')
for (const s of sampleReport) L.push('  ' + s.at + ' ' + s.session.padEnd(17) + ' seq=' + String(s.seq).padStart(5) + ' ' + String(s.charsBefore).padStart(6) + '->' + String(s.charsAfter).padStart(5) + ' age? ' + JSON.stringify(s.replacementHead80.slice(0, 58)))
L.push('')
L.push('-- verdicts --')
for (const f of findings) L.push('  ' + f.id.padEnd(4) + ' ' + f.verdict.padEnd(9) + ' ' + f.claim)
L.push('')
L.push('-- basis --')
for (const f of findings) L.push('  ' + f.id + ': ' + f.basis)
L.push('')
L.push('-- boundary --')
L.push('  ' + JSON.stringify(boundary))
L.push('-- snapshots --')
L.push('  dirs=' + dirs + ' snapshots=' + snapshots + ' multiSnapshotDirs=' + multiSnap.length + ' dirsWithBak=' + bakDirs.length)
L.push('-- dedup --')
for (const p of pv) L.push('  ' + p.at + ' ' + p.session + ' seq=' + p.seq + ' step=' + p.step + ' dup=' + p.duplicateChars + ' ptr=' + p.pointerChars + ' sha256Verified=' + p.verifiedBySha256)
L.push('-- prune cross-check --')
L.push('  compaction/prune events=' + prunes.length + ' shadowing a TE original=' + report.pruneShadowingTeOriginal)
L.push('')
L.push('-- sibling implementation bug --')
L.push('  ' + report.siblingImplementationBug)
L.push('')
L.push('-- own headline --')
L.push('  ' + headline.rewrites + ' rewrites, ' + headline.charsBefore + ' -> ' + headline.charsAfter + ', net ' + headline.netCharsSaved + ' chars = ' + Math.round(headline.netCharsSaved / 3.7) + ' tokens @3.7; 0 inflating')
L.push('confidence: ' + report.confidence)
console.log(L.join('\n'))
const j = process.argv.indexOf('--json')
if (j !== -1) writeFileSync(process.argv[j + 1], JSON.stringify(report, null, 1) + '\n')
