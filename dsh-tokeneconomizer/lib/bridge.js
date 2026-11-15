/**
 * Bridge between a DSH Host and the TokenEconomizer Python engine.
 *
 * The engine is never imported, patched in place, or vendored into this package: it runs as the
 * user's own copy, reached through two launchers under the TokenEconomizer state root
 * (`bin/te`, `bin/te-hook`), both written by `scripts/bootstrap.mjs`. This module owns the whole
 * process boundary:
 *
 *   - `hook()` — one Claude-shaped lifecycle payload in, one hook object out (`te-hook --host dsh`);
 *   - `brief()` — the session-start facts and tool mask, as one JSON object (`te dsh-session`);
 *   - `statusJson()` — the operator view (`te status --json`);
 *   - `writeExport()` — a decompressed copy of a DSH session log (`trace/dsh.py` reads it).
 *
 * Every call is bounded and fails open: a missing engine, a slow disk, a broken state file, or a
 * nonzero exit answers the neutral value and records one line through `onError`. A cost
 * optimizer must never break the session it is observing.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Environment that tells the engine a DSH session is talking to it. */
export const DSH_ENV = { TE_DSH: '1' }

/** Default bounded waits: a hook may delay a tool call, so it stays short. */
export const DEFAULT_HOOK_TIMEOUT_MS = 8000
export const DEFAULT_CLI_TIMEOUT_MS = 20000

/**
 * Absolute path of the TokenEconomizer state root: `TOKENECONOMIZER_HOME`, else
 * `~/.tokeneconomizer` — the same default the engine uses (`paths.state_root`).
 * @param {Record<string, string | undefined>} [env] - environment to read.
 * @returns {string} the state root.
 */
export function stateRoot(env = process.env) {
  const home = env.TOKENECONOMIZER_HOME
  return home && home.trim() ? home : join(homedir(), '.tokeneconomizer')
}

/**
 * Resolve the two launchers the bootstrap writes.
 * @param {Record<string, string | undefined>} [env] - environment to read.
 * @returns {{ te: string, hook: string, root: string }} absolute launcher paths.
 */
export function launchers(env = process.env) {
  const root = stateRoot(env)
  const bin = join(root, 'bin')
  return { te: join(bin, 'te'), hook: join(bin, 'te-hook'), root }
}

/**
 * Run one JSON-in/JSON-out call, bounded, resolving `null` on any failure.
 *
 * The child never inherits `TE_SIDECALL`/`TE_DISABLE` from this process: a DSH session that is
 * itself a TokenEconomizer side call must stay inert (`isInert`), and that is checked before
 * this function is reached.
 * @param {string} program - launcher to execute.
 * @param {string[]} args - launcher arguments.
 * @param {Record<string, unknown>} payload - JSON written to the child's stdin.
 * @param {{ env?: Record<string, string | undefined>, timeoutMs?: number, spawnImpl?: Function }} [options]
 *   process environment, bound, and a `spawn` replacement for tests.
 * @returns {Promise<object | null>} the parsed last JSON line, or null.
 */
export function runJson(program, args, payload, options = {}) {
  const { env = process.env, timeoutMs = DEFAULT_HOOK_TIMEOUT_MS, spawnImpl = spawn } = options
  return new Promise((resolve) => {
    let out = ''
    let child
    try {
      child = spawnImpl(program, args, {
        // The launchers find their interpreter through PATH; an environment holding only the
        // additions would leave the engine's own detached spawns without one.
        env: { ...process.env, ...env, ...DSH_ENV, PYTHONUTF8: '1' },
        stdio: ['pipe', 'pipe', 'ignore'],
      })
    } catch {
      resolve(null)
      return
    }
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      finish(null)
    }, timeoutMs)
    child.stdout?.setEncoding?.('utf8')
    child.stdout?.on?.('data', (chunk) => {
      out += chunk
    })
    child.on('error', () => finish(null))
    child.on('close', () => {
      // The engine's machine output is a JSON document, but not always a single line:
      // `te status --json` (plugin/cli.py) prints `json.dumps(out, indent=2)`, while the hook
      // and the dsh-import answer print one line. Parse the last line first (the single-line
      // protocol), and when that is not JSON but the whole output is, parse the whole output.
      // Measured 2026-11-15: `status --json` returned null through this path before the
      // whole-output fallback — the last line alone is `}`.
      const lines = out.trim().split('\n').filter(Boolean)
      const line = lines.pop()
      if (!line) return finish(null)
      try {
        const value = JSON.parse(line)
        finish(value && typeof value === 'object' ? value : null)
        return
      } catch { /* not a one-line answer; try the whole document */ }
      try {
        const value = JSON.parse(out)
        finish(value && typeof value === 'object' ? value : null)
      } catch {
        finish(null)
      }
    })
    child.stdin?.on?.('error', () => {})
    child.stdin?.end?.(JSON.stringify(payload ?? {}))
  })
}

