import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { zstdDecompressSync } from 'node:zlib'
// Independent recompute (no shared code with measure.mjs) of the plugin net chars in window.
const S = 1793571849158, E = 1793831049158
const SESS = join(homedir(), '.dsh', 'sessions')
const txt = (c) => Array.isArray(c) ? c.map((b) => (b && b.type === 'text' ? b.text ?? '' : '')).filter(Boolean).join('\n') : ''
let n = 0, before = 0, after = 0, infl = 0
for (const p of readdirSync(SESS)) {
  let ids; try { ids = readdirSync(join(SESS, p)) } catch { continue }
  for (const id of ids) {
    const d = join(SESS, p, id); let st
    try { st = statSync(d) } catch { continue }
    if (!st.isDirectory()) continue
    const fs2 = readdirSync(d).filter((f) => f.endsWith('.jsonl.zstd'))
    if (!fs2.length) continue
    let ev
    try { ev = zstdDecompressSync(readFileSync(join(d, fs2.sort().at(-1)))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { continue }
    const by = new Map(); for (const e of ev) if (typeof e.seq === 'number') by.set(e.seq, e)
    for (const e of ev) {
      if (e.type !== 'tool/result') continue
      if (e.time < S || e.time > E) continue
      const t = txt(e.data?.message?.content)
      const warm = t.startsWith('[tokeneconomizer] warm tier')
      const cold = t.startsWith('[tokeneconomizer] cold tier')
      const dedup = t.startsWith('[Output identical to step')
      if (!warm && !cold && !dedup) continue
      if (dedup) { n++; continue } // pointers handled separately, not a replace
      if (e.surfaceOp?.op !== 'replace') continue
      const o = by.get(e.surfaceOp.startSeq ?? e.sourceEventSeqs?.[0])
      if (!o) continue
      const b = txt(o.data.message.content).length
      n++; before += b; after += t.length
      if (t.length > b) infl++
    }
  }
}
console.log('independent replace-based totals: rewrites', n, 'before', before, 'after', after, 'net', before - after, 'inflating', infl)
