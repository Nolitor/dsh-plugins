#!/usr/bin/env node
/**
 * DSH_HOME isolation guard for the workspace's own scripts and test harnesses.
 *
 * WHY: running `dsh` (or a TokenEconomizer engine that spawns it) with the default
 * `~/.dsh` leaves session logs in the live sidebar under cwd values like
 * `/tmp/te-side-*`. Those logs become the "그룹 없음" (unregistered) flood. A test
 * or measurement script must never be able to write the owner's live home.
 *
 * WHAT IT CHECKS (source scan only — it never executes the scanned files):
 *   1. A JS/TS spawn-like call whose target is the `dsh` binary (literal `'dsh'`,
 *      `"dsh"`, a template literal, or a joined path ending in `dsh`) must pass a
 *      `DSH_HOME` in the same call options.
 *   2. A JS/TS spawn-like call that runs a TokenEconomizer engine entry (`bin/te`,
 *      `bin/te-hook`, `te-dsh`) is treated as an indirect DSH launcher: the engine
 *      spawns `dsh --profile headless` for side calls, so it needs `DSH_HOME`.
 *   3. A shell line that runs `dsh <subcommand>` must carry a `DSH_HOME=` prefix
 *      (or a script-level `ds_home=`/`iso=$(mktemp -d)` allocation that the same
 *      line references).
 *   4. No test file may set `process.env.DSH_HOME` to the live home
 *      (`homedir() + '/.dsh'` or `$HOME/.dsh`).
 *
 * ESCAPE HATCHES (both explicit, both printed by the guard so they stay visible):
 *   - `// dsh-isolation: read-only-live-home` on the file: a measurement/audit
 *     script that only READS the live home (never launches DSH, never writes).
 *   - `# dsh-isolation: live-intentional` on the file: an owner-run install/restart
 *     script whose entire purpose is a live write. Such a script must also refuse
 *     to run without the owner's explicit confirmation (see docs/DSH-HOME-ISOLATION.md).
 *
 * USAGE:
 *   node scripts/check-dsh-isolation.mjs            # human report, exit 1 on violations
 *   node scripts/check-dsh-isolation.mjs --json     # machine-readable
 *   node scripts/check-dsh-isolation.mjs --self-test
 *
 * @module scripts/check-dsh-isolation
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
/** Directories that are evidence/history, not runnable production harnesses. */
const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.verify', 'artifacts', '.runtime-measure', 'verification', 'staging'])
/** Roots that contain runnable launchers. Everything else is prose or product code. */
const SCAN_ROOTS = ['scripts', 'docs']
/** The guard's own test file contains rule fixtures as source text; exclude it. */
const EXCLUDED_FILES = new Set(['scripts/check-dsh-isolation.test.mjs'])

const READ_ONLY_MARK = 'dsh-isolation: read-only-live-home'
const LIVE_INTENTIONAL_MARK = 'dsh-isolation: live-intentional'

/** Source extensions the scanner reads. */
const CODE_EXT = /\.(mjs|cjs|js|ts|sh)$/

/**
 * Every runnable file under the scan roots.
 * @param {string} [root] - workspace root override (tests).
 * @returns {string[]} absolute paths.
 */
export function listSourceFiles(root = ROOT) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (EXCLUDED_DIRS.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (CODE_EXT.test(entry.name)) {
        const rel = relative(root, full)
        if (!EXCLUDED_FILES.has(rel)) out.push(full)
      }
    }
  }
  for (const scanRoot of SCAN_ROOTS) {
    try { walk(join(root, scanRoot)) } catch { /* optional root */ }
  }
  // Plugin test harnesses: test/, test/live/, and scripts/ inside a dsh-* track.
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('dsh-')) continue
    for (const sub of ['test', 'scripts']) {
      try { walk(join(root, entry.name, sub)) } catch { /* track without that dir */ }
    }
  }
  return out.sort()
}

