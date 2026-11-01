#!/usr/bin/env node
/**
 * Summarize the real-traffic trace written by lib/trace.js.
 *
 * A short probe cannot reproduce the leak: it needs long, output-heavy turns. The
 * trace records real requests, so this reader groups them by the process that served
 * them, then prints the leak rate by tool count, context chars, system prompt and
 * model, plus the first leaking excerpts.
 *
 * Usage:
 *   node scripts/analyze-opencode-trace.mjs [path] [--pid <pid>] [--since <iso>]
 */
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const path = args.find((value) => !value.startsWith('--') && !/^\d+$/.test(value)) ?? '/tmp/opencode-v2-trace.jsonl'
const pidIndex = args.indexOf('--pid')
const pidFilter = pidIndex >= 0 ? Number(args[pidIndex + 1]) : null
const sinceIndex = args.indexOf('--since')
const since = sinceIndex >= 0 ? Date.parse(args[sinceIndex + 1]) : 0

const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => {
  try { return JSON.parse(line) } catch { return null }
}).filter((line) => line && (!since || Date.parse(line.at) >= since))

const byPid = new Map()
for (const line of lines) {
  const requests = byPid.get(line.pid) ?? new Map()
  const entry = requests.get(line.rid) ?? { rid: line.rid, pid: line.pid, deltas: [] }
  if (line.kind === 'request') Object.assign(entry, line)
  if (line.kind === 'finish') entry.finish = line
  if (line.kind === 'error') entry.error = line
  if (line.kind === 'delta') entry.deltas.push(line)
  requests.set(line.rid, entry)
  byPid.set(line.pid, requests)
}

console.log('trace:', path)
console.log('processes:', byPid.size)
const summary = []
for (const [pid, requests] of byPid) {
  const all = [...requests.values()].filter((entry) => entry.model)
  if (all.length === 0) continue
  const leaking = all.filter((entry) => entry.deltas.length > 0)
  const models = [...new Set(all.map((entry) => entry.model))].join(',')
  summary.push({ pid, requests: all.length, leaking: leaking.length, models, maxChars: Math.max(...all.map((entry) => entry.chars ?? 0)) })
}
summary.sort((a, b) => b.requests - a.requests)
for (const row of summary) {
  const mark = row.pid === pidFilter ? ' <-- selected' : ''
  console.log('  pid ' + row.pid + '  requests=' + String(row.requests).padStart(4) + '  leaking=' + String(row.leaking).padStart(3) + '  maxChars=' + String(row.maxChars).padStart(8) + '  model=' + row.models + mark)
}

const pickPid = pidFilter ?? (summary[0]?.pid ?? null)
if (pickPid === null) {
  console.log('\nno requests recorded yet — run real work with the plugin mounted.')
  process.exit(0)
}
const requests = byPid.get(pickPid) ?? new Map()
const all = [...requests.values()].filter((entry) => entry.model)
const leaking = all.filter((entry) => entry.deltas.length > 0)
const fields = {}
for (const entry of all) for (const delta of entry.deltas) fields[delta.field] = (fields[delta.field] ?? 0) + 1
console.log('\nselected pid:', pickPid, ' requests:', all.length, ' leaking:', leaking.length, ' rate:', all.length ? (leaking.length / all.length * 100).toFixed(1) + '%' : '0%')
console.log('marker deltas by field:', JSON.stringify(fields))

const bucket = (value, edges) => edges.find((edge) => value <= edge) ?? edges[edges.length - 1]
const table = (name, keyOf) => {
  const rows = new Map()
  for (const entry of all) {
    const key = keyOf(entry)
    const row = rows.get(key) ?? { requests: 0, leaking: 0 }
    row.requests += 1
    if (entry.deltas.length > 0) row.leaking += 1
    rows.set(key, row)
  }
  console.log('\n' + name)
  for (const [key, row] of [...rows].sort()) {
    console.log('  ' + String(key).padEnd(18) + ' requests=' + String(row.requests).padStart(4) + '  leaking=' + String(row.leaking).padStart(3) + '  rate=' + (row.leaking / row.requests * 100).toFixed(1) + '%')
  }
}
table('by tool count', (entry) => bucket(entry.tools ?? 0, [0, 1, 8, 20, 38, 64]))
table('by context chars', (entry) => bucket(entry.chars ?? 0, [1000, 10000, 50000, 200000, 1000000]))
table('by system prompt', (entry) => (entry.hasSystem ? 'system' : 'no-system'))
table('by model', (entry) => entry.model ?? '?')

if (leaking.length > 0) {
  console.log('\nfirst leaking requests:')
  for (const entry of leaking.slice(0, 6)) {
    console.log('  rid=' + entry.rid, 'model=' + entry.model, 'msgs=' + entry.messages, 'chars=' + entry.chars, 'tools=' + entry.tools, 'system=' + entry.hasSystem, 'finish=' + (entry.finish?.finish ?? '?'))
    for (const delta of entry.deltas.slice(0, 3)) console.log('    ' + delta.field + ' len=' + delta.len + ' ' + JSON.stringify(String(delta.excerpt ?? '').slice(0, 200)))
  }
}
