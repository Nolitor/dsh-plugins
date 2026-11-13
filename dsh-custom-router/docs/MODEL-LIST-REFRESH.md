# Custom Router — Model-List Refresh Contract

<!-- skeleton:
version: 0.0.1-rc.13
kind: spec
status: active
updated: 2026-11-13
summary: Normative refresh contract for the model-serving lists: the vendor `?refresh=1` cache bypass, the refresh button on both surfaces, and the single refresh bus that keeps the models tab and the dashboard in sync (host events included).
-->

> Status: **implemented and measured**, 2026-11-13, router `0.0.1-rc.13`.
> Owner instruction: 백엔드 `?refresh=1` 캐시 우회 + 대시보드/설정탭 전체 새로고침 버튼 + 양쪽
> 컴포넌트 이벤트 동기화 세 구조로 설계해서 바로 패치.
> Parent: [CUSTOM-ROUTER-ARCHITECTURE.md](./CUSTOM-ROUTER-ARCHITECTURE.md),
> [SHARED-STREAM-PIPE-SPEC.md](./SHARED-STREAM-PIPE-SPEC.md).

## 1. The defect this contract closes

Measured 2026-11-13 on the live source (`lib/client.js` and the three vendor libraries):

| Surface | Before |
|---|---|
| Models tab (`CustomRouterModels`) | One load at mount in `useEffect(..., [])`; no refetch path of any kind |
| Models tab event subscriptions | **Zero** — `inject` was `slots, locale, configForms`; `ctx.remote.$on` count 0 |
| Models tab timers / focus hooks | **Zero** — no `setInterval`, `setTimeout`, `visibilitychange`, `focus` |
| Models tab refresh control | **None** — the toolbar held search / select-all / clear only |
| Dashboard | had its own `refreshTick`; refreshed its own feeds only |
| Vendor routes | TTL caches with **no bypass**: antigravity 15 min, opencode 5 min, deepinfra 30 min |
| `?refresh=1` | existed only on `opencode plan-usage` and `ranking/refresh` |
| Dashboard header button | **broken**: `setReload(read)` passed `read` as a React updater, so the stored `reload` was `undefined` and every click threw `reload is not a function` |

Conclusion: there was **no refresh logic at all**, not a broken one. The only way the list ever
changed was a component remount (closing/reopening settings) or a client bundle HMR.

## 2. Structure 1 — backend cache bypass (`?refresh=1`)

Every vendor model route answers a fresh upstream read when the request carries `?refresh=1`,
and otherwise stays on its cache. The route carrier matches on **pathname only**
(`dsh-client-connection` `createSharedFetchHandler`), so a query string reaches the same handler.

| Route | Cache dropped on `?refresh=1` | Default TTL |
|---|---|---|
| `POST /api/local/dsh-antigravity/models` | `catalog.invalidate()` then `catalog.all()` | `catalogTtlMs` 900000 |
| `POST /api/local/opencode-v2/model-settings` | `await adapter.catalog.refresh()` | `discoveryCacheMs` 300000 |
| `POST /api/local/deepinfra/models` | `invalidateCatalog()` (`cache = undefined`) | `DEFAULT_CATALOG_TTL_MS` 1800000 |

Rules that hold for all three:

1. A **malformed request URL is a plain read**, never a 500 — the flag helper never throws.
2. A **failed forced probe does not fail the read** (opencode): the lifecycle keeps its last good
   snapshot and the panel renders those rows.
3. A **plain read never invalidates** — opening settings or re-rendering a card must not spend an
   upstream request.

## 3. Structure 2 — a refresh control on both surfaces

| Surface | Control | Behaviour |
|---|---|---|
| Models tab | toolbar button `data-action="refresh-models"` | publishes `{force: true}` |
| Dashboard | header button (existing, now working) | publishes `{force: true}` |

Both disable while a refresh is in flight and show the `refreshing` locale string. The models tab
keeps search / select-all / clear in the same toolbar; the refresh control is additive.

## 4. Structure 3 — one refresh bus

`onRefresh(listener)` / `requestRefresh({force})` are module-level and exported. Each surface
subscribes in its own effect and refreshes **itself**; neither surface owns the other.

| Producer | Payload | Why |
|---|---|---|
| Either refresh button | `{force: true}` | A press is the operator asking for a fresh upstream answer |
| Host event | `{force: false}` | Re-read what the vendor already revalidated; never spend an upstream request |

Host events wired into the bus (the same invalidations the standard Models settings section
treats as such): `llm/adapters-updated`, `llm/models-updated`, `settings/document-updated`,
`credentials/record-updated`, `credentials/reference-updated`.

