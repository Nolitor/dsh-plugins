import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
const SESS = join(homedir(), '.dsh', 'sessions')
const textOf = (e) => (e?.data?.message?.content ?? [])
  .map((b) => (b && b.type === 'text' ? b.text ?? '' : ''))
  .filter(Boolean).join('\n')
const shapes = new Map()
let evs0 = null
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
    for (const e of evs) {
      if (!e.surfaceOp) continue
      const key = JSON.stringify(e.surfaceOp) + ' | type=' + e.type
      if (!shapes.has(key)) { shapes.set(key, { count: 0, sample: { time: e.time, seq: e.seq, src: e.sourceEventSeqs, text: textOf(e).slice(0, 120) } }) }
      shapes.get(key).count++
    }
  }
}
for (const [k, v] of [...shapes].sort((a, b) => b[1].count - a[1].count)) {
  console.log(String(v.count).padStart(5), k)
  console.log('        sample', new Date(v.sample.time).toISOString(), 'seq', v.sample.seq, 'src', JSON.stringify(v.sample.src), JSON.stringify(v.sample.text))
}
