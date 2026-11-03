/**
 * Measure the Korean pack against the dictionaries the running DSH actually ships.
 *
 * The per-package locale/*.json files are metadata stubs ({"meta":{"title":...}});
 * the real UI dictionaries are JS object literals passed to ctx.locale.register()
 * inside each lib/client.js bundle, bound through module-level consts (zh, en, ...).
 * This resolves those bindings and evaluates the literals (unquoted keys).
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const DSH = '/home/minami/.local/nodejs/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const PACK = process.argv[2] || 'dsh-korean-locale/data/ko.json'

function readBalanced(s, start) {
  let depth = 0, i = start, inStr = false, esc = false
  for (; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return s.slice(start, i + 1) }
  }
  return null
}

function literal(text) {
  try { return JSON.parse(text) } catch {}
  try { return vm.runInNewContext('(' + text + ')', Object.create(null), { timeout: 2000 }) } catch {}
  return tolerantPairs(text)
}

/**
 * Some bundles interpolate module constants (e.g. PLAN_NEXT_ACTION_EN) into their
 * dictionaries, so the literal cannot be evaluated. Scan depth-1 key/value pairs
 * instead: string values are kept, any other expression records its key with null.
 */
function tolerantPairs(text) {
  const out = {}
  let i = 0
  const n = text.length
  const skipWs = () => { while (i < n && /\s/.test(text[i])) i++ }
  i++
  while (i < n) {
    skipWs()
    if (text[i] === '}' || i >= n) break
    if (text[i] === ',') { i++; continue }
    let key = null
    if (text[i] === '"' || text[i] === "'") {
      const q = text[i]
      const end = text.indexOf(q, i + 1)
      if (end === -1) break
      key = text.slice(i + 1, end)
      i = end + 1
    } else {
      const start = i
      while (i < n && text[i] !== ':' && text[i] !== ',' && text[i] !== '}') i++
      key = text.slice(start, i).trim()
    }
    skipWs()
    if (text[i] !== ':') { if (text[i] === ',') i++; continue }
    i++
    skipWs()
    if (text[i] === '"' || text[i] === "'") {
      const q = text[i]
      let j = i + 1
      let val = ''
      while (j < n) {
        const c = text[j]
        if (c === '\\') { val += text[j + 1] ?? ''; j += 2; continue }
        if (c === q) break
        val += c
        j++
      }
      out[key] = val
      i = j + 1
    } else {
      // Non-literal expression: record the key, skip to the next depth-1 separator.
      let depth = 0
      while (i < n) {
        const c = text[i]
        if (c === '{' || c === '[' || c === '(') depth++
        else if (c === '}' || c === ']' || c === ')') { if (depth === 0) break; depth-- }
        else if (c === ',' && depth === 0) break
        else if (c === '"' || c === "'") {
          const q = c
          i++
          while (i < n && text[i] !== q) { if (text[i] === '\\') i++; i++ }
        }
        i++
      }
      if (!(key in out)) out[key] = null
    }
  }
  return Object.keys(out).length ? out : null
}

function constObjects(s) {
  const out = new Map()
  const re = /const\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g
  let m
  while ((m = re.exec(s)) !== null) {
    const braceAt = m.index + m[0].length - 1
    const text = readBalanced(s, braceAt)
    if (!text) continue
    const v = literal(text)
    if (v && typeof v === 'object' && !Array.isArray(v)) out.set(m[1], v)
  }
  return out
}

/** Resolve `const IDENT = "value"` without building a RegExp from the identifier (names like NS$1). */
function aliasValue(s, ident) {
  const needle = 'const ' + ident
  let i = s.indexOf(needle)
  while (i !== -1) {
    // Reject a prefix hit: "const NS" must not match "const NS$1".
    const after = s[i + needle.length]
    if (after !== undefined && /[\w$]/.test(after)) { i = s.indexOf(needle, i + 1); continue }
    const seg = s.slice(i + needle.length, i + needle.length + 240)
    const eq = seg.indexOf('=')
    if (eq !== -1) {
      const rest = seg.slice(eq + 1).replace(/^\s+/, '')
      const q = rest[0]
      if (q === '"' || q === "'") {
        const end = rest.indexOf(q, 1)
        if (end > 0) return rest.slice(1, end)
      }
    }
    i = s.indexOf(needle, i + 1)
  }
  return null
}

