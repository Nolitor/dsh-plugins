/**
 * Subagent provider for the OpenCode CLI.
 *
 * Merged from @nolit/dsh-subagent-opencode 0.1.0 (2026-11-05) so one package
 * carries the chat route, the `/ocode` command, `cli_worker`, the HTTP adapter
 * and this delegation provider. The prompt goes over stdin because a flattened
 * transcript can exceed the argv cap.
 *
 * @module @nolit/dsh-opencode-v2/subagent
 */
import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'

const MAX_DIAGNOSTIC_BYTES = 4096
const MAX_STDOUT_BYTES = 8 * 1024 * 1024
const MAX_STDERR_BYTES = 65536

/**
 * Bound a diagnostic to what the seam accepts.
 * @param text - raw diagnostic.
 * @returns the bounded string.
 */
function boundDiagnostic(text) {
  const value = String(text ?? '')
  if (Buffer.byteLength(value, 'utf8') <= MAX_DIAGNOSTIC_BYTES) return value
  return value.slice(0, MAX_DIAGNOSTIC_BYTES)
}

/**
 * Flatten a request prompt into text.
 * @param prompt - prompt blocks or a string.
 * @returns concatenated text.
 */
function promptText(prompt) {
  if (typeof prompt === 'string') return prompt
  if (!Array.isArray(prompt)) return ''
  const out = []
  for (const block of prompt) {
    if (block?.type === 'text' && typeof block.text === 'string') out.push(block.text)
  }
  return out.join('\n')
}

/**
 * Whether a path names a real file (a directory never counts as an executable).
 * @param path - candidate path.
 * @returns true when the path exists and is a file.
 */
