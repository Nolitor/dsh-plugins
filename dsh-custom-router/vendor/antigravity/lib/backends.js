/**
 * Antigravity CLI (`agy`) argv builder and output parser.
 *
 * Measured surface (agy 1.4.10):
 *   `agy -p <prompt> --model <id> --effort <effort> [--mode <mode>] --output-format json`
 * prints one JSON object:
 *   { conversation_id, status, response, usage: { input_tokens, output_tokens,
 *     thinking_tokens, cache_read_tokens } }
 *
 * The prompt must ride beside `-p`; `agy` never reads a print-mode prompt from
 * stdin (`-p -` ignores the pipe), and a single argument is capped at
 * 131,072 bytes by the kernel, so callers must reject overlong tasks.
 */

import { ADDITIVE_FORMULA, usageFromProjection } from '../../../lib/stream/usage.js'

/** Default model: flash with low thinking effort. */
export const DEFAULT_MODEL = 'gemini-3.8-flash-low'

/** Default reasoning effort. */
export const DEFAULT_EFFORT = 'low'

/** Execution mode fixed as the default for user-run calls. */
export const DEFAULT_MODE = 'accept-edits'

/** Modes accepted by `--mode`. */
export const MODES = Object.freeze(['accept-edits', 'auto', 'plan'])

/** Efforts accepted by `--effort`. */
export const EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max'])

/** Model ids may encode their reasoning effort as a suffix. */
const EFFORT_SUFFIX = /-(low|medium|high)$/

/**
 * Read the reasoning level encoded in an `agy` model id.
 * @param {string} model - model id such as `gemini-3.8-flash-low`.
 * @returns {string} the encoded level, or an empty string when the id has none.
 */
export function effortOfModel(model) {
  const match = EFFORT_SUFFIX.exec(String(model ?? ''))
  return match ? match[1] : ''
}

/** Largest task text that fits in one argv entry (kernel `MAX_ARG_STRLEN`). */
export const MAX_PROMPT_BYTES = 131072

/**
 * Build the argv for one headless print-mode call.
 * @param {object} options - call options.
 * @param {string} options.executable - resolved `agy` executable.
 * @param {string} options.prompt - task text delivered as the `-p` value.
 * @param {string} [options.model] - model id; falls back to `DEFAULT_MODEL`.
 * @param {string} [options.effort] - reasoning effort; falls back to `DEFAULT_EFFORT`.
 * @param {string} [options.mode] - execution mode; falls back to `DEFAULT_MODE`.
 * @param {string[]} [options.extraArgs] - verbatim trailing flags.
 * @returns {string[]} the complete argv.
 * @throws {TypeError} when the prompt is empty.
 * @throws {RangeError} when the prompt exceeds the single-argument limit.
 */
export function buildAgyArgv(options) {
  if (typeof options.prompt !== 'string' || options.prompt.trim() === '') {
    throw new TypeError('buildAgyArgv requires a non-empty prompt: `-p` with an empty value consumes the next flag')
  }
  const bytes = Buffer.byteLength(options.prompt, 'utf8')
  if (bytes >= MAX_PROMPT_BYTES) {
    throw new RangeError(
      `agy task text is ${bytes} bytes; a single command-line argument is capped at ${MAX_PROMPT_BYTES - 1} bytes. `
      + 'Save the text to a file inside the workspace and reference its path instead.',
    )
  }
  const argv = [options.executable, '-p', options.prompt]
  argv.push('--model', options.model || DEFAULT_MODEL)
  // A model id that already encodes its level rejects a different `--effort`,
  // and the CLI validates the pair before running; only base ids take the flag.
  const encoded = effortOfModel(options.model || DEFAULT_MODEL)
  const effort = options.effort || DEFAULT_EFFORT
  if (encoded) {
    if (effort !== encoded) {
      throw new RangeError(
        `model "${options.model}" encodes effort "${encoded}" and conflicts with --effort "${effort}". `
        + 'Omit --effort or choose a matching level.',
      )
    }
  } else {
    argv.push('--effort', effort)
  }
  argv.push('--mode', options.mode || DEFAULT_MODE)
  argv.push('--output-format', 'json')
  if (options.extraArgs?.length) argv.push(...options.extraArgs)
  return argv
}

/** Empty usage record used when the CLI prints no JSON envelope. */
const NO_USAGE = Object.freeze({ inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheReadTokens: 0 })

