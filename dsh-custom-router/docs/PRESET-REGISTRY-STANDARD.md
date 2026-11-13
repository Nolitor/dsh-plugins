# Custom Router — Adding a Model-Serving Preset

<!-- skeleton:
version: 0.0.1-rc.13
kind: spec
status: active
updated: 2026-11-13
summary: The five places a new model-serving preset must be registered today, why three of them are still manual (measured 2026-11-13), the exact drift each one causes when forgotten, and the normative descriptor contract a future registry must satisfy so a preset is added in one place.
-->

> Status: **measured registry audit**, 2026-11-13, router `0.0.1-rc.13`.
> Owner question that produced this document: 프리셋이 계속 추가될텐데 3개만 업데이트되고 신규로
> 추가되는 프리셋은 업데이트 또 별도로 해야하나? 그것도 규격화해야 하지 않아?
> Answer: **yes, five places today, and three of them fail silently.** §3 is the normative
> contract; §4 is the ordered plan. Parent:
> [CUSTOM-ROUTER-PRESET-SURFACE.md](./CUSTOM-ROUTER-PRESET-SURFACE.md),
> [MODEL-LIST-REFRESH.md](./MODEL-LIST-REFRESH.md).

## 1. The two registries (both exist today, neither derives from the other)

| Registry | File | Answers | Shape |
|---|---|---|---|
| Backend `PRESETS` | `lib/presets.js` | *what gets mounted* — package, loader rows, provider id, endpoint, auth, catalog layers, surfaces | frozen declaration objects |
| Browser `MODEL_PRESETS` | `lib/client.src.js` | *what the settings page renders* — tab id, label key, owning row, catalog route, `load()`, `saveValue()` | frozen descriptor objects |

They are joined only by **id** and by a unit test
(`test/inventory-metadata.test.mjs`, "the model-serving tabs map onto the three presets"), which
asserts that every `MODEL_PRESETS` id exists in `PRESETS` and that its `row` is one the preset
declares. That test catches a **typo or a missing descriptor**, and nothing else — it cannot notice
a *new* preset that was never added to either place.

## 2. Measured: adding one preset touches five places

Verified by reading every consumer of both registries (`grep -rn "MODEL_PRESETS\|PRESETS"` across
`lib/`, `test/`, `scripts/`), 2026-11-13:

| # | Place | What must be added | If forgotten |
|---|---|---|---|
| 1 | `lib/presets.js` → `PRESETS` | the whole declaration | the preset cannot be mounted; `planApplications()` reports an unknown preset |
| 2 | `lib/client.src.js` → `MODEL_PRESETS` | the UI descriptor (`id`, `labelKey`, `row`, `route`, `load`) | **silently no tab** — the settings page renders `MODEL_PRESETS.map(...)`, so a missing entry is simply absent, with no error anywhere |
| 3 | `lib/client.src.js` → `fetchUsageFeeds` | one hardcoded job in a literal array | **silently no usage card** — the dashboard shows the other presets and never says one is missing |
| 4 | `test/inventory-metadata.test.mjs:151` | the expected id array `['antigravity','opencode','deepinfra']` | the suite fails, which is the desired behaviour, but only after the change |
| 5 | `locale/en.json`, `locale/ko.json`, `locale/zh.json` + `node scripts/gen-locale.mjs` | the `labelKey` string in every locale | the tab renders the raw key (`vendorNewThing`) via the `t()` fallback |

Two of these (`#2`, `#3`) fail **without any signal**. That is the real defect: a new preset looks
configured and is simply never shown.

### 2a. Why `fetchUsageFeeds` is the worst of the five

```js
// lib/client.src.js — measured shape, before any standardisation
const jobs = [
  (async () => ['antigravity', normalizeAntigravityUsage(await postUsageRoute(doFetch, '/api/local/dsh-antigravity/models', options))])(),
  (async () => { /* opencode: plan-usage + model-settings */ })(),
  (async () => ['deepinfra', normalizeDeepinfraUsage(await postUsageRoute(doFetch, '/api/local/deepinfra/cost/summary', options))])(),
]
```

Three separate vendors, three different route shapes, one literal array. A fourth preset gets no
dashboard card and no warning. The same literal also decides **which routes a refresh touches**, so
a new preset is also invisible to the refresh contract in
[MODEL-LIST-REFRESH.md](./MODEL-LIST-REFRESH.md).

## 3. Normative descriptor contract (what the standardised registry must carry)

A preset that appears in the settings page, the dashboard and the refresh bus must be expressible as
**one** descriptor satisfying all of the following. These are the fields the three current presets
already need; the work in §4 is to move them into a single source and derive the rest.

| Field | Meaning | Consumer that needs it |
|---|---|---|
| `id` | stable preset id; the join key between registries | both registries, `planApplications()` |
| `row` | the loader row whose config carries `enabledModels` | the save path (`form.mutate(['vendorConfig', row, 'enabledModels'])`) |
| `catalogRoute` | local panel route that lists the catalog | settings tab load, refresh bus |
| `usageRoutes` | **an ordered list** of `{ path, normalize }`, not one call site | dashboard cards, refresh bus |
| `load(payload)` | route payload → `{ groups }` | settings tab |
| `saveValue(selected, groups)` | selection → `enabledModels` value | save path (default: flattened variants) |
| `labelKey` | locale key for the tab and card | `locale/*.json` |
| `metered` | pay-per-token (price block, promo count) | settings tab |
| `renderRowExtras(row, ctx)` | optional trailing cell | settings tab |

The rule this contract encodes: **a preset declares its routes; nothing enumerates presets by hand.**
Anything that today writes a literal list of preset ids (`fetchUsageFeeds`, the test's expected
array) must instead iterate the registry.

## 4. Ordered plan (not performed in rc.13 — recorded as work)

The owner chose to record the design now and defer the change. The steps, in dependency order:

1. **Add `usageRoutes` to all three presets** in `lib/presets.js` (an ordered list, each entry
   `{ path, normalize }`). No behaviour change yet.
2. **Expose the registry to the browser.** The client bundle cannot import `presets.js` (it is
   evaluated as a plain script), so the descriptor must arrive over the host seam the way
   `customRouter` already does (`ctx.provide('customRouter', ...)`), or be generated into
   `lib/client.js` by `scripts/build-client.mjs` alongside the locale table.
3. **Derive `MODEL_PRESETS`** from that single source inside `client.src.js`; keep `MODEL_PRESETS`
   as the exported view so existing tests and the rendered tree do not change shape.
4. **Rewrite `fetchUsageFeeds`** as `for (const preset of MODEL_PRESETS) for (const route of preset.usageRoutes)`;
   the existing per-vendor `normalize*` functions stay, they simply become descriptor values.
5. **Replace the test's literal id array** with `PRESETS.map(p => p.id)`, so a new preset updates
   the expectation automatically instead of failing a correct change.
6. **Add a drift gate** that fails when a `PRESETS` id has no `MODEL_PRESETS` descriptor and when a
   descriptor has no `usageRoutes`. That is the check that would have caught both silent failures.

## 5. Interim rule until step 6 lands

Anyone adding a preset must touch all five places in §2 and say so in the track CHANGELOG. The
existing pair test catches only #1/#2 id drift; #3 needs a manual check against this document.

## 6. Verification

- The registry audit in §2 is reproducible: `grep -rn "MODEL_PRESETS\|PRESETS" lib test scripts`.
- `npm run verify:refresh` (new) boots an isolated profile and calls every mounted model route
  twice; it reports the preset ids it reached, so a preset missing from the refresh path is visible.
