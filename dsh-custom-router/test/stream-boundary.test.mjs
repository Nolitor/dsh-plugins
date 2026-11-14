/**
 * L1 boundary lint (`ARCHITECTURE-LAYERED.md` §6.1) — the gate that keeps
 * `lib/stream/*` from leaking back into L2.
 *
 * The horizontal boundary held by inspection after Phase 1/2 (`HANDOFF.md` §3b)
 * but NOTHING failed when it was broken: a vendor import, a vendor identifier,
 * a Cordis/`process`/`fetch` reference, a per-vendor branch or a second SSE
 * decoder would all have landed green. This suite is that missing gate.
 *
 * Five assertions over every `lib/stream/*.js`:
 *   a. imports — every specifier is a sibling `./x.js`; no `vendor/`, no bare
 *      package, no `node:` builtin, no parent traversal;
 *   b. identifiers — zero DID vendor names (measured from the `vendor/` tree's
 *      package manifests, never typed in) in non-comment code; protocol
 *      vocabulary only where an
 *      exact allow-list entry says so, and an allow-list entry that no longer
 *      matches its measured count fails too;
 *   c. runtime deps — no `ctx.`, `process.env`, `node:*`, `fetch(`,
 *      `require(`, dynamic `import(`, clock or timer reads;
 *   d. branches — no `provider ===` nor any equality against a vendor id;
 *   e. singletons — exactly one SSE decoder, one usage writer, one finish
 *      table, one `abortError` factory, found by symbol search.
 *
 * The scan is a pure function of { filename → source } so the negative proof in
 * this file feeds it doctored sources: each rule has a mutation test that plants
 * the regression and asserts it is caught. A gate nobody has seen fail is a
 * gate nobody should trust.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const STREAM_DIR = join(ROOT, 'lib', 'stream')

/** Vendor names MEASURED from the vendored packages, never hand-listed. */
function measuredVendorWords() {
  const dir = join(ROOT, 'vendor')
  const words = new Set()
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    words.add(entry.name.toLowerCase())
    let name
    try {
      name = JSON.parse(readFileSync(join(dir, entry.name, 'package.json'), 'utf8')).name
    } catch {
      continue
    }
    if (typeof name !== 'string') continue
    for (const part of name.toLowerCase().split('/')) {
      if (part.startsWith('dsh-')) words.add(part.slice(4))
    }
  }
  return [...words].sort()
}

const VENDOR_WORDS = measuredVendorWords()

/**
 * Wire-protocol nouns that legitimately appear in L1 because they name a
 * PROTOCOL, not a vendor: the Anthropic Messages descriptor's protocol id, the
 * OpenAI-compatible wire name in error strings, and the two legacy formula
 * alias spellings the writer keeps resolvable.
 *
 * Every entry pins an exact count. `count` is not documentation: a new
 * occurrence of the allow-listed literal fails the gate, so the allow-list
 * cannot quietly grow.
 */
const PROTOCOL_ALLOW = Object.freeze([
  { file: 'anthropic.js', token: 'anthropic-messages', count: 1, why: 'descriptor.protocol id' },
  { file: 'openai.js', token: 'OpenAI-compatible', count: 4, why: 'error strings name the wire, not the vendor' },
  { file: 'usage.js', token: 'openai:', count: 1, why: 'published formula-alias spelling' },
  { file: 'usage.js', token: 'gemini:', count: 1, why: 'published formula-alias spelling' },
])

/** Protocol nouns with no allow-list entry must not appear at all. */
const PROTOCOL_WORDS = Object.freeze([
  'openai', 'anthropic', 'gemini', 'claude', 'deepseek', 'mistral', 'cohere', 'qwen',
  'moonshot', 'kimi', 'zhipu', 'grok', 'xai', 'llama', 'ollama', 'vllm',
])

