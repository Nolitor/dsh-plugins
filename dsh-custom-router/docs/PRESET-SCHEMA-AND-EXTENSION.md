# Custom Router — Service Preset Schema, Standardisation, and Extension Limits

<!-- skeleton:
version: 0.0.1-rc.1
kind: spec
status: active
updated: 2026-11-06
summary: Normative per-service preset schema, the common preset data model (delivery kind, authentication mode, endpoint protocol/transport), the standardisation boundary, how far preset extension can go, and the coverage ceiling for services added in the future.
-->

> Status: **specification built on measurement**, 2026-11-06, DSH `0.2.2-rc.1`. The owner
> asked four things the previous specs never answered: the per-service preset **규격**, the
> **스키마 규격**, how far **프리셋 확장** is possible, and how far a **future service's preset**
> can cover. Every limit below is read from installed source, not designed.
> Version discipline: document skeleton uses the `rc.#` history scheme; the plugin
> `@nolit/dsh-custom-router` starts at `0.0.1-rc.1`. No `rc#` advanced by the agent.
> Parents: [CUSTOM-ROUTER-SERVICE-SPEC.md](./CUSTOM-ROUTER-SERVICE-SPEC.md),
> [CUSTOM-ROUTER-ARCHITECTURE.md](./CUSTOM-ROUTER-ARCHITECTURE.md),
> [CUSTOM-ROUTER-PRESET-SURFACE.md](./CUSTOM-ROUTER-PRESET-SURFACE.md),
> [PLAN-AND-USAGE-SPEC.md](./PLAN-AND-USAGE-SPEC.md).

## 1. The measured substrate (what a preset is made of)

| Layer | Measured contract | Source |
| :--- | :--- | :--- |
| Preset row | `AgentPreset.Config = z.object({ id: string.required(), name, description, order: number, plugins: z.array(z.any()).required() })` → `ctx.agentPresets.register(config)` | `@deepseek-ai/dsh-agent-preset/lib/index.js:11–30` |
| Row validation | a composition row must have a non-empty `name`; `group: true` nests a sub-list | `dsh-agent-preset-registry/lib/index.js:10–32` |
| Surface slot | `settings.section` is a **list** slot; `ctx.slots.inject('settings.section', () => ctx.slots.register({ name, id, order, label }, component))` | `dsh-client-ui-settings-general/lib/client.js:1547,1587`; runner `SlotKind = 'single'|'list'|'keyed'|'chain'` |
| Config types | schemastery `string | number | boolean | array(T) | dict(T) | union([...]) | any`, plus `.default()`, `.volatile()`, `.description()`, `.role('secret')`, `.badge()`, `.i18n()` | vendored schemastery in `dsh-client-ui-settings/lib/client.js:263–425`; used in all 3 plugins |
| Settings write | `setPath(root, path, value)` / `deletePath` on a namespace; `settings.describe` mirror exposes `writable` and redacts `role('secret')` | `dsh-client-ui-settings/lib/client.js:1006–1030, 1339–1498`; DeepInfra `server.js:238,276` |
| Registration | `ctx.llm.registerAdapter([providerId], adapter)` — all-or-nothing, `DUPLICATE_ADAPTER` on a used id | `dsh-llm/lib/index.js:1842–1903` |

**Field counts measured in the three services:** OpenCode v2 **71**, Antigravity **33**, DeepInfra
**7** distinct `Config` fields. The asymmetry is the point — a single flat "preset schema" cannot
describe all three; the standard must be a **descriptor over per-service Config**, not one shared
object.

## 2. Normative per-service preset schema (the 규격)

### 2.1 The preset descriptor (one per service tab)

