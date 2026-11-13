/**
 * The subagent model allowlist the router ships as its default.
 *
 * WHY THIS LIVES HERE
 *   The host's `subagent-model-selection-settings` row decides which
 *   `provider/model` routes a delegated child may pick. The row is HOST-owned
 *   (`@deepseek-ai/dsh-tool-subagent/model-selection-settings`), so a profile
 *   that never states it gets the host's empty default — no child may pick a
 *   model at all. A fresh profile therefore needs the router's default
 *   stated somewhere the router owns.
 *
 *   Two homes, one source:
 *     - `cordis.patch.yml` (this package's bundle layer) states the row, so a
 *       fresh profile mounting the router bundle inherits it;
 *     - this module is the same list as DATA, so a test can pin it and a
 *       caller can read it without parsing YAML.
 *
 *   The bundle layer applies BEFORE the profile's own patch, and a patch
 *   REPLACES a row's whole config, so an operator's `cordis.patch.yml` wins
 *   wholesale — the default never fights the live list.
 *
 * THE ROUTE SHAPE
 *   `provider` is the preset's provider id (the route a child asks for) and
 *   `model` is the model id that preset serves. The provider ids are pinned by
 *   `test/preset-surfaces.test.mjs` against `lib/presets.js`.
 *
 * @module @nolit/dsh-custom-router/allowlist
 */

/**
 * The default allowed routes, in the order the Settings page lists them.
 *
 * @type {ReadonlyArray<{provider: string, model: string}>}
 */
export const DEFAULT_ALLOWED_MODELS = Object.freeze([
  Object.freeze({ provider: 'antigravity', model: 'gemini-4-hydrogen' }),
  Object.freeze({ provider: 'antigravity', model: 'gemini-4-argon' }),
  Object.freeze({ provider: 'antigravity', model: 'claude-opus-5-5' }),
  Object.freeze({ provider: 'opencode-http-agent', model: 'opencode-go/deepseek-v4.1-flash' }),
  Object.freeze({ provider: 'opencode-http-agent', model: 'opencode-go/minimax-m3.1-flash' }),
  Object.freeze({ provider: 'deepinfra', model: 'deepseek-ai/DeepSeek-V4.1-Flash-1017' }),
  Object.freeze({ provider: 'exaone', model: 'k-exaone_v2.5' }),
])

/**
 * The row id of the host-owned settings namespace the allowlist belongs to.
 * @type {string}
 */
export const ALLOWLIST_ROW_ID = 'subagent-model-selection-settings'

/**
 * The plugin name of that settings namespace.
 * @type {string}
 */
export const ALLOWLIST_ROW_NAME = '@deepseek-ai/dsh-tool-subagent/model-selection-settings'

/**
 * The default allowlist, as the config object the host row takes.
 *
 * `enabled: true` is what makes the list meaningful: the host's row throws
 * when it is enabled with an empty list, and treats it as "children inherit
 * the parent's route" when it is disabled.
 *
 * @returns {{enabled: boolean, allowedModels: Array<{provider: string, model: string}>}} the config.
 */
export function defaultAllowlistConfig() {
  return {
    enabled: true,
    allowedModels: DEFAULT_ALLOWED_MODELS.map((route) => ({ ...route })),
  }
}

/**
 * Whether one route is in the default allowlist.
 * @param {string} provider - the provider id.
 * @param {string} model - the model id.
 * @returns {boolean} whether the route is allowed by default.
 */
export function isAllowedByDefault(provider, model) {
  return DEFAULT_ALLOWED_MODELS.some((route) => route.provider === provider && route.model === model)
}
