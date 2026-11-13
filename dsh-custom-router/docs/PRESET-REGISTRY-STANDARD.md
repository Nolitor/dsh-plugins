# Custom Router — Adding a Model-Serving Preset

<!-- skeleton:
version: 0.0.1-rc.15
kind: spec
status: active
updated: 2026-11-14
summary: The preset registry is derived and its drift gate is implemented; the only hand-authored dashboard residual is ROUTER_PROVIDERS/PICKER_ITEMS (ROADMAP P2-1). Records the places a new model-serving preset touches, the exact drift each causes when forgotten, the normative descriptor contract, and the two-part drift gate that enforces it — a static registry diff (presets × descriptors × locales × artefacts) plus the isolated runtime boot — with a mutation harness that proves each drift class is rejected (17/17).
-->

> **PARTIALLY SUPERSEDED (2026-11-14).** The browser registry is now derived
> (`lib/preset-derive.js`, `lib/client.src.js:2010`) and the drift gate is implemented; the
> “two registries / five places” model below is historical. The only hand-authored parts left are
> `ROUTER_PROVIDERS` (`lib/client.src.js:395`) / `PICKER_ITEMS` (`lib/client.src.js:478`), tracked
> as [ROADMAP.md](./ROADMAP.md) P2-1. Mutation gate re-measured 2026-11-14: **17/17**.

> **Historical status (2026-11-14).** The registry is derived (`preset-derive` + `sync-derive`)
> and the drift gate is implemented; all §4 steps are done or superseded. The only remaining
> hand-authored part is the dashboard `ROUTER_PROVIDERS`/`PICKER_ITEMS` pair, tracked in
> [ROADMAP.md](./ROADMAP.md) P2-1.

## 1. The two registries (both exist today, neither derives from the other)

| Registry | File | Answers | Shape |
|---|---|---|---|
| Backend `PRESETS` | `lib/presets.js` | *what gets mounted* — package, loader rows, provider id, endpoint, auth, catalog layers, surfaces | frozen declaration objects |
| Browser `MODEL_PRESETS` | `lib/client.src.js` | *what the settings page renders* — tab id, label key, owning row, catalog route, `load()`, `saveValue()` | frozen descriptor objects |

They are joined only by **id**. As of rc.14 the join is enforced by the drift gate in §5 —
`checkPresetRegistry()` plus `test/preset-drift.test.mjs` — rather than by the single unit test that
used to be the whole guard. That earlier test
(`test/inventory-metadata.test.mjs`, "the model-serving tabs map onto the three presets") caught a
**typo or a missing descriptor** and nothing else: it could not notice a *new* preset that was never
added to either place, nor a preset with no usage route. Both of those are now rejected (measured
2026-11-14: `npm run verify:presets:mutation` → **17/17**).

## 2. Measured: adding one preset touches five places (historical)

> **Historical table (2026-11-14).** Rows 2 and 3 describe the pre-derivation state and no longer
> exist as hand-edit sites: `MODEL_PRESETS` is derived at `lib/client.src.js:2010` and
> `fetchUsageFeeds` iterates the registry. Kept as the record of *why* the gate exists.

Verified by reading every consumer of both registries (`grep -rn "MODEL_PRESETS\|PRESETS"` across
`lib/`, `test/`, `scripts/`), 2026-11-13:

| # | Place | What must be added | If forgotten |
|---|---|---|---|
| 1 | `lib/presets.js` → `PRESETS` | the whole declaration | the preset cannot be mounted; `planApplications()` reports an unknown preset |
| 2 | `lib/client.src.js` → `MODEL_PRESETS` | *(no longer hand-edited)* — derived by `deriveModelPresets(PRESET_DECLARATIONS)` | **silently no tab** was the old failure; the derivation removes the site |
| 3 | `lib/client.src.js` → `fetchUsageFeeds` | *(no longer a literal array)* — iterates `MODEL_PRESETS[].usageRoutes` | **silently no usage card** was the old failure; fixed |
| 4 | `test/inventory-metadata.test.mjs:151` | the expected id array `['antigravity','opencode','deepinfra']` | the suite fails, which is the desired behaviour, but only after the change. **Fixed:** the expectation is derived from `PRESETS` |
| 5 | `locale/en.json`, `locale/ko.json`, `locale/zh.json` + `node scripts/gen-locale.mjs` | the `labelKey` string in every locale | the tab renders the raw key (`vendorNewThing`) via the `t()` fallback |

Two of these (`#2`, `#3`) fail **without any signal**. That is the real defect: a new preset looks
configured and is simply never shown — it is why the static gate in §5 targets exactly those two
rather than the runtime half, which was already strict about #1.

### 2a. Why `fetchUsageFeeds` was the worst of the five

```js
// lib/client.src.js — measured shape, before any standardisation
const jobs = [
  (async () => ['antigravity', normalizeAntigravityUsage(await postUsageRoute(doFetch, '/api/local/dsh-antigravity/models', options))])(),
  (async () => { /* opencode: plan-usage + model-settings */ })(),
  (async () => ['deepinfra', normalizeDeepinfraUsage(await postUsageRoute(doFetch, '/api/local/deepinfra/cost/summary', options))])(),
]
```

Three separate vendors, three different route shapes, one literal array (this is the **rc.13
shape, kept as the record of the defect** — rc.14 deletes it). A fourth preset got no dashboard
card and no warning. The same literal also decides **which routes a refresh touches**, so
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

## 4. Ordered plan — status

Steps in dependency order. The state column was re-measured 2026-11-14 at router `0.0.1-rc.19`;
it records what the tree does now, not an intention. This plan is closed — any new work belongs in
[ROADMAP.md](./ROADMAP.md), not here.