`remote` is a **declared** inject: `['slots','locale','configForms','remote']`. Reading an
undeclared service on a real cordis context throws, so an undeclared read would leave every host
event unsubscribed while the unit suite stayed green.

## 5. Verification

### 5a. Live route measurement — `npm run verify:refresh` (2026-11-13)

An earlier revision of this document recorded the vendor bypass as verified on the strength of
**fixture** tests. The owner asked whether the real routes were ever exercised, and they were not:
a stub catalog cannot prove that a network fetch, a daemon probe or a durable cache file was
actually re-read. `scripts/verify-refresh-routes.mjs` now boots the real `web` profile into a
throwaway `DSH_HOME` (never the live home), mounts the router body, reads the host's own route
table, and calls each route twice — plain, then `?refresh=1`.

Measured result:

| Preset | Route | Plain | Forced | What it read |
|---|---|---|---|---|
| antigravity | `/api/local/dsh-antigravity/models` | 200, 10 grouped rows | 200, 10 rows | bases include **`gemini-4-hydrogen`** |
| opencode | `/api/local/opencode-v2/model-settings` | 200, 32 rows | 200, 32 rows | all 32 are `go`; **Hydrogen absent** (Zen route, `otherPlanCount: 26`) |
| deepinfra | `/api/local/deepinfra/models` | 200, 91 rows | 200, 91 rows | **8 discounted, 83 at list price** |

Three facts this settled that fixtures could not:

1. **Hydrogen reaches the Antigravity route.** Grouped bases:
   `gemini-3-flash, gemini-2.5-pro, gemini-3.8-flash, gemini-3.5-flash-lite, gemini-4-hydrogen,
   gemini-3.1-flash-lite, claude-sonnet-5-5, claude-opus-5-5, gpt-oss-120b, gemini-4-argon`.
2. **DeepInfra's promotion fix holds on the live payload.** 91 chat rows, exactly **8** carry a
   `promotion` object and 83 are `null`; the route's own `promotionCount` is 8. Before the client
   fix every one of those 83 rendered a `0%` badge.
3. **OpenCode's Hydrogen absence is a PLAN fact, not a catalog defect.** `activePlan: go`, 32 rows
   all `go`, `otherPlanCount: 26`. `opencode/gemini-4-hydrogen` is a **Zen** route, so no refresh
   can surface it while the tab is Go-scoped.

A mounted route is not a working route (F-45), so this gate calls the real handler and inspects the
real `Response`; it also prints the base ids it read, because "200 with rows" would still be true for
a catalog that silently omitted the model in question.

### 5b. Unit suite

`npm test` — 509 pass / 0 fail. Cases that prove each structure:

- mount load carries **no** `refresh=1`; one `requestRefresh({force:true})` issues exactly three
  forced `POST`s with body `{}` (one per preset);
- one `llm/models-updated` event re-reads three routes with **no** `refresh=1`;
- one announcement driven through both mounted surfaces refreshes the models tab **and** the
  dashboard feeds (the antigravity route is read once per surface, both forced);
- the dashboard header button publishes a forced refresh (and no longer throws);
- vendor units: `?refresh=1` invalidates once / a plain read invalidates zero times
  (antigravity, deepinfra); `?refresh=1` probes once / a plain read probes zero times, and a
  failing forced probe still answers 200 (opencode).

The client test harness was made faithful for this: `useEffect` is dependency-aware and two
surfaces get separate hook stores. Without that, a re-render re-issued every fetch and the suite
could not distinguish "one announcement = one refresh" from a render loop.

## 6. What a refresh can and cannot change (measured 2026-11-13)

A refresh re-reads the vendor's **own upstream**; it cannot invent a model the account does not
serve. Measured after the owner reported "안티그래비티 탭에 하이드로겐 모델이 없다":

| Question | Measurement |
|---|---|
| Is `gemini-4-hydrogen` an Antigravity model? | **Yes.** `gemini-4-hydrogen-{low,medium,high,xhigh}`. It is ALSO an OpenCode catalog route (`opencode/gemini-4-hydrogen`, Zen plan) — both facts hold. An earlier revision of this table said "No", because of the host error below |
| Does the Antigravity upstream serve it? | **Yes, on the daily host.** `daily-cloudcode-pa` returns 31 models with all four Hydrogen levels; `cloudcode-pa` returns 26 with none. The "no" in the earlier revision came from probing `cloudcode-pa` only |
| What does Antigravity actually serve? | **on the daily host**: 31 ids → 23 conversation models grouped as gemini-4-hydrogen (4 efforts), gemini-4-argon (3), gemini-3.8-flash (3), gemini-3.5-flash-lite (3), gemini-3-flash, gemini-3.1-flash-lite, gemini-2.5-pro, claude-sonnet-5-5 (3), claude-opus-5-5 (3), gpt-oss-120b. **On the control host: 26 ids and no Hydrogen** — which is why the first measurement of this document missed it |
| Does the OpenCode list update? | **Yes.** `opencode-models.json` = 58 probed rows including hydrogen and carbon; `?refresh=1` calls `CatalogLifecycle.refresh()` |

