
// Measure the loop-guard judge overhead before/after the 2026-11-05 config change.
// Read-only over ~/.tokeneconomizer. Run: node measure.mjs [--json out.json]
import { readdirSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const T_CHANGE = Number(process.env.T_CHANGE ?? 1793833939.670)
const START = 1793571849158 / 1000
const END = 1793831049158 / 1000
const root = join(homedir(), '.tokeneconomizer')
const repos = join(root, 'repos')
const kst = (t) => new Date(t * 1000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })

const before = { calls: 0, judgeTokens: 0, writerTokens: 0, byDay: {}, byRepo: {} }
const after = { calls: 0, tokens: 0, records: [] }
let judgeFilesAfter = 0

for (const repo of readdirSync(repos)) {
  const d = join(repos, repo, 'dsh')
  if (!existsSync(d)) continue
  const lp = join(d, 'ledger.jsonl')
  if (existsSync(lp)) {
    for (const line of readFileSync(lp, 'utf8').split('\n').filter(Boolean)) {
      let r; try { r = JSON.parse(line) } catch { continue }
      if (r.kind !== 'overhead') continue
      const j = (r.overhead?.spiral_judge_tokens) || 0
      const w = (r.overhead?.spiral_nudge_writer_tokens) || 0
      if (r.at >= START && r.at <= END) {
        before.calls++; before.judgeTokens += j; before.writerTokens += w
        const day = kst(r.at)
        before.byDay[day] = (before.byDay[day] || 0) + j + w
        before.byRepo[repo] = (before.byRepo[repo] || 0) + j + w
      } else if (r.at >= T_CHANGE) {
        after.calls++; after.tokens += j + w
        after.records.push({ repo, at: r.at, judge: j, writer: w })
      }
    }
  }
  const jd = join(d, 'judge')
  if (existsSync(jd)) for (const f of readdirSync(jd)) {
    if (statSync(join(jd, f)).mtimeMs / 1000 >= T_CHANGE) judgeFilesAfter++
  }
}

const cfgPath = join(root, 'config.json')
const config = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : null
const report = {
  generatedAt: new Date().toISOString(),
  window: { startMs: START * 1000, endMs: END * 1000 },
  change: { at: T_CHANGE, iso: new Date(T_CHANGE * 1000).toISOString(), action: 'A: pin loopguard.gate_min_turns=100000 and loopguard.gate_error_outputs=100000 (global config)', configPath: cfgPath, config },
  before: {
    calls: before.calls,
    judgeTokens: Math.round(before.judgeTokens),
    writerTokens: Math.round(before.writerTokens),
    totalTokens: Math.round(before.judgeTokens + before.writerTokens),
    tokensPerCall: before.calls ? Math.round((before.judgeTokens + before.writerTokens) / before.calls) : 0,
    byDayKst: Object.fromEntries(Object.entries(before.byDay).map(([k, v]) => [k, Math.round(v)])),
    byRepo: Object.fromEntries(Object.entries(before.byRepo).map(([k, v]) => [k, Math.round(v)])),
  },
  after: { calls: after.calls, tokens: Math.round(after.tokens), records: after.records, judgeFilesTouched: judgeFilesAfter },
  remainingRuleBased: {
    backstop: 'is_stuck + envelope*2.5, checked before the judge (nudge then abort)',
    dshLoopBreaker: 'identical failure x3 within 5 calls (rule-based, plugin-local)',
    watchdog: 'no-progress step/tool budget (10 min)',
  },
}
console.log(JSON.stringify(report, null, 1))
const i = process.argv.indexOf('--json')
if (i !== -1 && process.argv[i + 1]) writeFileSync(process.argv[i + 1], JSON.stringify(report, null, 1) + '\n')