/**
 * Remove comments while KEEPING string and template contents.
 *
 * Identifier rules must see error strings (a vendor name in a thrown message is
 * exactly the L2 leak the rule forbids), but a vendor name in `/** *\/` prose is
 * how the layer documents its history. One pass, so a `//` inside a string is
 * not mistaken for a comment (`'http://…'`) and a quote inside a comment is not
 * mistaken for code.
 *
 * @param {string} source - file text.
 * @returns {string} the same length with comment characters blanked to spaces.
 */
export function stripComments(source) {
  const out = source.split('')
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i += 1) if (out[i] !== '\n') out[i] = ' '
  }
  let index = 0
  let quote = null
  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]
    if (quote !== null) {
      if (char === '\\') {
        index += 2
        continue
      }
      if (char === quote) quote = null
      index += 1
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      index += 1
      continue
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2)
      const stop = end === -1 ? source.length : end + 2
      blank(index, stop)
      index = stop
      continue
    }
    if (char === '/' && next === '/') {
      let stop = index
      while (stop < source.length && source[stop] !== '\n') stop += 1
      blank(index, stop)
      index = stop
      continue
    }
    index += 1
  }
  return out.join('')
}

/** Every top-level function definition in comment-free source. */
function definitions(code) {
  const out = []
  const pattern = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\*?\s+([A-Za-z0-9_$]+)/g
  for (const match of code.matchAll(pattern)) out.push(match[1])
  return out
}

/**
 * Every static import/export-from specifier in comment-free source.
 *
 * Line-oriented on purpose: `lib/stream/index.js` re-exports a multi-line brace
 * block, so a single-line regex would silently skip the largest specifier in the
 * layer and the gate would under-count. A statement starts at a line that begins
 * with `import`/`export` and ends at the first `from '…'` it reaches.
 */
function specifiers(code) {
  const lines = code.split('\n')
  const out = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!/^\s*(?:import|export)\b/.test(line)) continue
    for (let scan = index; scan < Math.min(index + 40, lines.length); scan += 1) {
      const candidate = scan === index ? line : lines[scan]
      const match = /\bfrom\s*['"]([^'"]+)['"]/.exec(candidate) ?? /^\s*import\s*['"]([^'"]+)['"]/.exec(candidate)
      if (match !== null) {
        out.push(match[1])
        break
      }
      if (/;/ .test(candidate)) break
    }
  }
  return out
}

/**
 * Scan one stream layer for boundary violations.
 *
 * Pure: takes the file map, returns findings. Nothing is read here, so a test can
 * hand it a mutated copy and prove the rule fires.
 *
 * @param {Record<string, string>} sources - `filename.js` → source text.
 * @param {{ vendorWords?: string[], protocolAllow?: object[] }} [options] - overrides for the negative proof.
 * @returns {{ file: string, rule: string, message: string }[]} findings, empty when clean.
 */
