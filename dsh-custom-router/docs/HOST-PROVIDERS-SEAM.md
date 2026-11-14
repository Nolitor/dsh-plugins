# Host `dsh-llm-pi-ai` `providers` Seam — A7 Measurement

<!-- skeleton:
version: 1.0
kind: measurement
status: active
updated: 2026-11-14
summary: Measured answer for A7 — the host dsh-llm-pi-ai `providers: z.dict(profile)` seam, what it can and cannot express against the router's four presets, the provider-id collision it would create, and the owner decision it needs. Measurement frozen 2026-11-14; no code was changed by it.
-->

> **Status: measurement only.** This document records what was measured against the installed
> host, and stops there. **No router code changed, no profile value changed, no service
> restarted.** A7's exit bar is "a written, measured answer; no unmeasured data-only promise" —
> this is that answer. The code decision it implies is **owner-gated** and is not taken here.

## 1. The seam as installed

| Fact | Measured value |
| :--- | :--- |
| Package | `@deepseek-ai/dsh-llm-pi-ai@0.2.2-rc.3` (host DSH `0.2.2-rc.3`) |
| Mount | `@deepseek-ai/dsh-base/cordis.patch.yml` row **`llm-pi-ai`**, mounted **dormant**: zero routes and no extra picker models until a `llm-pi-ai:` settings section supplies profiles |
| Config schema | `const Config = z.object({ providers: z.dict(profile).default({}).volatile() })` (lib/index.js:1094) |
| `volatile()` semantics | the dict is a **lazily-read proxy**: `Object.keys(config.providers)` returns only `get`, and the value is read through `config.providers.get()`. Measured both ways — `Object.keys` → `["get"]`, `profiles.get()` → the real profile. **Reading it as a plain object silently looks empty**; that is a property of the seam, not a bug, and it is the single easiest way to mis-measure this seam. |
| Supported wires | `openai-completions`, `openai-responses`, `anthropic-messages`, `google-generative-ai` |
| Profile fields | `apiKeyEnv` (role `credential-ref`), `displayName`, `api`, `baseURL`, `models[]`, `modelOverrides{}`, `compat`, `defaultContextWindow`, `defaultMaxTokens`, `defaultInput`, `headers`, `reasoning`, `thinkingBudgets`, `cacheRetention`, `transport`, timeouts, image budgets, `retryPolicy` |
| Removed fields | `provider` (moved into the dict key) and `maxRetries`/`maxRetryDelayMs` (removed; compose with `dsh-llm-retry`) — both **throw** with a naming diagnostic |

## 2. The decisive finding: the host catalog already covers two of the four presets

The seam resolves a profile against pi-ai's **installed catalog**. Measured: `builtinProviders()`
returns **43** providers, and it already ships first-class `opencode` (**OpenCode Zen**) and
`opencode-go` (**OpenCode Go**) entries with real endpoints and per-model wire/baseUrl:

| Catalog provider | Models | Sample model fact |
| :--- | --: | :--- |
| `opencode` | **85** | `glm-5.3-flash` present |
| `opencode-go` | **32** | `glm-5.3-flash` → `api: openai-completions`, `baseUrl: https://opencode.ai/inference/go/openai/v1`, ctx **1 000 000**, maxTokens **131 072** |
| `deepseek` | — | `baseUrl: https://api.deepseek.com` |

Both catalog entries carry `auth: { apiKey: { name: "OpenCode API key" } }`, so a profile may
supply `apiKeyEnv` **or** inherit the catalog's own native auth (`routeAuth`: the catalog's auth
wins when it has one, and a harness api-key auth is substituted only when the profile names a
credential and the catalog has none).

Against the router's four presets:

| Preset | Router `providerId` | In the pi-ai catalog? |
| :--- | :--- | :--- |
| antigravity | `antigravity` | **No** |
| opencode | `opencode-http-agent` | **Not under that id** — the catalog's own ids are `opencode` / `opencode-go` |
| deepinfra | `deepinfra` | **No** |
| exaone | `exaone` | **No** |

So the seam can serve **OpenCode-shaped traffic only when the route id is one the catalog already
ships**. Two of the router's four presets are simply not catalog routes, and OpenCode's live
router id (`opencode-http-agent`) is a *different id* from the catalog's (`opencode`,
`opencode-go`).

