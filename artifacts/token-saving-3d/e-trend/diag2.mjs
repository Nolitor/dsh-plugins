import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
const dir = process.argv[2]
const textOf = (e) => (e?.data?.message?.content ?? [])
  .map((b) => (b && b.type === 'text' ? b.text ?? '' : ''))
  .filter(Boolean).join('\n')
const POINTER = /^\[Output identical to step (\d+) \(hash: ([0-9a-f]+)\), content omitted to save context\]/
const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl.zstd')).sort()
const evs = zstdDecompressSync(readFileSync(join(dir, files.at(-1)))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
console.log('session dir', dir, 'events', evs.length, 'files', files.length)
const bySeq = new Map()
for (const e of evs) if (!bySeq.has(e.seq)) bySeq.set(e.seq, e)
let n = 0
for (const e of evs) {
  if (e.type !== 'tool/result') continue
  const t = textOf(e)
  const op = e.surfaceOp
  if (!op) {
    if (POINTER.test(t) || /^\[tokeneconomizer\] cold tier/.test(t)) {
      console.log('NOSOP', new Date(e.time).toISOString(), 'seq', e.seq, JSON.stringify(t.slice(0, 80)))
    }
    continue
  }
  if (op.op !== 'replace') { console.log('OPOTHER', op.op); continue }
  const orig = bySeq.get(op.startSeq)
  const before = orig ? textOf(orig) : null
  let cls = 'other'
  if (before === null) cls = 'no-orig'
  else if (before.includes('tool result middle pruned') || t.includes('tool result middle pruned')) cls = 'HARNESS-PRUNE'
  else if (before.startsWith('[tokeneconomizer]')) cls = 'already-tiered'
  else if (/^\[tokeneconomizer\] warm tier/.test(t)) cls = 'warm'
  else if (/^\[tokeneconomizer\] cold tier/.test(t)) cls = 'cold'
  else if (POINTER.test(t)) cls = 'DEDUP-POINTER'
  n++
  if (cls !== 'warm' || n <= 3) {
    console.log('RW', new Date(e.time).toISOString(), 'seq', e.seq, '->', op.startSeq, cls, 'before=' + (before === null ? 'null' : before.length), 'after=' + t.length, JSON.stringify(t.slice(0, 60)))
  }
  if (cls === 'HARNESS-PRUNE') console.log('   PRUNE before:', JSON.stringify((before ?? '').slice(0, 130)), '| after:', JSON.stringify(t.slice(0, 130)))
}
console.log('total surfaceOp replaces', n)