export function scanStreamBoundary(sources, options = {}) {
  const vendorWords = options.vendorWords ?? VENDOR_WORDS
  const allow = options.protocolAllow ?? PROTOCOL_ALLOW
  const findings = []
  const add = (file, rule, message) => findings.push({ file, rule, message })
  const byFile = {}
  for (const [file, raw] of Object.entries(sources)) byFile[file] = stripComments(raw)

  for (const [file, code] of Object.entries(byFile)) {
    // (a) imports stay inside the layer
    for (const specifier of specifiers(code)) {
      if (!/^\.\/[A-Za-z0-9._-]+\.js$/.test(specifier)) {
        add(file, 'import', `forbidden specifier "${specifier}" — L1 may import only a sibling ./x.js`)
      }
      if (/vendor|@nolit\//.test(specifier)) add(file, 'import', `vendor specifier "${specifier}"`)
    }

    // (b) identifiers: vendor names never, protocol nouns only per allow-list
    const neutralise = (text, word) => text.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ')
    for (const word of vendorWords) {
      if (new RegExp(`\\b${word}\\b`, 'i').test(code)) {
        add(file, 'vendor-identifier', `vendor name "${word}" in L1 code`)
      }
    }
    let residual = code
    for (const entry of allow) {
      if (entry.file !== file) continue
      const actual = (residual.match(new RegExp(entry.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) ?? []).length
      if (actual !== entry.count) {
        add(file, 'allow-list', `allow-listed "${entry.token}" occurs ${actual}× but the gate pins ${entry.count}×`)
      }
      residual = neutralise(residual, entry.token)
    }
    for (const word of PROTOCOL_WORDS) {
      if (new RegExp(`\\b${word}\\b`, 'i').test(residual)) {
        add(file, 'protocol-word', `protocol/vendor word "${word}" in L1 code (no allow-list entry)`)
      }
    }

    // (c) no runtime dependencies: the pipe receives everything it needs
    const runtimeRules = [
      [/(^|[^\w.$])ctx\s*\./, 'ctx. (Cordis service access)'],
      [/process\s*\.\s*env/, 'process.env'],
      [/(^|[^\w.])require\s*\(/, 'require('],
      [/(^|[^\w.])fetch\s*\(/, 'fetch('],
      [/node:(?:fs|http|https|net|child_process|os|path)/, 'node: builtin'],
      [/(^|[^\w.])import\s*\(/, 'dynamic import('],
      [/(?:Date\.now|Math\.random|setTimeout|setInterval|globalThis)/, 'clock/timer/global read'],
    ]
    for (const [pattern, label] of runtimeRules) {
      const match = pattern.exec(code)
      if (match !== null) add(file, 'runtime-dep', `${label} at "${match[0].trim()}"`)
    }

    // (d) no per-vendor branch
    const branch = /\bprovider(?:Id)?\s*(?:===|!==|==|!=)/.exec(code)
    if (branch !== null) add(file, 'vendor-branch', `provider comparison "${branch[0]}"`)
    const vendorLiterals = vendorWords
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')
    const literal = new RegExp(`(?:===|!==|==|!=)\\s*['"\`](?:${vendorLiterals})['"\`]|['"\`](?:${vendorLiterals})['"\`]\\s*(?:===|!==|==|!=)`, 'i').exec(code)
    if (literal !== null) add(file, 'vendor-branch', `equality against a vendor id "${literal[0]}"`)
  }

  // (e) singletons, by symbol search across the whole layer
  const everywhere = Object.entries(byFile)
  const definedIn = (name) => everywhere.filter(([, code]) => definitions(code).includes(name)).map(([file]) => file)
  const countOf = (pattern) => everywhere.reduce((sum, [, code]) => sum + (code.match(pattern) ?? []).length, 0)

  const readSse = definedIn('readSseEvents')
  if (readSse.length !== 1 || readSse[0] !== 'sse.js') {
    add('lib/stream', 'singleton', `SSE reader readSseEvents defined in [${readSse.join(', ')}] — exactly one, in sse.js`)
  }
  const decoders = everywhere.filter(([, code]) => /new\s+TextDecoder\s*\(/.test(code)).map(([file]) => file)
  if (decoders.length !== 1 || decoders[0] !== 'sse.js') {
    add('lib/stream', 'singleton', `TextDecoder constructed in [${decoders.join(', ')}] — exactly one, in sse.js`)
  }
  const usageWriters = definedIn('usageFrom')
  if (usageWriters.length !== 1 || usageWriters[0] !== 'usage.js') {
    add('lib/stream', 'singleton', `usage writer usageFrom defined in [${usageWriters.join(', ')}] — exactly one, in usage.js`)
  }
  for (const [file, code] of everywhere) {
    for (const name of definitions(code)) {
      if (/^usageFrom[A-Z]/.test(name) && file !== 'usage.js') {
        add(file, 'singleton', `second usage writer "${name}" outside usage.js`)
      }
    }
  }
  const finishTables = definedIn('finishReasonFor')
  if (finishTables.length !== 1 || finishTables[0] !== 'wire.js') {
    add('lib/stream', 'singleton', `finish table finishReasonFor defined in [${finishTables.join(', ')}] — exactly one, in wire.js`)
  }
  for (const [file, code] of everywhere) {
    if (file === 'wire.js') continue
    const local = /(?:^|\n)\s*(?:export\s+)?const\s+FINISH_[A-Z_]+\s*=/.exec(code)
    if (local !== null) add(file, 'singleton', `second finish table "${local[0].trim()}" outside wire.js`)
  }
  const aborts = definedIn('abortError')
  if (aborts.length !== 1 || aborts[0] !== 'failure.js') {
    add('lib/stream', 'singleton', `abortError factory defined in [${aborts.join(', ')}] — exactly one, in failure.js`)
  }
  const abortNames = countOf(/\.name\s*=\s*['"`]AbortError['"`]/g)
  if (abortNames !== 1) {
    add('lib/stream', 'singleton', `AbortError name assignment occurs ${abortNames}× — exactly one factory (failure.js)`)
  }
  return findings
}

/** Read the real layer, refusing to scan a vacuum. */
function readStreamSources() {
  const files = readdirSync(STREAM_DIR).filter((name) => name.endsWith('.js')).sort()
  // A MINIMUM, not an exact count: adding a legit module must not fail the
  // gate, while an empty or unreadable directory must. The vacuity guard below
  // (code characters) is the real protection against scanning nothing.
  assert.ok(files.length >= 7, `lib/stream must expose at least its 7 modules; measured ${files.join(', ')}`)
  const sources = {}
  for (const file of files) sources[file] = readFileSync(join(STREAM_DIR, file), 'utf8')
  const code = Object.values(sources).map(stripComments).join('\n')
  assert.ok(code.length > 20_000, `the scan would be vacuous: ${code.length} code characters`)
  return sources
}

const SOURCES = readStreamSources()

test('the measured vendor set is non-empty and read from vendor/, not typed in', () => {
  assert.ok(VENDOR_WORDS.length >= 4, `measured vendor words: ${VENDOR_WORDS.join(', ')}`)
  assert.ok(VENDOR_WORDS.includes('deepinfra') && VENDOR_WORDS.includes('opencode'), VENDOR_WORDS.join(', '))
})

test('(a) every lib/stream import is a sibling ./x.js — no vendor, no bare package', () => {
  const findings = scanStreamBoundary(SOURCES).filter((finding) => finding.rule === 'import')
  assert.deepEqual(findings, [])
  const all = Object.values(SOURCES).flatMap(specifiers)
  assert.ok(all.length >= 15, `measured ${all.length} specifiers`)
  assert.ok(all.every((specifier) => /^\.\/[\w.-]+\.js$/.test(specifier)), all.join(' '))
})

test('(b) no vendor identifier in L1 code; protocol words only per pinned allow-list', () => {
  const findings = scanStreamBoundary(SOURCES).filter((finding) => ['vendor-identifier', 'protocol-word', 'allow-list'].includes(finding.rule))
  assert.deepEqual(findings, [])
})

test('(c) no ctx. / process.env / node:* / fetch( / require( inside lib/stream', () => {
  const findings = scanStreamBoundary(SOURCES).filter((finding) => finding.rule === 'runtime-dep')
  assert.deepEqual(findings, [])
})

test('(d) no per-vendor branch: no provider comparison, no vendor-id equality', () => {
  const findings = scanStreamBoundary(SOURCES).filter((finding) => finding.rule === 'vendor-branch')
  assert.deepEqual(findings, [])
})

test('(e) exactly one SSE decoder, usage writer, finish table and abortError factory', () => {
  const findings = scanStreamBoundary(SOURCES).filter((finding) => finding.rule === 'singleton')
  assert.deepEqual(findings, [])
})

test('the whole layer is clean in one pass', () => {
  assert.deepEqual(scanStreamBoundary(SOURCES), [])
})

// ------------------------------------------------------- negative proof (5×2)
// Each rule is exercised against a doctored copy of the real sources. If a
// mutation stops failing, the gate has stopped working — which is the only way
// this suite can be trusted as a gate rather than a description.

function mutated(file, text) {
  return { ...SOURCES, [file]: `${text}\n${SOURCES[file]}` }
}

test('mutation: a vendor import is caught (rule a)', () => {
  const findings = scanStreamBoundary(mutated('wire.js', "import { readSseEvents } from '../vendor/deepinfra/lib/sse.js'"))
  assert.ok(findings.some((finding) => finding.rule === 'import' && /vendor/.test(finding.message)), JSON.stringify(findings))
})

test('mutation: a bare or node: import is caught (rule a)', () => {
  for (const specifier of ['node:fs', '@nolit/dsh-deepinfra', '../lib/presets.js']) {
    const findings = scanStreamBoundary(mutated('wire.js', `import { x } from '${specifier}'`))
    assert.ok(findings.some((finding) => finding.rule === 'import'), `${specifier}: ${JSON.stringify(findings)}`)
  }
})

test('mutation: a vendor identifier in code or error text is caught (rule b)', () => {
  const findings = scanStreamBoundary(mutated('wire.js', "const vendor = 'deepinfra'\nthrow new Error('exaone said no')"))
  assert.ok(findings.some((finding) => finding.rule === 'vendor-identifier'), JSON.stringify(findings))
})

test('mutation: an allow-listed literal that grows fails, and an unlisted protocol word fails (rule b)', () => {
  const grown = scanStreamBoundary(mutated('openai.js', 'const leak = "OpenAI-compatible again"'))
  assert.ok(grown.some((finding) => finding.rule === 'allow-list'), JSON.stringify(grown))
  const unlisted = scanStreamBoundary(mutated('sse.js', "const leak = 'claude-3-opus'"))
  assert.ok(unlisted.some((finding) => finding.rule === 'protocol-word'), JSON.stringify(unlisted))
})

test('mutation: ctx. / process.env / fetch( are caught (rule c)', () => {
  for (const line of ['const service = ctx.configForms', "const token = process.env.TOKEN", 'const response = await fetch(url)', 'const text = require("node:fs")']) {
    const findings = scanStreamBoundary(mutated('index.js', line))
    assert.ok(findings.some((finding) => finding.rule === 'runtime-dep'), `${line}: ${JSON.stringify(findings)}`)
  }
})

test('mutation: a per-vendor branch is caught (rule d)', () => {
  for (const line of ["if (provider === 'opencode') return", 'if (providerId !== "antigravity") throw new Error("x")']) {
    const findings = scanStreamBoundary(mutated('index.js', line))
    assert.ok(findings.some((finding) => finding.rule === 'vendor-branch'), `${line}: ${JSON.stringify(findings)}`)
  }
})

test('mutation: a second SSE decoder, usage writer, finish table or abortError factory is caught (rule e)', () => {
  const secondDecoder = scanStreamBoundary(mutated('index.js', 'const decoder = new TextDecoder()'))
  assert.ok(secondDecoder.some((finding) => finding.rule === 'singleton' && /TextDecoder/.test(finding.message)), JSON.stringify(secondDecoder))

  const secondWriter = scanStreamBoundary(mutated('index.js', 'export function usageFromVendor(raw) { return raw }'))
  assert.ok(secondWriter.some((finding) => finding.rule === 'singleton' && /usage writer/.test(finding.message)), JSON.stringify(secondWriter))

  const secondFinish = scanStreamBoundary(mutated('index.js', 'const FINISH_NORMAL = new Set(["stop"])'))
  assert.ok(secondFinish.some((finding) => finding.rule === 'singleton' && /finish table/.test(finding.message)), JSON.stringify(secondFinish))

  const secondAbort = scanStreamBoundary(mutated('index.js', 'export function abortErrorAgain(message) { const error = new Error(message); error.name = "AbortError"; return error }'))
  assert.ok(secondAbort.some((finding) => finding.rule === 'singleton' && /AbortError|abortError/.test(finding.message)), JSON.stringify(secondAbort))
})

test('comment stripping keeps error strings and drops prose', () => {
  const code = stripComments("// vendor deepinfra import\n'/* not a comment */'\nconst url = 'http://x//y'")
  assert.ok(!code.includes('vendor deepinfra import'))
  assert.ok(code.includes('http://x//y'))
  assert.ok(code.includes('not a comment'))
})