function isFile(path) {
  try {
    return existsSync(path) && statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * Resolve the configured CLI name to an absolute executable path.
 *
 * Measured: a bare `opencode` is resolved by the CHILD's own PATH lookup, which
 * fails when the host daemon was started without the user's shell PATH. Doing
 * the lookup here makes that failure say what to fix instead of surfacing ENOENT.
 *
 * @param command - the configured `opencodePath` (default `'opencode'`).
 * @returns the first existing executable file: the path itself when absolute, otherwise the PATH match.
 * @throws {Error} when no candidate exists.
 */
export function resolveExecutable(command) {
  const value = String(command ?? '')
  if (value !== '' && isAbsolute(value) && isFile(value)) return value
  // Resolve against the host PATH exactly as a shell would. On win32 an
  // extensionless name only exists through PATHEXT, so try those variants.
  const extensions =
    process.platform === 'win32'
      ? ['', ...String(process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
      : ['']
  for (const dir of String(process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue
    for (const extension of extensions) {
      const candidate = join(dir, value + extension)
      if (isFile(candidate)) return candidate
    }
  }
  throw new Error('opencode subagent: opencode CLI not found (set opencodePath or add it to PATH)')
}

/**
 * Build the one-shot argv for a delegation.
 * @param options - resolved options.
 * @returns the argv.
 */
export function buildOpencodeArgv(options) {
  const argv = [options.executable, 'run', '-m', options.model, '--format', 'json']
  if (options.auto) argv.push('--auto')
  if (options.agent) argv.push('--agent', options.agent)
  return argv
}

/**
 * Collect the final assistant text from an OpenCode `--format json` stream.
 *
 * Events carry cumulative `part.text` snapshots, so the last snapshot for each
 * part id wins; reasoning and tool events are ignored, keeping only the answer.
 *
 * Measured (`lib/shared.js` JsonRunParser, the `run --format json` peer of this
 * parser): token usage rides on the `step_finish` event, at `part.tokens` or the
 * top-level `tokens`, and it is that STEP's usage, never a whole-run total. A
 * tool-free v2 run emits no `step_finish` at all, so `usage` is null there
 * rather than a row of invented zeros. Steps are summed so multi-step runs keep
 * every step's numbers; the shape mirrors `usageFromTokens` in `lib/http.js`.
 *
 * @param stdout - captured NDJSON output.
 * @returns the answer text, reported errors, and summed usage (null when the run reported none).
 */
export function parseRunStream(stdout) {
  const parts = new Map()
  const errors = []
  let usage = null
  for (const line of String(stdout ?? '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    let event
    try {
      event = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!event || typeof event !== 'object') continue
    if (event.type === 'text' && event.part && typeof event.part.text === 'string') {
      parts.set(event.part.id ?? `anon-${parts.size}`, event.part.text)
      continue
    }
    if (event.type === 'step_finish') {
      // Same lookup the authoritative run parser uses: a wrapper `part` wins
      // over the top-level field, and both are tolerated.
      const tokens = event.part?.tokens ?? event.tokens
      if (tokens && typeof tokens === 'object') {
        const cache = tokens.cache && typeof tokens.cache === 'object' ? tokens.cache : {}
        const buckets = {
          input: tokens.input,
          output: tokens.output,
          reasoning: tokens.reasoning,
          cacheRead: cache.read,
          cacheWrite: cache.write,
        }
        usage ??= {}
        let added = 0
        for (const [bucket, raw] of Object.entries(buckets)) {
          const value = Number(raw)
          // Numbers only when present: an absent bucket stays absent instead
          // of becoming a measured-looking zero.
          if (raw === undefined || raw === null || !Number.isFinite(value)) continue
          usage[bucket] = (usage[bucket] ?? 0) + value
          added += 1
        }
        // A `tokens` object with nothing numeric in it reports no usage at all.
        if (added === 0 && Object.keys(usage).length === 0) usage = null
      }
      continue
    }
    if (event.type === 'error') {
      const error = event.error
      if (typeof error === 'string') errors.push(error)
      else if (error && typeof error === 'object') errors.push(String(error.message ?? error.name ?? 'error'))
    }
  }
  return { text: [...parts.values()].join('').trim(), errors, usage }
}

/**
 * Register one spawned handle with the router's process registry, when present.
 *
 * The subprocess seam already terminates on the spec's abort signal; this is the
 * separate reclamation path for a handle whose session ends while the delegation
 * is still in flight and no abort is raised.
 * @param track - the router's `track` verb, or undefined.
 * @param session - owning session.
 * @param handle - the seam handle.
 * @param label - diagnostic label.
 * @returns {() => void} idempotent release.
 */
function trackHandle(track, session, handle, label) {
  if (typeof track !== 'function' || session === undefined || session === null) return () => {}
  try {
    const release = track(session, handle, label)
    return typeof release === 'function' ? release : () => {}
  } catch {
    return () => {}
  }
}

/** Provider implementation handed to `ctx.subagents`. */
export class OpenCodeSubagentProvider {
  capabilities = Object.freeze({ agentOptions: true, agentPreset: false, outputSchema: false, depthLimit: false })
  inheritsParentContext = false

  /**
   * @param name - registry name.
   * @param ctx - host context exposing `subprocess`.
   * @param config - resolved config.
   */
  constructor(name, ctx, config) {
    this.name = name
    this.ctx = ctx
    this.config = config
  }

  /**
   * Start one delegation.
   * @param request - resolved start request (absolute `cwd`, `prompt`, `signal`).
   * @returns the run handle.
   */
  start(request) {
    if (request.signal.aborted) throw new Error('opencode subagent request was aborted before start')
    // Defense in depth. The router's `tools/pre-execute` gate refuses the tool
    // call before this provider runs; a direct `ctx.subagents` caller bypasses
    // tools entirely, so the same rule is asserted here. The message is byte
    // identical to the router's so one grep finds every refusal.
    const verdict = this.config.gate?.(request.parent)
    if (verdict !== undefined && verdict.allowed === false) {
      throw new Error(`Disallowed: CLI worker invocation blocked under restricted sandbox/preset (${verdict.causes.join(', ')})`)
    }
    if (!request.cwd || !isAbsolute(request.cwd)) throw new Error('opencode subagent requires an absolute child cwd')
    const prompt = promptText(request.prompt)
    if (prompt === '') throw new Error('opencode subagent requires a non-empty text prompt')

    const env = { ...process.env, ...this.config.env }
    const timeout = AbortSignal.timeout(this.config.timeoutMs)
    const signal = AbortSignal.any([request.signal, timeout])
    // A per-request model beats the configured default. Read defensively: the
    // field type is AgentOptions, and an older or partial caller may omit it.
    const requested = request.agentOptions?.model
    const model = typeof requested === 'string' && requested !== '' ? requested : this.config.model
    const argv = buildOpencodeArgv({
      executable: resolveExecutable(this.config.opencodePath),
      model,
      auto: this.config.auto,
      agent: this.config.agent,
    })

    const handle = this.ctx.subprocess.spawn({
      argv,
      cwd: request.cwd,
      stdio: {
        stdin: 'pipe',
        stdout: { maxBytes: MAX_STDOUT_BYTES },
        stderr: { maxBytes: MAX_STDERR_BYTES },
      },
      graceMs: this.config.disposeGraceMs,
      signal,
      env,
    })

    // Router control plane (optional): registering the handle makes a worker
    // whose session is torn down reclaimable even though nobody raised its abort
    // signal. A standalone mount has no `track` and keeps signal-only teardown.
    const release = trackHandle(this.config.track, request.parent, handle, 'opencode subagent')

    // The prompt goes to stdin: a flattened transcript can exceed the argv cap.
    try {
      handle.stdin?.on?.('error', () => {})
      handle.stdin?.end?.(prompt)
    } catch {
      // A child that exits before reading stdin is reported through its exit facts.
    }

    const id = randomUUID()
    const result = (async () => {
      try {
        const outcome = await handle.done
        const stdout = handle.collected.stdout?.readFrom(0)?.text ?? ''
        const stderr = handle.collected.stderr?.readFrom(0)?.text ?? ''
        if (request.signal.aborted) return { output: [], stopReason: 'aborted' }
        if (timeout.aborted) {
          return { output: [], stopReason: 'error', diagnostic: boundDiagnostic('opencode child timed out') }
        }
        const parsed = parseRunStream(stdout)
        if ((outcome.exitCode ?? 0) !== 0 || parsed.errors.length > 0) {
          const detail = parsed.errors.join('; ') || stderr || stdout || 'opencode exited non-zero'
          return { output: [], stopReason: 'error', diagnostic: boundDiagnostic(detail) }
        }
        // A successful run reports its spend here, once. A child that reported no
        // usage (tool-free v2 runs emit no `step_finish`) records nothing rather
        // than a fabricated zero row. Recording never throws into the result.
        if (parsed.usage !== null) {
          try {
            this.config.recordUsage?.({ usage: parsed.usage, model })
          } catch {
            /* a ledger failure must not fail the delegation */
          }
        }
        if (parsed.text === '') return { output: [], stopReason: 'completed' }
        return { output: [{ type: 'text', text: parsed.text }], stopReason: 'completed' }
      } catch (error) {
        return {
          output: [],
          stopReason: 'error',
          diagnostic: boundDiagnostic(error instanceof Error ? error.message : String(error)),
        }
      }
    })()

    return {
      id,
      result,
      dispose: async () => {
        try {
          handle.terminate?.()
        } catch {
          // A handle that already settled has nothing left to terminate.
        }
        release()
        await result.catch(() => {})
      },
    }
  }
}