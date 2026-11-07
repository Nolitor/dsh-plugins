/** OpenCodex management-plane client. No upstream provider secret is accepted here. */
export const DEFAULT_OPENCODEX_MODELS_URL = 'http://127.0.0.1:10100/api/selected-models'

export function opencodexOrigin(url = DEFAULT_OPENCODEX_MODELS_URL) {
  return new URL(url).origin
}

export function createOpenCodexClient(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const base = options.url ?? DEFAULT_OPENCODEX_MODELS_URL
  const headers = {
    'content-type': 'application/json',
    ...(options.managementToken ? { authorization: `Bearer ${options.managementToken}` } : {}),
  }
  async function request(path, method, body) {
    const response = await fetchImpl(opencodexOrigin(base) + path, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: options.signal,
    })
    const text = await response.text()
    let result
    try { result = JSON.parse(text) } catch { result = { error: text.slice(0, 160) } }
    if (!response.ok) throw new Error(`OpenCodex ${path} failed (HTTP ${response.status}): ${result.error ?? 'unknown error'}`)
    return result
  }
  return {
    selectedModels: () => request('/api/selected-models', 'GET'),
    selectModels: (provider, models) => request('/api/selected-models', 'PUT', { provider, models }),
    scopeKey: (keyId, allowedModels) => request('/api/keys', 'PATCH', {
      id: keyId, allowedModels: allowedModels.length > 0 ? [...new Set(allowedModels)] : null,
    }),
  }
}
