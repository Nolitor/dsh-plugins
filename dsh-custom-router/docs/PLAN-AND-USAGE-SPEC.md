# Custom Router — Plan Detection, Usage Normalisation, and Standard-vs-Custom Coverage

<!-- skeleton:
version: 0.0.1-rc.1
kind: spec
status: active
updated: 2026-11-06
summary: Concrete measured logic for subscription-plan detection (OpenCode Go/Zen, DeepInfra), normalised usage/quota reporting across services, and how the custom surface covers what DSH standard misses.
-->

> Status: **specification built on live measurement**, 2026-11-06, DSH `0.2.2-rc.1`.
> Owner instruction: make the plan judgement, usage display/check, and standard-vs-custom
> coverage **concrete**, not prose. Every number and endpoint below was read from the installed
> runtime or a live response in this workspace; nothing was inferred.
> No runtime code, live profile, or version changed. **Version discipline:** this document's
> skeleton `version` follows the **`rc.#` history scheme** (the `rc#` advances once per session
> in which the document is substantively changed, only by the owner's instruction for that
> session). The **plugin** `@nolit/dsh-custom-router` starts at `0.0.1-rc.1` and its `rc#` is
> owner-owned. The two schemes are separate — a doc revision is not a plugin release. Parent: [CUSTOM-ROUTER-SERVICE-SPEC.md](./CUSTOM-ROUTER-SERVICE-SPEC.md),
> [CUSTOM-ROUTER-ARCHITECTURE.md](./CUSTOM-ROUTER-ARCHITECTURE.md),
> [CUSTOM-ROUTER-PRESET-SURFACE.md](./CUSTOM-ROUTER-PRESET-SURFACE.md).

> **Implementation status (2026-11-07):** `lib/plan.js` implements §1.4's `PlanVerdict`
> (`judgePlan`, `buildVerdict`) and the billing outcome (`billingOutcome`), with the preset
> `usage.billing.mode` (`subscription` / `flat` / `pay-per-token` / `none`). The vendor probes
> (L2 account state, L3 endpoint probe) still run inside the vendor plugins; this module judges
> their output and guarantees `unknown` never becomes a fabricated zero.

## 1. Subscription-plan detection — concrete logic

The owner asked: *"현재 사용자 상태를 어떻게 정확히 긁어와서 판정할지 구체적인 로직."*
The answer is **a 3-layer judgement**, not one boolean. A configured `activePlan` is only a
*declared* value; the account state must be scraped from a live endpoint.

### 1.1 Layer L1 — static (free, instant, no network)

| Step | Logic | Source |
| :--- | :--- | :--- |
| L1-1 | `planOfRoute(route)` reads the `provider/model` prefix → `go | zen | other` | `dsh-opencode-v2/lib/plans.js:22–48` (`PLAN_PROVIDERS = {go:'opencode-go', zen:'opencode'}`) |
| L1-2 | compare with `config.activePlan` (live: `go`) | `~/.dsh/profiles/web/cordis.patch.yml` |
| L1-3 | flag every `enabledModels` entry whose prefix mismatches | live: 14 entries, all `opencode-go/*` → 0 mismatch |
| L1-4 | read `GET /api/credential`, report active entry `type` (`oauth` preferred) + label, never the value | `http.js:1199–1245`; real: `Personal` oauth active, 2 keys inactive |

**L1 output:** `declaredPlan: 'go' | 'zen'`, `matchingModels: n`, `credentialKind: 'oauth'|'key'|'none'`.
It does **not** claim the account is on that plan.

### 1.2 Layer L2 — live account state (the actual "긁어오기")

**OpenCode — `GET /api/experimental/usage/limits`** (measured live 2026-11-06, real response):

```json
{"data":{"workspace":{"id":"org_01M4…","name":"Personal","usageURL":"https://opencode.ai/console/…/activity/overview"},
 "go":{"rolling":{"percent":2,"limited":false,"resetsAt":1793966994000},
       "weekly":{"percent":8,"limited":false,"resetsAt":1794182400000},
       "monthly":{"percent":29,"limited":false,"resetsAt":1794998310000}},
 "budgets":[]}}
```

