import { readFileSync } from 'node:fs'
import zlib from 'node:zlib'
import { join } from 'node:path'

// Which session does the adapter actually stamp? Read the trace for the serving pid.
const pid = Number(String(process.env.SERVING_PID || '0'))
const lines = readFileSync('/tmp/opencode-v2-trace.jsonl', 'utf8').trim().split('\n')
const rows = lines.map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
const reqs = rows.filter((r) => r.kind === 'request' && (pid === 0 || r.pid === pid))
const bySession = {}
for (const r of reqs) bySession[r.session ?? '(null)'] = (bySession[r.session ?? '(null)'] ?? 0) + 1
console.log('serving pid:', pid || 'all')
console.log('adapter request sessions:', JSON.stringify(bySession, null, 1))

// And what the DSH session log says the real session id is.
const dir = join(process.env.HOME, '.dsh/sessions/--home-minami-Workspace-projects-dsh-workspace-dsh-plugins--')
const { readdirSync } = await import('node:fs')
const sessions = readdirSync(dir).filter((n) => n.startsWith('session-'))
console.log('session dirs:', sessions.slice(0, 6))