const enByName = {}, nsSource = {}, unresolved = []
for (const pkg of fs.readdirSync(DSH).sort()) {
  const f = path.join(DSH, pkg, 'lib', 'client.js')
  if (!fs.existsSync(f)) continue
  const s = fs.readFileSync(f, 'utf8')
  if (!s.includes('locale.register')) continue
  const objs = constObjects(s)
  const re = /locale\.register\(\s*([A-Za-z_$][\w$]*|["'][^"']+["'])\s*,\s*\{([\s\S]{0,4000}?)\}\s*[,)]/g
  let m
  while ((m = re.exec(s)) !== null) {
    const argRaw = m[1].trim()
    let ns = argRaw
    if (argRaw.startsWith('"') || argRaw.startsWith("'")) ns = argRaw.slice(1, -1)
    else ns = aliasValue(s, argRaw)
    if (!ns) continue
    // Body entries are either shorthand (en) or key:value pairs (en: en$6); the
    // dictionary is bound on the VALUE side, which differs per namespace.
    let enIdent = null
    for (const raw of m[2].split(',')) {
      const entry = raw.trim()
      if (!entry) continue
      const colon = entry.indexOf(':')
      if (colon === -1) { if (entry === 'en') enIdent = 'en'; continue }
      if (entry.slice(0, colon).trim() !== 'en') continue
      enIdent = entry.slice(colon + 1).trim()
    }
    if (!enIdent) continue
    const dict = objs.get(enIdent)
    if (!dict) { unresolved.push({ pkg, ns, enIdent }); continue }
    enByName[ns] = Object.assign(enByName[ns] || {}, dict)
    nsSource[ns] = nsSource[ns] || pkg
  }
}

const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'))
const rtNs = Object.keys(enByName).sort()
const packNs = Object.keys(pack)
let rtKeys = 0, packKeys = 0
for (const n of rtNs) rtKeys += Object.keys(enByName[n]).length
for (const n of packNs) packKeys += Object.keys(pack[n]).length

console.log('RUNTIME (alpha.3 client bundles):', rtNs.length, 'namespaces |', rtKeys, 'en keys | unresolved', unresolved.length)
console.log('PACK', PACK + ':', packNs.length, 'namespaces |', packKeys, 'keys')

if (process.env.DUMP_MISSING) {
  const out = {}
  for (const ns of rtNs) {
    for (const [k, en] of Object.entries(enByName[ns])) {
      const ko = pack[ns] && pack[ns][k]
      if (typeof ko === 'string') continue
      ;(out[ns] = out[ns] || {})[k] = en
    }
  }
  for (const ns of rtNs) if (!pack[ns] && !out[ns]) out[ns] = enByName[ns]
  console.log('DUMP_JSON=' + JSON.stringify(out))
  process.exit(0)
}

const missingNs = rtNs.filter(n => !pack[n])
console.log('== MISSING NAMESPACES:', missingNs.length, JSON.stringify(missingNs))
if (missingNs.length) for (const ns of missingNs) console.log('   ', ns, '->', Object.keys(enByName[ns]).length, 'keys (src', nsSource[ns] + ')')

let missingKeys = 0
const detail = []
for (const ns of rtNs) {
  if (!pack[ns]) continue
  const miss = Object.keys(enByName[ns]).filter(k => !(k in pack[ns]))
  if (miss.length) { missingKeys += miss.length; detail.push({ ns, src: nsSource[ns], missing: miss.length, sample: miss.slice(0, 12) }) }
}
console.log('== MISSING KEYS in shared namespaces:', missingKeys)
console.log(JSON.stringify(detail, null, 1))

const gone = packNs.filter(n => !enByName[n])
let goneKeys = 0
for (const n of gone) goneKeys += Object.keys(pack[n]).length
console.log('== PACK namespaces absent from alpha.3:', gone.length, '| keys', goneKeys)
console.log(JSON.stringify(gone))

const ph = s => (String(s).match(/\{\w+\}/g) || []).sort().join(',')
let phBad = 0
const phDetail = []
for (const ns of rtNs) for (const [k, en] of Object.entries(enByName[ns])) {
  const ko = pack[ns] && pack[ns][k]
  if (typeof ko !== 'string') continue
  if (ph(en) !== ph(ko)) { phBad++; if (phDetail.length < 15) phDetail.push({ ns, k, en: ph(en), ko: ph(ko) }) }
}
console.log('== PLACEHOLDER mismatches:', phBad)
console.log(JSON.stringify(phDetail, null, 1))
if (unresolved.length) console.log('UNRESOLVED:', JSON.stringify(unresolved.slice(0, 25)))