| Step | Logic | Measured ground |
| :--- | :--- | :--- |
| L2-1 | `GET /api/experimental/usage/limits` via the daemon (`service.json` Basic auth), cache 60 s | `http.js:2620–2650` `plan-usage` route already does exactly this |
| L2-2 | normalise to `{rolling:'5-hour', weekly:'Weekly', monthly:'Monthly'}` + `percent` / `limited` / `resetsAt` | `http.js` `window()` helper |
| L2-3 | **plan verdict**: `data.go` present → account **has a Go plan**; absent/empty → not Go. `limited:true` on any window → **throttled**, not "no plan". | real response has `go` with 3 windows, all `limited:false` |
| L2-4 | per-request `opencode.billing_source` from the wire usage: `free | balance | go | go-plus | byok`; `go|go-plus` are `PLAN_SOURCES` whose `allowance` is the monthly plan burn | `lib/cost.js:12–49`; `BILLING_SOURCES`, `PLAN_SOURCES` |
| L2-5 | `usage.opencode.list_cost` (USD at list) vs `cost` (charged, 0 for Go within limits) vs `allowance` (plan burn) — three **different** numbers, never merged | `cost.js` field semantics |

**Zen / general plan:** there is no dedicated "zen limits" field in that response. Judge it by
the **endpoint probe** (L3): a 1-token `stream:false` call per plan endpoint returns a distinct
class — measured 2026-11-06:
- go + `deepseek-v4.1-flash` → upstream `[overloaded]` (route reachable, transient)
- go + `pulse-alpha-free` → `Model is unavailable`
- zen + `pulse-alpha-free` → `FreeUsageLimitError` ("subscribe to OpenCode")

So the Zen verdict is **entitlement-by-response**, not a field: `FreeUsageLimitError` ⇒
free-tier exhausted / subscription required; `billing_source:'balance'` ⇒ pay-as-you-go.
A preset must label these separately and never collapse them into "plan mismatch".

**DeepInfra:** there is **no subscription plan at all** — it is per-token billing.
| Step | Logic | Measured ground |
| :--- | :--- | :--- |
| L2-D1 | `GET /v1/me` → account **identity only**; no balance/plan field | [dsh-deepinfra/UPSTREAM-APIS.md](../../dsh-deepinfra/UPSTREAM-APIS.md) §1 |
| L2-D2 | `POST /v1/request-costs` → **404 for this credential** (documented, not deployed); degrade to `null`, never fake 0 | `catalog.js:41–51`, UPSTREAM-APIS §3 |
| L2-D3 | plan/promotion = `metadata.discount` on the catalog row (8 of 91 chat routes, 0.10–0.75) → `promotionOf()` → `percentOff` | `catalog.js:245–266` |
| L2-D4 | exact per-request cost = wire `usage.estimated_cost` (USD, discounted price), used verbatim | `cost.js:4–22` |

**Antigravity:** a consumer subscription, not a selectable plan. `retrieveUserQuotaSummary`
returns weekly / 5-hour buckets per model family with `remainingFraction`; `loadCodeAssist`
/`fetchAvailableModels` report `remainingFraction`. Verdict = entitlement present (quota
summary reachable) or absent (OAuth `invalid_grant` / no refresh token).

### 1.3 Layer L3 — one-shot endpoint probe (optional, authoritative)

```
for plan in [declared, other]:
  POST {plan-base}/chat/completions  (1 token, stream:false, x-opencode-session: preset-probe)
  classify: OK(200 + billing_source) | ModelUnavailable | FreeUsageLimitError | Overloaded | AuthError
  never bill more than 1 token; never run on every turn (cache with the L2 TTL)
```

`dsh-opencode-v2/test/live/endpoint-plan-probe.mjs` already implements this probe. The preset
shows **three separate lines**: `선택된 플랜`, `계정 응답(L2)`, `엔드포인트 판정(L3)`.
A green L1 with a failing L2/L3 must be shown as a **conflict**, not silently accepted.

### 1.4 Plan judgement output contract (normative)

