# Custom Router — Protocol Normalisation Standard

<!-- skeleton:
version: 0.0.1-rc.1
kind: spec
status: active
updated: 2026-11-06
summary: Standard-LLM-contract baseline and measured capability gaps first, then per-service wire/auth/catalog differences and the normative StreamChunk mapping.
-->

> Status: **specification** derived from measured source, 2026-11-06. Runtime: DSH `0.2.2-rc.1`,
> `@deepseek-ai/dsh-llm@0.2.2-rc.1`. No code, profile, or version is changed by this document.
> Parent: [CUSTOM-ROUTER-SERVICE-SPEC.md](./CUSTOM-ROUTER-SERVICE-SPEC.md).
> Per-plugin evidence stays in each track's `CHANGELOG.md` / `UPSTREAM-COMPAT.md`; this document
> holds only the cross-service contract (RULES.md §6.1).

## 1. Standard baseline first — then why a fit-specific layer is needed

**Read [CUSTOM-ROUTER-SERVICE-SPEC.md §1](./CUSTOM-ROUTER-SERVICE-SPEC.md) before this section.**
That section measures the installed `@deepseek-ai/dsh-llm@0.2.2-rc.1` runtime: it already
provides `registerAdapter` (all-or-nothing, disposer + atomic `replace`),
`registerConfigurableProviders`, `registerModelDiscovery`, the full `LlmAdapter` lifecycle,
dispatch, retry policy and attribution. `dsh-llm-pi-ai` is a **dormant, settings-driven dynamic
route slot** by design (`dsh-base/cordis.patch.yml` 128–134), not a missing feature.

DSH supplies **one** extension point and **one** output vocabulary:

- `LlmAdapter` (`dsh-llm/lib/index.js` 1670–1740): `providerInfo`,
  `providerRetryPolicy`, `imageRequestPricing`, `imageRequestTarget`, `listModels`,
  `resolveModel`, `prepareCall`, and the only required method
  `stream(options): AsyncIterable<StreamChunk>`. Every provider HTTP request must include
  `attributionHeaders()` (1665–1668).
- `StreamChunk` (`types.d.ts` 453–486): `text-delta`, `reasoning-delta`,
  `tool-call-delta` with `argumentsDelta`, `usage`, `finish`; emit `usage` **before** the
  terminal `finish` and **nothing afterward**; tool arguments remain **raw JSON strings**.

### 1.1 Fit verdict: standard slot vs these three services

The owner's brief: *"각 서비스 마다 제공되는 프로토콜이 각기 달라서 이를 규격화하고 커스텀하는 성격."*
Measured, the three services do **not** share a wire protocol, a credential boundary, a catalog
shape, a reasoning control, or a cost source (§2). The question is not "can the standard register
routes?" — it can (S2/S4/S7 in the parent spec). The question is **what the standard actually
serves**, and measured in [parent spec §1.3](./CUSTOM-ROUTER-SERVICE-SPEC.md) the answer to the
owner's three questions is **no**: no model discount, no live new-model catalog, no per-service
usage/quota. pi-ai ships a catalog generated into the installed DSH version and zeroes all cost
metadata. So this is a **capability gap**, not a stylistic fit:

| Standard pi-ai slot (measured) | What the three services actually serve | Standard provides? |
| :--- | :--- | :--- |
| one OpenAI-compatible endpoint per profile | Antigravity speaks Google `streamGenerateContent` with a **separate control host** | **NO** |
| one `apiKeyEnv` / stored credential per profile | OpenCode ranks **oauth before key** via `GET /api/credential`; Antigravity refreshes an OAuth token file | **NO** |
| a settings-supplied model list | DeepInfra has a **public 173-row catalog with per-model pricing**; OpenCode has a plan/ranking data index; Antigravity has an account quota summary | **PARTIAL** |
| a single wire request shape | reasoning is `effort-field` / `model-id-suffix` / `ordered-id`; usage is `session export` / response / **trailing chunk**; cost is reported / quota / **derived** | **NO** |
| one adapter instance for many profiles | three different control planes, credential ranks and cost semantics would make every field conditional | **no** ([DEEPINFRA-ADAPTER-BRIEF.md §6](../../dsh-deepinfra/docs/DEEPINFRA-ADAPTER-BRIEF.md)) |

