/**
 * Antigravity CLI (`agy`) argv builder and output parser.
 *
 * Measured surface (agy 1.4.10):
 *   `agy -p <prompt> --model <model> --effort <effort> --output-format json`
 * prints one JSON object:
 *   { conversation_id, status, response, usage: { input_tokens, output_tokens,
 *     thinking_tokens, cache_read_tokens }, ... }
 *
 * The prompt must ride beside `-p`; the CLI rejects an empty `-p` whose next
 * token is another flag ("-p took \"--model\" as its prompt").
 */

/** Default model: flash with low thinking effort. */
export const DEFAULT_MODEL = 'gemini-3.8-flash-low'

/** Default reasoning effort. */
export const DEFAULT_EFFORT = 'low'

/**
 * Build the argv for one headless print-mode call.
 * @param {object} options - call options.
 * @param {string} options.executable - resolved `agy` executable.
 * @param {string} options.prompt - task text delivered as the `-p` value.
 * @param {string} [options.model] - model id; falls back to `DEFAULT_MODEL`.
 * @param {string} [options.effort] - reasoning effort; falls back to `DEFAULT_EFFORT`.
 * @param {string[]} [options.extraArgs] - verbatim trailing flags.
 * @returns {string[]} the complete argv.
 */
export function buildAgyArgv(options) {
  if (typeof options.prompt !== 'string' || options.prompt.trim() === '') {
    throw new TypeError('buildAgyArgv requires a non-empty prompt: `-p` with an empty value consumes the next flag')
  }
  const argv = [options.executable, '-p', options.prompt]
  argv.push('--model', options.model || DEFAULT_MODEL)
  argv.push('--effort', options.effort || DEFAULT_EFFORT)
  argv.push('--output-format', 'json')
  if (options.extraArgs?.length) argv.push(...options.extraArgs)
  return argv
}

/** Empty usage record used when the CLI prints no JSON envelope. */
const NO_USAGE = Object.freeze({ inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheReadTokens: 0 })

/**
 * Parse the JSON envelope printed by `--output-format json`.
 *
 * An unrecognised or truncated payload degrades to the raw text so a worker
 * still reports what it produced.
 * @param {string} stdout - captured stdout.
 * @returns {{summary: string, usage: object, conversationId: string, status: string, parsed: boolean}} parsed result.
 */
export function parseAgyOutput(stdout) {
  const text = String(stdout ?? '').trim()
  if (!text) return { summary: '', usage: NO_USAGE, conversationId: '', status: '', parsed: false }
  try {
    const result = JSON.parse(text)
    if (result && typeof result === 'object') {
      const usage = result.usage && typeof result.usage === 'object' ? result.usage : {}
      const num = (value) => (Number.isFinite(value) ? value : 0)
      return {
        summary: typeof result.response === 'string' ? result.response.trim() : text,
        usage: {
          inputTokens: num(usage.input_tokens),
          outputTokens: num(usage.output_tokens),
          thinkingTokens: num(usage.thinking_tokens),
          cacheReadTokens: num(usage.cache_read_tokens),
        },
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