/**
 * Map the `agy` envelope's `usage` object onto the host's disjoint buckets.
 *
 * THE one mapper for the CLI envelope. It was duplicated once here (10 L) and
 * once in `subagent.js` (18 L) with diverging field sets, so the two surfaces
 * could disagree about the same CLI output.
 *
 * Field names are the union of what the two call sites accepted, in the CLI's own
 * snake_case plus the camelCase spellings a hand-written envelope may carry:
 *   `input_tokens`/`inputTokens`, `output_tokens`/`outputTokens`,
 *   `thinking_tokens`/`thinkingTokens`,
 *   `cache_read_tokens`/`cache_read_input_tokens`/`cacheReadTokens`.
 * Measured 2026-11-08: the CLI really prints `cache_read_tokens`, while the
 * documented provider spelling is `cache_read_input_tokens`; both are read rather
 * than silently reporting zero for a bucket the CLI emitted.
 *
 * The arithmetic is the router's one usage writer (`lib/stream/usage.js`) under
 * the ADDITIVE cache convention: measured `agy` output reports `input_tokens`
 * WITHOUT the cache read (10 + 6, not 10 of which 6 cached), which is exactly
 * what `input+output+cache` declares. A zero total yields `undefined` — "nothing
 * was reported" is not "nothing was used", and the ledger would otherwise record
 * a phantom request.
 *
 * @param usage - the CLI envelope's raw `usage` object.
 * @returns `{ inputTokens, outputTokens, reasoningTokens?, cacheReadTokens? }`,
 *   or undefined when the object carries no usable count.
 */
export function agyTokenUsage(usage) {
  if (usage === null || typeof usage !== 'object') return undefined
  const mapped = usageFromProjection(
    usage,
    (raw) => ({
      // The CLI's own `input_tokens` EXCLUDES cache, so it is the additive input
      // bucket verbatim; nothing is subtracted here.
      prompt: raw.input_tokens ?? raw.inputTokens,
      completion: raw.output_tokens ?? raw.outputTokens,
      reasoning: raw.thinking_tokens ?? raw.thinkingTokens,
      cached: raw.cache_read_tokens ?? raw.cache_read_input_tokens ?? raw.cacheReadTokens,
    }),
    { formula: ADDITIVE_FORMULA },
  )
  if (mapped === undefined) return undefined
  const total = (mapped.inputTokens ?? 0) + (mapped.outputTokens ?? 0)
    + (mapped.reasoningTokens ?? 0) + (mapped.cacheReadTokens ?? 0)
  return total === 0 ? undefined : mapped
}

/**
 * The CLI tool surface's fixed four-counter row for one envelope's usage.
 *
 * `agy` reports no per-bucket absence contract and this row feeds a JSON schema
 * whose four counters are required, so an unreported bucket is published as 0
 * here — the one place that trade-off is made, on top of {@link agyTokenUsage}.
 *
 * @param usage - the CLI envelope's raw `usage` object, or undefined.
 * @returns `{ inputTokens, outputTokens, thinkingTokens, cacheReadTokens }`.
 */
export function agyUsageCounters(usage) {
  const mapped = agyTokenUsage(usage)
  return {
    inputTokens: mapped?.inputTokens ?? 0,
    outputTokens: mapped?.outputTokens ?? 0,
    // The CLI and the tool schema spell the reasoning bucket `thinking`; the host
    // TokenUsage calls it `reasoning`. Same count, published name of this surface.
    thinkingTokens: mapped?.reasoningTokens ?? 0,
    cacheReadTokens: mapped?.cacheReadTokens ?? 0,
  }
}

/**
 * Parse the JSON envelope printed by `--output-format json`.
 *
 * An unrecognised or truncated payload degrades to the raw text so a caller
 * still sees what the CLI produced.
 * @param {string} stdout - captured stdout.
 * @returns {{summary: string, usage: object, conversationId: string, status: string, parsed: boolean}} parsed result.
 */
export function parseAgyOutput(stdout) {
  const text = String(stdout ?? '').trim()
  if (!text) return { summary: '', usage: NO_USAGE, conversationId: '', status: '', parsed: false }
  try {
    const result = JSON.parse(text)
    if (result && typeof result === 'object') {
      return {
        summary: typeof result.response === 'string' ? result.response.trim() : text,
        usage: agyUsageCounters(result.usage),
        conversationId: typeof result.conversation_id === 'string' ? result.conversation_id : '',
        status: typeof result.status === 'string' ? result.status : '',
        parsed: true,
      }
    }
  } catch {
    // A non-JSON payload (for example an argument error) is reported as text.
  }
  return { summary: text, usage: NO_USAGE, conversationId: '', status: '', parsed: false }
}
