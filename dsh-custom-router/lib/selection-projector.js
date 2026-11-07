/** Project DSH picker selections onto OpenCodex's public provider/model ids. */
export const AGY_WIRE_ALIASES = Object.freeze({
  'gemini-2.5-flash-lite': 'gemini-3.5-flash-lite',
  'gemini-2.5-flash': 'gemini-3.5-flash-lite',
  'gemini-2.5-flash-thinking': 'gemini-3.5-flash-lite',
})

/** DSH routes carry a `provider/` prefix; OpenCodex stores the bare model id. */
export function openCodeSelection(enabled, activePlan = 'go') {
  if (!Array.isArray(enabled)) throw new TypeError('enabled must be an array')
  const provider = activePlan === 'zen' ? 'opencode' : 'opencode-go'
  const prefix = provider + '/'
  const models = [...new Set(enabled
    .filter((id) => typeof id === 'string' && id.startsWith(prefix))
    .map((id) => id.slice(prefix.length)))]
  return { provider, models }
}

/** Collapse one raw Antigravity wire id onto its OpenCodex public family. */
export function agyBase(id) {
  const raw = String(id ?? '')
  return AGY_WIRE_ALIASES[raw] ?? raw.replace(/-(low|medium|high)$/, '')
}

/** Never invent a family OpenCodex does not advertise. */
export function antigravitySelection(enabled, available) {
  if (!Array.isArray(enabled)) throw new TypeError('enabled must be an array')
  const advertised = new Set(available ?? [])
  return [...new Set(enabled.map(agyBase).filter((id) => advertised.has(id)))]
}

export function projectSelection({ provider, enabled, activePlan, available = [] }) {
  if (!Array.isArray(enabled)) throw new TypeError('enabled must be an array')
  if (provider === 'opencode-go' || provider === 'opencode') {
    return openCodeSelection(enabled, provider === 'opencode' ? 'zen' : 'go')
  }
  if (provider === 'deepinfra') return { provider, models: [...new Set(enabled)] }
  if (provider === 'google-antigravity') return { provider, models: antigravitySelection(enabled, available) }
  throw new Error(`unsupported OpenCodex provider: ${provider}`)
}