/**
 * Ask the engine what this session should start with.
 * @param {{ te: string }} bins - launcher paths.
 * @param {string} cwd - repository directory of the session.
 * @param {string[]} tools - model-facing tool names this assembly registers.
 * @param {{ env?: object, timeoutMs?: number, spawnImpl?: Function }} [options] - overrides.
 * @returns {Promise<{ microskills?: { text?: string, facts?: number, profile?: string },
 *   toolprune?: { mode?: string, proposal?: string[] },
 *   loopguard?: { mode?: string, envelope?: number | null } } | null>} the brief, or null.
 */
export function brief(bins, cwd, tools, options = {}) {
  const args = ['--host', 'dsh', '--cwd', cwd, 'dsh-session']
  if (tools?.length) args.push('--tools', tools.join(','))
  return runJson(bins.te, args, {}, {
    env: options.env,
    timeoutMs: options.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS,
    spawnImpl: options.spawnImpl,
  })
}

/**
 * Deliver one lifecycle hook.
 * @param {{ hook: string }} bins - launcher paths.
 * @param {Record<string, unknown>} payload - Claude-shaped lifecycle payload.
 * @param {{ env?: object, timeoutMs?: number, spawnImpl?: Function, hostCwd?: string }} [options]
 *   overrides; `hostCwd` is passed as `--cwd` so a repository path is never inferred twice.
 * @returns {Promise<object>} the hook's object; `{}` changes nothing.
 */
export async function hook(bins, payload, options = {}) {
  const args = ['--host', 'dsh']
  if (options.cwd) args.push('--cwd', options.cwd)
  const out = await runJson(bins.hook, args, payload, {
    env: options.env,
    timeoutMs: options.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
    spawnImpl: options.spawnImpl,
  })
  return out ?? {}
}

/**
 * `te status --json` for one directory.
 * @param {{ te: string }} bins - launcher paths.
 * @param {string} cwd - repository directory.
 * @param {{ env?: object, timeoutMs?: number, spawnImpl?: Function }} [options] - overrides.
 * @returns {Promise<object | null>} the status object, or null.
 */
export function statusJson(bins, cwd, options = {}) {
  return runJson(bins.te, ['--host', 'dsh', '--cwd', cwd, 'status', '--json'], {}, {
    env: options.env,
    timeoutMs: options.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS,
    spawnImpl: options.spawnImpl,
  })
}

/**
 * Import one decompressed export into the engine (`te dsh-import`), the cold-start step.
 * @param {{ te: string }} bins - launcher paths.
 * @param {string} exportPath - absolute path of a decompressed session log.
 * @param {string} cwd - repository directory the session ran in.
 * @param {{ env?: object, timeoutMs?: number, spawnImpl?: Function }} [options] - overrides.
 * @returns {Promise<object | null>} the fold summary, or null.
 */
export function importExport(bins, exportPath, cwd, options = {}) {
  return runJson(bins.te, ['--host', 'dsh', '--cwd', cwd, 'dsh-import', exportPath], {}, {
    env: options.env,
    timeoutMs: options.timeoutMs ?? 120000,
    spawnImpl: options.spawnImpl,
  })
}

/**
 * Serialize a DSH session as the decompressed export the engine reads.
 *
 * The first line is the harness's own `session` header; every later line is one committed
 * `SessionEvent` exactly as `session.snapshotEvents()` returned it. Nothing is summarized here,
 * so a reader sees the same events the harness persisted.
 * @param {{ header: { id: string, version: number, createdAt: number, cwd?: string },
 *   events: readonly object[] }} session - live session identity and events.
 * @returns {string} newline-terminated JSONL.
 */
