/**
 * Promotion Gate G1–G6 — executable projection of the internal contract.
 *
 * Source of truth: `UTM-PROMOTION-GATE-SPEC.md` §2 (the restored original
 * `docs/architecture/PROMOTION-GATE.md` + `promotion.mjs`). That spec defines the
 * six checks and their blocker codes, but its reference implementation
 * (`governance-core/src/gate.mjs`) was never restored and `~/.dsh/governance`
 * does not exist on this machine — which is why the gate was "fail-open by
 * absence". This module supplies the missing runtime so the documented contract
 * can actually be evaluated.
 *
 * Design rules taken from the spec:
 *  - preview is side-effect free; apply is atomic;
 *  - G2 (skeleton generation) is separate from G3 (integrity), and G4 runs after G2;
 *  - G1 judges the *tracked* tree only;
 *  - the gate itself never writes to the registry.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

export const GATE_CODES = {
  G1: ['GATE_GIT_DIRTY', 'GATE_NO_REPO'],
  G2: ['GATE_SKELETON_INVALID'],
  G3: ['GATE_SKELETON_HASH_MISMATCH'],
  G4: ['GATE_TEST_FAILED'],
  G5: ['GATE_BOUNDARY_VIOLATION'],
  G6: ['GATE_CONTEXT_INVALID'],
}

const SKELETON_DIR = path.join('docs', 'skeleton')
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
]

function run(cwd, cmd, args) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (error) {
    return { ok: false, out: String(error.stdout ?? ''), err: String(error.stderr ?? error.message) }
  }
}

function git(cwd, args) {
  return run(cwd, 'git', args)
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

/** G1 — Git baseline on the tracked tree. */
export function gateG1({ root }) {
  const inside = git(root, ['rev-parse', '--is-inside-work-tree'])
  if (!inside.ok || inside.out.trim() !== 'true') {
    return { id: 'G1', ok: false, code: 'GATE_NO_REPO', detail: 'not a git work tree' }
  }
  const head = git(root, ['rev-parse', 'HEAD'])
  if (!head.ok) return { id: 'G1', ok: false, code: 'GATE_NO_REPO', detail: 'no HEAD commit' }
  const status = git(root, ['status', '--porcelain'])
  if (!status.ok) return { id: 'G1', ok: false, code: 'GATE_GIT_DIRTY', detail: status.err ?? 'status failed' }
  // The spec allows the gate's own skeleton output to be untracked.
  const dirty = status.out
    .split('\n')
    .filter((line) => line.trim() !== '')
    .filter((line) => !line.includes('docs/skeleton/'))
  return {
    id: 'G1',
    ok: dirty.length === 0,
    code: dirty.length === 0 ? undefined : 'GATE_GIT_DIRTY',
    detail: dirty.length === 0 ? `clean @ ${head.out.trim().slice(0, 12)}` : `${dirty.length} dirty path(s)`,
    head: head.out.trim(),
  }
}

/** G2 — generate the T1/T2 skeleton (manifest + symbol tree). */
export function gateG2({ root, write = false }) {
  const files = git(root, ['ls-files'])
  if (!files.ok) return { id: 'G2', ok: false, code: 'GATE_SKELETON_INVALID', detail: 'git ls-files failed' }
  const tracked = files.out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .filter((line) => !line.startsWith('node_modules/') && !line.includes('/.env'))
  if (tracked.length === 0) return { id: 'G2', ok: false, code: 'GATE_SKELETON_INVALID', detail: 'no tracked files' }
  const manifest = tracked
    .filter((file) => fs.existsSync(path.join(root, file)))
    .map((file) => `${sha256(path.join(root, file))}  ${file}`)
    .join('\n')
  const symbols = tracked
    .filter((file) => /\.(mjs|js|ts|tsx)$/.test(file) && fs.existsSync(path.join(root, file)))
    .map((file) => {
      const body = fs.readFileSync(path.join(root, file), 'utf8')
      const names = [...body.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_$]+)/g)].map((m) => m[1])
      return names.map((name) => `${file}\t${name}`).join('\n')
    })
    .filter((line) => line !== '')
    .join('\n')
  const dir = path.join(root, SKELETON_DIR)
  if (write) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'T1.sha256'), `${manifest}\n`)
    fs.writeFileSync(path.join(dir, 'T2.tsv'), `${symbols}\n`)
    fs.writeFileSync(
      path.join(dir, 'meta.json'),
      `${JSON.stringify({ generatedAt: new Date().toISOString(), files: tracked.length, symbols: symbols.split('\n').filter(Boolean).length }, null, 2)}\n`,
    )
  }
  return { id: 'G2', ok: true, detail: `${tracked.length} tracked files`, files: tracked.length, written: write }
}

