import { readFileSync } from 'node:fs'
const payload = JSON.parse(readFileSync('/tmp/ms4.json', 'utf8'))

// Question 1: is the long list needed?
console.log('=== list scope (activePlan=' + payload.activePlan + ') ===')
const sel = payload.models.filter((m) => m.available)
const other = payload.models.filter((m) => m.plan !== payload.activePlan)
console.log('served rows        ', payload.models.length)
console.log('selectable rows    ', sel.length)
console.log('other-plan rows    ', other.length, '-> all disabled, badge "다른 플랜" x' + other.length)
const usedByUi = ['route', 'name', 'plan', 'available', 'state', 'rank', 'isNew']
console.log('fields per row     ', usedByUi.length, '(client uses all of them)')
console.log('bytes per row      ', Math.round(JSON.stringify(payload.models).length / payload.models.length))

// Question 2: what the classification pipeline actually costs.
const SRC = '/home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-opencode-v2/lib/'
const lines = (f) => readFileSync(SRC + f, 'utf8').split('\n').length
console.log('\n=== serving pipeline modules ===')
const modules = ['http.js', 'notation-classifier.js', 'display-gate.js', 'display-clean.js', 'upstream-map.js', 'arguments.js', 'trace.js']
for (const m of modules) console.log(String(lines(m)).padStart(5), m)
console.log(String(modules.reduce((s, m) => s + lines(m), 0)).padStart(5), 'total in pipeline')

// Which of those modules are actually on the per-delta hot path?
const http = readFileSync(SRC + 'http.js', 'utf8')
console.log('\n=== per-delta path: what runs for every SSE delta ===')
console.log('mapChatDelta     ', /for \(const part of mapChatDelta/.test(http) ? 'yes' : 'no')
console.log('classifier.push  ', /classifier\.push\(part\.text\)/.test(http) ? 'yes' : 'no')
console.log('routeParts       ', /yield\* routeParts/.test(http) ? 'yes' : 'no')
console.log('stripThinkingTags', /stripThinkingTags\(/.test(http) ? 'yes (costs a split() per reasoning delta)' : 'no')