| # | Step | State |
|---|---|---|
| 1 | `usageRoutes` on every preset in `lib/presets.js` (ordered `{ path, normalize }`) | **done** — one route per preset (opencode 2, where order is the contract); `normalize` is a *reader name* because the backend graph cannot carry browser code |
| 2 | Expose the registry to the browser over the host seam | **done** — `lib/index.js` publishes `presetSettings` |
| 3 | Derive `MODEL_PRESETS` from that single source | **done** — `lib/client.src.js:2010` `deriveModelPresets(PRESET_DECLARATIONS)`; `lib/preset-derive.js` owns the derivation |
| 4 | `fetchUsageFeeds` iterates the registry | **done** — no literal preset list remains; readers are selected by the declared name |
| 5 | Replace the literal id array in the test | **done** — `test/inventory-metadata.test.mjs` compares against `PRESETS.map(p => p.id)` |
| 6 | Drift gate for descriptor↔preset and `usageRoutes` | **done** — §5 |

**The only hand-authored preset surface left** is the dashboard pair `ROUTER_PROVIDERS`
(`lib/client.src.js:395`) and `PICKER_ITEMS` (`lib/client.src.js:478`), which are still literal
arrays. That residual is tracked as [ROADMAP.md](./ROADMAP.md) P2-1; it is not a second registry,
because the drift gate rejects disagreement with the derived descriptors.

## 5. The gate (implemented)

Two halves, one command. The split matters: the silent failures live in the browser half, which a
Cordis runtime cannot see.

| Half | Module | Covers |
|---|---|---|
| **static** | `lib/preset-drift.js` → `checkPresetRegistry()` | `PRESETS` × `MODEL_PRESETS` × `locale/*.json`, plus `checkGeneratedArtifacts()` for stale `client.js`/`locale-table.js` |
| **runtime** | `scripts/verify-presets.mjs` (isolated boot) | providers, tools, commands, switch fields against the live registries |

`npm run verify:presets` runs both. `npm run verify:presets:static` runs the static half alone
(no boot, ~100 ms) — useful in a tight loop.

### 5.1 What the static half rejects

Each row is one line of §2's "if forgotten" column, now mechanical:

| Check | Failure it prevents |
|---|---|
| a `PRESETS` id with no descriptor | **silent: no settings tab** (§2 #2) |
| a descriptor with no `PRESETS` entry | a tab writing a row nothing mounts |
| descriptor `row` ∉ the preset's declared rows | the save lands in a vendor row nobody mounts |
| no `usageRoutes` on a usage-reporting preset | **silent: no dashboard card** (§2 #3) |
| usage/catalog route outside `/api/local/` | an upstream URL POSTed with the operator's credentials |
| `labelKey`/`planKey` missing from any locale | the raw key rendered via the `t()` fallback (§2 #5) |
| `load`/optional hooks not callable | a tab that throws on open |
| duplicate descriptor ids | the second tab silently wins |
| `metered` disagreeing with `usage.billing.mode` | a price block on a subscription, or a missing one on a metered preset |
| stale `client.js` / `locale-table.js` | every static check passing against code the page never runs |

A preset that reports no plan (`plan: 'unavailable'` + `billing.mode: 'none'`, e.g. the
`local-hub` declaration example) is the **only** legitimate absence of usage routes.

### 5.2 Proof that the gate bites — the mutation harness

A gate nobody has seen fail is a claim. `scripts/verify-presets-mutation.mjs` injects each drift
class into an in-memory copy of both registries and asserts the gate rejects it — the registries on
disk are never touched.

```bash
npm run verify:presets:mutation   # 17/17 drift classes caught, exit 1 on any survivor
```

Measured 2026-11-14 at router `0.0.1-rc.19`: **17/17 caught** (M1–M13 descriptor/registry cases,
F1–F4 derivation cases). The harness has grown since the first version; M10 (`metered: true` on a
subscription preset) initially **survived**, which is why the billing cross-check in §5.1 exists —
the harness found a real gap in the first version of the gate. A new drift class is added here
*first*; a check without a mutation case is a claim without evidence.

### 5.3 What a green report does not mean

The static half prints its blind spots under `not checked here:` on every green run, deliberately
(BLUEPRINT §13.0 — a green report must never imply "not checked"):

- runtime registration needs the isolated boot;
- the rendered element tree and real vendor payloads are covered by `test/client.test.mjs`, not by a
  registry diff.

## 6. Checklist — adding a preset

Mechanical, in order. Steps 1–4 are enforced by `verify:presets`; 5–6 are not.

1. **`lib/presets.js`** — add the declaration, including `usage.routes` (ordered `{ path, normalize }`).
2. **`lib/client.src.js`** — add the `MODEL_PRESETS` descriptor with `usageRoutes` and a reader in
   `USAGE_READERS`; keep `row` one the preset declares.
3. **`locale/{en,ko,zh}.json`** — add `labelKey` and `planKey` to **all three**; the parity gate in
   `gen-locale.mjs` refuses a half-translated table.
4. **`npm run build`** — regenerate `locale-table.js` and `client.js`; the artefact check fails on a
   stale bundle.
5. **`test/inventory-metadata.test.mjs`** — nothing to edit (the id list is derived); add a case only
   for preset-specific behaviour.
6. **`CHANGELOG.md`** — record the five places in the track history (RULES §6.1).

Then: `npm run verify:presets && npm run verify:presets:mutation && npm test`.

## 7. Verification

```bash
npm run verify:presets            # static + isolated runtime boot
npm run verify:presets:static     # registry diff only, no boot
npm run verify:presets:mutation   # proves each drift class is rejected
npm run verify:refresh            # calls every mounted model route twice, reports reached ids
```

The §2 audit is reproducible with `grep -rn "MODEL_PRESETS\|PRESETS" lib test scripts`.