**Conclusion:** the standard router supplies the *registration contract*; these services supply
the *missing serving facts* (live catalog, promotions, disjoint usage, quota, cost). They
**coexist** with the standard routes because they use distinct provider ids (parent spec §2: 4
routes register together, real isolated + browser boots clean, standard `deepseek-account` and
re-enabled pi-ai both survive). Coexistence is not sufficiency: [DSH-HARNESS-POLICY.md §1.1](../../docs/DSH-HARNESS-POLICY.md)
already declares `llm-pi-ai` **deprecated and not restored**. A second router layer *beside*
the harness is not needed and is the decommissioned `dsh-subrouter` mistake
([OPENCODE-MODEL-SERVING-PLAN.md §1](../../dsh-opencode-v2/docs/OPENCODE-MODEL-SERVING-PLAN.md)).

### 1.2 What this standard fixes

It fixes the *invariants* every service must satisfy against the standard contract, and the
*variable* parts each service must declare so the customisation is repeatable. The surface that
lets an operator configure those variables per service is the owner-approved plan B
[`Settings-Models (Custom)` preset surface](./CUSTOM-ROUTER-PRESET-SURFACE.md). Invariants are
shared; variables are customised. That is the whole design. Without it each new service
re-implements the harness contract ad-hoc — with the measured consequence of lost reasoning
control, retry policy and attribution headers.

## 2. Measured differences (source of truth: each track's `lib/`)

| Axis | OpenCode v2 | Antigravity | DeepInfra |
| :--- | :--- | :--- | :--- |
| Provider id | `opencode-http-agent` ([http.js:2367](../../dsh-opencode-v2/lib/http.js)) | `antigravity` (`PROVIDER_ID`, [index.js:44](../../dsh-antigravity/lib/index.js)) | `deepinfra` (`PROVIDER_ID`, [index.js:30](../../dsh-deepinfra/lib/index.js)) |
| Generation endpoint | `POST {baseURL}/chat/completions` (`chatPath` default `/chat/completions`) | `POST {baseUrl}/v1internal:streamGenerateContent?alt=sse` ([wire.js:21](../../dsh-antigravity/lib/wire.js)) | `POST {base}/chat/completions` ([wire.js:23](../../dsh-deepinfra/lib/wire.js)) |
| Wire family | OpenAI-compatible chat completions (SSE) | Google `streamGenerateContent` SSE (functionCall / functionResponse, `systemInstruction`) | OpenAI-compatible chat completions (SSE) |
| Base URL source | `GET /api/provider/{id}` → `settings.baseURL`, with `backendBaseUrl` override | `daily-cloudcode-pa.googleapis.com` (generation) vs `cloudcode-pa.googleapis.com` (control) — **two hosts** | `https://api.deepinfra.com/v1/openai` (config/env/default precedence) |
| Credential | `GET /api/credential` ranking: active **oauth** before **key**; fallback `OPENCODE_API_KEY` | token file `~/.gemini/antigravity-cli/{jetski-standalone-,}oauth-token` + `POST oauth2.googleapis.com/token` refresh | one bearer `DEEPINFRA_API_KEY`, or Settings `role('secret')` field |
| Control plane | local `opencode serve` daemon (attach first, spawn if needed) | `loadCodeAssist` / `fetchAvailableModels` / `retrieveUserQuotaSummary` | none (pure fetch) |
| Catalog | durable `opencode-models.json` + `https://opencode.ai/data/index.json` ranking, plan namespacing (`opencode-go/*`) | account model list + quota summary, TTL 15 min | `GET /v1/openai/models` — **public, no key**, 173 entries / 91 chat routes, per-row pricing |
| Reasoning control | `reasoningEffort` on the route; `#variant` suffix on delegation ids | **separate model ids** per effort (`gemini-3.8-flash-low/-medium/-high`); F-40 in [FAILURE-LEDGER.md](../../docs/FAILURE-LEDGER.md) | `reasoning_effort` ordered ids `none\|minimal\|low\|medium\|high\|xhigh\|max` |
| Reasoning channel | `reasoning` events / `reasoning_content` | thinking blocks (not echoed back) | `delta.reasoning_content` → `reasoning-delta` |
| Usage source | `session export` (v2 emits no `step_finish`) | response usage + quota | trailing usage-only SSE chunk; `stream_options.include_usage` defaults true |
| Cost source | reported / ledger (`cost.js`, `cost-pill.js`) | account quota, not per-token USD | **derived locally** from catalog `pricing{}`; labelled estimated |
| Tool calls | structured wire calls + a 679-line stream classifier for inline notation | `functionCall`/`functionResponse`; tool schemas → `functionDeclarations` (drops `additionalProperties`) | structured `tool_calls`; descriptions must be non-empty |
| UI seat | cost pill, event-driven route gate | `conversation.input.right` list slot (id `antigravity-usage`) | `conversation.input.right` list slot (id `deepinfra-cost`, order 3) |

