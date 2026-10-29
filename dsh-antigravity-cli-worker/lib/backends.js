/**
 * Antigravity CLI worker backend for `agy` (Antigravity CLI v1.4.x).
 *
 * Uses the measured stream-json/headless surface:
 *   - `agy -p <prompt> --model <model> --effort <effort> --output-format json`
 *     for one-shot calls (simple and reliable)
 *   - or `--input-format stream-json --output-format stream-json` for multi-turn
 *     (not needed for a simple worker tool)
 *
 * Default: gemini-3.8-flash-low with effort low for fast, cheap simple tasks.
 */

export const DEFAULT_MODEL = 'gemini-3.8-flash-low'
export const DEFAULT_EFFORT = 'low'

/**
 * Build argv for a one-shot agy call.
 * @param {{executable: string, model?: string, effort?: string, extraArgs?: string[]}} options
 * @returns {string[]}
 */
export function buildAgyArgv(options) {
  const argv = [options.executable]
  const prompt = options.prompt
  if (prompt) {
    argv.push('-p', prompt)
  } else {
    argv.push('-p')
  }
  if (options.model || DEFAULT_MODEL) {
    argv.push('--model', options.model || DEFAULT_MODEL)
  }
  if (options.effort || DEFAULT_EFFORT) {
    argv.push('--effort', options.effort || DEFAULT_EFFORT)
  }
  argv.push('--output-format', 'json')
  if (options.extraArgs?.length) {
    argv.push(...options.extraArgs)
  }
  return argv
}

/**
 * Parse `agy --output-format json` stdout.
 * @param {string} stdout
 * @returns {{summary: string, usage: {inputTokens: number, outputTokens: number, thinkingTokens: number, cacheReadTokens: number}, conversationId?: string, status?: string}}
 */
export function parseAgyOutput(stdout) {
  const text = String(stdout ?? '').trim()
  if (!text) {
    return {
      summary: '',
      usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheReadTokens: 0 },
    }
  }
  
  // Try to parse as JSON
  try {
    const result = JSON.parse(text)
    if (result && typeof result === 'object') {
      const usage = result.usage && typeof result.usage === 'object' ? result.usage : {}
      return {
        summary: typeof result.response === 'string' ? result.response.trim() : text,
        usage: {
          inputTokens: Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0,
          outputTokens: Number.isFinite(usage.output_tokens) ? usage.output_tokens : 0,
          thinkingTokens: Number.isFinite(usage.thinking_tokens) ? usage.thinking_tokens : 0,
          cacheReadTokens: Number.isFinite(usage.cache_read_tokens) ? usage.cache_read_tokens : 0,
        },
        conversationId: result.conversation_id,
        status: result.status,
        error: result.error,
      }
    }
  } catch {
    // Fall through to plain text
  }
  
  return {
    summary: text,
    usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheReadTokens: 0 },
  }
}

/**
 * Build argv for stream-json mode (for multi-turn if needed later).
 * @param {{executable: string, model?: string, effort?: string}} options
 * @returns {string[]}
 */
export function buildAgyStreamArgv(options) {
  const argv = [options.executable]
  if (options.model || DEFAULT_MODEL) {
    argv.push('--model', options.model || DEFAULT_MODEL)
  }
  if (options.effort || DEFAULT_EFFORT) {
    argv.push('--effort', options.effort || DEFAULT_EFFORT)
  }
  argv.push('--input-format', 'stream-json')
  argv.push('--output-format', 'stream-json')
  argv.push('--dangerously-skip-permissions')
  return argv
}
