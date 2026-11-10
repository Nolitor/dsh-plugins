import { readFileSync } from 'node:fs'

const payload = JSON.parse(readFileSync('/tmp/ms4.json', 'utf8'))
const active = payload.activePlan

// Question 1: how much of the list is even actionable?
const rows = payload.models
const byPlan = {}
for (const m of rows) byPlan[m.plan] = (byPlan[m.plan] || 0) + 1
const selectable = rows.filter((m) => m.available).length
console.log('activePlan      ', active)
console.log('rows served     ', rows.length, JSON.stringify(byPlan))
console.log('rows selectable ', selectable)
console.log('rows disabled   ', rows.length - selectable, '(' + Math.round((rows.length - selectable) / rows.length * 100) + '% of the list is unclickable)')
const otherPlan = rows.filter((m) => m.plan !== active)
console.log('other-plan rows ', otherPlan.length, '-> badge "다른 플랜" rendered', otherPlan.length, 'times')
console.log('enabled routes  ', payload.enabled.length, 'all of plan', [...new Set(payload.enabled.map((r) => r.split('/')[0]))])
// What the payload costs per row (the client never uses most of it for other-plan rows)
console.log('\nper-row keys served:', Object.keys(rows[0]).join(', '))

// How many rows would remain if the list were scoped to the active plan?
console.log('\nscoped list would be:', rows.filter((m) => m.plan === active).length, 'rows')