```ts
interface PlanVerdict {
  service: 'opencode-v2' | 'antigravity' | 'deepinfra'
  declaredPlan: string | null          // L1, config value
  accountPlan: string | null           // L2, e.g. 'go' from data.go presence
  windows: Array<{ label: string; percent: number; limited: boolean; resetsAt: number }>
  billingSources: string[]             // L2-4, from wire usage
  endpointProbe: 'ok'|'model-unavailable'|'free-limit'|'overloaded'|'auth-error'|'skipped'
  verdict: 'match'|'mismatch'|'throttled'|'unknown'|'no-plan-service'
  measuredAt: number                  // never show a stale verdict as current
  degraded: string[]                  // e.g. ['/v1/request-costs 404 -> cost source = wire estimated_cost']
}
```

**Rule:** `unknown` (no live answer) is a valid, **visible** state. Never display `0%` or
`no plan` when an endpoint did not answer. This is the exact defect the owner flagged about
hardcoded catalogs: a fabricated default is worse than an honest gap.

## 2. Usage / quota normalisation — one display standard

The owner asked: *"각 서비스가 제공하는 제각각의 사용량(Quota, 토큰 잔여량)을 커스텀 라우터에서
어떤 기준으로 표기하고 체크할지 표준화."*

### 2.1 The problem (measured)

| Service | Native shape | Unit | Window | Comparable? |
| :--- | :--- | :--- | :--- | :--- |
| OpenCode | `go.{rolling,weekly,monthly}.{percent,limited,resetsAt}` + `billing_source` + `allowance` | **% consumed** / USD burn | 5h / weekly / monthly | no |
| Antigravity | `groups[].limits[].{window, remainingFraction}`, `quotaRemaining` | **fraction remaining** | weekly / 5h | no |
| DeepInfra | `usage.{prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens}` + `estimated_cost` | **tokens + USD** | per request | no |

They are **not** the same quantity. A single "사용량 %" bar would be wrong. The standard must
normalise the **schema**, not the **unit**.

### 2.2 Normalised usage record (normative)

```ts
interface UsageReading {
  service: string
  source: string                    // exact endpoint or wire field
  kind: 'percent-consumed' | 'fraction-remaining' | 'tokens' | 'usd-amount'
  value: number
  unit: '%' | 'fraction' | 'tokens' | 'USD'
  window: '5h' | 'weekly' | 'monthly' | 'per-request' | 'quota' | null
  scope: 'account' | 'plan' | 'model-family' | 'request'
  limited: boolean | null            // provider said "limited"; null = provider does not say
  resetsAt: number | null
  display: string                   // pre-formatted, locale-aware
  measuredAt: number
  confidence: 'measured' | 'estimated' | 'unavailable'
  unavailableReason?: string        // e.g. '/v1/request-costs 404 for this credential'
}
```

### 2.3 Mapping table (exact, from measured shapes)

| Native | `kind` | `value` | `window` | `display` |
| :--- | :--- | :--- | :--- | :--- |
| `go.rolling.percent=2` | `percent-consumed` | `2` | `5h` | `5시간 2% 사용 · 제한 없음` |
| `go.weekly.percent=8` | `percent-consumed` | `8` | `weekly` | `주간 8% 사용` |
| `go.monthly.percent=29` | `percent-consumed` | `29` | `monthly` | `월간 29% 사용 · 리셋 …` |
| `go.*.limited` | — | — | — | `limited:true` ⇒ **경고 배지**, 값 자체는 그대로 |
| `opencode.allowance` | `usd-amount` | USD | `per-request` | `이 요청 플랜 소진 $…` (list_cost와 분리) |
| `opencode.billing_source` | `usd-amount` | `cost` | `per-request` | `청구: go-plus / $0` — `cost=0`은 "무료", `absent`는 `null` (위조 0 금지) |
| `group.limits[].remainingFraction` | `fraction-remaining` | `0..1` | `weekly|5h` | `주간 64% 남음` (`1-v` 로 **바꾸지 않음**: 원 단위 유지) |
| `group.quotaRemaining` | `fraction-remaining` | `0..1` | `quota` | `쿼타 98% 남음` |
| `usage.prompt_tokens` 등 | `tokens` | disjoint buckets | `per-request` | `입력 N / 출력 N / 캐시읽기 N / 추론 N` |
| `usage.estimated_cost` | `usd-amount` | USD | `per-request` | `추정 $…` (`confidence:'estimated'`) |
| `/v1/me` | — | — | — | **계정 잔액 없음** → `confidence:'unavailable'`, 사유 명시 |