**Conclusion:** two services speak OpenAI-compatible chat completions but differ in *everything
around* the wire (credential ranking, control plane, catalog, plan namespacing, cost); the third
speaks a completely different wire. "OpenAI-compatible" is therefore **not** a sufficient
standard for the pi-ai profile slot (§1.1), and it is not a sufficient reason to claim the DSH
standard router is incapable — §1 shows it registers these routes fine. The boundary that must be
standardised is `LlmAdapter` / `StreamChunk`, which is exactly what the standard router already
exposes and what these three services implement.

## 3. Normative invariants (MUST)

Every Custom Router service, regardless of protocol:

| # | Invariant | Contract reference |
| :--- | :--- | :--- |
| N1 | Register its **unique** provider id(s) with `ctx.llm.registerAdapter(providers, adapter)` and hold the returned disposer + `replace` handle. A duplicate id throws `DUPLICATE_ADAPTER` (all-or-nothing); distinct ids coexist with standard routes. | `dsh-llm/lib/index.js` 1842–1903; parent spec §2.1 S2/S3 |
| N2 | `stream()` honors `options.signal`; an unsupportable option throws `LlmError(..., 'UNSUPPORTED_OPTION')`, never silently dropped. | cookbook / adapter contract |
| N3 | Emit `usage` before the terminal `finish`; emit nothing after `finish`. Buffer a trailing usage-only chunk. | `types.d.ts` `StreamChunk` comment |
| N4 | Tool `arguments` are raw JSON strings; stream `argumentsDelta`, never parsed objects. Reuse block `index`es in first-seen order. | `types.d.ts` |
| N5 | Two error paths only: throw `LlmError` (transport/protocol), or end with `finish{kind:'error'\|'aborted'}` (in-band). Document which class maps where. | adapter contract |
| N6 | `resolveModel()` returns provider/model identity plus optional `context` / `reasoning`; reasoning levels are ordered **opaque ids** the adapter maps to wire values. | `index.d.ts` |
| N7 | `listModels()` advertises every GUI-selectable model; an empty catalog means no GUI selection. | `index.d.ts` `listModels` doc |
| N8 | Every provider HTTP request carries `attributionHeaders()`, proven in the wire request or header hook. | `index.d.ts` `LlmAdapter` doc |
| N9 | Secrets are cordis-native (schemastery `Config` + env fallback), never ad-hoc key files in code; `role('secret')` where the Settings UI writes them. | adapter brief §3 / DeepInfra `settings.js` |
| N10 | `GenerateOptions.purpose` (auxiliary classification) is ignored explicitly if the wire has no field; a plugin that *produces* an auxiliary request declares its own key. | adapter brief §3 |
| N11 | Usage buckets are **disjoint**: `input + cacheRead + cacheWrite` = provider prompt total; `output` excludes reasoning. Cost derived locally must be labelled estimated. | measured DeepInfra + OpenCode lessons |
| N12 | A duplicate `registerAdapter` id throws `DUPLICATE_ADAPTER` and aborts the whole registration; activation follows the 4-step replacement (disable → remove → add → real mount / browser boot). Standard routes survive a custom disposer. | `dsh-llm/lib/index.js` 1872; parent spec §2.1 S3/S5; [RULES.md](../../docs/RULES.md) §4 |
| N13 | UI seats use additive **list** slots; a single-slot (`conversation.input.activity`) claim is a collision. | [PLUGIN-STYLE-STANDARD.md](../../docs/PLUGIN-STYLE-STANDARD.md), [FAILURE-LEDGER.md](../../docs/FAILURE-LEDGER.md) |