```ts
interface ServicePreset {
  // --- identity (maps 1:1 onto AgentPreset.Config) ---
  id: string                    // stable, lowercase-hyphen, e.g. 'opencode-v2'
  name: string                  // locale-aware label
  description: string
  order: number                 // display order in the tab strip
  plugins: Array<{ name: string; id?: string; config?: Record<string, unknown> }>  // z.array(z.any())

  // --- activation (the "one tool = one service" rule) ---
  activation: {
    masterSwitch: string        // Config field, e.g. 'enabled' (AG) or the bundle row (OC/DI)
    providerId: string          // UNIQUE; registerAdapter([...])
    surfaces: string[]          // tools/commands/providers/chips this row mounts
    disposer: 'registerAdapter-handle' | 'ctx.effect'
  }

  // --- credential (owner decision 2) ---
  credential: {
    mode: 'read-only-reference' | 'separate-input'
    refName?: string            // credentialRef(name) -> resolve -> found/missing only
    secretField?: string        // role('secret') Config field
    envFallback?: string
    webAuth: 'oauth' | 'token-file' | 'none'
    keyInputShownWhen: 'web-auth-absent'   // never otherwise
    writeTarget: 'own-namespace'           // settings.update(own id, ...), never refs
  }

  // --- readiness (the per-service checklist) ---
  readiness: Array<{
    id: string
    kind: 'binary' | 'token-file' | 'oauth-refresh' | 'control-plane' | 'endpoint' | 'catalog' | 'plan-probe'
    probe: string               // exact command / endpoint / file
    passCondition: string
    onFail: 'block-activation' | 'warn'
  }>

  // --- plan & usage (see PLAN-AND-USAGE-SPEC.md) ---
  plan: { layers: ['L1-static','L2-account','L3-probe']; verdictType: 'PlanVerdict' }
  usage: { readingType: 'UsageReading'; rules: 'U1-U7' }

  // --- service-specific extension (the only open part) ---
  configSchema: Record<string, ConfigFieldSpec>   // derived from the plugin's real Config
  extensions: PresetExtension[]                  // §4
}

interface ConfigFieldSpec {
  type: 'string'|'number'|'boolean'|'array'|'dict'|'union'|'any'
  of?: ConfigFieldSpec                          // array/dict element
  allowed?: string[]                            // union members (measured enums)
  default?: unknown
  volatile: boolean
  secret: boolean                               // role('secret')
  description?: string
  writable: boolean                             // from settings.describe mirror
}
```

### 2.2 The three instantiated descriptors (measured, not invented)

| Section | OpenCode v2 | Antigravity | DeepInfra |
| :--- | :--- | :--- | :--- |
| `id` | `opencode-v2` | `antigravity` | `deepinfra` |
| `providerId` | `opencode-http-agent` | `antigravity` | `deepinfra` |
| master switch | bundle row `dsh-opencode-v2-http` (`disabled:false`) | `Config.enabled` | bundle row `dsh-deepinfra` |
| `surfaces` | route, `opencode`, `/ocode`, `cli_worker`, `subagent_opencode`, cost pill | route, `/agy`, `agy_worker`, `subagent_antigravity`, usage chip | route, cost chip |
| `credential.webAuth` | `oauth` (`Personal`, active) | `token-file` (refresh_token → grant) | `none` (bearer key) |
| `credential.secretField` | `apiKey`, `password` (2) | `clientSecret`, `refreshToken` (2) | `apiKey` (1) |
| `credential.envFallback` | `OPENCODE_API_KEY` | `ANTIGRAVITY_REFRESH_TOKEN` | `DEEPINFRA_API_KEY` |
| union/enum fields | `activePlan`(go|zen), `workerBackend`, `httpRetryStatuses` | `effort`, `mode`, `httpRetryStatuses` | `defaultEffort` (documented 7 levels) |
| readiness probes | binary, daemon/service.json, `/api/credential`, `/api/experimental/usage/limits`, L3 probe | `agy`, `agy models`, token file, oauth2 grant, `loadCodeAssist`, `retrieveUserQuotaSummary` | env/UI key, public `/models`, `/v1/request-costs` (404 → unavailable) |
| config field count | 71 | 33 | 7 |

**Standardisation boundary (the answer to "스키마 규격"):** `ServicePreset` itself is the one
shared schema. `configSchema` is **derived** from each plugin's real `Config` — it is not
hand-written and must be re-measured, never assumed. Shared = identity/activation/credential/
readiness/plan/usage shape; custom = `configSchema` + `readiness` + `extensions`.

## 2.3 Common preset data model (2026-11-07) — delivery, auth, endpoint

