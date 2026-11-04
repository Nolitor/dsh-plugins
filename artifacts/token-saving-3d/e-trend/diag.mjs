import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
const SESS = join(homedir(), '.dsh', 'sessions')
const textOf = (e) => (e?.data?.message?.content ?? [])
  .map((b) => (b && b.type === 'text' ? b.text ?? '' : ''))
  .filter(Boolean).join('\n')
const ptrs = []
const colds = []
const rows = []
for (const project of readdirSync(SESS)) {
  const pdir = join(SESS, project)
  try { if (!statSync(pdir).isDirectory()) continue } catch { continue }
  for (const id of readdirSync(pdir)) {
    const dir = join(pdir, id)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    let files = readdirSync(dir).filter((f) => f.endsWith('.jsonl.zstd')).sort()
    if (!files.length) continue
    let evs
    try { evs = zstdDecompressSync(readFileSync(join(dir, files.at(-1)))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { continue }
    const users = evs.filter((e) => e.type === 'user/message')
    const bySeq = new Map()
    for (const e of evs) if (!bySeq.has(e.seq)) bySeq.set(e.seq, e)
    for (const e of evs) {
      const t = textOf(e)
      if (e.type === 'tool/result') {
        if (t.includes('Output identical to step')) {
          ptrs.push({ id, time: e.time, sop: !!e.surfaceOp, anchored: /^\[Output identical/.test(t), len: t.length, head: t.slice(0, 70) })
        }
        if (/^\[tokeneconomizer\] cold tier/.test(t)) colds.push({ id, time: e.time, len: t.length, head: t.slice(0, 90) })
        if (e.surfaceOp && e.surfaceOp.op === 'replace') {
          const orig = bySeq.get(e.surfaceOp.startSeq)
          const before = orig ? textOf(orig) : null
          if (before !== null && !/^\[tokeneconomizer\]/.test(before) && /^\[tokeneconomizer\]/.test(t)) {
            const turnIdx = users.findIndex((u) => u.time <= (orig?.time ?? e.time))
            const curIdx = users.findIndex((u) => u.time > e.time)
            rows.push({ id, time: e.time, kind: t.slice(0, 30), blen: before.length, alen: t.length, turn: turnIdx + 1, cur: curIdx === -1 ? users.length : curIdx, totalTurns: users.length })
          }
        }
      }
    }
  }
}
console.log('pointer events total', ptrs.length, 'anchored', ptrs.filter((p) => p.anchored).length, 'withSurfaceOp', ptrs.filter((p) => p.sop).length)
for (const p of ptrs.slice(0, 12)) console.log(' PTR', new Date(p.time).toISOString(), p.id.slice(0, 14), 'sop=' + p.sop, 'anch=' + p.anchored, 'len=' + p.len, JSON.stringify(p.head))
console.log('')
console.log('cold tier events', colds.length)
for (const c of colds.slice(0, 6)) console.log(' COLD', new Date(c.time).toISOString(), c.id.slice(0, 14), c.len, JSON.stringify(c.head))
console.log('')
const warm = rows.filter((r) => r.kind.startsWith('[tokeneconomizer] warm'))
console.log('TE rewrites (fresh)', rows.length, 'warm', warm.length)
const ages = warm.map((r) => r.cur - r.turn).sort((a, b) => a - b)
console.log('age (currentTurn - turn) distribution:', JSON.stringify(ages))
const turns = warm.map((r) => r.turn).sort((a, b) => a - b)
console.log('turn distribution:', JSON.stringify(turns))
console.log('totalTurns distribution:', JSON.stringify(warm.map((r) => r.totalTurns).sort((a, b) => a - b)))
console.log('min age', ages[0], 'max age', ages.at(-1))
const byTurn = {}
for (const r of warm) byTurn[r.turn] = (byTurn[r.turn] ?? 0) + 1
console.log('warm by turn:', JSON.stringify(byTurn))
