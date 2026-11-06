/**
 * Hot-pluggable DSH umbrella sub-router.
 *
 * One plugin instance can register several model-API routes. Each route goes
 * through the public `ctx.llm.registerAdapter()` extension point, so existing
 * routes (including dsh-llm-pi-ai's opencode-go) stay available alongside it.
 * Cordis runs the returned disposer when the plugin unloads, restoring the
 * route table to its pre-plugin state.
 */
import { AnthropicMessagesAdapter } from './anthropic.js'
import { OpenAIChatAdapter, resolveConfig, routeConfigs } from './adapter.js'

/** Host plugin name; must equal package name and cordis.patch.yml row id. */
export const name = 'dsh-subrouter'

/** The LLM registry is the only host service required. */
export const inject = ['llm']

export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig ?? {})
  const routes = routeConfigs(config)
  const disposers = []

  for (const route of routes) {
    if (!route.baseURL) {
      ctx?.logger?.warn?.(`dsh-subrouter: ${route.provider} has an empty baseURL; route not registered`)
      continue
    }
    if (!route.models.length) {
      ctx?.logger?.warn?.(`dsh-subrouter: ${route.provider} has no models; route not registered`)
      continue
    }
    const Adapter = route.protocol === 'anthropic-messages' ? AnthropicMessagesAdapter : OpenAIChatAdapter
    const adapter = new Adapter(ctx, route)
    const registration = ctx.llm.registerAdapter([route.provider], adapter)
    disposers.push(() => {
      adapter.disposed = true
      try {
        registration()
      } catch {
        /* registration was already released by the host */
      }
    })
    try {
      ctx.emit?.('llm/models-updated', route.provider)
    } catch {
      /* catalogs refresh on demand even when no UI is attached */
    }
    ctx?.logger?.info?.(
      `dsh-subrouter: registered provider "${route.provider}" `
      + `(${route.displayName}, ${route.protocol}) with ${route.models.length} model(s)`,
    )
  }

  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const release of disposers.reverse()) release()
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => dispose, 'dsh-subrouter: release adapter registrations')
  }
  return dispose
}
