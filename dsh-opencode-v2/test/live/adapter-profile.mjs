import { readFileSync } from 'node:fs'

const SRC = readFileSync('/home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-opencode-v2/lib/http.js', 'utf8')
const lines = SRC.split('\n')
const methods = []
let current = null
for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i]
  const m = /^  (?:async )?[_*]*([A-Za-z_][A-Za-z0-9_]*)\(/.exec(line)
  if (m) {
    if (current) methods.push({ ...current, end: i })
    current = { name: m[1], start: i }
  }
}
if (current) methods.push({ ...current, end: lines.length })
const sized = methods.map((m) => ({ name: m.name, lines: m.end - m.start })).sort((a, b) => b.lines - a.lines)
console.log('=== OpencodeHttpAdapter methods by size (top 20) ===')
for (const m of sized.slice(0, 20)) console.log(String(m.lines).padStart(4), m.name)
console.log('method lines total', sized.reduce((s, m) => s + m.lines, 0), 'of', lines.length)