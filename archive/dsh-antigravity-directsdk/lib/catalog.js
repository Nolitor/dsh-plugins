/**
 * Model serving and per-model quota.
 *
 * Antigravity's catalog changes without notice: measured 2026-11-05 the account
 * served `gemini-4-argon-*` and `claude-*-5-5-*`, while the open-source Hermes
 * plugin still documented `gemini-3.8` / `claude-*-4-6`. Hardcoding the list
 * would rot within a release, so the catalog is fetched live and cached.
 *
 * Measured endpoints:
 *   POST /v1internal:fetchAvailableModels  {project}
 *     -> { models: { "<id>": { displayName, maxTokens, maxOutputTokens,
 *          supportsImages, supportsThinking,
 *          quotaInfo: { remainingFraction, resetTime } } }, defaultAgentModelId, ... }
 *   POST /v1internal:loadCodeAssist        {metadata:{pluginType}}
 *     -> { currentTier, cloudaicompanionProject, paidTier }
 *
 * @module @nolit/dsh-antigravity-directsdk/catalog
 */

/**
 * Pick the model ids that are usable for chat from a fetchAvailableModels body.
 *
 * The response also lists utility routes (tabs, mquery, commit message, image,
 * audio transcription). Those are not conversation models, so they are filtered
 * by the response's own role lists plus an id allow-list of prefixes.
 *
 * @param payload - fetchAvailableModels JSON.
 * @returns ordered model entries.
 */
export function parseCatalog(payload) {
  const models = payload?.models ?? {}
  const utility = new Set([
    ...(payload?.tabModelIds ?? []),
    ...(payload?.mqueryModelIds ?? []),
    ...(payload?.webSearchModelIds ?? []),
    ...(payload?.commitMessageModelIds ?? []),
    ...(payload?.audioTranscriptionModelIds ?? []),
    ...(payload?.imageGenerationModelIds ?? []),
  ])
  const entries = []
  for (const [id, value] of Object.entries(models)) {
    if (utility.has(id)) continue
    if (!isConversationModel(id, value)) continue
    entries.push({
      id,
      name: value?.displayName ?? id,
      maxInputTokens: num(value?.maxTokens),
      maxOutputTokens: num(value?.maxOutputTokens),
      supportsImages: value?.supportsImages === true,
      supportsThinking: value?.supportsThinking === true,
      quota: quotaOf(value?.quotaInfo),
    })
  }
  return entries
}

/**
 * Decide whether a catalog entry is a conversation model.
 * @param id - model id.
 * @param value - catalog entry.
 * @returns true for chat-capable models.
 */
function isConversationModel(id, value) {
  // Utility routes use snake_case ids (tab_flash_lite_preview, chat_23310).
  if (/^[a-z0-9]+_[a-z0-9_]+$/.test(id) && !id.includes('-')) return false
  if (typeof value?.displayName !== 'string') return false
  return true
}

/**
 * Extract quota state.
 * @param quotaInfo - raw quotaInfo.
 * @returns normalized quota, or undefined.
 */
function quotaOf(quotaInfo) {
  if (!quotaInfo || typeof quotaInfo !== 'object') return undefined
  const remaining = typeof quotaInfo.remainingFraction === 'number' ? quotaInfo.remainingFraction : undefined
  if (remaining === undefined) return undefined
  return { remaining, resetTime: quotaInfo.resetTime ?? undefined }
}

/**
 * Read a non-negative integer.
 * @param value - raw field.
 * @returns the number, or undefined.
 */
function num(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.trunc(value)
}

/**
 * Extract the serving identity from loadCodeAssist.
 * @param payload - loadCodeAssist JSON.
 * @returns project, tier, and upgrade metadata.
 */
export function parseAccount(payload) {
  return {
    project: payload?.cloudaicompanionProject ?? undefined,
    tier: payload?.currentTier?.id ?? undefined,
    tierName: payload?.currentTier?.name ?? undefined,
    paidTier: payload?.paidTier?.id ?? undefined,
    ineligible: Array.isArray(payload?.ineligibleTiers) ? payload.ineligibleTiers.map((t) => t?.reasonCode).filter(Boolean) : [],
  }
}

/**
 * Split a picker id into base model and effort suffix.
 * @param id - e.g. `gemini-3.8-flash-low`.
 * @returns base id and the effort suffix, if any.
 */
export function splitEffort(id) {
  const match = /^(.*)-(low|medium|high)$/.exec(id)
  if (!match) return { base: id, effort: undefined }
  return { base: match[1], effort: match[2] }
}

/**
 * Group catalog ids by base model so the picker can list efforts per model.
 * @param entries - catalog entries.
 * @returns base id -> { efforts, entry }.
 */
export function groupByBase(entries) {
  const groups = new Map()
  for (const entry of entries) {
    const { base, effort } = splitEffort(entry.id)
    let group = groups.get(base)
    if (!group) {
      group = { base, efforts: [], entry }
      groups.set(base, group)
    }
    if (effort) group.efforts.push(effort)
  }
  return groups
}
