import { createCostStore } from '../../lib/cost.js'
// Does the adapter resolve a real path in the live profile?
const store = createCostStore({ explicit: '', profileDir: process.env.HOME + '/.dsh/profiles/web', dshHome: process.env.DSH_HOME })
console.log('resolved path:', store.path)
console.log('write ok     :', store.write({ sessions: { probe: { requests: 1 } }, savedAt: new Date().toISOString() }))
console.log('read back    :', JSON.stringify(store.read()))
