/**
 * Antigravity CLI diagnostics: the read-only `agy models` listing.
 *
 * Since 2026-11-05 the CLI worker itself no longer spawns `agy` here: `/agy`
 * and `agy_worker` start a managed child session through
 * `lib/cli-activation.js`, and the subagent provider (`lib/subagent.js`) owns
 * the CLI process for that child. The only remaining direct process is the
 * read-only model listing, which creates no session and no conversation.
 *
 * @module @nolit/dsh-antigravity/worker
 */

/**
 * Forward selected environment variables to the listing process.
 * @param {string[]} names - variable names to copy.
 * @returns {Record<string, string>} the forwarded subset.
 */
function forwardedEnv(names) {
  const env = {}
  for (const key of names ?? []) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return env
}

/**
 * Run `agy models` and return its text.
 *
 * This is a diagnostic listing, not a delegation: it spawns no session and
 * writes no conversation. A resolve miss or a non-zero exit is reported as
 * `{ ok: false, text }` instead of throwing.
 * @param {object} ctx - host context exposing `subprocess`.
 * @param {object} config - resolved plugin config with reactive getters.
 * @param {string} cwd - absolute working directory.
 * @returns {Promise<{ok: boolean, text: string}>} the listing, or a diagnostic.
 */
export async function listAgyModels(ctx, config, cwd) {
  const env = forwardedEnv(config.forwardEnv.get())
  try {
    const executable = await ctx.subprocess.resolveExecutable(config.agyPath.get(), env)
    const handle = ctx.subprocess.spawn({
      argv: [executable, 'models'],
      cwd,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 262144 }, stderr: { maxBytes: 65536 } },
      graceMs: 5000,
      signal: AbortSignal.timeout(30000),
      env,
    })
    const outcome = await handle.done
    const out = handle.collected.stdout?.readFrom(0)?.text ?? ''
    const err = handle.collected.stderr?.readFrom(0)?.text ?? ''
    return { ok: (outcome.exitCode ?? 0) === 0, text: (out || err).trim() }
  } catch (error) {
    return { ok: false, text: `cannot list agy models: ${error instanceof Error ? error.message : String(error)}` }
  }
}