### 2.4 Check rules (normative)

| # | Rule |
| :--- | :--- |
| U1 | **Never convert `remaining` to `consumed`** (or vice versa) silently. Keep `kind` and label the unit. Antigravity shows "남음", OpenCode shows "사용". |
| U2 | **Never fabricate a zero.** `cost` absent → `null`; `/v1/request-costs` 404 → `unavailable`; quota RPC failure → stale value with `confidence:'estimated'` or `unavailable`, never `{}` shown as 0%. |
| U3 | **Windows are not merged.** 5h / weekly / monthly are three separate rows; a per-request token figure is a fourth, never added into a plan percentage. |
| U4 | **Check = freshness + limited flag.** A reading older than its TTL (OpenCode plan cache 60 s, Antigravity quota 60 s, DeepInfra catalog 30 min) is `stale` and must be re-fetched before being used to gate a turn. |
| U5 | **Gate is advisory, not a hard block** (boot card rule 6, UTM advisory): `limited:true` or `remaining<0.1` shows a warning; it does not abort the turn. **Owner 2026-11-06: no automatic model/provider fallback — the earlier "offers another service" wording is withdrawn.** See [RETRY-POLICY.md](RETRY-POLICY.md). |
| U6 | **Source is always displayed.** Every chip/panel row names its endpoint or wire field, so a derived number is never mistaken for a billed one. |
| U7 | **Standardisation is schema-level.** Three different units remain three different units; the custom surface renders them in one consistent *layout* (label + value + window + source + freshness), not one number. |

### 2.5 Why the standard router cannot do this (measured)

- `dsh-llm-pi-ai/lib/index.js:271–275`: *"The harness never reads pi-ai's cost metadata —
  `replay.ts` zeroes it and no consumer reports spend"*; `emptyPiUsage()` returns all zeros.
- `dsh-client-ui-settings-models` shows credential dots and model rows, no usage/quota panel.
- There is no `UsageReading`-shaped host service, no window model, no `limited` flag, no
  `resetsAt`. The three custom plugins already compute these facts locally
  (`plan-usage` route, `quotaSummary()`, `parseCost()`); the new surface **collects and
  normalises them**, it does not ask the host for them.

## 3. Standard vs custom coverage matrix (the "완벽하게 커버" 명세 보강)