The `ServicePreset` above describes the **settings surface**. The questions a new provider raises
before any surface exists are answered by a smaller, machine-checked model in
[`lib/preset-schema.js`](../lib/preset-schema.js) (exported as
`@nolit/dsh-custom-router/preset-schema`) with a JSON Schema mirror
(`PRESET_JSON_SCHEMA`). Every preset — measured or declared — must fill it.

### 2.3.1 The three axes

| Axis | Field | Allowed values | Measured ground |
| :--- | :--- | :--- | :--- |
| **Delivery** | `kind` | `package` (code-backed, mounted as a child plugin) or `declaration` (JSON data only, no package) | the three vendors are npm packages; a loopback OpenAI endpoint needs no code |
| **Authentication** | `auth.mode` + ordered `auth.sources` | `api-key`, `web-auth`, `local-socket`, `none`; sources `secret-field`, `env`, `credential-ref`, `token-file`, `daemon-endpoint` | credentials service's two spaces (`CredentialRef` vs `CredentialRecord`), vendor token files, `GET /api/credential` |
| **Endpoint** | `endpoint.mode`, `.protocol`, `.route`, `.baseUrl`, `.transport` | modes `http`, `local-http`, `daemon`; protocols `openai-completions`, `openai-responses`, `anthropic-messages`, `google-generative-sse`, `google-generative-ai`; routes `pi-ai`, `own`; transports `sse`, `websocket`, `websocket-cached`, `auto` | `dsh-llm-pi-ai` `PROTOCOLS` (three host wires only) + `transport`; the two Google vendor wires (`google-generative-sse` = Antigravity's `v1internal:streamGenerateContent`, `google-generative-ai` = the `generateContent` family); localhub `127.0.0.1:8080/v1` |

### 2.3.2 Measured instances

| Preset | kind | endpoint | auth |
| :--- | :--- | :--- | :--- |
| `antigravity` | package `@nolit/dsh-antigravity` | `http` · `google-generative-sse` · `own` · `sse` · `daily-cloudcode-pa.googleapis.com` (catalog + generation; `loadCodeAssist` also answers on the control host — measured 2026-11-13: the control host omits every Hydrogen route) | `web-auth`: token-file → `refreshToken` → `clientSecret` → env `ANTIGRAVITY_REFRESH_TOKEN` |
| `opencode` | package `@nolit/dsh-opencode-v2` | `daemon` · `openai-completions` · `own` · `sse` · `/chat/completions` | `web-auth`: daemon `/api/credential` → `apiKey` → `password` → env `OPENCODE_API_KEY` |
| `deepinfra` | package `@nolit/dsh-deepinfra` | `http` · `openai-completions` · `own` · `sse` · `api.deepinfra.com/v1/openai` | `api-key`: `apiKey` → env `DEEPINFRA_API_KEY` |
| `exaone` | package `@nolit/dsh-custom-router/vendor/exaone` | `http` · `openai-completions` · `own` · `sse` · `api.exaone.ai/v1` | `api-key`: `apiKey` → env `EXAONE_API_KEY` |

A `declaration` example ships as `DECLARATION_EXAMPLE` (loopback `local-http`, `auth: none`,
`catalog: static`) — the shape an operator fills when no package is involved.

### 2.3.3 Catalog & price synchronization — the 3 layers (owner decision 2026-11-07)

`catalog.layers` is an ordered array; merge precedence is **3 > 2 > 1** and merging is
**field-level** (a later layer patches only the fields it defines).

| Layer | `source` | What it is | Measured |
| :--- | :--- | :--- | :--- |
| 1 (fallback) | `upstream` | the pi-ai static snapshot | 42 providers, **1,712 models, all priced**, 261 with price tiers; generated `2026-11-02T10:43:28Z` (manifest `schemaVersion: 6`) |
| 2 (dynamic) | `probe` | a live API / web-auth probe of the endpoint's own list | OpenAI `GET {baseURL}/models`, Anthropic `GET {root}/v1/models?limit=…`, OpenCode `/api/model`, Antigravity `fetchAvailableModels`, DeepInfra `/models` |
| 3 (manual) | `override` | preset/local data: local models and new prices | `models[]` (context, maxTokens, modalities, reasoning, cost) and `pricing[]` (`{modelId, cost}` partial rate patches) |

Measured instances: `antigravity` = probe only (absent from pi-ai's snapshot); `opencode` = upstream
(`opencode`, `opencode-go`) + probe; `deepinfra` = probe only (absent from the snapshot); the
`DECLARATION_EXAMPLE` = override only (a local loopback model, no package).

**Merge rules** (`lib/catalog.js`, exported as `@nolit/dsh-custom-router/catalog`):

1. `mergeCatalog(layers)` merges by model id, field by field; `cost` is merged rate by rate, and
   `tiers` replaces only when a layer supplies it.
2. A later layer may create a model the earlier layers never described (local models).
3. Each merged model records `source` (highest layer that contributed) and `layers` (provenance).
4. Layers must be ordered `upstream → probe → override`; a duplicate source in one preset is an error.

**Cost arithmetic** (`lib/cost.js`, exported as `@nolit/dsh-custom-router/cost`) mirrors upstream
pi-ai `calculateCost()` because the DSH wrapper drops `usage.cost` (measured: `mapUsage()` forwards
tokens only): rates are US$ per 1M tokens, tiers apply by `input + cacheRead + cacheWrite`, a 1-hour
cache write bills at 2× the input rate, and `total` sums the four buckets.

### 2.3.4 Routing and the probe executor (2026-11-07)

**Routing** (`lib/routing.js`, exported as `@nolit/dsh-custom-router/routing`) decides which preset
serves a model id, in this order: explicit `presetId` → explicit `providerId` → the model id's
**`modelPrefixes`** segment before the first `/`. A prefix claimed by two presets is refused
(`claimed by a, b`), never guessed; a bare id can route only when exactly one preset is declared.
`resolveRoute()` returns the same decision plus `endpoint` and `auth` for the caller.

**Probe** (`lib/probe.js`, exported as `@nolit/dsh-custom-router/probe`) is layer 2. The probe layer
declares `shape`:

| `shape` | Endpoint answer | Executor behaviour |
| :--- | :--- | :--- |
| `openai` | `{data:[{id, context_length?, max_output_tokens?}]}` or a bare array | normalizes ids/names/limits; `Authorization: Bearer` |
| `anthropic` | `{data:[{id, display_name}]}` | one page only (`has_more` not followed); `x-api-key` + `anthropic-version` |
| `vendor` | provider-specific RPC (`/api/model`, `fetchAvailableModels`) | **refused** (`VENDOR_OWNED`) — the owning plugin parses it, not the router |

`probeCatalog(layer, {baseUrl, apiKey, fetchImpl, signal})` is injected (tests never hit the network);
`probePreset()` runs every standard layer, skips vendor-owned ones, and returns
`{models, measuredAt, errors}` ready to feed `mergeCatalog([upstream, probeResult, override])`.

### 2.3.5 Plan and billing — subscription vs flat vs per-token (2026-11-07)

`usage.billing.mode` names the billing model, and `lib/plan.js`
(`@nolit/dsh-custom-router/plan`) judges and prices it.

| Mode | Provider (measured) | Billing outcome |
| :--- | :--- | :--- |
| `subscription` | antigravity (5h / weekly / monthly windows) | plan covers usage → billed `0`, covered `true`; windows `limited` → `throttled` (still covered); verdict `unknown` → billed `null` |
| `flat` | opencode-v2 (go/zen, per-request allowance) | same as subscription |
| `pay-per-token` | deepinfra (catalog rates) | billed = `calculateCost().total` (`estimated`) |
| `none` | loopback declaration | billed `0` |

**PlanVerdict** (spec §1.4) combines L1 declared, L2 account and L3 endpoint probe:
`no-plan-service` (billing `none`), `throttled` (a window says limited), `mismatch` (declared ≠ account),
`match` (a settled probe / account plan), and `unknown` (probe failed or never ran — **visible**, never
rendered as `0%` or "no plan"). `billingOutcome()` returns `{billed, covered, confidence, reason}` and
never turns `unknown` into zero.

### 2.3.6 Usage binding, quota display, and the vendor-probe connection (2026-11-07)

**Vendor-probe connection** (`probeVendor` in `lib/probe.js`) resolves a `shape: 'vendor'` layer in
this order:

1. `options.vendorProbes[preset.id]` — an explicit handler supplied by the owning plugin;
2. `ctx.llm.discoverModels(layer.namespace, {provider, baseURL, apiKey})` — the host discovery seam;
3. otherwise `VENDOR_OWNED` with a reason naming both missing pieces.

Measured 2026-11-07: **none of the three vendor plugins calls `ctx.llm.registerModelDiscovery`** (0
hits); OpenCode keeps its discovery inside `lib/provider.js` (`discoverModels`, `discoverModelsViaServe`)
and derives its settings namespace as `dsh-opencode-v2-http`. So a vendor connects by passing a
handler or registering discovery — the router never re-implements the RPC.

**Usage binding** (`lib/usage.js`, `bindUsage`) turns one adapter usage record into
`{usage, cost, billing, readings}`: normalized token buckets, `calculateCost()`, `billingOutcome()`,
then `UsageReading[]`.

**Quota display** (`windowReadings`) normalizes provider windows (`rolling`→`5h`, `7d`→`weekly`,
`30d`→`monthly`) into `percent-consumed` / `fraction-remaining` readings with locale-aware
`display` (`en`/`ko`), `limited`, `resetsAt` and `measuredAt`.

**Invariant:** a reading that could not be measured is `confidence: 'unavailable'` with a reason —
`bindUsage` appends such a reading instead of claiming `$0` when the plan verdict is `unknown`.

### 2.3.7 Vendor bridges — antigravity, opencode, deepinfra (2026-11-07)

Antigravity cannot use the generic probe: the endpoint rejects a request without the measured
client identity (documented at `dsh-antigravity/docs/ANTIGRAVITY-DIRECTSDK-MEASUREMENT.md` §"Digital
fingerprint").

| Without | With |
| :--- | :--- |
| UA missing → **403** `"You do not have a valid license of this product"`; `loadCodeAssist` → `UNSUPPORTED_CLIENT` | `antigravity/cli/1.5.0 (aidev_client; os_type=linux; arch=amd64; cl=1013440158; auth_method=consumer)` → accepted |

`lib/bridges/antigravity.js` (`@nolit/dsh-custom-router/bridges/antigravity`) builds the probe from the
vendor's own exports — no vendor edit:

| Vendor export | Used for |
| :--- | :--- |
| `./auth` → `TokenProvider` | OAuth access token (refresh file / explicit token) |
| `./settings` → `resolveEndpoint` | base URL, project, **measured User-Agent** |
| `./catalog` → `parseCatalog` | conversation models, quota, utility filtering |

**Flexible slots** (read from `vendorConfig[presetId]`, reactive or plain; every slot optional):

| Slot | Default | Purpose |
| :--- | :--- | :--- |
| `tokenPath` | vendor's measured `~/.gemini/antigravity-cli/*` | different machines / token file locations |
| `refreshToken` | — | explicit token, highest precedence |
| `userAgent` | measured `antigravity/cli/…` | environment-specific client identity |
| `extraHeaders` | `{}` | proxy routing / custom headers |
| `project`, `baseUrl`, `controlBaseUrl` | vendor defaults | host and project overrides |

**The other two bridges** (`lib/bridges/`, `@nolit/dsh-custom-router/bridges`):

| Vendor | Endpoint | Auth | Reused vendor exports |
| :--- | :--- | :--- | :--- |
| `opencode` | `GET {daemon}/api/model` | `Basic opencode:<password>` from `opencode/service.json` or slots | `./http` `authHeader`, `serviceStateCandidates`; `lib/shared.js` `modelsFromApiPayload` (file URL, not an export-map entry) |
| `deepinfra` | `GET https://api.deepinfra.com/v1/openai/models` | `Bearer <apiKey>` / `DEEPINFRA_API_KEY` | none needed — thin wrapper over `probeCatalog` (shape `openai`) |

OpenCode slots: `baseUrl`, `password`, `serviceFile` (or `serviceStatePath`), `extraHeaders`.
DeepInfra slots: `baseUrl`, `apiKey`, `extraHeaders`. `createVendorBridges({modules})` builds all
three; without vendor modules only `deepinfra` is available (standard listing).

**Module resolution and the apply seam:** `lib/vendor-modules.js` resolves every vendor entry through
the **profile's** `package.json` (`createRequire`), because bare specifiers fail from the router's own
path (measured). `apply()` accepts `profileDir`; it loads the modules, builds the bridges, resolves
each preset package to a file URL for `ctx.plugin`, and provides the `customRouter` seam
`{presets, vendorProbes, route(), probe(), merge()}` so the rest of the body never re-derives paths.

Proxy note: the OpenCodex router's management token is a **different** credential (its
`lib/opencodex-client.js` sends `authorization: Bearer <managementToken>`); antigravity keeps its own
OAuth chain, and `extraHeaders` (with `HTTPS_PROXY` handling) is the proxy hook. The handler never
invents a User-Agent — an override wins, otherwise the vendor's resolved value is used.

### 2.3.8 Rules the validator enforces

1. `kind: package` requires a scoped package name; `kind: declaration` forbids one and requires a
   `static` catalog with at least one model id.
2. `endpoint.route: 'pi-ai'` requires a protocol the host implements; `own` is required for a wire
   the host does not speak (Google SSE today).
3. `endpoint.baseUrl` must be an http(s) URL, except for `daemon` where it may be empty (resolved at
   runtime).
4. `auth.mode` and its sources must agree: non-`none` needs at least one source; `none` must declare
   none; `web-auth` needs a token-file / daemon-endpoint / credential-ref; `local-socket` requires a
   `local-http` or `daemon` endpoint.
5. `secret-field` sources are camelCase field names on the plugin's `Config`; values are never
   inside the preset.

## 3. Schema conformance rules (스키마 규격)

| # | Rule | Measured ground |
| :--- | :--- | :--- |
| S1 | `id` unique across presets; `providerId` unique across all mounted rows | `DUPLICATE_ADAPTER` (`index.js:1872`), duplicate tool/command aborts the row (RULES.md §4) |
| S2 | `plugins: z.array(z.any())` — a preset row may carry any plugin rows, but each must still pass `entryListProblem` (`name` non-empty, nested `group:true` is a list) | agent-preset-registry `lib/index.js:10–32` |
| S3 | every `secretField` is `role('secret')`; the preset renders "set / not set" only, never the value | `http.js:129–134`, DeepInfra client hint |
| S4 | every `union` field lists its **measured** allowed values; adding one requires a source change + re-measure | `activePlan: Schema.union(PLANS)`, `PLANS=['go','zen']` |
| S5 | `configSchema` is generated from the plugin `Config` at build/verify time; drift fails the gate | field counts 71/33/7 measured 2026-11-06 |
| S6 | `settings.describe` decides `writable`; a non-writable field is display-only | `dsh-client-ui-settings/lib/client.js:1213–1227, 1287` |
| S7 | writes go only to `settings.update(<own id>, …)`; never to `.credentials.yaml` `refs` | [PRESET §1.2](./CUSTOM-ROUTER-PRESET-SURFACE.md), owner decision 2 |
| S8 | each preset owns **one** `settings.section` entry with a unique `id` + `order` | `SlotCore.register` `StoredEntry.options {key,id,order,label,priority}` |
| S9 | locale-aware `label` + `name`; typography consumes live tokens | [PLUGIN-STYLE-STANDARD.md](../../docs/PLUGIN-STYLE-STANDARD.md) |

## 4. How far preset extension can go (프리셋 확장 기능)

Measured capability, then the hard ceiling.

### 4.1 What is possible today (no host change)

| Extension | Feasible | Mechanism |
| :--- | :--- | :--- |
| Add a **4th service tab** | ✅ unlimited | `settings.section` is `kind:'list'`; `entries()` returns all occupants. No count cap measured. |
| Add a **field** to a service tab | ✅ | add a schemastery `Config` field (`string/number/boolean/array/dict/union/any`) + `volatile()` + `settings.update`. Host `setPath` materialises nested containers. |
| Add a **nested object / array of objects** | ✅ | `Schema.dict`, `Schema.array(Schema.object)`, `setPath` supports object-key **and array-index** paths. |
| Add a **choice / badge / i18n** | ✅ | `Schema.union`, `.badge()`, `.i18n()` (vendored schemastery lines 412–425). |
| Add a **secret** | ✅ | `role('secret')` → host redaction, never returned. |
| Add a **child slot** inside the tab | ✅ | `SlotCore.register` supports `children` (`ChildrenDecl`) + `SlotSpec` per child; a tab can declare its own sub-slots. |
| Add a **per-session scoped surface** | ✅ | `SlotEntryDef.scope: SlotScope`; `conversation.input.right` already `scope:'session'`. |
| **Reorder / hide** a tab | ✅ | `order` + `priority` in `StoredEntry.options`; `renderSlot(..., {only: active})` selects one. |
| **Swap a service at runtime** | ✅ | `handle.replace(providers)` atomic; `handle()` disposes own ids only, standard routes survive. |
| **Conditional fields** | ⚠️ limited | no native `when` on Config fields measured; do it in the React tab (show/hide), not in the schema. |
| **Cross-preset relations** (one tab depends on another) | ⚠️ | `agentPresets` registry tracks revisions per preset; no dependency field measured. Keep presets independent. |

### 4.2 The hard ceiling (what is NOT possible unasked)

| Limit | Why |
| :--- | :--- |
| **Duplicate `providerId` / tool / command / slot `id`** | hard mount failure; abort the row. Extension is by **4-step replacement**, never a second declaration. |
| **Tabs inside the standard Models page** | no `registerTab`/`addTab` API (grep 0); that page is a flat `rowCard` section. |
| **Write into another plugin's namespace or `refs`** | single-writer (RULES.md §3); `.credentials.yaml` is provider-managed strict map. |
| **Silently intercept a DSH-managed key** | owner decision 2: read-only reference only. |
| **A number where the provider did not answer** | U2 in [PLAN-AND-USAGE-SPEC.md](./PLAN-AND-USAGE-SPEC.md): `unavailable` with reason, never 0. |
| **New `SlotKind` / new global seat** | `SlotKind = 'single'|'list'|'keyed'|'chain'` is host-typed; a new top-level seat needs a host change (UI-SLOT-ARCHITECTURE §3). |
| **Plugin version bump by the agent** | `0.0.1-rc.1` start; the numeric part is owner-gated, `rc#` is agent-managed (global AGENTS.md §6). |
| **Live profile / 3080 restart** | RULES.md §2; owner approval only. |

**Verdict on "어디까지 가능한가":** a preset can grow **without bound in field count, nested
structure, number of tabs, child slots, and runtime swaps** — because the substrate is
`z.array(z.any())` + a list slot + schemastery's recursive types. What it **cannot** do is
violate uniqueness, reach outside its own namespace, invent a host slot kind, or fabricate a
measurement. The ceiling is **identity and authority**, not expressiveness.

## 5. Coverage ceiling for a future service (추가 구현될 서비스별 프리셋)

The owner asked how far a newly added service's preset can cover. Measured answer: it can cover
everything in `ServicePreset` **iff** the service publishes the facts. Coverage is graded, not
binary.

### 5.1 Coverage tiers

| Tier | What the preset can show | Requirement on the new service |
| :--- | :--- | :--- |
| **T0 — identity** | tab, activation switch, provider id, surfaces | M1 `registerAdapter` with a unique id |
| **T1 — credential** | read-only ref + separate key input when web auth absent | M4 credential chain; publish `webAuth` kind |
| **T2 — readiness** | install / token / oauth / endpoint checklist | M9 probe chain; each probe has a pass condition |
| **T3 — catalog** | model list, context, reasoning, new-model badge | M5 catalog source (live or TTL) |
| **T4 — plan** | `PlanVerdict` L1/L2/L3 | a **live account-state endpoint**; if none, `verdict:'no-plan-service'` (DeepInfra case) |
| **T5 — usage** | `UsageReading[]` with windows/limited/source | a usage/quota endpoint or wire usage; if none, `confidence:'unavailable'` + reason |
| **T6 — cost / promotion** | discount, exact vs estimated, plan burn | pricing/promotion fields; else `estimated` label only |
| **T7 — full extension** | custom child slots, nested config, badges, i18n | M8 client half + M10 tab; unlimited within §4.2 |

### 5.2 Worked ceilings for the three measured services

| Service | Highest tier reached | Ceiling reason |
| :--- | :--- | :--- |
| OpenCode v2 | **T7** | has `/api/experimental/usage/limits` (real go windows), `billing_source`/`allowance`, `/api/model`, L3 probe, 71 Config fields, cost pill + plan panel. |
| Antigravity | **T6** (T7 client half exists but no per-request USD cost) | `retrieveUserQuotaSummary` gives weekly/5h fractions; quota is per account, not a billed amount. No plan-select endpoint (consumer subscription). |
| DeepInfra | **T5 with T4='no-plan-service'** | no subscription plan; `/v1/me` identity only; `/v1/request-costs` **404 for this credential** → exact account cost is `unavailable`. T6 is **estimated from catalog pricing**, never exact. |

### 5.3 The rule for a 4th service (normative)

1. It **must** reach **T0–T2** to be activatable at all (identity + credential + readiness). No
   silent activation (parent spec §4.2, `NO_ADAPTER` on a dropped route).
2. It **may** stop at any tier **T3–T6** and must say so: a missing endpoint is rendered
   `unavailable` with the exact reason, never a fake value. Stopping is honest; faking is the
   defect the owner flagged about hardcoded catalogs.
3. Reaching **T7** requires the M1–M12 module contract
   ([ARCHITECTURE §3](./CUSTOM-ROUTER-ARCHITECTURE.md)) and a per-track `CHANGELOG.md`.
4. **Adding a service never changes `ServicePreset`** — that is the standardisation test. It
   adds one descriptor instance + one `settings.section` entry. If adding a service requires
   editing the shared schema, the schema was wrong.
5. Every added service must be re-measured by the C0–C8 / P1–P7 gates and recorded with
   measured before/after.

### 5.4 What a future preset can **never** cover (state it plainly)

- The DSH standard's own `refs` write path (read-only only).
- A provider fact the provider never publishes (e.g. DeepInfra account balance, Zen plan field).
  The surface shows `unknown`/`unavailable`; it does not invent.
- Another service's route/tool/id (hard failure).
- A host-level tab API, global header seat, or new `SlotKind` without a host change.

## 6. Verification of this document

| Claim | Command |
| :--- | :--- |
| Field counts 71/33/7 | `grep -rhoE '^  [a-zA-Z][a-zA-Z0-9]*: Schema\.' dsh-*/lib/index.js dsh-opencode-v2/lib/http.js | sort -u | wc -l` |
| `plugins: z.array(z.any())` | `sed -n '11,30p' .../dsh-agent-preset/lib/index.js` |
| `settings.section` list kind | `grep -n "settings.section" .../dsh-client-ui-settings-general/lib/client.js` |
| `SlotKind` union | `grep -n "type SlotKind" .../dsh-cordis-client-runner/lib/client.js` |
| `role('secret')` fields | `grep -rn "role('secret')" dsh-*/lib/index.js dsh-opencode-v2/lib/http.js` |

## 7. Not done here

No preset descriptor file written to a runtime package, no `Config` field added, no
`settings.section` row, no client half, no real mount, no browser boot, no version/rc change.

## 8. References

- [CUSTOM-ROUTER-SERVICE-SPEC.md](./CUSTOM-ROUTER-SERVICE-SPEC.md), [CUSTOM-ROUTER-ARCHITECTURE.md](./CUSTOM-ROUTER-ARCHITECTURE.md), [CUSTOM-ROUTER-PRESET-SURFACE.md](./CUSTOM-ROUTER-PRESET-SURFACE.md), [CUSTOM-ROUTER-PROTOCOL-STANDARD.md](./CUSTOM-ROUTER-PROTOCOL-STANDARD.md), [PLAN-AND-USAGE-SPEC.md](./PLAN-AND-USAGE-SPEC.md)
- [docs/RULES.md](../../docs/RULES.md), [docs/UI-SLOT-ARCHITECTURE.md](../../docs/UI-SLOT-ARCHITECTURE.md), [docs/PLUGIN-STYLE-STANDARD.md](../../docs/PLUGIN-STYLE-STANDARD.md)
- Installed `@deepseek-ai/dsh-agent-preset`, `dsh-agent-preset-registry`, `dsh-client-ui-settings*`, `dsh-cordis-client-runner`, `dsh-llm`

## Cross-reference

- [WEB-AUTH-PIPELINE-ENGINE.md](./WEB-AUTH-PIPELINE-ENGINE.md) — upper/lower web-auth ownership; standard vs per-service layer verdict