/** Spawn-like calls in JS. */
const SPAWN_CALL = /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync)\s*\(\s*/g
/** The target argument of such a call is the dsh binary. */
const DSH_TARGET = /^(?:'dsh'|"dsh"|`dsh`|(?:[A-Za-z_$][\w$]*\s*\+\s*)*join\([^)]*['"]dsh['"][^)]*\))/
/** TokenEconomizer engine entries that spawn `dsh --profile headless` themselves. */
const ENGINE_TARGET = /join\([^)]*['"](?:te|te-hook|te-dsh)['"][^)]*\)|['"](?:te-hook|te-dsh)['"]/
/** A shell command line that invokes the dsh CLI. */
const SHELL_DSH = /(^|[;&|({]\s*)(?:[A-Za-z_][\w]*=\S*\s+)*dsh\s+(?:web|headless|plugin|acp|--profile|--help|run\b)/
/** A live home default for DSH. */
const LIVE_HOME = /(?:homedir\(\)\s*,\s*['"]\.dsh['"]|HOME['"]?\s*[,+]\s*['"]\/?\.dsh['"]|\$HOME\/\.dsh|\$\{HOME\}\/\.dsh)/

/** Extract the balanced argument text of a call starting at `openIndex` (points at '('). */
function callText(src, openIndex, limit = 2000) {
  let depth = 0
  let quote = null
  for (let i = openIndex; i < Math.min(src.length, openIndex + limit); i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') { i++; continue }
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === '(') depth++
    else if (c === ')') { depth--; if (depth === 0) return src.slice(openIndex, i + 1) }
  }
  return src.slice(openIndex, Math.min(src.length, openIndex + limit))
}

/** Line number of an index in the source. */
function lineOf(src, index) {
  return src.slice(0, index).split('\n').length
}

/**
 * Scan one source text and return isolation violations.
 * @param {object} input - { file, text, kind } where kind is 'js' or 'sh'.
 * @returns {Array<{file:string,line:number,rule:string,evidence:string}>} violations.
 */
export function scanText({ file = '<memory>', text, kind }) {
  const violations = []
  const hasReadOnly = text.includes(READ_ONLY_MARK)
  const hasLiveIntentional = text.includes(LIVE_INTENTIONAL_MARK)

  if (kind === 'sh') {
    const lines = text.split('\n')
    lines.forEach((line, index) => {
      // Strip comments for the command test but keep the raw line as evidence.
      const command = line.replace(/(^|\s)#.*$/, '')
      if (!SHELL_DSH.test(command)) return
      if (/DSH_HOME=\S+\s+.*\bdsh\b/.test(command)) return
      const scriptAllocatesTempHome = /(?:DSH_HOME|iso|tmp|home)\s*=\s*"?\$\(mktemp\s+-d/.test(text)
      if (!scriptAllocatesTempHome && hasLiveIntentional) return
      if (hasLiveIntentional) return
      violations.push({
        file,
        line: index + 1,
        rule: 'shell-dsh-without-DSH_HOME',
        evidence: line.trim().slice(0, 160),
      })
    })
    return violations
  }

  // JS: spawn-like calls.
  SPAWN_CALL.lastIndex = 0
  let match
  while ((match = SPAWN_CALL.exec(text)) !== null) {
    const open = text.indexOf('(', match.index + match[0].length - 1)
    const args = callText(text, open)
    const target = args.slice(1).trimStart()
    const isDsh = DSH_TARGET.test(target)
    const isEngine = !isDsh && ENGINE_TARGET.test(target)
    if (!isDsh && !isEngine) continue
    const isolated = args.includes('DSH_HOME')
    if (isolated) continue
    if (hasReadOnly || hasLiveIntentional) continue
    violations.push({
      file,
      line: lineOf(text, match.index),
      rule: isEngine ? 'engine-spawn-without-DSH_HOME' : 'spawn-dsh-without-DSH_HOME',
      evidence: args.replace(/\s+/g, ' ').slice(0, 160),
    })
  }

  // JS: a test that pins the live home.
  for (const m of text.matchAll(/process\.env\.DSH_HOME\s*=\s*([^\n]{0,120})/g)) {
    if (LIVE_HOME.test(m[1]) && !hasReadOnly) {
      violations.push({
        file,
        line: lineOf(text, m.index),
        rule: 'process-env-pins-live-home',
        evidence: m[0].trim().slice(0, 160),
      })
    }
  }
  return violations
}

/** Scan the workspace. */
export function scanWorkspace(root = ROOT) {
  const violations = []
  const annotations = []
  for (const file of listSourceFiles(root)) {
    const text = readFileSync(file, 'utf8')
    const kind = file.endsWith('.sh') ? 'sh' : 'js'
    const rel = relative(root, file)
    if (text.includes(READ_ONLY_MARK)) annotations.push({ file: rel, annotation: 'read-only-live-home' })
    if (text.includes(LIVE_INTENTIONAL_MARK)) annotations.push({ file: rel, annotation: 'live-intentional' })
    violations.push(...scanText({ file: rel, text, kind }))
  }
  return { violations, annotations }
}

// ---------------------------------------------------------------------------
// Self-test: proves the scanner detects each rule and respects the escape hatches.
// ---------------------------------------------------------------------------
const SELF_TEST_FIXTURES = [
  {
    name: 'unisolated spawn of dsh',
    kind: 'js',
    text: "spawn('dsh', ['web', '--no-open'], { stdio: 'ignore' })",
    expect: 'spawn-dsh-without-DSH_HOME',
  },
  {
    name: 'isolated spawn of dsh',
    kind: 'js',
    text: "spawn('dsh', ['web'], { env: { ...process.env, DSH_HOME: iso } })",
    expect: null,
  },
  {
    name: 'unisolated engine spawn',
    kind: 'js',
    text: "execFileSync(join(home, 'bin', 'te'), ['--host', 'dsh'], { env: { ...process.env } })",
    expect: 'engine-spawn-without-DSH_HOME',
  },
  {
    name: 'engine spawn with DSH_HOME',
    kind: 'js',
    text: "execFileSync(join(home, 'bin', 'te'), ['--host', 'dsh'], { env: { ...process.env, DSH_HOME: tempHome } })",
    expect: null,
  },
  {
    name: 'shell dsh without DSH_HOME',
    kind: 'sh',
    text: 'dsh web --no-open --port 0',
    expect: 'shell-dsh-without-DSH_HOME',
  },
  {
    name: 'shell dsh with DSH_HOME',
    kind: 'sh',
    text: 'DSH_HOME="$iso" timeout 45 dsh web --no-open --port 0',
    expect: null,
  },
  {
    name: 'process.env pinned to live home',
    kind: 'js',
    text: "process.env.DSH_HOME = join(homedir(), '.dsh')",
    expect: 'process-env-pins-live-home',
  },
  {
    name: 'read-only annotation allows a live-home read',
    kind: 'js',
    text: "const HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')\n// dsh-isolation: read-only-live-home",
    expect: null,
  },
  {
    name: 'live-intentional annotation allows a live install',
    kind: 'sh',
    text: "# dsh-isolation: live-intentional\ndsh plugin --profile web add \"link:$PLUGIN\"",
    expect: null,
  },
]

function selfTest() {
  let failures = 0
  for (const fixture of SELF_TEST_FIXTURES) {
    const found = scanText({ file: fixture.name, text: fixture.text, kind: fixture.kind })
    const actual = found[0]?.rule ?? null
    const ok = actual === fixture.expect
    if (!ok) failures++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${fixture.name}${ok ? '' : ` (expected ${fixture.expect ?? 'none'}, got ${actual ?? 'none'})`}`)
  }
  console.log(failures === 0 ? `self-test: ${SELF_TEST_FIXTURES.length}/${SELF_TEST_FIXTURES.length} pass` : `self-test: ${failures} failure(s)`)
  return failures === 0
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  const argv = process.argv.slice(2)
  if (argv.includes('--self-test')) process.exitCode = selfTest() ? 0 : 1
  else {
    const { violations, annotations } = scanWorkspace()
    const report = {
      ok: violations.length === 0,
      scannedRoots: SCAN_ROOTS,
      violations,
      annotations,
    }
    if (argv.includes('--json')) console.log(JSON.stringify(report, null, 2))
    else {
      console.log('DSH_HOME isolation guard')
      console.log('  violations:', violations.length)
      for (const violation of violations) {
        console.log(`  - ${violation.file}:${violation.line}  ${violation.rule}`)
        console.log(`      ${violation.evidence}`)
      }
      console.log('  explicit escape hatches:')
      for (const annotation of annotations) console.log(`  - ${annotation.file}  (${annotation.annotation})`)
      console.log(violations.length === 0
        ? '\nPASS — every DSH launcher in scripts/tests/ is isolated or explicitly annotated.'
        : '\nFAIL — isolate the launcher (temp DSH_HOME) or annotate it with a reason.')
    }
    process.exitCode = report.ok ? 0 : 1
  }
}