| Capability | DSH standard (measured) | Where the custom surface covers it | Concrete logic |
| :--- | :--- | :--- | :--- |
| Route registration | ✅ `registerAdapter` + `replace` | uses it (does not replace) | M1–M2 in [ARCHITECTURE §3](./CUSTOM-ROUTER-ARCHITECTURE.md) |
| Model **discount / promotion** | ❌ cost zeroed, no `discount` | DeepInfra tab: `promotionOf()` badge + effective price | §1.2 L2-D3; `catalog.js:245–266` |
| **New model** without DSH release | ❌ generated `PROVIDER_DATA` snapshot | each tab: live catalog fetch + `isNewModel()` 7-day badge + TTL | §1.2; `plans.js:47–61`, `catalog.js` fetchCatalog |
| **Per-service usage / quota** | ❌ `emptyPiUsage()` zeros | normalised `UsageReading[]` panel per tab | §2, U1–U7 |
| **Subscription plan** (Go/Zen) | ❌ no field | L1 static + L2 `/api/experimental/usage/limits` + L3 endpoint probe | §1, `PlanVerdict` |
| **Plan burn / allowance** | ❌ | `billing_source` + `allowance` shown separately from `cost` and `list_cost` | `cost.js:12–49` |
| **Web-auth readiness** | ❌ credential dot only | per-service install/token/oauth checklist | [PRESET §3.3](./CUSTOM-ROUTER-PRESET-SURFACE.md) |
| **Read-only key reference** | ❌ standard page writes its own `refs` | `credentials.resolve` report only; separate `role('secret')` input when web auth absent | [PRESET §1.2](./CUSTOM-ROUTER-PRESET-SURFACE.md), owner decision 2 |
| **Service-specific tabs** | ❌ flat `rowCard` section, no tab API | plugin-owned `settings.section` with own React tab strip | [PRESET §3.1](./CUSTOM-ROUTER-PRESET-SURFACE.md), [ARCHITECTURE §2.1](./CUSTOM-ROUTER-ARCHITECTURE.md) |
| **Model allow-list per service** | ⚠️ profile-wide only | per-tab `enabledModels` with service-specific validation | `cordis.patch.yml` of each plugin |
| Reasoning effort / wire mapping | ⚠️ generic opaque ids | per-service mapping (`effort-field` / `model-id-suffix` / `ordered-id`) | [PROTOCOL §2](./CUSTOM-ROUTER-PROTOCOL-STANDARD.md) |
| **Downstream stream normalisation** (SSE→StreamChunk→usage→finish) | ❌ three separate implementations that already drifted | **one shared pipe with hooks**, consumed by all three | [SHARED-STREAM-PIPE-SPEC.md](./SHARED-STREAM-PIPE-SPEC.md), [PROTOCOL §2.1](./CUSTOM-ROUTER-PROTOCOL-STANDARD.md) |
| **Composer usage chip** | ❌ | `conversation.input.right` list slot, provider-id gated | [UI-SLOT-ARCHITECTURE.md](../../docs/UI-SLOT-ARCHITECTURE.md) |

**Coverage rule:** for every ❌ row, the custom surface must (a) name the **exact endpoint or
wire field** it reads, (b) show `measuredAt` + `confidence`, and (c) degrade to `unavailable`
with a reason when the provider does not answer. "완벽하게 커버" means **no silent default**,
not "always a number". A standard field that returns zeros is not coverage; a visible
`unavailable` with its reason is.

## 4. Verification of this document

| Claim | Command / source |
| :--- | :--- |
| `go` limits real values | `curl …/api/experimental/usage/limits` (response in §1.2) |
| `billing_source` vocabulary | `dsh-opencode-v2/lib/cost.js` `BILLING_SOURCES` / `PLAN_SOURCES` |
| DeepInfra 404 / `/v1/me` | `dsh-deepinfra/UPSTREAM-APIS.md` §1, §3 |
| Antigravity `remainingFraction` | `dsh-antigravity/lib/client.src.js:243–253` |
| Standard zeroed cost | `dsh-llm-pi-ai/lib/index.js:271–275` |

## 5. Not done here

No implementation, no `settings.section` row, no live-profile edit, no restart, no real
generation turn, no browser boot of the new surface, no version/rc change.

## 6. References

- [PRESET-SCHEMA-AND-EXTENSION.md](./PRESET-SCHEMA-AND-EXTENSION.md) — per-service preset schema, extension limits, future-service coverage tiers


- [CUSTOM-ROUTER-SERVICE-SPEC.md](./CUSTOM-ROUTER-SERVICE-SPEC.md), [CUSTOM-ROUTER-PROTOCOL-STANDARD.md](./CUSTOM-ROUTER-PROTOCOL-STANDARD.md), [CUSTOM-ROUTER-PRESET-SURFACE.md](./CUSTOM-ROUTER-PRESET-SURFACE.md), [CUSTOM-ROUTER-ARCHITECTURE.md](./CUSTOM-ROUTER-ARCHITECTURE.md)
- [dsh-opencode-v2/docs/OPENCODE-V2-HTTP-API-MEASUREMENT.md](../../dsh-opencode-v2/docs/OPENCODE-V2-HTTP-API-MEASUREMENT.md), [dsh-deepinfra/UPSTREAM-APIS.md](../../dsh-deepinfra/UPSTREAM-APIS.md), [dsh-antigravity/README.md](../../dsh-antigravity/README.md)
- [docs/RULES.md](../../docs/RULES.md), [docs/DSH-HARNESS-POLICY.md](../../docs/DSH-HARNESS-POLICY.md)
