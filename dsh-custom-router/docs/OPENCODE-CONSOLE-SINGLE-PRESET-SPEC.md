# OpenCode Console — Single-Preset Absorption Spec (Session + Token Isolation, Plan Billing)

<!-- skeleton:
version: 0.0.1-rc.3
kind: spec
status: active
updated: 2026-11-14
summary: Specification only; six pieces remain unlanded (ROADMAP P2-6). How the existing single `opencode` preset absorbs the OpenCode Console workspace session/token isolation and the plan-specific billing and limit rules, with no second preset, no new model prefix, and no second route table; the measured evidence for every claim, and the three defects the absorption must close. Re-measured 2026-11-14 at router 0.0.1-rc.19 / suite 625/625.
-->

> **SPECIFICATION ONLY (2026-11-14).** Six pieces named here are still unlanded ([ROADMAP.md](./ROADMAP.md) P2-6). Test counts and rc numbers in this document are historical; the current baseline is router `0.0.1-rc.19`, host DSH `0.2.2-rc.3`, suite **625/625**.

> Status: **measurement plus the Track A/B correction**, 2026-11-12. `lib/plan.js` and its tests
> changed (see §8); no profile, live service or browser code was touched. At that time the plugin
> was `0.0.1-rc.12`; it is now `0.0.1-rc.19` (the `rc` suffix advances per session that changes the
> plugin's files, global AGENTS.md §6).
> Parents: [OPENCODE-PLAN-USAGE-SPEC.md](OPENCODE-PLAN-USAGE-SPEC.md),
> [PLAN-AND-USAGE-SPEC.md](PLAN-AND-USAGE-SPEC.md),
> [PRESET-SCHEMA-AND-EXTENSION.md](PRESET-SCHEMA-AND-EXTENSION.md),
> [OPENCODE-ABSORPTION-BLUEPRINT.md](OPENCODE-ABSORPTION-BLUEPRINT.md) §12 (Ingress Protocol
> Guard), [CUSTOM-ROUTER-PRESET-SURFACE.md](CUSTOM-ROUTER-PRESET-SURFACE.md) §1.2 (credential
> rules).
>
> **Correction this document records.** An earlier draft of the surrounding discussion proposed
> splitting Console into a separate preset with its own model prefixes. That proposal was wrong
> and is withdrawn here: OpenCode is **one provider account with four commercial plans**, and Zen
> and Go speak the **same wire**. Measurement §1.5 shows 7 model ids present in both plans with
> **0** protocol differences. A second preset would mount the same provider twice, which the
> router's own uniqueness rule rejects.

---

## 1. Measured baseline (2026-11-12)

### 1.1 The preset that already exists

Source: `lib/presets.js` (read, not remembered), `preset.id === 'opencode'`.

| Field | Measured value |
| :--- | :--- |
| `id` | `opencode` |
| `providerId` | `opencode-http-agent` |
| `modelPrefixes` | `['opencode-http-agent', 'opencode-go', 'opencode']` — **one preset, three prefixes** |
| `endpoint` | `daemon` · `openai-completions` · own adapter · `/chat/completions` · `sse` |
| `auth.sources` | `daemon-endpoint:/api/credential` → `secret-field:apiKey` → `secret-field:password` → `env:OPENCODE_API_KEY` |
| `catalog.layers` | `upstream` (`opencode`, `opencode-go`) → `probe` (`shape:'vendor'`, `/api/model`, TTL 300000) |
| `usage.billing` | `flat`, `service: 'opencode-v2'`, `windows: [{label:'per-request'}]` |
| entries | `dsh-opencode-v2`, `dsh-opencode-v2-http`, `tool-subagent-opencode` |

Prefix ownership re-measured across all three presets:

```
prefix "opencode-http-agent" -> owners: opencode
prefix "opencode-go"         -> owners: opencode
prefix "opencode"            -> owners: opencode
```

**Consequence:** there is no prefix to allocate and no preset to add. Both plan prefixes are
already owned by `opencode`, and `lib/routing.js` refuses a prefix claimed twice
(`claimed by a, b`).

### 1.2 The four plans (documented, re-read this session)

Source: [console/go](https://opencode.ai/docs/console/go) and
[OPENCODE-PLAN-USAGE-SPEC.md](OPENCODE-PLAN-USAGE-SPEC.md) §2.1, re-confirmed against the live
endpoints in §1.4.

| Plan | Billing | Windows | Per-model monthly limit |
| :--- | :--- | :--- | :--- |
| Zen | prepaid credits, per token | none | none (per-token price only) |
| Go | $10/mo | 5h / weekly / monthly | yes |
| Go Plus | $40/mo | 5h / weekly / monthly | yes, higher |
| Go Teams | $20/member/mo | 5h / weekly / monthly | yes = Go + $5 on every row |

Documented window rule (verbatim): *"5-hour — 20% of the monthly limit; weekly — 50%; monthly —
100%."* Windows are therefore **per model**, not global.

### 1.3 Plan → provider id, already implemented and vendored

Source: `vendor/opencode/lib/plans.js`.

```js
export const PLANS = ['go', 'zen']
export const PLAN_PROVIDERS = { go: 'opencode-go', zen: 'opencode' }
```

The provider id **is** the plan. `planOfRoute('opencode-go/kimi-k3.1-pro')` → `go`;
`planOfRoute('opencode/kimi-k3.1-pro')` → `zen`. The vendored cost parser already separates the
billing sources:

```js
export const BILLING_SOURCES = ['free', 'balance', 'go', 'go-plus', 'byok']
export const PLAN_SOURCES    = ['go', 'go-plus']   // allowance counts against a monthly limit
```

### 1.4 What the Console workspace actually publishes (live, this session)

All calls read-only, using the stored Console OAuth credential. **No org header is required** —
`x-org-id`, `x-opencode-org-id` and neither all answered `200` with identical bodies on
`/zen/go/v1/usage`, `/console/api/policies` and `/console/api/v2/config`.

| Endpoint | Status | Payload measured |
| :--- | :--- | :--- |
| `GET /zen/go/v1/usage` | 200 | `{usage:{rolling:{status,percent,resetsAt},weekly,monthly}}` → `1% / 2% / 62%` |
| `GET /zen/go/v1/models` | 200 | 30 models, keys `api, canonical_id, capabilities, cost, created, description, family, id, knowledge, last_updated, limit, modalities, name, object, open_weights, owned_by, release_date, type` |
| `GET /console/api/policies` | 200 | 141 model rows (`format`, `inputPrice`, `outputPrice`, `enabled`, `capabilities`, `ruleIDs`), `policies: []`, 1 member |
| `GET /console/api/policies/current-budgets` | 200 | `[]` |
| `GET /console/api/v1/models` | 200 | 2 providers, 57 models, **4 distinct wire kinds** (§1.6) |
| MCP `get_context` | 200 | `{user:{id,email}, workspace:{id,name,role:'owner'}}` |
| MCP `get_usage` | 200 | `{requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, models[], budgets:[]}` |
| MCP `list_providers` | 200 | `{items:[{id:'conn_…', name:'OpenCode', built_in:true, enabled:true, model_count:90, enabled_model_count:27}]}` |
| `GET /console/api/v2/usage` | 404 | — |
| `GET /console/api/v2/budgets` | 404 | — |
| `GET /console/api/subscription` | 404 | — |

MCP `get_usage` accepts **only** `24h | 7d | 30d | all` — `1d` is rejected with a validation
error (measured).

### 1.5 Zen and Go share the wire — the premise of this spec

`GET /console/api/v1/models`: 7 model ids exist in **both** plans. For all 7 the api kind is
identical and only the root differs by the `/go` segment:

```
beam-free           | zen: chat-completions https://opencode.ai/inference/openai/v1
                    | go : chat-completions https://opencode.ai/inference/go/openai/v1
claude-haiku-5-5    | zen: messages         https://opencode.ai/inference/anthropic/v1
                    | go : messages         https://opencode.ai/inference/go/anthropic/v1
deepseek-v4-pro     | zen: chat-completions https://opencode.ai/inference/openai/v1
                    | go : chat-completions https://opencode.ai/inference/go/openai/v1
```

```
same api-kind across plans: 7 | different: 0
```

The vendored adapter already encodes exactly this rule, measured 2026-11-04:

> *"The provider id `opencode-go` is the Go subscription root (`/inference/go/openai/v1`) and
> `opencode` is the Zen pay-as-you-go root (`/inference/openai/v1`). They are different endpoints
> with different entitlements. So the route decides the endpoint, not the configured default."*
> — `vendor/opencode/lib/http.js`, `backendProviderForRoute()`

**So plan separation is a root selection the adapter already performs. It is not a protocol, a
preset, or a prefix.** The absorption adds only the two things the adapter cannot derive from the
route: **which workspace session the request belongs to**, and **how much plan allowance it
consumed**.

### 1.6 The wire split inside one provider (a defect this spec must not inherit)

`/console/api/v1/models` carries four api kinds under **one** provider id:

```
opencode-go | chat-completions  | .../go/openai/v1        21
opencode-go | messages          | .../go/anthropic/v1      5
opencode-go | responses         | .../go/openai/v1         5
opencode-go | generate-content  | .../go/google/v1beta    1
opencode      | chat-completions| .../openai/v1           16
opencode      | messages        | .../anthropic/v1         5
opencode      | responses       | .../openai/v1            3
opencode      | generate-content| .../google/v1beta       1
```

`@opencode/console`'s own `routes()` collapses each provider to **one** api and, when the wires
disagree, falls back to `<root>/anthropic`. That would send 21 `chat-completions` models down an
Anthropic wire. This is exactly the failure
[OPENCODE-ABSORPTION-BLUEPRINT.md](OPENCODE-ABSORPTION-BLUEPRINT.md) §12 G1–G3 (the Ingress
Protocol Guard) exists to prevent, so the router must **read the Console catalog field-by-field
and never collapse it** (§4.3).

### 1.7 The session/token surface `@opencode/console@0.1.10` provides

Read from `dsh-plugin.js` and the chunk it imports (installed copy
`~/.local/share/opencode-console/cli/`):

| Mechanism | Measured implementation |
| :--- | :--- |
| Service isolation | row mounted with `isolate: {credentials: 'opencode-console'}` |
| Token provision | `provide('credentials', …)` resolving exactly `OPENCODE_CONSOLE_TOKEN`; `set`/`unset`/`modifyRecord` all reject (read-only) |
| Route wiring | `apiKeyEnv: 'OPENCODE_CONSOLE_TOKEN'`, `headers: {'x-opencode-plugin': 'opencode-console/<ver>'}` |
| Session propagation | `requestHeaders(session, headers)`: if `sessionId` present and the header map already has `x-opencode-plugin`, sets `x-opencode-session` |
| Workspace sync | one `setInterval(…, 60000)` effect; `sync()` is a no-op until the snapshot is readable |
| Guard | `ctx.tools.guard(...)` — deny unless the call passed `tools/pre-execute` |
| Default model | `agent-default-model` → `{provider:'opencode', model:'claude-sonnet-5-5'}` (computed from the live payload, this session) |

**Slots the router does not have.** `lib/index.js` mounts children with
`ctx.plugin(plugin, item.config)` (line 417) and `grep isolate lib/` returns **0** hits. Mounting
the console plugin through the router today fails, measured:

```
THREW on provide: service "credentials" has been registered at <host-credentials>
```

Cordis isolation itself works when the mount uses it — measured with the exact console pattern:

```
parent after child:               {"which":"parent"}   ← parent untouched
child sees:                       {"which":"child"}
second isolate same label sees:   {"which":"child"}    ← realm shared by label
provider row in realm resolves:   sk-console
```

### 1.8 What this deployment actually bills (live ledger)

`~/.dsh/profiles/web/opencode-session-cost.json`, 86 sessions, re-read this session:

| Fact | Measured |
| :--- | :--- |
| billing sources seen | `go-plus=9279` — **only** `go-plus`, never `go`, `balance` or `free` |
| `lastBillingSource` | `go-plus` in 85 sessions |
| priced / unpriced requests | 9279 / 3325 |
| `estimatedRequests > 0` | 0 of 86 sessions |
| `costUsd` total | 0.000000 |
| `allowanceUsd` total | 73.501960 |
| `listCostUsd` total | 28.547039 |

Per model, with the documented monthly limits from §1.2:

| Model | allowance $ | Go % | Go Plus % | Go Teams % |
| :--- | ---: | ---: | ---: | ---: |
| `opencode-go/kimi-k3.1-pro` | 47.11 | 314.1 | 78.5 | 235.6 |
| `opencode-go/deepseek-v4.1-flash` | 12.93 | 12.9 | 6.5 | 12.3 |
| `opencode-go/minimax-m3.1-flash` | 10.05 | 50.3 | 12.6 | 40.2 |
| `opencode-go/hy4` | 2.41 | 4.0 | 1.0 | 3.7 |

**Two facts this table settles.**

1. The account is on **Go Plus**, not Go: only `go-plus` divides every row below 100%.
2. The live profile declares `activePlan: go` (`~/.dsh/profiles/web/cordis.patch.yml`, dumped as
   `activePlan: go`). The declaration is **wrong**, and nothing in the current code can notice.

### 1.9 The router's judging layer already accepts this data

`lib/plan.js` and `lib/usage.js` were exercised against the measured payloads:

| Input | Router output |
| :--- | :--- |
| `rolling/weekly/monthly` windows | normalized to `5h / weekly / monthly`, three `percent-consumed` readings |
| declared `go`, account `go`, probe `ok` | verdict `match`, billing `{billed:0, covered:true, confidence:'measured'}` |
| declared `go`, account `go-plus` | verdict **`mismatch`**, billing `{covered:false, confidence:'estimated'}` |
| declared `go`, account absent | verdict `match` — **the gap in §5 D1** |
| probe `overloaded` | verdict `unknown`, billing `{billed:null, confidence:'unavailable'}` |

`normalizeWindow()` maps every label the Console APIs emit: `rolling→5h`, `weekly→weekly`,
`monthly→monthly`, `7d→weekly`, `30d→monthly`.

---

## 2. The design: one preset, three absorbed responsibilities

The preset stays `opencode`. It gains **no** prefix, **no** second provider id, and **no** second
adapter. Three things are absorbed, each at the layer that can own it:

```
                    ┌─────────────────────────────────────────────────────────┐
   DSH agent loop ──▶│ customRouter seam  (ctx.provide('customRouter'))       │
                    │   route()  probe()  merge()  cliDispatch               │
                    └───────┬──────────────┬───────────────────┬──────────────┘
                            │              │                   │
             ┌──────────────▼───┐  ┌───────▼────────┐  ┌───────▼─────────────┐
             │ preset `opencode`│  │ catalog layers │  │ usage/plan layer    │
             │ one prefix set   │  │ upstream→probe │  │ judgePlan +         │
             │ one provider id  │  │ →override      │  │ billingOutcome      │
             └──────────┬───────┘  └───────┬────────┘  └───────┬─────────────┘
                        │                  │                   │
                        ▼                  ▼                   ▼
              ┌──────────────────┐  ┌─────────────┐  ┌────────────────────┐
              │ vendor/opencode  │  │ console     │  │ console plan       │
              │ (existing adapter│  │ catalog     │  │ allowance reader   │
              │  + session hdr)  │  │ reader      │  │ (windows+allowance)│
              └────────┬─────────┘  └──────┬──────┘  └─────────┬──────────┘
                       │                   │                   │
                       └───────────────────┴───────────────────┘
                                     │
                        same Console OAuth token,
                        same workspace org, same session id
```

### 2.1 Responsibility table

| # | Responsibility | Owner | Where | New code |
| :--- | :--- | :--- | :--- | :--- |
| R1 | **Workspace session identity** (`x-opencode-session`) | `vendor/opencode` adapter | `sessionHeaders()` — exists, measured at `http.js:2558` | none (already correct) |
| R2 | **Console token isolation** | router mount path | `lib/index.js` `mountRow` | ~3 lines (§3) |
| R3 | **Plan allowance + windows** | router `lib/plan.js` + `lib/usage.js` | `judgePlan()`, `windowReadings()` | 1 reader + 1 wiring (§4.2) |
| R4 | **Per-model monthly limit table** | preset declaration | `presets.js` `usage.billing.limits` | data only (§4.4) |
| R5 | **Catalog fidelity (4 wires, cost, cache)** | router `lib/catalog.js` | `override` layer from Console | 1 reader (§4.3) |
| R6 | **Plan billing arithmetic** | existing `lib/cost.js` | `calculateCost()` with `tiers` | 1 adapter+multiplier extension (§4.5) |

Nothing in R1–R6 needs a second preset, a second provider id, or a second route table.

---

## 3. R2 — Console token isolation inside the existing preset

### 3.1 The declaration

Add two fields to the **existing** `opencode` preset. Both already validate —
`validatePreset()` returns `{ok:true, errors:[]}` on the extended declaration (measured):

```js
// lib/presets.js — preset.id === 'opencode'
auth: Object.freeze({
  mode: 'web-auth',
  sources: Object.freeze([
    // Console workspace session, highest precedence: it is the only credential
    // that carries the workspace's org, budgets and policy, so when the user has
    // signed in to Console it must win over a daemon-local or env key.
    Object.freeze({ kind: 'credential-ref', name: 'OPENCODE_CONSOLE_TOKEN' }),
    Object.freeze({ kind: 'daemon-endpoint', name: '/api/credential' }),
    Object.freeze({ kind: 'secret-field', name: 'apiKey' }),
    Object.freeze({ kind: 'secret-field', name: 'password' }),
    Object.freeze({ kind: 'env', name: 'OPENCODE_API_KEY' }),
  ]),
}),
```

Add a mount-time isolation scope to the **provider row only** (not the CLI row — the CLI row is
an external binary and has no credential service to isolate):

```js
entries: Object.freeze([
  Object.freeze({ row: 'dsh-opencode-v2' }),
  Object.freeze({
    row: 'dsh-opencode-v2-http',
    specifier: '@nolit/dsh-opencode-v2/http',
    // One realm label for every row that must see the Console credential.
    isolate: Object.freeze({ credentials: 'opencode-console' }),
  }),
  Object.freeze({ row: 'tool-subagent-opencode', … }),
]),
```

`entry.isolate` is not yet a declared field; `validateEntries()` ignores unknown keys, so this is a
**schema addition**, not a workaround (§5 D2).

### 3.2 The mount change

`lib/index.js`, inside `mountRow`, replace the plain plugin call:

```js
// before (line 417)
const fiber = ctx.plugin(plugin, item.config)

// after
const scope = item.isolate === undefined
  ? ctx
  : Object.entries(item.isolate).reduce(
      (context, [service, label]) => context.isolate(service, label),
      ctx,
    )
const fiber = scope.plugin(plugin, item.config)
```

Measured behaviour this depends on (cordis, this session): `isolate(name, label)` returns a child
context whose `name` service resolves in the new scope; the **same label joins scopes**, so a
second row declaring `{credentials:'opencode-console'}` resolves the same provision. The parent
keeps its own implementation (`parent after child: {"which":"parent"}`).

### 3.3 Where the token value comes from — three options, one choice

The Console OAuth token lives at `~/.local/share/opencode-console/credential.json`
(`{type:'oauth', access, refresh, expires, orgID, accountID, email}`), which is **another
plugin's state file**. The router must not pretend it owns it.

| Option | Mechanism | Verdict |
| :--- | :--- | :--- |
| **A. Read `OPENCODE_CONSOLE_TOKEN` from the credential store only** | user runs `npx @opencode/console login` (or exports the token); the router never reads Console's file | **chosen** — respects single-writer, no cross-plugin file dependency |
| B. Read Console's `credential.json` | router parses another plugin's private state | **rejected** — undocumented private shape, silent breakage on their upgrade |
| C. Ask `npx @opencode/console token` at mount | one subprocess per mount, token expiry unmanaged | **rejected** — a mount that shells out is a load-time failure source |

Under option A the token reaches the realm through the host's credential service, which is exactly
the read-only contract §1.7 documents. Measured: `~/.dsh/.credentials.yaml` currently has `refs:
DEEPSEEK_API_KEY, OPENCODE_API_KEY` and **no** `OPENCODE_CONSOLE_TOKEN`, so today the Console path
would resolve to nothing and fall through to the daemon — a visible, correct degradation, not a
silent empty key.

### 3.4 What MUST NOT change

- `providerId` stays `opencode-http-agent`. The Console plugin's own `agent-default-model` write
  (`provider:'opencode'`) is **not** adopted: that provider id does not exist in this deployment,
  and the router's `agent-default-model` row is owner config.
- `modelPrefixes` stays `['opencode-http-agent','opencode-go','opencode']`. Adding
  `console`/`console-go` prefixes is **withdrawn** (§1.5).
- The Console plugin itself is **not** mounted. Only its two capabilities are absorbed. Mounting it
  would register `opencode-console` as a second credential owner and a second `agent/default-model`
  writer, which is the duplicate-ownership failure the router exists to prevent.

---

## 4. R3–R6 — Plan billing and limits inside the same preset

### 4.0 The two-track rule (owner correction 2026-11-12)

A pre-dispatch decision may only rest on evidence that exists **before** dispatch. Two kinds of
plan evidence exist in this deployment, and they are not interchangeable:

| | Track A — declared baseline | Track B — observed correction |
| :--- | :--- | :--- |
| **When** | t=0, before any request | after a turn completes |
| **Source** | the operator's `activePlan` declaration | `usage.opencode.billing_source` on the response wire |
| **Nature** | a stated fact | a **receipt** |
| **May judge?** | **yes** — it is the only tier evidence available at t=0 | **no** — it did not exist when the decision was made |
| **Effect** | sets the verdict's `declaredPlan` | produces a **consent-gated proposal** only |

An earlier draft of this section fed the post-request `billing_source` straight into the verdict.
That is wrong: at cold start the ledger is empty, so the pre-dispatch verdict would have no input
at all, and on a warm profile it would retroactively rewrite a decision already taken. The receipt
can only ever correct the *next* baseline, and only after the operator agrees (Track B, §4.7).

### 4.1 What is actually knowable at t=0 (measured 2026-11-12)

Every candidate source was probed before writing this section. **None of them names a tier.**

| Candidate | Result |
| :--- | :--- |
| Console OAuth token | opaque `st_0443e255-…`, 39 chars, **not a JWT** → no claims to read |
| Token metadata `credential.json` | `type, server, access, refresh, expires, accountID, email, orgID, orgName` → **no plan field** |
| `GET /zen/go/v1/usage` | 200, `{rolling, weekly, monthly}` → proves a subscription window set **exists**, names no tier |
| `/zen/go/v1/{subscription,plan,plans,billing,account,me,limits}` | **all 404** |
| `/zen/v1/{usage,subscription,me}` | **all 404** |
| `/console/api/v2/{me,orgs,members,subscription,billing,plan,usage}` | **all 404** |
| `/console/api/orgs` | 200, `[{id,name,avatarUrl,blocked}]` → no plan |
| MCP `get_context` | `{user:{id,email}, workspace:{id,name,role:'owner'}}` → no plan |
| MCP `get_usage` | `budgets: []` on this account |
| MCP tool list | 11 tools, none reads or reports a plan |

**Conclusion:** the tier is not publishable from any pre-request source. It must be **declared**
(Track A), and the wire may later **propose a correction** (Track B).

The one thing the route *does* decide at t=0 is the **plan id**, which is the provider prefix:

```js
planOfRoute('opencode-go/x') === 'go'    // subscription root
planOfRoute('opencode/x')    === 'zen'   // pay-as-you-go root
```

That is a routing fact, not a billing tier, and it needs no new field.

### 4.2 Track A — the declared baseline is the pre-dispatch input

`lib/plan.js` was corrected so a declaration is a legitimate pre-dispatch basis **and** so a
receipt can never silently become one. The decision chain is now:

```js
if (no billing service)                          -> 'no-plan-service'
else if (probe failed)                           -> 'unknown'
else if (a window is limited)                    -> 'throttled'
else if (declared && account && differ)          -> 'mismatch'
else if (account !== null)                       -> 'match'   // pre-request tier measured
else if (declared !== null)                      -> 'match'   // TRACK A baseline, +degraded note
else                                             -> 'unknown' // nothing to judge
```

Two behaviours this fixes, both tested:

| Case | Before | After |
| :--- | :--- | :--- |
| `declaredPlan:'go'`, no account evidence, probe `ok` | `match` (correct by luck) | `match`, and `degraded[]` says the tier is *declared* not measured |
| `declaredPlan:'go'`, `billingSources:['go-plus']` | `match`, receipt ignored | `match`, `accountPlan` stays `null`, receipt recorded for Track B |

The verdict shape is unchanged (`buildVerdict()` field order and names are asserted by a test), so
no consumer breaks.

### 4.3 Track B — the receipt proposes, the operator consents

`proposeCorrection()` is the only place a `billing_source` may influence the plan, and it produces
a proposal object, never a verdict:

```js
proposeCorrection({ declaredPlan: 'go', billingSources: ['go-plus'], sampleCount: 9279 })
// {
//   status: 'propose',
//   declared: 'go', observed: 'go-plus',
//   proposal: { field: 'activePlan', from: 'go', to: 'go-plus',
//               source: 'billing_source', sampleCount: 9279, requiresConsent: true },
//   reason: 'declared go but every subscription request billed as go-plus'
// }
```

Status vocabulary is deliberately three-valued, and only one of them is actionable:

| `status` | Meaning | Surface behaviour |
| :--- | :--- | :--- |
| `none` | no subscription source observed yet (cold start, or only `balance`/`free`/`byok`) | say nothing; the baseline stands |
| `agree` | observed tier equals the declaration | show "확인됨", no action |
| `propose` | the receipt names a different tier | show a **correction card** with from → to, the sample count, and an explicit apply action |

The apply path is an ordinary settings write to the row's own volatile field
(`vendorConfig['dsh-opencode-v2-http'].activePlan`), which is exactly the field the vendor's
`activePlan: Schema.union(PLANS)` reads. It is a one-field write inside the router's own namespace,
so it respects the single-writer rule. **No automatic write exists**: `requiresConsent: true` is a
contract field, and a test asserts the module never mutates anything.

### 4.4 Live evidence that a correction is pending

Measured 2026-11-12 on the live profile, and the reason this whole section exists:

| Fact | Value |
| :--- | :--- |
| `activePlan` in `~/.dsh/profiles/web/cordis.patch.yml` | **`go`** |
| `billing_source` across 86 sessions / 12592 requests | **`go-plus`, 9279 times** |
| any `go`, `balance`, `free`, `byok` receipt | **0** |
| allowance vs documented Go limits | `kimi-k3.1-pro` at 47.11 vs Go 15 → **314%** |
| allowance vs documented Go Plus limits | same row → **78.5%**, every row < 100% |

The declaration is wrong and the receipt proves it. Under this design that surfaces as
`proposeCorrection() -> {from:'go', to:'go-plus', sampleCount:9279}`, and nothing changes until
someone applies it.
```

### 4.5 R5 — catalog reader preserves the four wires

The Console catalog is the **most complete source in this deployment**: 57/57 models carry
`cost.text.input.price`, `cost.text.output.price`, `cost.text.input.cache.read` and
`limit.context`/`limit.output`; 16 carry `cache.write`; 4 carry `cost.multipliers`; 6 carry
context-tiered `overrides`.

```
context-tiered pricing: 6 of 30 Go models
tier conditions: context > 200000 | 272000 | 100000 | 512000 | 256000
cache.write TTL buckets: 30m, 12h
```

The reader feeds the **`override` layer** (layer 3), never replaces `upstream` or `probe`:

```js
// shape produced for mergeCatalog([upstream, probeResult, override])
{ source: 'override', models: [
  { id: 'opencode-go/deepseek-v4.1-pro', name, contextWindow: limit.context, maxTokens: limit.output,
    input: modalities.input, reasoning: capabilities.reasoning?.supported,
    // never collapse `api` — carry the wire kind the model actually names
    wire: 'anthropic-messages' | 'openai-completions' | 'openai-responses' | 'google-generative-sse',
    cost: { input, output, cacheRead, cacheWrite, tiers:[{inputTokensAbove, input, output, cacheRead, cacheWrite}] } },
] }
```

`validateCatalogModel()` already accepts `name`, `contextWindow`, `maxTokens`, `input`,
`reasoning` and `cost` with `tiers`, and passes unknown keys through — measured, so `wire` rides
the record instead of being dropped. **The `wire` field is what closes the §1.6 defect**: a route
whose `wire` the adapter cannot speak is marked `unverifiedWire` and warned, never silently sent
down a default root.

### 4.6 R4 — per-model monthly limits as declared data

No API publishes the monthly limit table (measured §1.4 and §4.1). It is documentation, so it is
**declared data**, not a probe, and it is versioned with the preset:

```js
usage: Object.freeze({
  record: 'opencode-cost',
  plan: 'available',
  billing: Object.freeze({
    mode: 'flat',
    service: 'opencode-console',
    windows: Object.freeze([
      Object.freeze({ label: '5h' }),
      Object.freeze({ label: 'weekly' }),
      Object.freeze({ label: 'monthly' }),
    ]),
    // Documentation-derived; every row is "monthly limit in US$".
    // Source: console/go plan table, re-read 2026-11-12.
    limits: Object.freeze({
      'opencode-go/kimi-k3.1-pro':        Object.freeze({ go: 15,  goPlus: 60,  goTeams: 20 }),
      'opencode-go/deepseek-v4.1-flash':  Object.freeze({ go: 100, goPlus: 200, goTeams: 105 }),
      'opencode-go/minimax-m3.1-flash':   Object.freeze({ go: 20,  goPlus: 80,  goTeams: 25 }),
      'opencode-go/hy4':                  Object.freeze({ go: 60,  goPlus: 240, goTeams: 65 }),
      // … 37 priced rows + 3 Unlimited rows
    }),
  }),
}),
```

`validatePreset()` accepts this (measured `{ok:true}`). Two rules keep it honest:

1. A row absent from `limits` renders **`unknown`**, never `0%` — consistent with
   [PLAN-AND-USAGE-SPEC.md](PLAN-AND-USAGE-SPEC.md) U2 and `billingOutcome()`'s
   `confidence:'unavailable'` path.
2. The table is **documentation-sourced**, so its staleness is a visible state: the reader records
   `limits.sourcedAt` and the dashboard shows the date, the same way `measuredAt` works elsewhere.

### 4.7 R6 — the billing arithmetic the Console expects

The measured per-request cost record already matches `lib/cost.js` almost exactly. Three gaps:

| Gap | Console behaviour (measured) | Router today |
| :--- | :--- | :--- |
| context tiers | `cost.text.input.overrides[].when.context.gt` — 5 distinct thresholds | `cost.tiers[].inputTokensAbove` — same semantics, different shape |
| cache TTL buckets | `cache.write: {30m: x, 12h: y}` | `cacheWrite` + `cacheWrite1h` (1h only) |
| peak multipliers | `cost.multipliers[]` on 4 models | absent |

Rule: **the router bills, and it bills the same way for every plan.** `mode:'flat'` +
`PLAN_SOURCES` decides *whether* a request consumed allowance; `calculateCost()` decides *how much*
list value it represented. The measured live ledger proves the split is already right —
`costUsd` 0.000000 while `allowanceUsd` 73.50 and `listCostUsd` 28.55.

The three gaps are closed by a **shape adapter**, not new arithmetic:

```js
export function consoleModelCost(entry) {
  const tiers = (entry.cost?.text?.input?.overrides ?? []).map((o) => ({
    inputTokensAbove: o.when?.context?.gt ?? 0,
    input: o.price, output: o.cache?.output ?? entry.cost?.text?.output?.price,
    cacheRead: o.cache?.read, cacheWrite: o.cache?.write?.['12h'] ?? o.cache?.write?.['30m'],
  }))
  return { input: entry.cost.text.input.price, output: entry.cost.text.output.price,
           cacheRead: entry.cost.text.input.cache.read,
           cacheWrite: entry.cost.text.input.cache.write?.['12h'] ?? entry.cost.text.input.cache.write?.['30m'] ?? 0,
           ...(tiers.length ? { tiers } : {}) }
}
```

Verified against the live tiered entry (`gpt-5.6-luna`, base in=0.2 out=1.2, override above
272 000 → in=0.4 out=1.8) and against `calculateCost()`, whose tier selection measurably switches
at the threshold (`small` → 0.0026, `large` → 0.6006).

### 4.8 Plan verdict — which layer may answer at t=0

After the two-track correction, the three layers keep their meanings but their **timing** decides
what they may be used for:

| Layer | Source | When available | May judge pre-dispatch? |
| :--- | :--- | :--- | :--- |
| **L1 declared** | `activePlan` in the row config | **t=0** | **yes** — the only tier evidence that exists |
| **L2 account** | a pre-request tier measurement | t=0 *, if one existed | yes — but §4.1 measured that **no such source exists** |
| **L3 endpoint** | `GET /zen/go/v1/usage` `status` | t=0 (a query, not a receipt) | corroborates reachability/throttle; **names no tier** |
| **Track B receipt** | `usage.opencode.billing_source` | after a turn | **never** — it proposes a correction (§4.3) |

\* `GET /zen/go/v1/usage` is a genuine pre-request query and stays in the design for **windows**
(`rolling → 5h`, `weekly`, `monthly`) and throttle state. What it cannot supply is the tier, so it
does not populate `accountPlan`.

The allowance fit-test from the earlier draft is therefore **demoted from judge to auditor**: it is
not run at t=0 (its input is the ledger, which is empty on a cold start), and when it does run it
cross-checks the receipt rather than deciding. Applied to §4.4: `opencode-go/kimi-k3.1-pro` at 47.11
exceeds Go (15) and Go Teams (20) and fits Go Plus (60) — that is why the pending proposal says
`go-plus`.

**So the defect was never missing comparison logic.** It was two separate things: a declaration that
was wrong (§4.4), and a receipt that had no path to correcting it. Track A keeps the declaration
authoritative at dispatch; Track B gives the receipt a consent-gated route back into it.

---

## 5. Defects the absorption must close

| # | Defect | Measured evidence | Fix |
| :--- | :--- | :--- | :--- |
| **D1** | A receipt has no path to correct a wrong declaration | `activePlan: go` live vs `billing_source: go-plus` × 9279, with no code that relates them | **Track B**: `proposeCorrection()` + a consent card; **done** in `lib/plan.js` |
| **D1b** | The old chain accepted "declared, nothing measured" as an untagged `match` | `judgePlan({declaredPlan:'go', endpointProbe:'ok'})` returned `match` with `degraded: []` | **Track A**: `match` now carries a `degraded[]` note that the tier is declared, not measured; **done** |
| **D2** | `entry.isolate` is undeclared, so a realm-mounted row is silently ignored | `grep isolate lib/` → 0; `validateEntries()` ignores unknown keys | declare `entry.isolate` in `presets.js` + apply it in `mountRow` (§3.2) |
| **D3** | The catalog wire is collapsed to one api per provider | `routes()` on the live payload yields `anthropic-messages` for a provider whose 21/32 entries are `chat-completions` | carry `wire` through the override layer (§4.3); never let a reader choose one api for a provider |

D1 is the one that matters most in practice: it is why the live profile has been declaring `go`
while the account is `go-plus`, with nothing in the surface contradicting it.

---

## 6. What this spec deliberately does not do

| Not done | Why |
| :--- | :--- |
| A second preset or provider id | one account, one provider, four plans; the router refuses a duplicate prefix (§1.1) |
| New model prefixes (`console/`, `console-go/`) | withdrawn; the wire is shared and the root differs (§1.5) |
| Mounting `@opencode/console` itself | it would become a second credential owner and a second default-model writer; only its two capabilities are absorbed |
| Reading Console's `credential.json` | another plugin's private state; option A in §3.3 |
| Reimplementing Console's policy engine | the workspace has `policies: []` today; a separate concern outside this spec |
| Overriding `agent-default-model` | owner config; Console's computed default (`opencode/claude-sonnet-5-5`) is not adopted |
| `llm-pi-ai` eligibility | out of scope: the router owns the route table, and this spec does not consult or override that row |
| Editing code, profile, version, or restarting anything | specification only, per the workspace rule |

---

## 7. Verification plan (for whoever implements it)

| Claim | How it is proven |
| :--- | :--- |
| R2 realm isolation | unit test: mount two children with `isolate:{credentials:'x'}`, assert the parent's `credentials` is unchanged and both children see one provision |
| R2 no duplicate mount | existing `verify:presets` — one `opencode-http-agent`, unchanged |
| R3 window mapping | feed the measured `/zen/go/v1/usage` body to `windowReadings()`; expect `5h/weekly/monthly` |
| **Track A** | `judgePlan({declaredPlan:'go', endpointProbe:'ok'})` → `match` **with** a `degraded[]` accountPlan note; `judgePlan({billing:{mode:'flat'}, endpointProbe:'ok'})` → `unknown` |
| **Track A ignores receipts** | `judgePlan({declaredPlan:'go', billingSources:['go-plus'], endpointProbe:'ok'})` → `accountPlan === null`, verdict `match` |
| **Track B proposes** | `proposeCorrection({declaredPlan:'go', billingSources:['go-plus'], sampleCount:9279})` → `status:'propose'`, `from:'go'`, `to:'go-plus'`, `requiresConsent:true` |
| **Track B cold start** | `proposeCorrection({declaredPlan:'go', billingSources:[]})` → `status:'none'`, no proposal |
| **Track B non-tier sources** | `balance`/`free`/`byok` never set a tier and never propose |
| **Track B never writes** | no `settings.update`, no file write exists in `lib/plan.js` (source scan) |
| R4 limits table | every priced row present; a missing row renders `unknown`, never `0%` |
| R5 four wires | replay the measured `/api/v1/models` body; assert `wire` per model matches the payload's `api` keys, and no provider collapses to one api |
| R6 cost parity | `consoleModelCost()` on `gpt-5.6-luna` reproduces base and tiered rates; `calculateCost()` switches at 272 000 |
| D1 | `judgePlan({declaredPlan:'go', accountPlan:null})` must **not** be `match` |
| Live parity | `opencode-session-cost.json` re-aggregates to the same `allowanceUsd` per model after the reader lands |
| Docs | `npm run docs:check` and `node scripts/check-plugin-history.mjs` |

---

## 8. What was changed, and what was not

**Changed (Track A/B, owner-ordered 2026-11-12):**

| File | Change |
| :--- | :--- |
| `lib/plan.js` | `judgePlan()` chain corrected for Track A (a declaration is a valid pre-dispatch basis, tagged `degraded`); `accountPlan` is **never** derived from `billingSources`; added `proposeCorrection()` (Track B) and `tierFromBillingSources()` |
| `test/plan.test.mjs` | +9 tests pinning the two-track contract (21 in the file, all passing) |

**Not changed:** `presets.js`, `usage.js`, `catalog.js`, `cost.js`, `settings-schema.js`, anything
under `vendor/`, `locale/`, or the browser client. No profile patch, no `~/.dsh` write, no service
restart, no version or `rc` change.

**Full suite:** `npm test` → **502/502 pass** at the time of this correction (was 493; +9 new).
Current baseline re-measured 2026-11-14: **625/625**.

**Still to build (specified here, not implemented):** the R2 `entry.isolate` mount change (§3.2), the
Console window bridge (§4.2), the four-wire catalog reader (§4.5), the `usage.billing.limits` table
(§4.6), the cost shape adapter (§4.7), and the Track B consent card in the dashboard (§4.3).