/** G3 — verify the skeleton against the current tree. */
export function gateG3({ root }) {
  const manifestFile = path.join(root, SKELETON_DIR, 'T1.sha256')
  if (!fs.existsSync(manifestFile)) {
    return { id: 'G3', ok: false, code: 'GATE_SKELETON_HASH_MISMATCH', detail: 'skeleton manifest missing (run G2 first)' }
  }
  const lines = fs.readFileSync(manifestFile, 'utf8').split('\n').filter((line) => line.trim() !== '')
  const mismatches = []
  for (const line of lines) {
    const [expected, file] = line.split(/\s{2,}/)
    const full = path.join(root, file)
    if (!fs.existsSync(full)) { mismatches.push(`${file}: missing`); continue }
    const actual = sha256(full)
    if (actual !== expected) mismatches.push(`${file}: hash changed`)
  }
  return {
    id: 'G3',
    ok: mismatches.length === 0,
    code: mismatches.length === 0 ? undefined : 'GATE_SKELETON_HASH_MISMATCH',
    detail: mismatches.length === 0 ? `${lines.length} files verified` : `${mismatches.length} mismatch(es)`,
    mismatches: mismatches.slice(0, 10),
  }
}

/** G4 — required test gates from `.upm/gate.json`. */
export function gateG4({ root, runTests = false }) {
  const configFile = path.join(root, '.upm', 'gate.json')
  let required = ['npm test']
  if (fs.existsSync(configFile)) {
    try {
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
      if (Array.isArray(config.requiredGates) && config.requiredGates.length > 0) required = config.requiredGates
    } catch {
      return { id: 'G4', ok: false, code: 'GATE_TEST_FAILED', detail: '.upm/gate.json is not valid JSON' }
    }
  }
  if (!runTests) {
    return { id: 'G4', ok: true, skipped: true, detail: `deferred: ${required.join(', ')}`, required }
  }
  const failures = []
  for (const command of required) {
    const [bin, ...args] = command.split(/\s+/)
    const result = run(root, bin, args)
    if (!result.ok) failures.push(command)
  }
  return {
    id: 'G4',
    ok: failures.length === 0,
    code: failures.length === 0 ? undefined : 'GATE_TEST_FAILED',
    detail: failures.length === 0 ? `${required.length} gate(s) passed` : `failed: ${failures.join(', ')}`,
    required,
  }
}

/** G5 — boundary/neutrality (no cross-package deep imports from a plugin). */
export function gateG5({ root }) {
  const violations = []
  const files = git(root, ['ls-files'])
  const tracked = files.ok ? files.out.split('\n').filter((line) => /\.(mjs|js)$/.test(line)) : []
  for (const file of tracked) {
    const full = path.join(root, file)
    if (!fs.existsSync(full)) continue
    const body = fs.readFileSync(full, 'utf8')
    // A plugin must not reach into another package's private lib path.
    for (const match of body.matchAll(/from\s+['"](@deepseek-ai\/[^'"]+\/lib\/[^'"]+)['"]/g)) {
      violations.push(`${file} -> ${match[1]}`)
    }
    if (/\brequire\(\s*['"]@deepseek-ai\/[^'"]+\/src\//.test(body)) violations.push(`${file} -> src deep import`)
  }
  return {
    id: 'G5',
    ok: violations.length === 0,
    code: violations.length === 0 ? undefined : 'GATE_BOUNDARY_VIOLATION',
    detail: violations.length === 0 ? 'no private deep imports' : `${violations.length} violation(s)`,
    violations: violations.slice(0, 10),
  }
}

/** G6 — capsule/instructions present, valid, and free of secrets. */
export function gateG6({ root }) {
  const problems = []
  const agents = path.join(root, 'AGENTS.md')
  if (!fs.existsSync(agents)) problems.push('AGENTS.md missing')
  const capsule = path.join(root, 'promotion-capsule.json')
  if (fs.existsSync(capsule)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(capsule, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null) problems.push('promotion-capsule.json is not an object')
    } catch {
      problems.push('promotion-capsule.json is not valid JSON')
    }
  } else {
    problems.push('promotion-capsule.json missing')
  }
  // Secret scan over instruction files only (bounded, no full-tree scan).
  const candidates = [agents, capsule, path.join(root, 'CAPSULE.md')].filter((file) => fs.existsSync(file))
  for (const file of candidates) {
    const body = fs.readFileSync(file, 'utf8')
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(body)) problems.push(`possible secret in ${path.relative(root, file)}`)
    }
  }
  return {
    id: 'G6',
    ok: problems.length === 0,
    code: problems.length === 0 ? undefined : 'GATE_CONTEXT_INVALID',
    detail: problems.length === 0 ? 'capsule and instructions valid' : problems.join('; '),
    problems,
  }
}

/**
 * Run the full gate. Preview is the default (G2 does not write, G4 does not run).
 * @param {{root:string, write?:boolean, runTests?:boolean}} input
 */
export function runPromotionGate({ root, write = false, runTests = false }) {
  const results = [
    gateG1({ root }),
    gateG2({ root, write }),
    // G3 only makes sense once a skeleton exists; before that it is a defined blocker.
    gateG3({ root }),
    gateG4({ root, runTests }),
    gateG5({ root }),
    gateG6({ root }),
  ]
  const blockers = results.filter((result) => !result.ok).map((result) => ({ id: result.id, code: result.code, detail: result.detail }))
  return {
    ok: blockers.length === 0,
    preview: !write && !runTests,
    results,
    blockerCodes: blockers.map((blocker) => blocker.code),
    blockers,
  }
}
