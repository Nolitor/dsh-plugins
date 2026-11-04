/**
 * Model serving, effort grouping, and per-model quota.
 *
 * THE CENTRAL MAPPING PROBLEM
 *
 * Antigravity exposes reasoning effort as SEPARATE MODEL IDS:
 *   gemini-3.8-flash-low, gemini-3.8-flash-medium, gemini-3.8-flash-high
 *
 * DSH models it as ONE model with a reasoning-effort list
 * (LlmResolvedModelInfo.reasoning.efforts). Pasting the raw ids through would
 * give the picker three near-identical entries and no effort control, so this
 * module groups suffixed ids into one base model and exposes the suffixes as
 * efforts. `modelForEffort` in wire.js reverses the mapping on the way out.
 *
 * Measured 2026-11-05: `thinkingConfig.thinkingLevel` is IGNORED by the server,
 * which is why effort MUST be the id suffix and not a request field.
 *
 * @module @nolit/dsh-antigravity/catalog
 */

/** Effort suffixes the catalog uses, least to greatest. */
export const EFFORT_ORDER = ['low', 'medium', 'high']

/** Display names for the effort ids DSH shows in its selector. */
const EFFORT_NAMES = { low: 'Low', medium: 'Medium', high: 'High' }

/**
 * Split a picker id into base model and effort suffix.
 * @param id - e.g. `gemini-3.8-flash-low`.
 * @returns base id and the suffix, if any.
 */
export function splitEffort(id) {
  const match = /^(.*)-(low|medium|high)$/.exec(String(id ?? ''))
  if (!match) return { base: String(id ?? ''), effort: undefined }
  return { base: match[1], effort: match[2] }
}

/**
 * Group catalog entries by base model, collecting efforts.
 *
 * The group's representative entry is the FIRST one seen, but context, output
 * limit and capabilities are taken from whichever member reports them, because
 * the account can report slightly different limits per level.
 *
 * @param entries - raw catalog entries (one per suffixed id).
 * @returns base models with an ordered effort list.
 */
export function groupByBase(entries) {
  const groups = new Map()
  for (const entry of entries ?? []) {
    const { base, effort } = splitEffort(entry.id)
    let group = groups.get(base)
    if (!group) {
      group = {
        id: base,
        name: base,
        efforts: [],
        maxInputTokens: undefined,
        maxOutputTokens: undefined,
        supportsImages: false,
        supportsThinking: false,
        quota: undefined,
        members: [],
      }
      groups.set(base, group)
    }
    group.members.push(entry)
    if (effort && !group.efforts.includes(effort)) group.efforts.push(effort)
    // Prefer a human name from any member, minus the trailing level.
    if (typeof entry.name === 'string' && entry.name !== entry.id) {
      const trimmed = entry.name.replace(/\s*\((Low|Medium|High)\)\s*$/i, '').trim()
      if (trimmed !== '') group.name = trimmed
    }
    if (entry.maxInputTokens !== undefined) group.maxInputTokens = Math.max(group.maxInputTokens ?? 0, entry.maxInputTokens)
    if (entry.maxOutputTokens !== undefined) group.maxOutputTokens = Math.max(group.maxOutputTokens ?? 0, entry.maxOutputTokens)
    if (entry.supportsImages === true) group.supportsImages = true
    if (entry.supportsThinking === true) group.supportsThinking = true
    if (!group.quota && entry.quota) group.quota = entry.quota
  }
  for (const group of groups.values()) {
    group.efforts.sort((a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b))
  }
  // The account reports the SAME displayName for distinct ids
  // (gemini-2.5-flash, -lite and -thinking are all "Gemini 3.5 Flash Lite" as of
  // 2026-11-05). Three identical picker rows are not distinguishable, so only a
  // duplicated name gets the id appended.
  const names = new Map()
  for (const group of groups.values()) names.set(group.name, (names.get(group.name) ?? 0) + 1)
  for (const group of groups.values()) {
    if ((names.get(group.name) ?? 0) > 1) group.name = `${group.name} (${group.id})`
  }
  return [...groups.values()]
}

/**
 * Parse a fetchAvailableModels body into flat per-id entries.
 *
 * The response also lists utility routes (tabs, mquery, commit message, image,
 * audio transcription). Those are not conversation models, so they are filtered
 * by the response's own role lists plus an id shape check.
 *
 * @param payload - fetchAvailableModels JSON.
 * @returns one entry per conversation model id.
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
      // Measured: gpt-oss-120b reports no supportsImages and ignores inlineData.
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
 * Build the host's `LlmModelInfo` for one grouped model.
 *
 * CONTRACT (dsh-llm types.d.ts): `{ provider, id, name, description?,
 * inputModalities?, badge? }`. Notably there is NO `contextWindow` field here —
 * context belongs to `LlmResolvedModelInfo.context.contextWindow`.
 *
 * @param provider - registered route.
 * @param group - grouped catalog model.
 * @returns host model info.
 */
export function toModelInfo(provider, group) {
  const info = { provider, id: group.id, name: group.name ?? group.id }
  if (group.supportsImages) info.inputModalities = ['text', 'image']
  return info
}

/**
 * Build the host's `LlmResolvedModelInfo` for one grouped model.
 *
 * CONTRACT: extends LlmModelInfo with `context: { contextWindow }`,
 * `defaultMaxTokens`, and `reasoning: { efforts: [{ id, name }], defaultEffort? }`.
 * The effort ids are the LOWERCASE suffixes, which is what a caller passes back
 * as `GenerateOptions.reasoningEffort`.
 *
 * @param provider - registered route.
 * @param group - grouped catalog model.
 * @param options - `{ defaultMaxTokens }`.
 * @returns host resolved model info.
 */
export function toResolvedModelInfo(provider, group, options = {}) {
  const info = toModelInfo(provider, group)
  if (group.maxInputTokens) info.context = { contextWindow: group.maxInputTokens }
  // defaultMaxTokens is the per-request output cap materialized when a caller
  // omits one. maxOutputTokens is the model's CAPACITY, not a sensible per-turn
  // reservation: advertising it would reserve the whole output window for every
  // turn. The DeepInfra track hit the identical trap (its catalog's max_tokens
  // equals context_length on all 91 routes). So a cap is advertised only when the
  // caller supplies a turn policy, and is clamped to what the model can emit.
  const cap = Number(options.defaultMaxTokens)
  if (Number.isFinite(cap) && cap > 0) {
    info.defaultMaxTokens = group.maxOutputTokens ? Math.min(cap, group.maxOutputTokens) : cap
  }
  if (group.supportsThinking && group.efforts.length > 0) {
    info.reasoning = {
      efforts: group.efforts.map((effort) => ({ id: effort, name: EFFORT_NAMES[effort] ?? effort })),
      // The owner's test policy is the LOWEST level, not the first catalog row
      // (the account returns high, medium, low in that order). Without this the
      // picker says "Default" and the adapter resolves to high.
      defaultEffort: group.efforts[0],
    }
  }
  return info
}
