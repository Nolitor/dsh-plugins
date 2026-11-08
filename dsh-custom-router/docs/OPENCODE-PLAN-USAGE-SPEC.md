# OpenCode Console Plans — Usage and Limits in the Custom Router's OpenCode Tab

<!-- skeleton:
version: 0.0.1-rc.1
kind: spec
status: active
updated: 2026-11-08
summary: Measured specification of how the Custom Router's OpenCode tab shows the four OpenCode console plans (Zen, Go, Go Plus, Go Team), their windows, spend and per-model limits, plus the API gaps behind it.
-->

> Status: **specification only**, built on live measurement 2026-11-08. No code, profile, version
> or live service was changed. Document version follows the `rc.#` history scheme; plugin
> `@nolit/dsh-custom-router` is `0.0.1-rc.5` (unchanged). Parents:
> [PLAN-AND-USAGE-SPEC.md](PLAN-AND-USAGE-SPEC.md),
> [CUSTOM-ROUTER-PRESET-SURFACE.md](CUSTOM-ROUTER-PRESET-SURFACE.md),
> [CUSTOM-ROUTER-SERVICE-SPEC.md](CUSTOM-ROUTER-SERVICE-SPEC.md).
>
> Measured against: OpenCode daemon **v2.2.6** (`http://127.0.0.1:49374`, pid 3867975),
> OpenCode Console public docs (2026-11-08), and the live Console API with the daemon's own
> stored OAuth credential.

## 1. Summary

OpenCode accounts have **four** commercial shapes — **Zen** (pay-as-you-go balance),
**Go** ($10/month), **Go Plus** ($40/month) and **Go Team** ($20/member/month) — and the
three subscription plans each carry a **5-hour / weekly / monthly** allowance window plus a
**per-model monthly dollar limit**. The Custom Router's OpenCode tab currently shows **one**
plan's three windows (the Go family, read through the local daemon) and a model list; it cannot
say *which* of the four plans the account is on, cannot show the per-model limits, and cannot
separate "Go" from "Go Plus" from "Go Team" because **no local or public API exposes the plan
identifier**. The measurements below pin down exactly which fields exist, which are missing, and
the smallest vendor change that closes the gap.

## 2. What the console documents say (measured from the live docs)