export function serializeExport(session) {
  const { header, events } = session
  const lines = [JSON.stringify({
    type: 'session',
    version: header.version,
    id: header.id,
    createdAt: header.createdAt,
    ...(header.cwd ? { cwd: header.cwd } : {}),
    ...(header.parentSession ? { parentSession: header.parentSession } : {}),
    ...(header.origin ? { origin: header.origin } : {}),
  })]
  for (const event of events) lines.push(JSON.stringify(event))
  return `${lines.join('\n')}\n`
}

/**
 * Write one session export, creating the directory (`0700`) and file (`0600`) private.
 * @param {string} dir - export directory.
 * @param {{ header: { id: string }, events: readonly object[] }} session - session to export.
 * @returns {string} absolute path of the written file.
 */
export function writeExport(dir, session) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, `${session.header.id}.jsonl`)
  writeFileSync(path, serializeExport(session), { mode: 0o600 })
  return path
}

/**
 * Run one engine command and keep its exit code alongside its output.
 *
 * {@link runJson} answers a machine protocol where the last JSON line is the whole answer, so it
 * drops the status. An operator command is the opposite: `te config set` prints a human-readable
 * confirmation on success and still exits 0, so a caller that only sees stdout cannot tell success
 * from a rejection. This keeps both, and never throws.
 * @param {string} program - the launcher to run.
 * @param {string[]} args - its arguments.
 * @param {{ env?: object, timeoutMs?: number, spawnImpl?: Function }} [options] - overrides.
 * @returns {Promise<{ ok: boolean, code: number | null, output: string, error: string }>} the run.
 */
export function runText(program, args, options = {}) {
  const { env = process.env, timeoutMs = DEFAULT_CLI_TIMEOUT_MS, spawnImpl = spawn } = options
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let child
    try {
      child = spawnImpl(program, args, {
        env: { ...process.env, ...env, ...DSH_ENV, PYTHONUTF8: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({ ok: false, code: null, output: '', error: error instanceof Error ? error.message : String(error) })
      return
    }
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      finish({ ok: false, code: null, output: out, error: 'engine command timed out after ' + timeoutMs + 'ms' })
    }, timeoutMs)
    child.stdout?.setEncoding?.('utf8')
    child.stderr?.setEncoding?.('utf8')
    child.stdout?.on?.('data', (chunk) => {
      out += chunk
    })
    child.stderr?.on?.('data', (chunk) => {
      err += chunk
    })
    child.on('error', (error) => {
      finish({ ok: false, code: null, output: out, error: error instanceof Error ? error.message : String(error) })
    })
    child.on('close', (code) => {
      finish({ ok: code === 0, code: typeof code === 'number' ? code : null, output: out, error: err })
    })
  })
}

/**
 * The exit status a DSH tool result names in its rendered text, when it names one (`bash`
 * appends `[exit code: N]`). Used for the guard's ended-green proxy.
 * @param {string} text - rendered tool result.
 * @returns {number | undefined} the status, or undefined when the result does not say.
 */
export function exitCodeOf(text) {
  const match = /\[exit code:\s*(-?\d+)\]/i.exec(text ?? '')
  return match ? Number(match[1]) : undefined
}

/**
 * Text of a tool result's content blocks.
 * @param {readonly object[] | undefined} content - DSH content blocks.
 * @returns {string} the joined text.
 */
export function contentText(content) {
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => (block && block.type === 'text' ? block.text ?? '' : ''))
    .filter(Boolean)
    .join('\n')
}

/**
 * Build the Claude-shaped tool response the engine's host adapter reads.
 * @param {{ content?: readonly object[], isError?: boolean }} result - DSH tool outcome.
 * @returns {{ content: string, isError: boolean, exit_code?: number }} hook `tool_response`.
 */
export function toolResponse(result) {
  const text = contentText(result?.content)
  const exit = exitCodeOf(text)
  return {
    content: text,
    isError: result?.isError === true,
    ...(exit === undefined ? {} : { exit_code: exit }),
  }
}

/**
 * Whether this process is a TokenEconomizer side call (or explicitly disabled), where the
 * plugin must do nothing so it cannot recurse.
 * @param {Record<string, string | undefined>} [env] - environment to read.
 * @returns {boolean} true when inert.
 */
export function isInert(env = process.env) {
  const on = (value) => ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase())
  return on(env.TE_SIDECALL) || on(env.TE_DISABLE)
}

/**
 * Ensure the export directory exists and is private.
 * @param {string} dir - export directory.
 * @returns {string} the same directory.
 */
export function ensureExportDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}
