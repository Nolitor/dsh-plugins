/**
 * Process orchestration for the antigravity CLI worker tool.
 */
import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { buildAgyArgv, parseAgyOutput } from './backends.js'
import { collectArtifacts } from './artifacts.js'

const STDERR_TAIL_CHARS = 4000

async function resolveWorkerCwd(cwd) {
  if (!cwd || !isAbsolute(cwd)) {
    throw new Error('agy_worker requires an absolute "cwd" outside the workspace')
  }
  const absolute = resolve(cwd)
  let info
  try {
    info = await stat(absolute)
  } catch {
    throw new Error(`agy_worker cwd does not exist: ${absolute}`)
  }
  if (!info.isDirectory()) {
    throw new Error(`agy_worker cwd is not a directory: ${absolute}`)
  }
  return absolute
}

function tail(s, n) {
  const str = String(s ?? '')
  if (str.length <= n) return str
  return str.slice(str.length - n)
}

function forwardEnv(config) {
  const list = Array.isArray(config.forwardEnv) ? config.forwardEnv : []
  const out = {}
  for (const k of list) {
    if (process.env[k] !== undefined) out[k] = process.env[k]
  }
  return out
}

export async function runAgyWorker(ctx, config, options) {
  const cwd = await resolveWorkerCwd(options.cwd)
  const executable = config.agyPath || 'agy'
  const model = options.model || config.model || 'gemini-3.8-flash-low'
  const effort = options.effort || config.effort || 'low'
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : (config.timeoutMs ?? 600000)
  const maxOutputBytes = Number.isFinite(config.maxOutputBytes) ? config.maxOutputBytes : 262144

  const argv = buildAgyArgv({ executable, model, effort, extraArgs: config.extraArgs })

  let stdout = Buffer.alloc(0)
  let stderr = Buffer.alloc(0)
  let truncated = false

  const result = await ctx.subprocess.run(argv, {
    cwd,
    stdin: options.prompt ?? '',
    env: forwardEnv(config),
    timeoutMs,
    onStdout: (chunk) => {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      if (stdout.length + b.length > maxOutputBytes) {
        truncated = true
        stdout = Buffer.concat([stdout, b]).subarray(stdout.length + b.length - maxOutputBytes)
      } else {
        stdout = Buffer.concat([stdout, b])
      }
    },
    onStderr: (chunk) => {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      if (stderr.length + b.length > maxOutputBytes) {
        stderr = Buffer.concat([stderr, b]).subarray(stderr.length + b.length - maxOutputBytes)
      } else {
        stderr = Buffer.concat([stderr, b])
      }
    },
  })

  const stdoutStr = stdout.toString('utf8')
  const stderrStr = stderr.toString('utf8')
  const parsed = parseAgyOutput(stdoutStr)

  let artifacts = []
  if (Array.isArray(options.artifacts) && options.artifacts.length > 0) {
    try {
      artifacts = await collectArtifacts(cwd, options.artifacts)
    } catch {
      artifacts = []
    }
  }

  if (result.timedOut) {
    return {
      ok: false,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: true,
      truncated,
      summary: parsed.summary,
      stderrTail: tail(stderrStr, STDERR_TAIL_CHARS),
      usage: parsed.usage,
      conversationId: parsed.conversationId,
      artifacts,
    }
  }

  if (result.exitCode !== 0) {
    return {
      ok: false,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: false,
      truncated,
      summary: parsed.summary || (parsed.error ? String(parsed.error) : tail(stderrStr, STDERR_TAIL_CHARS)),
      stderrTail: tail(stderrStr, STDERR_TAIL_CHARS),
      usage: parsed.usage,
      conversationId: parsed.conversationId,
      artifacts,
    }
  }

  return {
    ok: true,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: false,
    truncated,
    summary: parsed.summary,
    usage: parsed.usage,
    conversationId: parsed.conversationId,
    status: parsed.status,
    artifacts,
  }
}