Source: [https://opencode.ai/docs/console/go](https://opencode.ai/docs/console/go) (and its
`#usage-limits`, `#estimated-requests`, `#privacy` sections),
[https://opencode.ai/docs/console/api/inference#cost](https://opencode.ai/docs/console/api/inference),
[https://opencode.ai/docs/console/models#pricing](https://opencode.ai/docs/console/models),
[https://opencode.ai/docs/console/billing](https://opencode.ai/docs/console/billing).

### 2.1 The plans

| Plan | Price / billing | Windows | Per-model limits | Doc source |
|---|---|---|---|---|
| **Zen** (pay-as-you-go) | Prepaid credits, per-token billing (no subscription) | none | none (per-token price only) | [models](https://opencode.ai/docs/console/models) — "OpenCode Console provides a list of models … You are charged per request" |
| **Go** | $10/month | 5-hour, weekly, monthly | per-model monthly dollar limit (see §2.3) | [go](https://opencode.ai/docs/console/go) plan table |
| **Go Plus** | $40/month | 5-hour, weekly, monthly | per-model monthly dollar limit, higher | [go](https://opencode.ai/docs/console/go) plan table |
| **Go Team** (docs: "Go Teams") | $20/member/month, per member | 5-hour, weekly, monthly | per-model monthly dollar limit; docs: "$5/month higher than Go on every model" | [go](https://opencode.ai/docs/console/go) plan table + "Go Teams" note |

Documented window rule (verbatim): *"Each model has the following usage limits: 5-hour — 20% of
the monthly limit; weekly — 50%; and monthly — 100%."* Windows are therefore **per model**, not
global — the console's own tables give a *Monthly limit* per model, and the 5-hour/weekly limits
are percentages of it.

Documented "Extra Usage": *"If you also have credits in your Console balance, you can turn on
Extra Usage on the `Go` page. When enabled, Go will fall back to your pay-as-you-go balance after
you've reached your usage limits instead of blocking requests. Go Team starts with Extra Usage on."*

Documented per-request accounting (`/docs/console/api/inference#cost`): `usage.cost` (USD charged
to the balance; `0` inside Go limits), `usage.opencode.billing_source`
(`free | balance | go | go-plus | byok`), `usage.opencode.list_cost` (USD at list price),
`usage.opencode.allowance` (**Go only**: dollars of the plan's monthly limit the request
consumed), `usage.opencode.tokens`.

### 2.2 Privacy / retention (the doc the owner linked)

The console publishes a per-model training/retention table (Go models): most models are
*"Not used"* for training with **0 days** retention; Grok 4.7, GPT 6 Luna, GPT 5.6 Luna and
Claude Haiku 5.5 retain **30 days**; Muse Spark 1.3/1.2 Contributor and Iceman Contributor Free
train on requests and are **"Not ZDR"**. DeepSeek's ZDR agreement is renewed monthly (valid
through 2026-11-30). **None of this is exposed by any API** — it is documentation-only, and it
is **per model**, not per plan.

### 2.3 The per-model monthly limits the docs publish

Go / Go Plus / Go Teams share the same token prices but differ in the *monthly allowance* per
model. Measured from the docs source
(`services/site/src/docs/content/console/go.mdx`, three `<PlanTabs>` blocks `go-pricing`,
`go-plus-pricing`, `go-teams-pricing`) — every row, USD/month:

| Model | Go | Go Plus | Go Teams |
|---|---:|---:|---:|
| GLM-5.3-Flash | 60 | 180 | 65 |
| GLM-5.3 | 15 | 120 | 20 |
| GLM-5.2 | 60 | 180 | 65 |
| Kimi K3.1 Pro | 15 | 60 | 20 |
| Kimi K3 | 15 | 60 | 20 |
| Kimi K2.7 Code | 60 | 180 | 65 |
| LongCat-2.0 | 60 | 240 | 65 |
| Step 5 Preview | 15 | 60 | 20 |
| MiMo-V2.6-Flash | 60 | 120 | 65 |
| MiMo-V2.6-Pro | 15 | 60 | 20 |
| MiMo-V2.5 | 60 | 120 | 65 |
| MiMo-V2.5-Pro | 15 | 60 | 20 |
| MiniMax M3.1 Flash | 20 | 80 | 25 |
| MiniMax M3 (≤ 512K / > 512K) | 60 / 60 | 180 / 180 | 65 / 65 |
| Muse Spark 1.3 Contributor | 60 | 120 | 65 |
| Muse Spark 1.2 Contributor | 60 | 120 | 65 |
| Qwen3.8 Max | 15 | 60 | 20 |
| Qwen3.8 Flash | 30 | 90 | 35 |
| Qwen3.7 Plus (≤ / > 256K) | 60 / 60 | 180 / 180 | 65 / 65 |
| DeepSeek V4.1 Flash (Off-Peak / Peak) | 100 / 100 | 200 / 200 | 105 / 105 |
| DeepSeek V4 Pro (Off-Peak / Peak) | 15 / 15 | 60 / 60 | 20 / 20 |
| Hy4 | 60 | 240 | 65 |
| Hy4 preview | 30 | 120 | 35 |
| Hy3 | 60 | 240 | 65 |
| Grok 4.7 (≤ / > 200K) | 15 / 15 | 60 / 60 | 20 / 20 |
| GPT 6 Luna (≤ / > 272K) | 15 / 15 | 60 / 60 | 20 / 20 |
| GPT 5.6 Luna (≤ / > 272K) | 15 / 15 | 60 / 60 | 20 / 20 |
| Claude Haiku 5.5 (≤ / > 100K) | 15 / 15 | 60 / 60 | 20 / 20 |
| Gemini 4 Argon (50% off) | 30 | 120 | 35 |
| Crouton Alpha Free / Beam Free / Iceman Contributor Free | Unlimited | Unlimited | Unlimited |

All three tables have **40 rows** each — **37 priced models** plus the 3 free models
(Crouton Alpha Free, Beam Free, Iceman Contributor Free), which are `Unlimited` on every plan.

**Cross-check.** The console's own landing-page bundle encodes a subset of the same numbers as
`{model: {go:[requests5h, monthlyLimitUsd], "go-plus":[...], "go-teams":[...]}}` — measured in
`/console/_build/assets/landing-go-allowance-BtnnnB5e.js`, 11 models:
`"deepseek-v41-flash":{go:[43330,100],"go-plus":[86670,200],"go-teams":[45500,105]}`,
`"kimi-k31-pro":{go:[147,15],"go-plus":[588,60],"go-teams":[196,20]}`,
`"glm-53-flash":{go:[6320,60],"go-plus":[18960,180],"go-teams":[6847,65]}`, … All 11 match the
doc table's monthly-limit column exactly (verified row by row).

**The two plans are not related by a constant factor.** Measured over all 37 priced models:

- **Go Teams = Go + $5 on every single row** (60→65, 15→20, 30→35, 100→105) — 0 exceptions.
  This matches the plan table's wording literally.
- **Go Plus is NOT a multiple of Go**: the ratio is 2× (MiMo-V2.6-Flash 60→120), 3×
  (GLM-5.3-Flash 60→180), 4× (Kimi K3.1 Pro 15→60, Hy4 60→240), 8× (GLM-5.3 15→120).

So a UI may derive Go Teams from Go by `+5`, but it must carry the **Go Plus table separately** —
scaling by a ratio is wrong for every model except the 2×/3×/4× cases.

## 3. The vendor implementation in this repo (read)

| Fact | File | Detail |
|---|---|---|
| Plan ids in the vendor | `dsh-opencode-v2/lib/plans.js:22` | `export const PLANS = ['go', 'zen']` — **two** ids only |
| Plan → provider map | `dsh-opencode-v2/lib/plans.js:25` | `{ go: 'opencode-go', zen: 'opencode' }` |
| The plan **is** the provider id | `dsh-opencode-v2/lib/plans.js:31-44` | `planOfRoute()` splits `provider/model`; `opencode-go/*` = go, `opencode/*` = zen |
| Active plan config | `dsh-opencode-v2/lib/http.js:276` | `activePlan: Schema.union(PLANS).default('go')` — the user *declares* it; nothing measures it |
| `plan-usage` route | `dsh-opencode-v2/lib/http.js:2647-2680` | reads `GET /api/experimental/usage/limits`, maps `data.go.{rolling,weekly,monthly}` → `{percent, limited, resetsAt}`; 60 s cache; `?refresh=1` bypasses |
| `model-settings` route | `dsh-opencode-v2/lib/http.js:2606-2628` | returns `activePlan`, `plans: PLANS`, `enabled`, `models[]` (each with `plan`), `otherPlanCount`, `cost` (ledger summary), `verdicts`, `observedAt`, `ranking` |
| `cost/session` route | `dsh-opencode-v2/lib/http.js:2688-2708` | `{session, totals:{sessions, requests, costUsd, allowanceUsd}}` from the in-process ledger |
| Cost parsing | `dsh-opencode-v2/lib/cost.js:84-108` | `parseCost()` → `costUsd`, `listCostUsd`, `allowanceUsd`, `estimated`, `billingSource`, `planSource` |
| Billing sources | `dsh-opencode-v2/lib/cost.js:47-50` | `BILLING_SOURCES = ['free','balance','go','go-plus','byok']` — **`go-plus` is a distinct billing source** |
| Plan-burn sources | `dsh-opencode-v2/lib/cost.js:50` | `PLAN_SOURCES = ['go','go-plus']` (no `go-teams` literal; a team seat reports as one of these) |
| Per-model ledger | `dsh-opencode-v2/lib/cost.js:204-220` | `byModel[route] = {requests, costUsd, listCostUsd, allowanceUsd, tokens{...}}` |
| Vendor's own plan UI | `dsh-opencode-v2/lib/client.js:608-782` | cost pill → plan panel: per-model rows (sorted by `allowanceUsd`) then the three window bars |
| Vendor's plan panel fetches | `dsh-opencode-v2/lib/client.js:638-644` | `POST plan-usage` + `POST cost/session` |

**Consequence:** the vendor's model is *plan = provider id*. `opencode-go` covers Go, Go Plus and
Go Team indistinguishably — there is **no `go-plus` or `go-team` provider id** and no plan
identifier anywhere in the catalog.

## 4. Measured payloads (read-only)

### 4.1 Daemon: `GET /api/experimental/usage/limits`

Command (password read from the daemon state file, never printed):

```bash
PW=$(python3 -c "import json;print(json.load(open('$HOME/.local/state/opencode/service.json'))['password'])")
curl -s -u "opencode:$PW" http://127.0.0.1:49374/api/experimental/usage/limits
```

Measured response (2026-11-08):

```json
{
  "location": { "directory": "/home/minami" },
  "data": {
    "workspace": {
      "id": "org_01M4C03H8AYRTHKPE247B8803V",
      "name": "Personal",
      "usageURL": "https://opencode.ai/console/org_01M4C03H8AYRTHKPE247B8803V/activity/overview"
    },
    "go": {
      "rolling": { "percent": 5,  "limited": false, "resetsAt": 1794084398000 },
      "weekly":  { "percent": 58, "limited": false, "resetsAt": 1794182400000 },
      "monthly": { "percent": 54, "limited": false, "resetsAt": 1794998310000 }
    },
    "budgets": []
  }
}
```

Exact field names observed: `data.workspace.id`, `data.workspace.name`,
`data.workspace.usageURL`, `data.go.rolling.percent`, `data.go.rolling.limited`,
`data.go.rolling.resetsAt` (epoch **ms**), `data.go.weekly.*`, `data.go.monthly.*`,
`data.budgets` (array; empty on this account).

**There is no plan id, no price, no per-model split, and no Zen/balance block in this payload.**

### 4.2 Console: `GET https://opencode.ai/zen/go/v1/usage`

Discovered from the daemon's own source in the installed binary
(`/home/minami/.bun/install/global/node_modules/@opencode/cli-linux-x64/bin/opencode`,
strings: `` `${new URL(a).origin}/zen/go/v1/usage` `` and the
`UsageLimits.Meter = {percent, limited, resetsAt}` schema).

Command (OAuth access token taken from the daemon's active credential, never printed):

```bash
curl -s -H "authorization: Bearer $TOK" \
  -H "x-opencode-org-id: org_01M4C03H8AYRTHKPE247B8803V" \
  https://opencode.ai/zen/go/v1/usage
```

Measured response:

```json
{"usage":{
  "rolling":{"status":"ok","percent":5,"resetsAt":"2026-11-07T20:46:38.000Z"},
  "weekly": {"status":"ok","percent":58,"resetsAt":"2026-11-09T00:00:00.000Z"},
  "monthly":{"status":"ok","percent":54,"resetsAt":"2026-11-18T10:38:30.000Z"}}}
```

Field names: `usage.{rolling,weekly,monthly}.status` (`ok` | `rate-limited`),
`.percent`, `.resetsAt` (**ISO-8601 string** here; epoch ms in the daemon route).
**Same numbers as the daemon route at the same moment** — the daemon route is a 60 s-cached
projection of this endpoint (`limited` = `status === "rate-limited"`).

Probed and **404**: `/zen/go/v1/usage/{model}`, `/zen/go/v1/usage?model=…` (the query parameter is
ignored — the same three numbers come back for `deepseek-v4.1-flash`, `hy4` and
`minimax-m3.1-flash`), `/zen/go/v1/plans`, `/zen/go/v1/plan`, `/zen/go/v1/subscription`,
`/zen/go/v1/allowance(s)`, `/zen/go/v1/meters`, `/zen/go/v1/usage/history`,
`/zen/go/v1/usage/by-model`, `/zen/v1/usage`.

### 4.3 Console: `GET https://opencode.ai/zen/go/v1/models`

The Go model list with prices (30 entries measured).

```json
{"object":"list","data":[{
  "id":"kimi-k3.1-pro","name":"Kimi K3.1 Pro",
  "limit":{"context":1048576,"output":131072},
  "cost":{"text":{"input":{"price":2.0,"cache":{"read":0.2,"write":2.0}},"output":{"price":10.0}}},
  "api":{"chat-completions":{"base_url":"https://opencode.ai/inference/go/openai/v1", …}}}]}
```

Field names measured: `id`, `name`, `cost.text.input.price`, `cost.text.input.cache.read`,
`cost.text.input.cache.write`, `cost.text.output.price`, `cost.multipliers[]` (peak-hour factor),
`limit.context`, `limit.input`, `limit.output`, `modalities`, `capabilities`, `api`.

**No monthly-limit field exists.** The union of every key across all 30 models is:
`api, canonical_id, capabilities, cost, created, description, family, id, knowledge, last_updated,
limit, limit.context, limit.input, limit.output, modalities, name, object, open_weights,
owned_by, release_date, type` — **no `monthly`, `allowance`, `quota` or `plan` key**.

### 4.4 Console: `GET https://opencode.ai/console/api/policies/current-budgets`

```json
[]
```

Empty on this account. The daemon's schema (from the binary) shows the shape it would return:
`{ruleID, limitDollars, spentDollars, scope: each|combined, per: set|model,
coverage: all|models, models:[{providerID, modelID, name, spentDollars}], vendors,
inputPriceAtLeast, picked, shared, resetsAt}` — this is the **workspace budget-policy** surface
(Console › Budgets), **not** the Go plan allowance.

### 4.5 Console MCP: `POST https://opencode.ai/console/mcp`

The Console exposes an MCP server; the daemon registers it as an MCP provider
(`opencode_console`, `https://opencode.ai/console/mcp`). Measured tool list:
`get_context`, `get_usage`, `list_providers`, `list_models`, `set_model_enabled`,
`set_models_enabled`, `create_provider`, `create_model`, `update_model`, `list_members`,
`get_member_usage`.

`tools/call get_usage {"range":"30d"}` → `structuredContent`:

```json
{
  "user_id": "user_01M4C03H71EQWZ97KQPCWYC34K",
  "range": "30d",
  "requests": 15684,
  "input_tokens": 47875159,
  "output_tokens": 13604222,
  "cache_read_tokens": 2716573072,
  "cache_write_tokens": 931370,
  "cost_usd": 44.1823243,
  "models": [
    {"model":"deepseek-v4.1-flash","provider":"opencode-go","requests":11285,"cost_usd":18.64890398},
    {"model":"kimi-k3.1-pro","provider":"opencode-go","requests":185,"cost_usd":11.7793784},
    {"model":"minimax-m3.1-flash","provider":"opencode-go","requests":2796,"cost_usd":10.73478381},
    {"model":"hy4","provider":"opencode-go","requests":158,"cost_usd":2.40542423},
    {"model":"qwen3.8-flash","provider":"opencode-go","requests":146,"cost_usd":0.27139368}
  ],
  "budgets": []
}
```

Field names: `user_id`, `range` (`24h|7d|30d|all`), `requests`, `input_tokens`,
`output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd`,
`models[].model`, `models[].provider`, `models[].requests`, `models[].cost_usd`, `budgets`.

`tools/call get_context {}` → `structuredContent`:
`{user:{id,email}, workspace:{id,name,role}}` — **the workspace name and role, but no plan tier**.

**This is the only measured API that gives a per-model breakdown of account usage.** It reports
`cost_usd` (list-price value), **not** the Go allowance burn (`opencode.allowance`) and **not**
the per-model monthly limit.

### 4.6 The local cost ledger (`~/.dsh/profiles/web/opencode-session-cost.json`)

Measured snapshot, pinned at `savedAt = 2026-11-07T19:10:13.728Z` (the file is live and grows
while DSH runs, so the numbers below are that one instant; re-derive them with the command in §9):

| Route | requests | listCostUsd | allowanceUsd | costUsd |
|---|---:|---:|---:|---:|
| `opencode-go/kimi-k3.1-pro` | 179 | 11.777756 | 47.111026 | 0 |
| `opencode-go/deepseek-v4.1-flash` | 4676 | 7.512451 | 9.014941 | 0 |
| `opencode-go/minimax-m3.1-flash` | 534 | 1.470978 | 4.412935 | 0 |
| `opencode-go/hy4` | 158 | 2.405424 | 2.405424 | 0 |
| `opencode-go/step-5-preview` | 3362 | 0.252880 | 1.011521 | 0 |
| `opencode-go/hy4-preview` | 2 | 0.011878 | 0.023756 | 0 |
| `opencode-go/beam-free` | 104 | 0 | 0 | 0 |
| `opencode-go/iceman-contributor-free` | 111 | 0 | 0 | 0 |
| **total (39 sessions)** | **9126** | **23.4314** | **63.9796** | **0** |

**The account is on Go Plus** — the ledger's `bySource` records `go-plus`, and `cost.js` maps
`billing_source` → `go-plus` → `PLAN_SOURCES`. This is the *only* place the plan tier appears,
and it appears **per request**, never per plan.

**Measured caveat on `bySource` coverage** (this is why the plan tier cannot be derived from
`bySource` alone): at that instant, 39 sessions hold 9126 requests, but `bySource` accounts for
only **5818** of them. One session (`b70d93d8-…`, `opencode-go/step-5-preview`, 3362 requests)
reports `bySource: {"go-plus": 54}` with `pricedRequests: 54` and
`unpricedRequests: 3308` — 3308 requests carried **no `billing_source` at all**. Its
`lastBillingSource` is still `go-plus`. So `bySource` is a **partial** counter: it counts only
requests whose wire payload carried `usage.opencode.billing_source`.

Any plan-tier derivation must therefore treat `bySource` as *evidence, not proof*:
`bySource` empty ⇒ tier unknown; `bySource` non-empty ⇒ the tier it names, corroborated by
`lastBillingSource`.

### 4.7 The router's own routes (measured)

```bash
curl -s -X POST -H 'content-type: application/json' -d '{}' \
  http://127.0.0.1:3080/api/local/opencode-v2/plan-usage
```

→ **HTTP 401 `unauthorized`** (the DSH web cookie is required). Same for `model-settings` and
`cost/session`. The router client reaches these from the browser with the cookie attached, so the
401 is a measurement constraint, not a defect — **the route payloads could not be captured
directly**. Their shapes are taken from the vendor source (§3), and the upstream source they read
was measured directly (§4.1–§4.5).

## 5. Plan matrix — what is identifiable from the API

| Plan | Price / billing | Windows | Per-model limits | What the API exposes (measured) |
|---|---|---|---|---|
| **Zen** (pay-as-you-go) | prepaid credits, per-token | none | none | **Only as a provider id**: `opencode/*` routes in `/api/model` (21 of 53 live routes) and `PLANS` in `model-settings`. **No balance, no spend-to-date, no plan id from any API.** `usage.cost` per request is the only money number; it is `0` for free models and absent for unpriced models. |
| **Go** | $10/month | 5h / weekly / monthly (`data.go.rolling\|weekly\|monthly` = `{percent, limited, resetsAt}`) | per-model monthly USD limit — **documented only** | The three window percentages are exposed (aggregate over all Go models). The plan tier is **not** exposed. |
| **Go Plus** | $40/month | same three windows | same shape, higher limits | The tier is observable **only** as `usage.opencode.billing_source == "go-plus"` on individual responses (recorded in the local ledger's `bySource`). No window or limit differs by tier in the API — the windows are the account's numbers, the tier changes *what those numbers mean*. |
| **Go Team** | $20/member/month, per member | same three windows | same shape | **Not distinguishable from Go/Go Plus by any API.** The console *docs* call the plan "Go Teams" (§2.1) while the owner's complaint calls it "Go Team"; neither string appears in the daemon binary. Service accounts are excluded from Go Teams (documented). |

**Answer to "if the API exposes `go.rolling/weekly/monthly` only":** yes — the daemon route
exposes exactly `go.rolling`, `go.weekly`, `go.monthly` (plus `workspace` and `budgets`), and
nothing about the plan tier, the Zen balance, or per-model limits.

## 6. Gap analysis — what the router tab cannot show today, and why

| # | Gap | Root cause (measured) | Consequence in the UI |
|---|---|---|---|
| **G1** | The tab cannot name the plan | No API exposes a plan id. `PLANS = ['go','zen']` is a *provider-id* mapping, and `opencode-go` covers Go, Go Plus **and** Go Team. The tier lives only in `usage.opencode.billing_source` on the wire. | The tab shows "Subscription" (`planSubscription`) for everything Go-family. Go vs Go Plus vs Go Team is indistinguishable. |
| **G2** | The tab cannot show the **Zen** plan's state at all | Zen is pay-as-you-go against a prepaid balance. No measured endpoint returns a balance (`/api/info`, `/api/provider`, `/api/credential`, `/api/experimental/usage/limits`, `/console/api/*` — all 404 for balance paths). | The Zen chip would have no numbers. Only per-request `usage.cost` is available, and only locally, in the ledger. |
| **G3** | Per-model **spend limits** are documentation-only | The doc table has per-model monthly limits per plan; `/zen/go/v1/models` carries `cost` (prices) but **no** limit field; `/zen/go/v1/usage` returns three aggregate percentages and ignores `?model=`. | The tab cannot render "this model has $15/month, you used $X". |
| **G4** | The tab's **per-model usage** is local-only and lossy | The ledger (`~/.dsh/profiles/web/opencode-session-cost.json`) records only what *this DSH process* sent. Measured at one instant: ledger 9126 requests / $23.43 list cost vs console `get_usage` 15684 requests / $44.18 over 30 days — the local ledger covers ~58% of the requests and ~53% of the list value. | The per-model table under-reports the account. It must be labelled as "this workspace's own traffic", not "your account". |
| **G5** | The **allowance burn** is per-model but the **windows** are aggregate | `opencode.allowance` is per request and accumulates in the ledger; `data.go.*.percent` is one account-level number across all models. | A per-model progress bar against the monthly limit cannot be computed locally — the denominator (the model's monthly limit) is not in any API. |
| **G6** | **Extra Usage** (fall back to the balance past the limit) is invisible | Documented as a toggle on the Go page; no API exposes it. | The tab cannot warn "your plan is capped but Extra Usage will bill your balance". |
| **G7** | **Privacy / retention** is invisible | Documentation-only, per model, not per plan. | Cannot be shown from data; at most a static notice pointing at the docs. |
| **G8** | `activePlan` is a **declaration**, not a measurement | `dsh-opencode-v2/lib/http.js:276` — `Schema.union(PLANS).default('go')`. | A user on Zen who never flips the setting sees Go windows (which are empty/absent for a Zen account) and a Zen-only catalog. |

## 7. Proposed UI (fits the router's existing OpenCode tab)

The router's OpenCode tab is the **models tab** — the preset descriptor
`{id:'opencode', row:'dsh-opencode-v2-http', route:'/api/local/opencode-v2/model-settings',
planKey:'planOpenCode'}` in `lib/client.src.js` (the descriptor list was named `MODEL_SOURCES`
when this was measured and is being renamed to `MODEL_PRESETS` in a parallel change — match on
the `id:'opencode'` entry, not on the list's name), rendered with the shared
`crSettingsTabs` / `crPanelBody` / `crGroup` / `crRow` chrome and one active `role="tabpanel"`.
The **usage** surface (`normalizeOpencodeUsage` in `lib/client.src.js`) already feeds
`UsageWindow` progress bars into the provider card.

The proposal adds a **plan block at the top of the OpenCode models tab** (so it lives inside the
existing tab, before the model groups) and **one group per plan** inside the existing list.

### 7.1 Plan selector chip row

A `crPlanChips` row of four chips — `Zen · Go · Go Plus · Go Team` — rendered in the same style
as the existing `crTabs` buttons, inside the OpenCode models panel:

```
┌ Zen ┐ ┌ Go ┐ ┌ Go Plus ┐ ┌ Go Team ┐     ← Go Plus = active (measured billing_source)
```

Rules:
- The **active** chip is the plan the ledger's `bySource` shows (`go-plus` here). It is a
  *measurement*, not a setting — and per §4.6 `bySource` is a **partial** counter (5818 of 9126
  requests at the measured instant), so the chip must read *"Go Plus (measured)"* only when
  `bySource` names it, and fall back to the **declared** `activePlan` labelled as declared
  otherwise. A chip with neither reads `unknown`.
- The other three chips are **selectable as a filter**, not as a switch: picking "Go" shows what
  the Go plan's limits are for the models below.
- A chip whose data is unavailable carries a `not provided` badge and is disabled.

### 7.2 Windows as real progress bars

Reuse `UsageWindow` (`lib/client.src.js`, function `UsageWindow`) verbatim — it already renders a
`role="progressbar"` bar with `aria-valuenow`, a percentage and a reset line. One row per
window, from `plan-usage`'s `windows.rolling|weekly|monthly`:

```
5-hour      ███░░░░░░░░░░░░░░░░░░░░   5%    resets 2026-11-07 20:46
Weekly      ███████████░░░░░░░░░░░░░  58%    resets 2026-11-09 00:00
Monthly     ██████████░░░░░░░░░░░░░░  54%    resets 2026-11-18 10:38
```

Copy rule: the label comes from the locale (`window5h` / `windowWeekly` / `windowMonthly`
already exist in `lib/locale-table.js`); the reset instant comes from `resetsAt`
(epoch ms → `resetEpoch()` already handles both seconds and ms).

### 7.3 Allowance / spend line

One line under the bars, from the ledger (`cost.bySession[].byModel[]`, `cost.totals`):

```
Plan burn $63.98   ·   Charged $0.00   ·   List value $23.43
```

- `allowanceUsd` = plan burn (dollars of the plan's monthly limit consumed).
- `costUsd` = charged (0 inside Go limits — the honest "$0, not free" case the vendor's cost pill
  already handles, `dsh-opencode-v2/lib/cost-pill.js:62`).
- `listCostUsd` = what the traffic was worth at list price.
- When no figure exists, the slot reads **`not provided`** — never `0` and never `$0.00`.

### 7.4 Per-model usage table

Sourced from `cost.bySession[].byModel` (the ledger), one row per route:

| Model | Requests | Charged | Plan burn | List value | Monthly limit |
|---|---:|---:|---:|---:|---|
| kimi-k3.1-pro | 179 | $0 | $47.11 | $11.78 | $60 (Go Plus) |
| deepseek-v4.1-flash | 4676 | $0 | $9.01 | $7.51 | $200 (Go Plus) |
| minimax-m3.1-flash | 534 | $0 | $4.41 | $1.47 | $80 (Go Plus) |
| hy4 | 158 | $0 | $2.41 | $2.41 | $240 (Go Plus) |
| step-5-preview | 3362 | $0 | $1.01 | $0.25 | $60 (Go Plus) |
| beam-free | 104 | $0 | $0 | $0 | Unlimited |

(Ledger figures from the pinned §4.6 snapshot; the limit column from the §2.3 doc table,
Go Plus plan, which the measured `billing_source` says is the account's plan.)

Fallback rules (explicit, per column):
- **Monthly limit**: not from any API. Either a static table shipped with the router (the doc
  values in §2.3, keyed by plan id + model id) or **`not provided`**. The table must be marked
  as *documentation-derived, snapshot date 2026-11-08* — the console says "Usage limits may
  change as we learn from early usage and feedback".
- **Charged**: `$0` is a real value (inside the plan); `not provided` when the route is unpriced.
- **Plan burn**: `0` is real for free routes (`beam-free`); `not provided` when the route was not
  billed to the plan.
- Rows whose route is not on the selected plan chip are dimmed with a `another plan` badge.

### 7.5 Explicit "not provided" fallbacks

Every column that has no measured source renders a muted **`not provided`** label with a `title`
explaining the missing source, following the router's existing `usageUnavailable` /
`balanceUnavailable` / `billingRatesUnknown` pattern in `lib/locale-table.js`. A window with no
data renders the label without a bar (the existing `UsageWindow` already does this when
`percent` is not a number).

## 8. Data contract proposal

### 8.1 What the router client needs (from the OpenCode routes)

`POST /api/local/opencode-v2/plan-usage` — the router already calls it. Extended contract:

| Field | Type | Nullability | Source | Notes |
|---|---|---|---|---|
| `ok` | boolean | never null | vendor | already present |
| `plan` | `'go' \| 'go-plus' \| 'go-team' \| 'zen' \| 'unknown'` | never null | **new** | the measured tier; `unknown` when nothing observed |
| `planSource` | `string \| null` | nullable | **new** | the raw `billing_source` (`go`, `go-plus`, …) |
| `planConfidence` | `'measured' \| 'declared' \| 'unknown'` | never null | **new** | `declared` = only `activePlan` config; `unknown` = neither |
| `workspace.name` | `string \| null` | nullable | vendor (`data.workspace.name`) | already present |
| `workspace.usageURL` | `string \| null` | nullable | vendor (`data.workspace.usageURL`) | already present |
| `windows.rolling` | `{label, percent, limited, resetsAt}` | object | vendor | already present |
| `windows.weekly` | same | object | vendor | already present |
| `windows.monthly` | same | object | vendor | already present |
| `allowanceUsd` | number | nullable | **new** (ledger) | total plan burn across sessions |
| `costUsd` | number | nullable | **new** (ledger) | total charged |
| `listCostUsd` | number | nullable | **new** (ledger) | total list value |
| `requests` | number | nullable | **new** (ledger) | total requests |
| `byModel` | `Record<route, {requests, costUsd, listCostUsd, allowanceUsd, tokens}>` | never null (may be `{}`) | **new** (ledger) | per-model table |
| `byModel[route].monthlyLimitUsd` | number | **nullable** | **new** (documentation table) | the only way to render "spent $X of $Y" |
| `byModel[route].monthlyLimitSource` | `'docs' \| 'none'` | never null | **new** | marks the limit as documentation-derived |
| `byModel[route].plan` | `'go' \| 'go-plus' \| 'go-team' \| 'zen' \| 'other'` | never null | **new** (derived from route prefix + plan) | which plan the route belongs to |

The per-model numbers already exist in the ledger and in the `model-settings` response
(`cost: adapter.costSummary()` → `{sessions, requests, costUsd, listCostUsd, allowanceUsd,
bySession:[{sessionId, …, byModel:{…}}]}`). The router already receives `model-settings`; it
simply does not read `cost` today (`normalizeOpencodeModels` reads only `enabled` and `models`).

### 8.2 Minimal change in `dsh-opencode-v2`

1. **`plan-usage`** (`dsh-opencode-v2/lib/http.js:2647`): add `plan`, `planSource`,
   `planConfidence` derived from the **ledger's** `bySource` counters
   (`costSummary().bySession[].bySource`): `go-plus` → `go-plus`, `go` → `go`,
   `balance` → `zen`, `free` → `zen` (free tier of Zen). When no session has billed to a plan,
   `plan` is `unknown` and `planConfidence` is `declared` (falling back to `config.activePlan`).
   This is a **local, credential-free** change — no new upstream request.
   **Measured caveat (§4.6): `bySource` is a partial counter** — it covered only 5818 of 9126
   requests at the measured instant, so the derivation must be *"the tier `bySource` names, if
   any"*, never *"the account's tier"*. With an empty `bySource` the tier stays `unknown`
   (never a fabricated `go`).
2. **`plan-usage`** also gains the aggregate money fields (`allowanceUsd`, `costUsd`,
   `listCostUsd`, `requests`) and the flattened `byModel` map, taken from the same ledger.
   `model-settings` already returns the same `cost` block (`cost: adapter.costSummary()`), so the
   router can read the per-model table from `model-settings` with **no vendor change at all** —
   that is the cheapest path and should be taken first.
3. **No daemon change is possible** for the plan tier: the daemon's `/api/experimental/usage/limits`
   schema (measured from the binary) is fixed at
   `{workspace:{id,name,usageURL}, go:{rolling,weekly,monthly}, budgets[]}` — there is no plan id
   upstream to expose.

### 8.3 Optional (needs an OAuth credential the router does not have)

`GET https://opencode.ai/console/mcp` → `tools/call get_usage {"range":"30d"}` returns the
**account-wide** per-model breakdown (`models[].requests`, `models[].cost_usd`) plus
`cost_usd`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, and
`budgets`. That is the only measured source for the *account's* usage rather than this
workspace's own traffic (G4). It needs the Console OAuth access token the daemon holds
(`/api/credential` → active `oauth` entry → `value.access`), which the router does not read
today and which **must never be forwarded to the browser**. If it is wired, it belongs in
`dsh-opencode-v2` (which already owns the daemon connection), served as a redacted summary.

The Console MCP also exposes `get_context` → `workspace.role` and `get_member_usage` — useful for
a "Go Team: per member" view, and still **no plan tier**.

## 9. Evidence / commands

All read-only. The daemon password and the Console OAuth token were read from local state and
never printed or written.

```bash
# daemon state (url + password + pid), password redacted for the record
cat ~/.local/state/opencode/service.json \
  | sed -E 's/"password"[[:space:]]*:[[:space:]]*"[^"]*"/"password":"<REDACTED>"/'
# → {"id":"b3b12986-…","version":"2.2.6","url":"http://127.0.0.1:49374","pid":3867975,"password":"<REDACTED>"}

# the daemon's Go allowance windows (the source of plan-usage)
PW=$(python3 -c "import json;print(json.load(open('$HOME/.local/state/opencode/service.json'))['password'])")
curl -s -u "opencode:$PW" http://127.0.0.1:49374/api/experimental/usage/limits

# the console's own Go usage endpoint (found in the daemon binary's strings)
curl -s -H "authorization: Bearer $TOK" \
  -H "x-opencode-org-id: org_01M4C03H8AYRTHKPE247B8803V" \
  https://opencode.ai/zen/go/v1/usage

# the console's Go model list with prices (no limits)
curl -s -H "authorization: Bearer $TOK" -H "x-opencode-org-id: $ORG" \
  https://opencode.ai/zen/go/v1/models

# the console's workspace budget policies (empty on this account)
curl -s -H "authorization: Bearer $TOK" -H "x-opencode-org-id: $ORG" \
  https://opencode.ai/console/api/policies/current-budgets

# the console MCP: tool list, get_context, get_usage
curl -s -X POST https://opencode.ai/console/mcp \
  -H "authorization: Bearer $TOK" -H "x-opencode-org-id: $ORG" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# the local cost ledger (this workspace's own traffic)
cp ~/.dsh/profiles/web/opencode-session-cost.json /tmp/ledger-snapshot.json
python3 -c "
import json
from collections import defaultdict
d=json.load(open('/tmp/ledger-snapshot.json'))
req=defaultdict(int); lst=defaultdict(float); alw=defaultdict(float); chg=defaultdict(float)
for sid,v in d['sessions'].items():
    for m,mv in (v.get('byModel') or {}).items():
        req[m]+=mv.get('requests',0); lst[m]+=mv.get('listCostUsd',0)
        alw[m]+=mv.get('allowanceUsd',0); chg[m]+=mv.get('costUsd',0)
print('savedAt', d.get('savedAt'), 'sessions', len(d['sessions']))
for m in sorted(req, key=lambda k: -alw[k]):
    print(f'{m:42s} {req[m]:6d} {chg[m]:9.4f} {alw[m]:11.6f} {lst[m]:11.6f}')
print('bySource coverage:', sum(sum((v.get('bySource') or {}).values()) for v in d['sessions'].values()),
      'of', sum(v.get('requests',0) for v in d['sessions'].values()), 'requests')
"

# the router's own routes (need the DSH web cookie → 401 without it)
curl -s -X POST -H 'content-type: application/json' -d '{}' \
  http://127.0.0.1:3080/api/local/opencode-v2/plan-usage     # → unauthorized
curl -s -X POST -H 'content-type: application/json' -d '{}' \
  http://127.0.0.1:3080/api/local/opencode-v2/model-settings  # → unauthorized
curl -s -X POST -H 'content-type: application/json' -d '{}' \
  http://127.0.0.1:3080/api/local/opencode-v2/cost/session    # → unauthorized

# the daemon's own usage-limit schema, from the installed binary's strings
strings -n 5 /home/minami/.bun/install/global/node_modules/@opencode/cli-linux-x64/bin/opencode \
  | grep -o 'UsageLimits\.[A-Za-z]*=\?[^;]\{0,200\}'
# → UsageLimits.Meter = {percent, limited, resetsAt}
#   UsageLimits.Go   = {rolling, weekly, monthly}
#   UsageLimits.Info = {workspace:{id,name,usageURL}, go, budgets}

# the console's own per-plan estimate table (documentation values, encoded in the web app)
curl -s https://opencode.ai/console/_build/assets/landing-go-allowance-BtnnnB5e.js \
  | grep -o '"[a-z0-9-]*":{go:\[[0-9,]*\],"go-plus":\[[0-9,]*\],"go-teams":\[[0-9,]*\]}'

# the docs source: the three per-plan monthly-limit tables (the rendered page only shows Go)
curl -sL https://raw.githubusercontent.com/anomalyco/opencode/dev/services/site/src/docs/content/console/go.mdx \
  | grep -n 'Monthly limit'          # → 3 tables (go / go-plus / go-teams), 40 rows each
```

### Sources

- [OpenCode Go (plans, usage limits, estimated requests, privacy)](https://opencode.ai/docs/console/go)
- [OpenCode Console models (Zen pay-as-you-go pricing, privacy)](https://opencode.ai/docs/console/models)
- [OpenCode Console billing (credits, Extra Usage, invoices)](https://opencode.ai/docs/console/billing)
- [OpenCode inference API (cost / billing_source / allowance / tokens)](https://opencode.ai/docs/console/api/inference)
- [OpenCode Console API overview (keys, permissions)](https://opencode.ai/docs/console/api/)
- Repo: `dsh-opencode-v2/lib/{http.js,plans.js,cost.js,cost-pill.js,client.js}`,
  `dsh-custom-router/lib/{client.src.js,presets.js,plan.js,usage.js,locale-table.js}`,
  `dsh-opencode-v2/docs/OPENCODE-V2-HTTP-API-MEASUREMENT.md`