## 4. Variable declarations (MUST declare, MAY customise)

Each service publishes a **service protocol descriptor** — the customisation surface. It is a
specification artifact (config shape), not a new runtime package:

```ts
interface ServiceProtocolDescriptor {
  providerId: string                 // N1: unique route id
  wire: {
    family: 'openai-chat' | 'google-generate' | (string & {})
    baseURL: { source: 'static' | 'control-plane' | 'config'; value: string }
    generationPath: string
    streaming: 'sse'
    extraHosts?: string[]            // e.g. Antigravity control plane
  }
  auth: {
    kind: 'oauth-file' | 'credential-ranking' | 'bearer-key' | (string & {})
    secretField?: string             // role('secret') settings key
    envFallback?: string
    refresh?: string                 // token endpoint when applicable
  }
  catalog: {
    source: 'control-plane' | 'public-http' | 'durable-cache' | 'account-quota'
    endpoint?: string
    ttlMs: number
    requiresAuth: boolean
    modelIdShape: string             // e.g. 'opencode-go/*', 'org/Model-Name'
  }
  reasoning: {
    control: 'effort-field' | 'model-id-suffix' | 'ordered-id'
    ids: string[]                    // ordered opaque ids (N6)
    channel: string                  // wire field -> reasoning-delta
  }
  usage: { source: string; trailingChunk: boolean }
  cost: { source: 'reported' | 'derived' | 'quota'; label: string }
  toolCalls: { shape: string; classifier: 'wire-only' | 'canonical-parser' }
  surfaces: { route: string; tools: string[]; uiSeats: string[] }
}
```

### 4.1 Descriptor values for the three measured services

| Field | OpenCode v2 | Antigravity | DeepInfra |
| :--- | :--- | :--- | :--- |
| `wire.family` | `openai-chat` | `google-generate` | `openai-chat` |
| `wire.baseURL.source` | `control-plane` | `static` (+ extra host) | `config` |
| `auth.kind` | `credential-ranking` | `oauth-file` | `bearer-key` |
| `auth.envFallback` | `OPENCODE_API_KEY` | — | `DEEPINFRA_API_KEY` |
| `catalog.source` | `control-plane` + `durable-cache` | `account-quota` | `public-http` |
| `catalog.requiresAuth` | yes | yes | **NO** |
| `reasoning.control` | `effort-field` | `model-id-suffix` | `ordered-id` |
| `usage.trailingChunk` | no (`session export`) | no | **yes** |
| `cost.source` | `reported` | `quota` | `derived` |
| `cost.label` | ledger | account quota | **estimated** |
| `toolCalls.classifier` | `canonical-parser` (stage 2 candidate) | `wire-only` | `wire-only` |

## 5. Normalisation pipeline (per turn)

```
tool-preset entry (agent | API key)          [parent spec §4]
  -> service row mounts (one per service)
  -> descriptor resolves: baseURL, credential, catalog, effort mapping
  -> prepareCall(provider, model, signal)     [N6, N7]
  -> GenerateOptions -> service wire request  [wire.family, attributionHeaders N8]
  -> SSE deltas -> StreamChunk                [N3, N4, N5, N11]
       text-delta / reasoning-delta / tool-call-delta(argumentsDelta)
  -> usage (buffered if trailing) -> finish
  -> disposer released on tool removal        [N1, N12]
```

