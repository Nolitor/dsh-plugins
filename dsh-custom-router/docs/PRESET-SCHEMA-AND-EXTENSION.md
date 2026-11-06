# Custom Router — Service Preset Schema, Standardisation, and Extension Limits

<!-- skeleton:
version: 0.0.1-rc.1
kind: spec
status: active
updated: 2026-11-06
summary: Normative per-service preset schema, the standardisation boundary, how far preset extension can go, and the coverage ceiling for services added in the future.
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
| **Plugin version bump by the agent** | `0.0.1-rc.1` start, `rc#` owner-only (global AGENTS.md §6). |
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