## 3. What the seam cannot express (against this router's actual work)

Measured by reading the resolve path, not by inference:

1. **The OpenCode daemon indirection is not expressible.** The router reaches OpenCode through a
   spawned `opencode serve` daemon and its own HTTP surface; the catalog routes point straight at
   `https://opencode.ai/inference/...`. Neither is a `baseURL` swap for the other — the daemon is a
   different API, not a different host.
2. **The delivery surfaces are out of scope.** The router owns a dashboard, a cost/plan/usage
   ledger, a model picker projection, dispatch admission/reclamation and a browser bundle. The host
   seam expresses **only** provider profiles: api, endpoint, models, compat, retry. An
   "absorb the router into pi-ai profiles" move would carry the wire and drop everything above it.
3. **Non-catalog routes must spell everything out.** `resolveRouteModels` requires that a route the
   catalog does not describe lists its models **and** sets `api` + `baseURL`, because there is no
   catalog base to fall back on (measured error text: *"needs an api; the installed catalog does not
   describe it"* / *"needs a baseURL"*). A hand-declared Antigravity/DeepInfra/EXAONE profile is
   therefore a full model list, not a pointer.
4. **The seam has no billing, plan or catalog-refresh surface.** Per-request `cost`/`opencode.*`
   accounting, plan windows, ranking order, and the `?refresh=1` catalog bypass all live in the
   router's own layer and have no profile field to land in.

## 4. The collision an owner decision would have to resolve

The host's `llm-pi-ai` is mounted **dormant** in this profile today; no `llm-pi-ai:` settings
section exists in `~/.dsh/profiles/web/cordis.patch.yml`, so it registers **zero** routes and adds
no picker rows. That is the only reason there is no collision right now.

If profiles were supplied for catalog-backed OpenCode routes, the ids `opencode` / `opencode-go`
would be registered **by the host adapter** while the router separately serves
`opencode-http-agent`. Those are different ids, so it mounts — but it would present **two parallel
ways to reach the same upstream** with different accounting, which is the drift class the preset
registry gate exists to prevent. `lib/presets.js` already rejects a duplicate `providerId` inside
the router (`validatePresets`, `duplicate providerId "…"`); it cannot see a host-registered route.

## 5. Verdict (the measured answer A7 asked for)

- **The seam exists, is well-formed, and is genuinely capable** for what it models: one dict of
  provider profiles, four wire protocols, catalog-backed or fully hand-declared routes, credential
  refs with a `credential-ref` role, per-route retry/compat/timeouts.
- **It cannot replace this router.** It models *provider profiles*; the router is a *serving layer
  plus a bill* — daemon indirection, ledger, picker, dispatch gates, dashboard. Only the wire half
  of one preset (OpenCode) overlaps, and even that reaches a different endpoint.
- **A "data-only preset" promise through this seam is not reachable**, which confirms the earlier
  removal of **P2-1** as an unreachable promise rather than a regression.
- **Do not supply `llm-pi-ai` OpenCode profiles** without an owner decision: it would create a
  second route family to the same upstream, outside the preset registry's gates.

**Owner decision requested (A7 exit):** keep `llm-pi-ai` dormant (recommended), or declare one or
more catalog-backed profiles. Nothing here authorises either; the recommended option changes
nothing, which is why it is the safe close.

## 6. How this was measured

```bash
P=~/.local/nodejs/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai
cd $P && node --input-type=module -e "
const m = await import('./lib/index.js');
const all = await import('@earendil-works/pi-ai/providers/all');
console.log(m.supportedProtocols());                       // 4 wires
console.log(all.builtinProviders().length);                // 43
console.log(all.getBuiltinModels('opencode-go').length);   // 32
const cfg = m.Config({ providers: { 'opencode-go': { apiKeyEnv: 'OPENCODE_API_KEY' } } });
console.log(JSON.stringify(cfg.providers.get()));          // the REAL value (not Object.keys)
"
grep -n "providers: z.dict(profile)" $P/lib/index.js        # 1094
grep -n "llm-pi-ai" <host>/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml
```

**Scope statement.** Measured 2026-11-14. No reverse-engineering beyond the resolve path above, per
owner instruction to freeze A7 at the point measured. No live profile value was read beyond the
presence/absence of a `llm-pi-ai:` section; no secret is reproduced here.