## 6a. Reasoning efforts: one category, a level list (F-40)

Antigravity serves effort as **separate model ids**, not a request field. The contract
(F-40 in `docs/FAILURE-LEDGER.md`, restated in
[CUSTOM-ROUTER-PROTOCOL-STANDARD.md](./CUSTOM-ROUTER-PROTOCOL-STANDARD.md) §4.1) is that the
suffixed ids are grouped into **one base model** and the suffixes are exposed as
`reasoning.efforts`, with `modelForEffort()` reversing the mapping on the way out.

Measured 2026-11-13, `gemini-4-hydrogen`:

| Level | Wire id |
|---|---|
| low | `gemini-4-hydrogen-low` |
| medium | `gemini-4-hydrogen-medium` |
| high | `gemini-4-hydrogen-high` |
| **xhigh** | `gemini-4-hydrogen-xhigh` |

The picker therefore shows ONE `Gemini 4 Hydrogen` row and a reasoning selector listing four
levels. Two defects stood between the account and that contract, and both were mine to fix:

1. **The level table only knew three entries.** `EFFORT_ORDER = ['low','medium','high']` made
   `indexOf('xhigh')` return `-1`, which sorted the highest level *before* `low`, and the display
   name was never trimmed (the row read `Gemini 4 Hydrogen (XHigh)` instead of grouping as
   `Gemini 4 Hydrogen`). Both lists now cover `minimal/none/low/medium/high/xhigh/maximal/max`.
2. **The reverse mapping folded xhigh onto high unconditionally.**
   `modelForEffort()` did `effort === 'xhigh' || effort === 'max' ? 'high' : effort`. That was
   correct only while no account served an `xhigh` id; on Hydrogen it meant **picking XHigh sent
   High** — a control accepted but not honoured, the exact failure F-40 records. It now collapses
   only when the catalog does not carry the exact level, so a three-level account keeps the old
   safe behaviour and Hydrogen round-trips.

## 6b. Promotion display (a defect found by the same live check)

`promoPercentOf(price)` is the single authority for "does this row have a discount". A row badges
exactly when the value is a finite number **> 0**. Before 2026-11-13 the computation was
`Number.isFinite(Number(price.promoPercent))`, and `Number(null) === 0` is finite, so every
full-price row rendered `0% 할인` and the footer counted all of them. Live: 91 chat rows, 8 real
discounts, 168/177 catalog entries with no discount at all.

## 7. What a refresh still does NOT fix

Measured 2026-11-13, recorded so a future session does not read a refresh as a cure-all:

| Symptom | Cause | A refresh cannot help because |
|---|---|---|
| A model missing from the **prompt** picker while the **tab** shows it | the saved `enabledModels` allow-list excludes it (`catalog.list()` filters, `catalog.all()` does not) | the filter applies after the read; selecting and saving is the fix |
| OpenCode Hydrogen missing | `opencode/gemini-4-hydrogen` is a **Zen** route and `activePlan` is `go` | the plan gate applies before the allow-list |
| A preset with no tab and no usage card | never added to `MODEL_PRESETS` / `fetchUsageFeeds` | nothing enumerates presets automatically — see [PRESET-REGISTRY-STANDARD.md](./PRESET-REGISTRY-STANDARD.md) |

## 8. Status

`applied pending restart` — the rebuilt `lib/client.js` and the three vendor libraries are on
disk; `dsh-web.service` serves the previous build until restarted (owner action). The live
measurement in §5a ran against an **isolated** profile, so it proves the code, not the running
service.

## 9. References

- [PRESET-REGISTRY-STANDARD.md](./PRESET-REGISTRY-STANDARD.md) — the five places a new preset touches
- [CUSTOM-ROUTER-ARCHITECTURE.md](./CUSTOM-ROUTER-ARCHITECTURE.md)
- [SHARED-STREAM-PIPE-SPEC.md](./SHARED-STREAM-PIPE-SPEC.md)
- [../CHANGELOG.md](../CHANGELOG.md) — `0.0.1-rc.13`
