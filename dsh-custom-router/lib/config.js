import { managementToken } from './management-token.js'

/** Loopback management surface of the local OpenCodex instance. */
export const DEFAULT_OPENCODEX_MODELS_URL = 'http://127.0.0.1:10100/api/selected-models'

/**
 * One configuration for every vendor plugin.
 *
 * The bridge is owned here, so the server URL and the shared DSH client-key id
 * are NOT per-vendor settings: three plugins each holding their own copy is how
 * one provider's save silently narrows the others' scope.
 */
export function bridgeConfig(env = process.env) {
  const url = env.OPENCODEX_BRIDGE_URL?.trim() || DEFAULT_OPENCODEX_MODELS_URL
  return {
    url,
    keyId: env.OPENCODEX_BRIDGE_KEY_ID?.trim() || '',
    managementToken: managementToken(env),
  }
}
