import { readFileSync } from 'node:fs'
import { orderModels } from '/home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-opencode-v2/lib/plans.js'
const payload = JSON.parse(readFileSync('/tmp/ms.json', 'utf8'))
const verdicts = payload.verdicts ?? {}
const rows = payload.models.map((m) => ({ route: m.route, name: m.name }))
const now = Date.parse('2026-11-04T01:20:00Z')
const firstSeen = { 'opencode/pulse-alpha-free': '2026-11-03T08:32:04.443Z' }
for (const activePlan of ['go', 'zen']) {
  const ordered = orderModels(rows, { activePlan, verdicts, firstSeen, now, ranking: {} })
  const tally = {}
  for (const m of ordered) {
    const k = m.plan + ' | ' + m.state + ' | ' + (m.available ? 'available' : 'blocked')
    tally[k] = (tally[k] || 0) + 1
  }
  console.log('=== activePlan ' + activePlan)
  for (const [k, v] of Object.entries(tally).sort()) console.log(String(v).padStart(3), k)
  const planSeq = ordered.map((m) => m.plan).join(',')
  const blocks = planSeq.replace(/(\w+)(,\1)*/g, '$1').split(',')
  console.log('plan blocks in order:', blocks.join(' -> '))
  console.log('first 3:', ordered.slice(0, 3).map((m) => m.state + ' ' + m.route).join(' | '))
  console.log('last 3:', ordered.slice(-3).map((m) => m.state + ' ' + m.route).join(' | '))
}