Two services may share `wire.family = 'openai-chat'` yet **must not share an adapter instance**:
their descriptors differ in `auth`, `catalog`, `reasoning`, `usage` and `cost`. Sharing is the
"extend the OpenCode adapter with a second vendor" mistake rejected in
[DEEPINFRA-ADAPTER-BRIEF.md §6](../../dsh-deepinfra/docs/DEEPINFRA-ADAPTER-BRIEF.md).

## 6. Conformance gates for a new service

A fourth service (or a change to an existing one) is conformant only when all hold:

| # | Gate | Threshold |
| :--- | :--- | :--- |
| C0 | Standard baseline measured **first** | §1 of the parent spec read; the three owner questions (discount / new model / per-service usage) answered from source, and the installed-version catalog limitation recorded, before any spec claim |
| C1 | Descriptor published | every field in §4 populated from measurement, not memory |
| C2 | One real streamed turn | text + reasoning + tool call arrive as the right `StreamChunk` kinds, in order |
| C3 | Usage disjoint | N11 measured on a real response |
| C4 | Reasoning tokens resolved | measured with one keyed request, not inferred |
| C5 | Real isolated boot | `dsh web --port 0` with a throwaway `DSH_HOME`, zero activation warnings |
| C6 | Browser boot | shell renders, no `web boot: N entries did not activate`, no page errors (RULES.md §4) |
| C7 | No duplicate route/tool; standard routes preserved | `registerAdapter` ids and tool names unique across mounted rows; disposing the new service leaves `deepseek-account` (and any standard route) registered — parent spec §2.1 S3/S5, §2.2 A/B boots |
| C8 | Regression tests | one test per closed defect, recorded in the track's `CHANGELOG.md` |

C5/C6 are the mount proof; a passing `--dump-config` is explicitly **not** sufficient (measured
again on 2026-11-06: `dsh --profile web --dump-config` fails with `EROFS` because the live
`cordis.yml` is read-only — a config dump is not a mount).

## 7. Known deltas this standard does not resolve

- `dsh-deepinfra` declares `engines.dsh >=0.2.2-alpha.3 <0.3.0` while the other two declare
  `>=0.2.2-alpha.2 <0.3.0`; runtime `0.2.2-rc.1` satisfies both. Harmonisation is a version-owner
  decision, not a spec change.
- OpenCode v2 stage-2 canonical parser and Antigravity stage-2 quota UX are gated on owner
  S6 soak confirmation ([dsh-opencode-v2/docs/OPENCODE-V2-STAGE-PLAN.md](../../dsh-opencode-v2/docs/OPENCODE-V2-STAGE-PLAN.md),
  [dsh-antigravity/docs/ANTIGRAVITY-STAGE-PLAN.md](../../dsh-antigravity/docs/ANTIGRAVITY-STAGE-PLAN.md)).
- `@nolit/dsh-subrouter` remains an active (uninstalled) track pending the owner's P-4
  install-or-archive decision. This standard supersedes its *concept*, not its files.

## 8. References

- [CUSTOM-ROUTER-SERVICE-SPEC.md](./CUSTOM-ROUTER-SERVICE-SPEC.md)
- [CUSTOM-ROUTER-ARCHITECTURE.md](./CUSTOM-ROUTER-ARCHITECTURE.md) — composition diagrams + normative per-service module contract
- [dsh-deepinfra/docs/DEEPINFRA-ADAPTER-BRIEF.md](../../dsh-deepinfra/docs/DEEPINFRA-ADAPTER-BRIEF.md), [dsh-deepinfra/UPSTREAM-COMPAT.md](../../dsh-deepinfra/UPSTREAM-COMPAT.md)
- [RULES.md](../../docs/RULES.md), [FAILURE-LEDGER.md](../../docs/FAILURE-LEDGER.md), [PLUGIN-CONSOLIDATION.md](../../docs/PLUGIN-CONSOLIDATION.md)
- Installed `@deepseek-ai/dsh-llm@0.2.2-rc.1` `lib/types/index.d.ts` and `types.d.ts`
