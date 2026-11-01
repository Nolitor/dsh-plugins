#!/usr/bin/env node
/**
 * Summarize the real-traffic trace written by lib/trace.js.
 *
 * The defect does not reproduce on short probes: it needs long, output-heavy turns.
 * This reader turns the trace of normal work into the comparison the probes could
 * not give: for every request, its shape (tools, context chars, system prompt) and
 * whether any streamed delta carried protocol notation.
 *
 * Usage: node scripts/analyze-opencode-trace.mjs [/tmp/opencode-v2-trace.jsonl]
 */
import { readFileSync } from 'node:fs'

const path = process.argv[2] ?? '/tmp/opencode-v2-trace.jsonl'
const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => {
  try { return JSON.parse(line) } catch { return null }
}).filter(Boolean)

const requests = new Map()
for (const line of lines) {
  const entry = requests.get(line.rid) ?? { rid: line.rid, deltas: [], markerDeltas: 0 }
  if (line.kind === 'request') Object.assign(entry, line)
  if (line.kind === 'finish') entry.finish = line
  if (line.kind === 'error') entry.error = line
  if (line.kind === 'delta') { entry.deltas.push(line); entry.markerDeltas += 1 }
  requests.set(line.rid, entry)
}

const all = [...requests.values()].filter((entry) => entry.kind === 'request' || entry.model)
const leaking = all.filter((entry) => entry.markerDeltas > 0)

const bucket = (value, edges) => edges.find((edge) => value <= edge) ?? edges[edges.length - 1]
const table = (name, keyOf) => {
  const rows = new Map()
  for (const entry of all) {
    const key = keyOf(entry)
    const row = rows.get(key) ?? { requests: 0, leaking: 0 }
    row.requests += 1
    if (entry.markerDeltas > 0) row.leaking += 1
    rows.set(key, row)
  }
  console.log('\n' + name)
  for (const [key, row] of [...rows].sort()) {
    console.log('  ' + String(key).padEnd(16) + ' requests=' + String(row.requests).padStart(4) + '  leaking=' + String(row.leaking).padStart(3) + '  rate=' + (row.leaking / row.requests * 100).toFixed(1) + '%')
  }
}

console.log('trace:', path)
console.log('requests:', all.length, ' leaking:', leaking.length, ' rate:', all.length ? (leaking.length / all.length * 100).toFixed(1) + '%' : '0%')
table('by tool count', (entry) => bucket(entry.tools ?? 0, [0, 1, 8, 20, 38, 64]))
table('by context chars', (entry) => bucket(entry.chars ?? 0, [1000, 10000, 50000, 200000, 1000000]))
table('by system prompt', (entry) => (entry.hasSystem ? 'system' : 'no-system'))
table('by model', (entry) => entry.model ?? '?')

if (leaking.length > 0) {
  console.log('\nfirst leaking requests:')
  for (const entry of leaking.slice(0, 5)) {
    console.log('  rid=' + entry.rid, 'model=' + entry.model, 'tools=' + entry.tools, 'chars=' + entry.chars, 'markerDeltas=' + entry.markerDeltas)
    for (const delta of entry.deltas.slice(0, 2)) console.log('    ' + delta.field + ' len=' + delta.len + ' ' + JSON.stringify(String(delta.excerpt ?? '').slice(0, 160)))
  }
} else {
  console.log('\nno leaking request in this trace yet — keep working; the trace records it when it happens.')
}
