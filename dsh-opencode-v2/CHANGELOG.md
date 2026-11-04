# Changelog — @nolit/dsh-opencode-v2

<!-- skeleton:
version: 1.0
kind: report
status: active
updated: 2026-11-05
summary: Engineering history for @nolit/dsh-opencode-v2. The subagent delegation provider was merged in from @nolit/dsh-subagent-opencode 0.1.0 on 2026-11-05.
-->

Current version: `0.0.2-rc.1`

## Subagent merge — 2026-11-05

`@nolit/dsh-subagent-opencode` 0.1.0 merged into this package as `lib/subagent.js`.
One install now carries every OpenCode surface:

| Surface | Registration | Switch |
| :--- | :--- | :--- |
| `opencode` delegation tool + `/ocode` | `ctx.tools` / `ctx.commands` | always (existing) |
| `cli_worker` | `ctx.tools` | `workerEnabled` |
| `opencode-http-agent` route | `ctx.llm.registerAdapter` | existing |
| `subagent_opencode` provider | `ctx.subagents.registerProvider` | **`subagent`** (new) |

**Duplicate-provider guard.** The old package registers `opencode` on `ctx.subagents` too; this
plugin now calls `getProvider(name)` first and yields with a warning rather than shadowing it.

**Not changed:** the existing route, command, tool, HTTP adapter and worker behaviour. The 406
pre-existing tests still pass unmodified; 5 new tests cover the merged provider.

# Changelog — @nolit/dsh-opencode-v2

<!-- skeleton:
version: 1.1
kind: report
status: active
updated: 2026-11-04
summary: Engineering history for @nolit/dsh-opencode-v2, moved out of README.md so the README can serve as an operator manual. Every entry records what was measured, what changed, and what stayed unchanged; per-round proof lives in VERIFICATION.md and VERIFICATION-ARCHIVE.md.
-->

## Documentation alignment (2026-11-04)

**No code changed in this package.** This entry records a documentation-only alignment made while
building `dsh-deepinfra`, so the two tracks state the same host contracts in the same terms.

### Added

- **`ARCHITECTURE.md`** — the document this track was missing. It records, for both halves:
  - the **control plane vs serving plane** split (local `opencode serve` for catalog/provider/
    credential only; `POST {baseURL}/chat/completions` for generation), and the forbidden
    `POST /api/session/{id}/prompt` path;
  - credential resolution order (explicit → `/api/provider/{id}` + `/api/credential`), with the
    `credentialCacheMs` window and the single forced refresh on 401;
  - module ownership (`request-guards`, `stream-parser`, `upstream-map`, `display-gate`,
    `cost`, `usage-ledger`, `catalog-cache`, `plans`, `conflicts`);
  - the shared boundary rule: **a delta's type comes from the wire field, never its characters**;
  - the slot contract (`InputActivityOwnerProps`, release expansion on unmount, provider-id-only
    gating, and why `conversation.input.model.label` must not be used);
  - the ledger path and the "unpriced ≠ free" rule;
  - an explicit statement of why DeepInfra is a separate package.

### Clarified — the service-declaration difference between the two tracks

This package declares five services (`llm, subprocess, sessions, connection, settings`) because the
control plane genuinely needs all of them. `dsh-deepinfra` declares only `['llm']` and mounts the
web surfaces through `ctx.inject([...])`.

Both are correct, and the rule that reconciles them is now written down in both ARCHITECTURE docs:

> Declare a service when the plugin cannot serve **any** surface without it; otherwise read it
> optionally so a profile that lacks it still boots.

Measured evidence for the rule, from building `dsh-deepinfra`: declaring a web-only service made a
**headless** profile log `pending (waiting for service: connection)` and then
`NO_ADAPTER: no adapter registered`, i.e. the model route was gated by a UI dependency.

### Cross-reference

The config-layer credential pattern (a `.volatile()` + `role('secret')` field written through
`settings.update()`, with the patch default left empty so the saved value wins) is documented in
`dsh-deepinfra/ARCHITECTURE.md` §3. This package already uses `.volatile()` on all of its fields,
which is why its settings writes were never affected by the defect recorded there.

> Per-round proof, measurements and failure ledger entries live in
> [VERIFICATION.md](VERIFICATION.md) and [VERIFICATION-ARCHIVE.md](VERIFICATION-ARCHIVE.md).
> This file records **what changed and why**, in the order the owner instructed it.

## 0.0.2-rc.1 — the beta package is gone; the pill is event-driven (2026-11-04)

Owner instruction, verbatim intent: two plugin cards with the same name cannot be told apart;
stages 2 and 3 are unreachable while stage 1 keeps emitting bugs; delete the beta package,
fix on `0.0.2.rc3` and up, and build the later stages on a stabilised version.

| Field | Value |
|---|---|
| `package.json` / load beacon | `0.0.2-rc.1` (was `0.0.2`) |
| Beta package | **removed** — `dsh-opencode-v2-beta/` deleted, artifact deleted, ledger row dropped |
| Tests | 403 (was 417; the 14 exclusion/beta tests went with the package) |
| Artifact | `artifacts/nolit-dsh-opencode-v2-0.0.2-rc.1.tgz` |

### 0.0.2-rc.1.1 Why the beta package was a mistake, measured

| Observation | Measurement |
|---|---|
| The two cards were indistinguishable | The beta package shipped **no** `locale/*.json`; the plugin manager falls back to `pkg.meta?.title === undefined ? pkg.name`, so its card rendered as the bare specifier `@nolit/dsh-opencode-v2-beta` next to `Opencode v2 Agent`. |
| It could never run beside the stable package | Both register `opencode` tool, `/opencode`, `/ocode`, `cli_worker` and the `opencode-http-agent` route. The mutual-exclusion claim existed precisely because coexistence is broken. |
| It shipped nothing that served a model | It mounted, self-checked, and stood down. It was a test fixture packaged as a plugin. |

Removing it also removed the whole claim-file subsystem (`lib/exclusion.js`, `exclusionStatePath`,
the beta dependency in three test files). The `conflictPolicy` guard stays: it handles a legacy
`opencode-go`/`opencode` provider, which is a real third-party collision.

### 0.0.2-rc.1.2 The cost pill is event-driven

Owner instruction: "1초 폴링 대신 MutationObserver나 모델 변경 이벤트 리스너로".

- `watchRoute()` observes the composer chip's `data-provider-id` / `data-model-id` attributes
  with a `MutationObserver` (childList + attributes, filtered to those two names) and fires only
  when the pair actually changes. A 1 s interval queried the DOM forever on every page.
- The mount-time read is explicit: the chip does not exist yet when the slot mounts, so the
  effect reads the route once and then relies on the observer. Measured without it: the pill
  stayed hidden until the operator switched models.
- Cost refresh follows activity: opening the route reads once, a composer/session mutation
  schedules one debounced read (400 ms), and a 15 s tick remains as a floor for an idle page.

**Verified live** (playwright, route attribute rewritten and restored):

| step | route | pills |
|---|---|---|
| 1 | `opencode-http-agent/opencode-go/deepseek-v4.1-flash` | `$0.58…` |
| 2 | `deepseek-account/deepseek-flash` (after 1.2 s) | **none** |
| 3 | back on our route (after 1.2 s) | `$0.58…` |

`ROUTE_POLL_MS` is gone from the served bundle (verified by fetching it from the running
service: 0 occurrences, `watchRoute` present).

### 0.0.2-rc.1.3 The pill matched a MODEL PREFIX, so other routers still showed it (2026-11-04)

Owner report after the previous fix: "오픈코드 v2 서빙된 모델이 아닌 다른 라우터에서 부른 모델인데 왜
이렇게 모델 서빙 옆에 붙냐 ... 이거 버그라고".

**Cause.** `usingOwnRoute()` accepted `provider === 'opencode-http-agent'` **or** any model id
matching `/^opencode(-go)?\//`. The model id comes from OpenCode's CATALOG, not from this
adapter, so every router that resells `opencode-go/*` ids matched it. Reproduced against the
predicate directly:

| provider | model | before | after |
|---|---|---|---|
| `opencode-http-agent` | `opencode-go/deepseek-v4.1-flash` | SHOWED | SHOWED |
| `subrouter` | `opencode-go/deepseek-v4.1-flash` | **SHOWED** | hidden |
| `deepseek-account` | `opencode-go/deepseek-v4.1-flash` | **SHOWED** | hidden |
| `opencode-zen`, `opencodeai`, `my-opencode-agent` | any | SHOWED/hidden by accident | hidden |

**Fix.** Only the PROVIDER id decides, and the accepted set is the ids this package actually
registers: `lib/http.js` registers `opencode-http-agent`, `lib/provider.js` registers
`opencode-agent`. The model id is read only to prove the node is a route chip; it is never
matched.

**Verified live** on the running service (fresh token; the earlier attempt silently measured an
expired-token page that had no composer at all — recorded so the evidence is not over-read):

| step | route | pill |
|---|---|---|
| 1 | `opencode-http-agent/opencode-go/deepseek-v4.1-flash` | `$0.67…` |
| 2 | `subrouter/opencode-go/deepseek-v4.1-flash` | **none** (was the leak) |
| 3 | `deepseek-account/opencode-go/deepseek-v4.1-flash` | **none** |
| 4 | back to ours | `$0.67…` |

**Regression gate.** `test/cost-pill-gate.test.mjs` now derives the accepted ids from the
bundle's own `OWN_PROVIDER_IDS` declaration, asserts a foreign router serving an
`opencode-go/` id is hidden, and fails if the gate consults the model id at all.

### 0.0.2-rc.1.4 Stage plan written; the staging code is preserved as source (2026-11-04)

Owner instruction: plan the beta work properly and make stages 2 and 3 reachable **after
stabilisation**, not instead of it.

- [docs/OPENCODE-V2-STAGE-PLAN.md](../docs/OPENCODE-V2-STAGE-PLAN.md) defines stage 1 exit
  criteria S1–S7, the stage-2 acceptance gates S2-1…S2-5, the stage-3 gates S3-1…S3-4, the
  three adversarial inputs that must round-trip, and the rule that only an owner instruction
  opens a stage.
- `scripts/opencode-v2-stabilisation-status.sh` turns S1–S5 and S7 into a command. It prints
  PASS/FAIL/UNKNOWN per criterion and exits non-zero unless every machine-decidable one
  passes. S6 (soak) always prints UNKNOWN: it is owner-reported, and it is the criterion the
  `0.0.2` release skipped.
- `scripts/opencode-v2-browser-boot.mjs` is the S5 probe (real shell boot, not a route probe).
- The deleted beta package's parser work was recovered from git into `staging/`, which is
  **source, not a plugin**: no package.json, no mount, no `npm pack` entry. `scripts/doc-index.mjs`
  skips it so it cannot pollute the documentation index.

Measured when this was written (`--boot --browser`): S1 PASS, S2 PASS (`0.0.2-rc.1`),
S3 PASS (401 tests), S4 PASS (isolated boot, 0 activation warnings), S5 PASS (shell renders,
own client entry present, no page errors), S7 PASS. S6 UNKNOWN — the soak has not happened.

### 0.0.2-rc.1.5 The composer slot has a contract the pill was ignoring (2026-11-04)

Owner pointed at `docs/upgrade-guide/v0.2.2-alpha.3/chat-process-activity-context` and asked whether
the context was designed for the current version. Checking that guide led to the slot contract
the pill is registered under.

**First, the version question.** The guide sits under `v0.2.2-alpha.3/` in master, but the
`dsh-v0.2.2-alpha.3` **tag does not contain it**, and the tag's source has no `context` member:

| Source | `ProcessActivity` union | `RunningProcessActivity` |
|---|---|---|
| installed `0.2.2-alpha.3` | 13 members, no `context` | absent |
| tag `dsh-v0.2.2-alpha.3` | 13 members, no `context` | absent |
| master (`0.2.2-rc.1`) | 14 members, includes `context` | `Exclude<ProcessActivity,'context'>` |

So the guide documents a change that ships in a LATER release; the installed host does not have
it. **This plugin is unaffected**: `lib/client.js` contains zero references to
`ProcessActivity`/`processActivity` and registers no process-activity UI.

**What the check did find — a real gap in this plugin.** The pill occupies
`conversation.input.activity`, whose installed contract is:

```ts
interface InputActivityOwnerProps extends InputControlOwnerProps {
  onActiveChange: (active: boolean) => void
}
// "A toolbar activity hides ordinary accessory controls while expanded; its
//  occupant must release expansion on unmount."
```

`CostPill()` took no props and never called `onActiveChange`. Because the pill returns
`null` when another provider is selected, an unreleased expansion could outlive the
chip and leave the composer hiding the model selector and other accessory controls.

Fixed: the component now accepts props, reports `onActiveChange(false)` on mount and on
unmount, and does nothing when the host passes no props. It never reports `true` — this
occupant is a fixed-size chip that never needs the expanded toolbar.

`test/slot-contract.test.mjs` pins all four facts, and separately records that the
`settings.section` registration correctly ignores `SettingsSectionOwnerProps.close`
(that prop is for a section that navigates the operator elsewhere; this one does not).

Tests: 406 pass. Live re-check after repacking: pill shows on our route, is absent for
`subrouter` and `deepseek-account` even when they serve an `opencode-go/` model id, and
returns on our route.

### 0.0.2-rc.1.6 Documentation policy: history lives in this directory (2026-11-04)

Owner instruction: "각 플러그인에 작업 히스토리 안쌓아? 매번 부트카드와 에이전트에만 쌓아두는거야? …
에이전트 규정과 부트카드는 내 작업 미이행 내역이나 내가 기억을 놓칠만한것만 기록하게 하고".

| Change | Where |
|---|---|
| Plugin history is authoritative in `dsh-<track>/CHANGELOG.md` + `VERIFICATION.md` | `docs/RULES.md` §6.1 |
| Boot cards and `AGENTS.md` are narrowed to **owner memory only** (unfinished asks, open decisions, state to remember) | `docs/RULES.md` §6.1, `docs/BOOTCARD-POLICY.md` |
| New upstream version → acquire the exact tag, diff it, write a per-surface verdict | `docs/RULES.md` §6.2, this file |
| The comparison record for this plugin | [UPSTREAM-COMPAT.md](UPSTREAM-COMPAT.md) |

Why: the same compatibility question was answered twice in this session, the second time by
citing a master-only upgrade guide that does not exist at the installed tag. Without a written
per-surface record, "no problem found" is indistinguishable from "nothing was checked".

## 0.0.2 — Tier A guards, beta track split, verified prerequisites (2026-11-04)

Owner instruction: version to `0.0.2`, beta to `0.0.2-beta.1`, beta stabilises through
`0.0.2-beta.N` and becomes `0.0.3`, at which point `0.0.2` is the lower version.

| Field | Value |
|---|---|
| `package.json` | `0.0.2` (was `0.0.1-rc.10`) |
| `lib/http.js` load-beacon `VERSION` | `0.0.2` |
| beta package | `@nolit/dsh-opencode-v2-beta` `0.0.2-beta.1` — **removed in `0.0.2-rc.1`**, see above |
| Tests | 402 stable (was 359), 12 beta |
| Artifacts | `artifacts/nolit-dsh-opencode-v2-0.0.2.tgz` (sha256 `395267f1…`), `artifacts/nolit-dsh-opencode-v2-0.0.2-beta.1.tgz` (sha256 `60165f6f…`) |
| Packing | `scripts/pack-opencode-v2.sh` — see the artifact naming rule below |

**Artifact naming rule (owner instruction, 2026-11-04).** The PACKAGE keeps `-beta`
in its name (that identity is what the peer dependency and the exclusion claim
reference), but the ARTIFACT does not repeat the word: `npm pack` names a tarball
`<name without scope>-<version>.tgz`, which produced
`nolit-dsh-opencode-v2-beta-0.0.2-beta.1.tgz` — "beta" twice. Artifacts are
named `nolit-dsh-opencode-v2-<version>.tgz` and built through
`scripts/pack-opencode-v2.sh`, which renames after packing and rewrites the
`artifacts/SHA256SUMS.opencode-v2` rows against the final name.

### 0.0.2.1 Hotfix — the exclusion guard killed the entry it was protecting (2026-11-04)

Owner report, immediately after the 0.0.2 restart: "플러그인 2개가 안올라왔어 하나는 오류이고".

Measured from the journal of the new pid 1694267:

```
dsh: warning: 1 entry did not activate
dsh-opencode-v2-http (@nolit/dsh-opencode-v2/http): Error: cannot get property "tools" without inject
    at new apply (.../dsh-opencode-v2/lib/http.js:2262:81)
```

**Cause.** cordis proxies `ctx` and THROWS on reading a service the plugin did not declare in
`inject`. The `dsh-opencode-v2-http` entry declares
`['llm','subprocess','sessions','connection','settings']`, and the new mutual-exclusion guard
read `ctx?.tools`. Optional chaining does not help — the throw happens on the property read
itself — so `apply()` aborted, the model route never registered, and the whole row was dropped.

**Why the suite missed it.** Every test built `ctx` as a plain object, where `ctx.tools` is
simply `undefined`. A plain object cannot reproduce a throwing proxy, so 402 tests passed while
the production mount failed. The beta entry had the same defect (`inject = []`, reading
`ctx.llm` and `ctx.tools`) and would have failed the moment it was mounted.

**Fix.** `lib/optional-service.js` — `optionalService(ctx, name)` reads a service and treats a
rejected read as "not observable". Both entries use it for every service they do not declare.

**Regression gates added (three layers, because one was not enough):**

1. `test/optional-service.test.mjs` — the helper against a throwing proxy.
2. `test/apply-cordis.test.mjs` — mounts both entries on a cordis-like proxy and on the REAL
   `@deepseek-ai/cordis` Context, asserting `apply()` does not throw and the provider registers.
3. `test/service-inject-gate.test.mjs` — reads the SOURCE and fails if any entry module reads an
   undeclared service directly instead of through the helper.

**Verified by a real isolated boot** (copied profile, `DSH_HOME` under `/tmp`, port 0):
`did not activate` count 0, load beacon `{"version":"0.0.2","event":"load"}`.

**Artifact note.** The first `0.0.2` tarball never mounted, so it is replaced in place rather
than given a new version (the release itself was never usable). `SHA256SUMS.opencode-v2` carries
the replaced hash history for it; no version number was invented.

### 0.0.2.2 Cost pill was rendered for every provider (2026-11-04)

Owner report: "오픈코드 v2 플러그인 모델이 아닌 다른 모델을 사용해도 모델 서빙 오른쪽에 붙은 저게
무료로 바뀌고 오픈코드를 불러오는 구조던데, 오픈코드 모델이 아닌 다른 api나 dsh 자체 모델에서는
아예 감춰져야 하는거 아닌가?" — measured true.

**Cause.** The pill exists in two generations of code. The old DOM painter
(`paintCostPill`) checks `usingOwnRoute()` and removes itself on a foreign route. The
React slot component (`CostPill`, registered at `conversation.input.activity`) replaced
that path and did **not** carry the check — it rendered for every provider, polled
`cost/session` every 15 s, fell back to the locale's zero label ("무료") when the session
had no OpenCode cost, and its click opened the OpenCode plan panel from a model this
plugin does not serve.

**Fix.** The component now applies the same single gate:

- `usingOwnRoute()` is polled every second (the slot does not remount when the operator
  switches models), so the chip appears only on `opencode-http-agent` / `opencode*` routes;
- on any other route it returns **null** — no seat, no cost request, no plan panel;
- returning null (not an empty chip) is what makes it disappear without shifting the
  host's own pills.

**Verified live** (playwright against the running service, route attribute rewritten to a
foreign model and back):

| step | route | pills rendered |
|---|---|---|
| 1 | `opencode-http-agent/opencode-go/deepseek-v4.1-flash` | `$0.42…` |
| 2 | `deepseek-account/deepseek-flash` | **none** |
| 3 | back to `opencode-http-agent/…` | `$0.42…` |

**Regression gate.** `test/cost-pill-gate.test.mjs` pins the rule at the source level:
the gate reads the provider/model attributes, the component consults it before rendering,
it renders nothing on a foreign route, it does not poll cost there, and exactly one
function decides ownership so the two paths cannot drift again.

### 0.0.2.3 Request guards (Tier A) — deepseek-recipe rules applied

- `max_tokens` is clamped to `min(reservation, contextWindow - promptTokens)`, floored at 1.
  A prompt that cannot fit is refused as `OPENCODE_CONTEXT_OVERFLOW` **before upload**.
  Basis: recipe `ConversationRequest::resolve_max_tokens`; measured on this profile, 3,140
  recorded requests carried more than 120k prompt characters and none was checked.
- Full upstream `finish_reason` mapping. `content_filter`, `insufficient_system_resource` and
  any unknown reason are now `error` with their own codes instead of a silent `stop`.
- Pre-flight tool validation: non-empty name, at most 128 bytes, `^[a-zA-Z0-9_-]+$`,
  uniqueness, and `parameters` must be a JSON object. Stop lists: at most 16, none empty.
  Basis: recipe `protocol/validation.rs`.
- Reasoning-token accounting: absence of `completion_tokens_details.reasoning_tokens` is
  recorded on the trace finish line and warned once per stream. The host's `TokenUsage` has
  no field for an absence, so the trace carries it.
- Prompt tokens are ESTIMATED at 3.5 chars/token (conservative end of the measured range).
  An exact count needs `deepseek-recipe-encoding` and is deliberately not a dependency.

### 0.0.2.4 Beta track `@nolit/dsh-opencode-v2-beta` (Tier B and C)

- Canonical DeepSeek V4/V4.1 token table extracted from recipe by code point. A hand-typed
  draft was wrong in five of eighteen entries; every entry is now asserted in a test.
- Staged protocol parser modelled on recipe's `OutputParser`. Two defects were found and
  fixed by measurement during the port: a hold-back limited to the token spelling loses the
  opener at one-code-unit chunking, and eating a partial closer destroys the block terminator.
- Conformance corpus (7 cases, each naming its recipe source) plus a re-chunking oracle
  (300 splits invariant).

### 0.0.2.5 Mutual exclusion (both packages, mandatory)

Both packages register `opencode-http-agent`, the `opencode` tool and the same commands, so
only one may be active per profile. One implementation (`lib/exclusion.js`) serves both:
a mount-time claim at `$DSH_HOME/cache/opencode-claim.json` (stale pid taken over) and a
runtime live-sibling check. Measured end to end: the second activation is refused and names
the owner, pid and timestamp.

Two defects were found while wiring it, both by measurement rather than review:

- The first runtime check read `llm.adapters()`, which this host does not provide — a guard
  that could never fire. The real surface is `llm.listProviders()` (`dsh-llm` `LlmRuntime`).
- The corrected check then treated the SHARED provider id as proof of a sibling, so it stood
  down on its own registration and silenced the pre-existing `already registered by another
  instance` warning (caught by `conflicts.test.mjs`). Both packages register
  `opencode-http-agent`, so that id can never name an owner: ownership belongs to the claim
  file, and the runtime check only reports a *foreign* provider id or the shared tool name.

### 0.0.2.6 Documentation

README gained `## Prerequisites (measured 2026-11-04)` — OpenCode v2.2.0 install shape, web
auth and token storage (`~/.local/share/opencode/auth.json`, mode 0644, integration ids that
differ from the route id, oauth-before-key selection), and PATH resolution with a five-step
validation ladder. Also `## Request guards` and `## Mutual exclusion`.

### 0.0.2.7 What did NOT change

- The stable parse path. The regex classifier still serves; the canonical parser lives in the
  beta package and is not on the stream path.
- No runtime dependency on deepseek-recipe: the repository has no Node binding (measured),
  so adoption is a Rust or Python sidecar. Four specs and one test oracle were copied instead.
- `turnMaxTokens` stays 16384. The clamp changes the value only when the window is tighter.

## 0. Version — 0.0.1 baseline, 0.0.1-rc.9 on instruction

| Field | Value |
|---|---|
| `package.json` | `0.0.1-rc.9` (was `0.0.1-rc.8`, which was `0.0.1-rc.7`, which was `0.0.1-rc.6`, which was `0.0.1-rc.5`, which was `0.0.1-rc.4`, which was `0.0.1-rc.3`, which was `0.0.1-rc.2`, which was `0.0.1-rc.1`, which was `0.0.1`) |
| `lib/http.js` load-beacon `VERSION` | `0.0.1-rc.9` (was `0.0.1-rc.8`, which was `0.0.1-rc.7`, which was `0.0.1-rc.6`, which was `0.0.1-rc.5`, which was `0.0.1-rc.4`, which was `0.0.1-rc.3`, which was `0.0.1-rc.2`, which was `0.0.1-rc.1`, which was `0.0.1`) |
| Versions self-bumped in this history | 26 (`0.1.1` … `0.9.0`) |
| `0.0.1-rc.1` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.1.tgz` — sha256 `64be56cd99543754caadcc5459b983c597ac53f226cdd145ded4ab7d99a3fc16` |
| `0.0.1-rc.2` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.2.tgz` — sha256 `29260240b776708a524e90c5e6b4071557beeb9f6b18908c4ad09befda85e8e3` |
| `0.0.1-rc.3` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.3.tgz` — sha256 `54e7b84380cf9373d991ce4f4ddc2fdd67987831a42865c3d2a5eadd9542f32b` |
| `0.0.1-rc.4` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.4.tgz` — sha256 `19212774f7f4fc8d001e980e3d9c25509510c54804670b4480f2f41cb3693be1` |
| `0.0.1-rc.5` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.5.tgz` — sha256 `970e0c70cefc4ebcb0ce3dc767dc824939f6a6ea3e14f1807ea9124ed8fa7609` |
| `0.0.1-rc.6` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.6.tgz` — sha256 `b95379ad0f13b78699fa8a4b526ca586fc0ad2d945628d487bea0e24d311b1b9` |
| `0.0.1-rc.7` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.7.tgz` — sha256 `79e6ddf7d0fa7e640654783b7fd243d8a36295c68ebd07747530790322a2d442` |
| `0.0.1-rc.8` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.8.tgz` — sha256 `a417272025669427fd7bdcb4f114a4092ba188c55212782cf1451b66c5d63ac1` |
| `0.0.1-rc.9` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.9.tgz` — sha256 `46b95607e34a6916cc34c3f23c4eb1c3f66cc391f84904c1ed5a3873b1b270f9` |

> Per-artifact hashes for releases after `0.0.1-rc.10` live in `artifacts/SHA256SUMS.opencode-v2`
> (outside the tarball) and in `VERIFICATION.md`; a hash row inside `CHANGELOG.md` would change the
> hash of the artifact that contains it.

The owner reset the number and forbade further self-bumps: **the version changes again only on an
explicit owner instruction, and then only as `0.0.1.rc<N>`** (packaged as `0.0.1-rc.<N>`). A release,
a fix round or a green test run is not an instruction. The load-beacon constant is part of the
release, not a log decoration. The `0.0.1` baseline stays the reset; the line advances one
release-candidate step per instructed fix round and nowhere else.

Eight instructed fix rounds have moved the line so far: `0.0.1` → `0.0.1-rc.1` (argument
accumulation, §0.1), `0.0.1-rc.1` → `0.0.1-rc.2` (shape-based marker classification, §0.2),
`0.0.1-rc.2` → `0.0.1-rc.3` (stream-safe recognition at chunk boundaries, §0.3),
`0.0.1-rc.3` → `0.0.1-rc.4` (protocol tokens are a delimiter family, not a DSML family, §0.4),
`0.0.1-rc.4` → `0.0.1-rc.5` (real-traffic trace instead of synthetic probes, §0.5),
`0.0.1-rc.5` → `0.0.1-rc.6` (the system prompt actually reaches the model, §0.6) and
`0.0.1-rc.6` → `0.0.1-rc.7` (a call in the reasoning channel is promoted, not dropped, §0.7),
`0.0.1-rc.7` → `0.0.1-rc.8` (assistant history is prose only, §0.8) and
`0.0.1-rc.8` → `0.0.1-rc.9` (the per-turn reservation is separated from the route capability, §0.9).
None of those numbers came from a green suite or a defect found on our own; each was the one RC
step the owner's instruction allowed.

### 0.1 `0.0.1-rc.1` — what changed and why

`0.0.1-rc.1` is **a fix of `0.0.1`, not a new architecture**: the top state machine and the bottom
parser/screen gate are unchanged; two argument-boundary defects found in live traffic are fixed.

The defect report is session `2dc3531f-1b50-406e-bacc-9ce73345e193` (`opencode-go/deepseek-v4.1-flash`,
workspace `total_skill`, 2026-11-01 06:58–07:41 KST):

| Measure | Value |
|---|---|
| tool calls in the session | **80** |
| failed in the host with `Error: invalid arguments: "arguments" must be an object` (`ToolArgsError INVALID_ARGS`) | **30** |
| bare JSON tool payloads shown as prose | **4** |

Root causes and fixes:

| # | Cause | Fix |
|---|---|---|
| 1 | the route **re-sends the whole arguments object as a second delta** instead of a fragment; the adapter appended it, so the host received two concatenated JSON objects (`{"code":…}{"code":…}`) and `JSON.parse` failed — hence "must be an object". 24 of the 30 second copies were exact duplicates, 6 restated the call with changed content, and 3 of those copies arrived wrapped as `{"arguments":"<json>"}`. | new `lib/arguments.js`: `normalizeArguments(raw, schema)` parses one-or-more complete JSON snapshots, unwraps the `{"arguments": …}` form, and picks the **last snapshot that fits the declared tool's parameter schema** (keys within `properties`, all `required` present); without a schema it keeps the last complete snapshot. `lib/http.js` applies it when a tool-call block closes (normal and cut paths) and when the gate compares against structured calls. Unparsable arguments pass through unchanged so the host still reports them — nothing is silently rewritten. |
| 2 | after the dispatch error the model re-typed the call as a bare JSON object inside `content` (no marker). The 0.9.0/0.0.1 gate recognized only `[tool call …]`, DSML and thinking notation, so those payloads were displayed as prose. | a held JSON probe in `lib/http.js`: when the visible text of a response **begins** with `{` or a fenced block, it is held until it parses, the tool is inferred by schema (`inferToolFromArguments`), and if exactly one declared tool fits it is promoted to a real tool-call part and never shown. If nothing matches, the held text is released unchanged; JSON inside prose is never probed. |

Gate rule added: when **every** structured call of that name has unusable arguments, the body payload
is promoted as its replacement (the wire call could not execute anyway); otherwise the existing
echo / superseded / undeclared rules apply.

Measured after the fix:

| Measure | Before | After |
|---|---|---|
| corpus: 267 `opencode-route` sessions, 16,709 tool calls — invalid arguments | 44 | **0** |
| snapshot modes in that corpus | — | valid 16,665 / duplicate 32 / restated 12 |
| bare JSON text payloads (corpus) | 4 | 4 matched to a declared tool, **0 displayed** |
| reported session `2dc3531f` — invalid arguments | 30 | **0** |
| reported session — bare JSON payloads displayed as prose | 4 | **0** (4 matched to `run_code`) |

Details and the before/after tables: `VERIFICATION.md` §40.

**Status: applied on disk, pending restart.** The running service (`pid 2199391`, started
2026-11-01 06:52:39 KST) still serves `0.0.1`; the `0.0.1-rc.1` source is on disk and is **not live**.

### 0.2 `0.0.1-rc.2` — the marker family was a literal list; classification is now by shape

The owner reported that his turns looked "forcibly cut" and that more errors appeared, again
pointing at session `2dc3531f-1b50-406e-bacc-9ce73345e193`. Measured, that report contains two
different things and neither is an rc.1 regression:

| Window in that session | Measured outcome |
|---|---|
| `0.0.1` (before the 07:54–07:56 KST restart) | 30 `ToolArgsError INVALID_ARGS`, all timestamped 06:58–07:41 KST |
| `0.0.1-rc.1` (after the restart) | 3 turns, 11 tool calls, **0 tool errors**, every `turn/end` `completed` |

So rc.1 added no errors there. What did change is a **new, corrupted notation family** the route/model
began writing into `content`: the classifier recognized it in none of its forms, so the intended call
never reached the parser and the model's own text says "continuing from where it was cut". Measured
shapes: `<tool_call #call_00_…>`, `<tool call run_code #code_placeholder_001>`, closer-shaped
parameter openers `</│DSML│ parameter name="code">…</│DSML│>`, doubled pipes
`</｜｜DSML｜｜ parameter>`, a bare `</│DSML│>`, `<│DSML│parameter name="description">…</│DSML│>`,
and the mixed `<tool call run_code #id]: {json}`.

Replayed through the **rc.1** classifier those payloads yield **0 calls promoted and 0 characters
removed** — the notation was displayed verbatim. That is the "cut": the call was never executed.

`0.0.1-rc.2` keeps the same state machine and makes the top classifier tolerant:

| Piece | Behaviour |
|---|---|
| marker head | recognized in any bracket style, `^[<\[]\s*tool[ _-]?call\b` — `[tool call …`, `<tool_call …`, `<tool-call …` |
| call name | taken from a declared tool name in the head, from `name="…"`, or **inferred from the parameter schema** (`inferToolFromArguments`) when the head cannot name it |
| call id | from `#id` or `id="…"` |
| payload | a JSON object found after the head, **or** parameter tags closed by whatever closer the model invented — a parameter opener may even be written as a closer. Block terminators require `invoke`/`calls`/`tool_calls`, so a bare closer stays a parameter closer |
| pipe glyphs | `｜`, `│` and `\|` in any 1–2 repeats, doubled included |
| screen | `scrub` removes model-written tool/parameter tags and DSML tokens, so no marker reaches the screen |
| bottom gate | de-duplicates by **call id**, so the same call restated with drifted arguments is promoted once |

Measured across all `opencode-route` sessions:

| Measure | Before `0.0.1-rc.2` | After |
|---|---|---|
| assistant messages whose text contained protocol notation | 333 | 333 (same corpus) |
| strict screen leaks (line-start marker, DSML token, parameter tag) | 301 | **4** — all 4 are prose quoting the notation inside backticks |
| looser "any mention" count | 333 | **49** — all prose |
| calls promoted from those payloads | 0 | **24** |
| duplicate restatements dropped | 0 | **209** |

In the reported session: the marker-only payload is dropped with no call (there is no payload to
execute), the mixed payload becomes **1 call** with the correct id and JSON arguments and **0
characters shown**, and the 6,427-character final payload collapses to **2 distinct calls** after
id de-duplication.

**Status at the time: applied on disk, pending restart.** The service was restarted afterwards;
later measurement shows serving `pid 2325852` runs `0.0.1-rc.2`, and `0.0.1-rc.3` supersedes it
on disk only. No mount is claimed. Detail: `VERIFICATION.md` §41, ledger F-29.

### 0.3 `0.0.1-rc.3` — the classifier was tested on whole strings; a stream splits the marker

The owner was right that work continued after every update: the calls executed, but the marker was
also printed. Measured on rc.2 (serving `pid 2325852`, 09:22–09:31 KST), turn 16 of session
`2dc3531f-1b50-406e-bacc-9ce73345e193` still showed the marker on screen — steps 3, 4 and 6 printed
`<tool call run_code #call_00_…]: {json}`, and step 8 printed a bare code body (the
`<parameter name="code">` opener removed, the value kept). **3 of the 6** assistant messages in
that turn leaked; the turn still completed because the wire call was present.

Root cause: the classifier recognised the marker **only when the whole marker was in the buffer**. A
real SSE stream splits it, so `<tool ca` was emitted as prose before it could be recognised; the
remainder no longer sat at a line start, so the marker never opened. Replaying the same text as one
string hid the bug (**0 leaks**); replaying it one character at a time reproduced it (**4 of 6
messages**). That is why rc.2 looked fixed in tests and still failed live.

`0.0.1-rc.3` keeps the parser and the gate and fixes recognition at chunk boundaries:

| # | Mitigation |
|---|---|
| a | bounded hold of a trailing fragment that could still become a marker (`<tool ca`, `<tool`, `[`+tool…), a DSML tag (`</｜DSML｜ calls>`, `<｜DSML｜ invoke name="bash">`, `</│DSML│`, doubled pipes, attribute quotes) or a parameter tag (`<parameter`, `<│DSML│parameter`) |
| b | a new `PARAM_BODY` state drops a standalone parameter tag and its value |
| c | scrub removes orphan DSML tokens whose `<` was consumed in an earlier chunk |
| d | the same hold applies to piped and attribute-bearing tokens |

Measured under worst-case chunking — each of **3,689** assistant text messages across all
`opencode-route` sessions fed **one character at a time**:

| Measure | rc.2 baseline | rc.3 |
|---|---|---|
| strict screen leaks (line-start marker, DSML token, parameter tag) | **42** | **3** — all 3 are prose that quotes the notation inside backticks |
| whole-string feeding, strict leaks | **4** | **3** (same prose) |
| calls promoted from body payloads | — | **28** |
| turn 16, one character at a time | **4/6 messages leaked** | **0/6** leaked, calls still promoted |

The earlier rc.2 corpus figures (301 -> 4) were measured with **whole-string** feeding. They are not
a chunked measurement and are not repeated here as one.

Tests: `npm test` **286/286**, `npm run check` exit 0. New regressions cover a marker split into
single characters, a standalone parameter tag split across deltas, a DSML opener with attributes
split across deltas, and every two-way split of a mixed payload leaving no marker on screen.

**Status at the time: applied on disk, pending restart.** Serving `pid 2325852` ran `0.0.1-rc.2`;
the `0.0.1-rc.3` source was on disk only. The owner restarted onto rc.3 afterwards (serving
`pid 2339788`, 09:42:39 KST); `0.0.1-rc.4` (§0.4) now supersedes it on disk only. No mount is
claimed. Detail: `VERIFICATION.md` §42, ledger F-30.

### 0.4 `0.0.1-rc.4` — not every protocol token is DSML; scrub by delimiter shape

The owner restarted onto rc.3 (serving `pid 2339788`, 09:42:39 KST) and ran **nine more turns**
(17-25). Tool errors: **none**. Two messages still showed protocol tokens, and **neither was
DSML**: turn 18 step 6 printed `<｜End of thought｜>`, and turn 20 step 3 printed `<｜thought>` and
`</thought>`.

Root cause: the scrub recognised only **DSML-shaped** tokens (`｜DSML｜`) and only
think/thinking/analysis wrappers. The model also writes other pipe-wrapped tokens
(`<｜thought>`, `<｜End of thought｜>`) and a `thought` wrapper, so those fell through.

`0.0.1-rc.4` fixes the family, not the instances:

| # | Mitigation |
|---|---|
| a | a generic protocol-token scrub removes **any** `<｜…｜>` / `<│…│>` token regardless of its text |
| b | `thought` is accepted as a thinking wrapper (`<thought>` opens reasoning, `</thought>` closes it) alongside think/thinking/analysis, and both are stripped from prose |
| c | the chunk-boundary prefix hold now accepts **any** character inside a pending `<…` fragment, so a split token cannot leak |

Measured under worst-case chunking — every assistant text message across all `opencode-route`
sessions fed **one character at a time**:

| Measure | rc.2 | rc.3 | rc.4 |
|---|---|---|---|
| strict screen leaks, one character at a time | **42** | **3** | **1** — a false positive of the measurement regex (a pair of markdown pipes, not notation) |
| body calls promoted | — | **28** | **28** |

Whole-string feeding: **4 → 1**. Prose identity: **2,728** messages without notation stay
byte-identical. Latest traffic: the **33** assistant messages since rc.3 (turns 17-25) contain
**1** regex false positive and **no real notation**. Replaying the two live shapes through rc.4 —
turn 18 step 6 (`<｜End of thought｜>`) and turn 20 step 3 (`<｜thought>` / `</thought>`) — leaves
**no residue**; both are clean, including the single-sided `<｜thought>` form. Corpus worst-case
chunking stays at the same **1** regex false positive.

Tests: `npm test` **286/286**, `npm run check` exit 0. Artifact
`artifacts/nolit-dsh-opencode-v2-0.0.1-rc.4.tgz`, sha256
`19212774f7f4fc8d001e980e3d9c25509510c54804670b4480f2f41cb3693be1`.

**Status: applied on disk, pending restart.** Serving `pid 2339788` runs `0.0.1-rc.3`; the
`0.0.1-rc.4` source is on disk only. No mount is claimed. Detail: `VERIFICATION.md` §43, ledger F-31.

### 0.5 `0.0.1-rc.5` — a probe cannot reproduce the leak, so rc.5 traces real traffic

`0.0.1-rc.5` is an **evidence round, not a new classifier**: the parser, the gate, the
argument normaliser and the chunk-boundary hold are the rc.4 code. What changed is how the
defect is measured.

#### The owner's objection to the synthetic A/B

The A/B was replayed to test whether request **headers** cause the leak, and the owner rejected it
as evidence: a short synthetic prompt makes the model produce almost no reasoning and almost no
text, so **there is nothing to leak**. The leak needs long, multi-turn, output-heavy work; a probe
neither reproduces the volume nor the context. Re-running those long turns as probes would burn
the owner's quota for a result that is still synthetic.

The A/B is therefore kept only as a **negative result** — headers are not the cause:

| Variant (same endpoint `https://opencode.ai/inference/go/openai/v1/chat/completions`) | Result |
|---|---|
| `x-opencode-session` header on vs off | same structured `tool_calls`, **zero** content markers; without the header the endpoint answers **HTTP 400**, so the header is required and is already sent |
| directory + client headers | **zero** content markers |
| non-stream request | **zero** content markers |
| `tool_choice: required` + `parallel_tool_calls: false` | **zero** content markers |
| the above in combination | **zero** content markers |
| 38 tools declared | **zero** content markers |
| long system prompt | **zero** content markers |
| markup-primed history | **zero** content markers |

Run on both `beam-free` and `deepseek-v4.1-flash`: every variant returned structured
`tool_calls`, and none put protocol notation into `content`. So the six header/shape variants are
ruled out, and the cause has to be found in **real** long turns.

#### The real-traffic trace — `lib/trace.js`

The adapter now records what real work already produces. Per request it writes only the **shape**,
never the body:

| Record | Fields |
|---|---|
| `request` | model, message count, context chars, tools count, `hasSystem`, stream, maxTokens, toolChoice, effort, session id |
| `delta` | written **only when protocol notation is detected**: field (content / reasoning / tool-call), length, marker flag, and an excerpt of at most **400** characters |
| `finish` | counts by field, content/reasoning chars, blocks, tool-call count |
| `error` | the transport detail (truncated) and the retry counters |

- Path: `/tmp/opencode-v2-trace.jsonl` (override with `OPENCODE_V2_TRACE=<path>`).
- Kill switch: `OPENCODE_V2_TRACE=0` disables it entirely.
- Cap: appends stop at **8 MB**, so a forgotten trace cannot fill the disk.
- Privacy: **no prompt text, no message bodies, no credentials** — counts, flags and a bounded
  marker excerpt only.

#### What the first real trace showed — the system prompt was sent as a user message

The owner ran five real turns on rc.5 (process **2397320**, `deepseek-v4.1-flash`). The trace
recorded **29** requests; **17** of them (**58.6%**) carried protocol notation in streamed deltas —
**34** marker deltas in `content` and **1** in `reasoning`. The request shape was the same every
time: 559-580 messages, ~1.07-1.10 million context characters, tools=1, max_tokens 384000,
effort high — and **hasSystem=false on 29 of 29** requests.

That last flag was not a trace bug. DSH's loop-built history carries the system prompt as a
**leading message with role `system`** (`dsh-llm` `types.d.ts` documents this), but
`dsh-opencode-v2` mapped every role it did not name to `user`. The whole system prompt therefore
went to the model as a user message and the model ran without its system instructions — a real
adapter defect that no unit fixture had exercised, found by reading the shape of real traffic.
§0.6 fixes it.

#### What the rc.6 trace showed — the calls were in the reasoning channel

After rc.6 the owner restarted (serving **pid 2422772**) and reported that the visible markup was
gone, but that tool calls often failed and the model frequently just sat there ("spacing out").
The trace of **155** real requests on `deepseek-v4.1-flash` shows both halves:

| Measure | Value |
|---|---|
| traced requests | **155** |
| `hasSystem` | **true — 155 of 155** (the rc.6 fix, verified) |
| ended with structured `tool_calls` | **138** |
| ended with `stop` | **10** |
| no finish record | **7** |
| requests still carrying protocol notation in a streamed delta | **56** (**36.1%**) |

and the notation had moved channel: it is now mostly in the **reasoning** stream — for example
`</thinking>\n[tool call` and `</|DSML| parameter>`, plus one runaway request with **7,275**
marker deltas in reasoning. That is the stall: the adapter classified only the **content** channel
for body calls; reasoning was merely stripped of think tokens, so a tool call the model wrote into
`reasoning_content` was never promoted — the step produced no tool call at all and the turn
looked stalled. §0.7 fixes it.
#### The analyser — `scripts/analyze-opencode-trace.mjs`

`node scripts/analyze-opencode-trace.mjs [trace] [--pid <pid>] [--since <iso>]` lists **every
process** in the trace with its request count, leaking count and largest context, then reports the
leak rate **by tool count, by context chars, by system-prompt presence and by model**, plus the
first leaking excerpts. It defaults to the **busiest** process; `--pid` selects another and
`--since` cuts the trace at a timestamp. Unit-test processes also write trace lines (they run the
same adapter), so to isolate real traffic pick the process with the **largest `maxChars`** — that
is the turn the owner actually ran. Until real long work produces a hit it prints
**"no leaking request in this trace yet"**; it does not invent a number.

Tests: `test/trace.test.mjs` (**5** tests) pins the kill switch, one compact line per record, the
bounded excerpt, that no prompt body is copied, and the marker-family recognition.
`npm test` **291/291** in rc.5, **293/293** in rc.6, **295/295** in rc.7; `npm run check` exit 0
throughout.
Artifact for the rc.5 evidence round: `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.5.tgz`, sha256
`970e0c70cefc4ebcb0ce3dc767dc824939f6a6ea3e14f1807ea9124ed8fa7609`.

**Status: applied on disk, pending restart.** No live verdict about the leak is claimed in rc.5;
the trace exists so that the next real occurrence is analysable instead of argued about. Detail:
`VERIFICATION.md` §44, ledger F-32; the defect the trace exposed is §0.6 below, ledger F-33.

### 0.6 `0.0.1-rc.6` — the system prompt was sent as a user message, so the model ran without instructions

rc.5's trace did its job. The owner ran five real turns on rc.5 and reported a large improvement,
but the trace still showed new artifacts and remaining issues — and it exposed a defect the
parser work had hidden: on **29 of 29** real requests `hasSystem` was **false**.

DSH's loop-built history puts the system prompt in a **leading message whose role is `system`**
(`dsh-llm` `types.d.ts` documents that shape). The adapter mapped `assistant`, `tool` and
`developer` and fell through to `user` for everything else — including `system`. The entire
system prompt was therefore sent as a **user message**: the model never saw its system
instructions, and the leak rate measured on that traffic (17 of 29 requests, 58.6%) is the rate of
a model running off-format. No unit fixture had covered the leading system message; the trace
did.

`0.0.1-rc.6` makes the request faithful to the host's own types:

| # | Fix | Behaviour |
|---|---|---|
| a | `system` role | `message.role === 'system'` now maps to the OpenAI `system` role; `developer` still maps to `system` |
| b | empty tool result | an empty tool result is still sent **with its `tool_call_id`** — the previous `append()` dropped empty content and could mis-assign the id |

Both are covered by new tests: a leading system-role message keeps the system slot, and an empty
tool result keeps its call id.

| Check | Result |
|---|---|
| `npm test` | **293/293 pass**, 0 fail (291 before; the two role/tool tests are new) |
| `npm run check` | exit 0 |
| artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.6.tgz` |
| sha256 | `b95379ad0f13b78699fa8a4b526ca586fc0ad2d945628d487bea0e24d311b1b9` |

The trace stays on: the system-prompt flag is now expected to read `true` on the next real
traffic, and the leak rate is re-read from the same trace after the restart (`--pid` selects the
serving process, `--since` a window).

**Status: applied on disk, pending restart.** The defect was confirmed on real traffic and fixed
in the request builder; no mount is claimed here. Detail: `VERIFICATION.md` §45, ledger F-33.

### 0.7 `0.0.1-rc.7` — a tool call written into reasoning is promoted, not dropped

The rc.6 traffic made the remaining failure precise. Of the 155 traced requests, **138** ended with
structured `tool_calls`, **10** with `stop` and **7** had no finish record; **56 (36.1%)** still
carried protocol notation, and now almost all of it was in the **reasoning** channel. When the
model writes its call there, the old adapter stripped the wrapper tokens from reasoning for the
screen and kept only the prose — the call itself was dropped. The step had no tool call to execute,
so the turn sat until it ended: the "spacing out" the owner saw.

Replaying the owner's two sessions through the rc.7 classifier (`c889802e`, `ec259449`):

| Session | Assistant messages with markers in reasoning | Calls recovered | No-wire-call steps recovered |
|---|---|---|---|
| `ec259449` | **30** | **21** | **3** of 6 |
| `c889802e` | **3** | 0 | 0 |

`0.0.1-rc.7` feeds the reasoning channel through the **same** classifier as content:

| # | Piece | Behaviour |
|---|---|---|
| a | reasoning classification | reasoning text goes through a classifier instance identical to the content one, so a body call written in `reasoning_content` is recognised |
| b | prose stays reasoning | text without a marker is emitted as a `reasoning-delta` unchanged |
| c | recovered call | a recovered call is queued for the **parser** channel with `source: 'text'`, so the bottom gate promotes or discards it by the usual rules |
| d | wrapper tokens | `<thinking>` / `</thinking>` and the pipe-wrapped protocol tokens are still stripped; the marker never reaches the screen |
| e | state reset | the reasoning classifier is a **second instance** and is reset together with the content classifier and the gate between retries |

Two new end-to-end tests cover the fix: a tool call written into `reasoning_content` is promoted
and the marker does not reach the screen, and reasoning prose without a marker stays reasoning.

| Check | Result |
|---|---|
| `npm test` | **295/295 pass**, 0 fail (293 before; **2** new) |
| `npm run check` | exit 0 |
| artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.7.tgz` |
| sha256 | `79e6ddf7d0fa7e640654783b7fd243d8a36295c68ebd07747530790322a2d442` |

**Status: applied on disk, pending restart.** The serving process (pid 2422772) still runs rc.6;
the recovered-call count is a replay of recorded traffic, not a live rate. After the restart the
same trace should show the reasoning marker deltas falling while the `tool_calls` finish count
rises. Detail: `VERIFICATION.md` §46, ledger F-34.

### 0.8 `0.0.1-rc.8` — assistant history is prose only

The rc.7 traffic left two owner-visible symptoms: turns that **restated tool calls in a loop**
(session `edeabe91`, 2026-11-02 07:02–07:06 KST) and protocol notation that still reached the
screen (the same session's final step printed a run of `</run_code>` / `</function>` closers as
reasoning; session `bca2c2f7` is the second reference).

Measured on those two sessions by rebuilding the request body from the recorded transcript:

| Measure (one request built from the whole session) | `bca2c2f7` | `edeabe91` |
|---|---|---|
| wire characters, before → after | 634,761 → **388,841** (−38.7%) | 133,684 → **66,405** (−50.3%) |
| `<thinking>` wrappers sent back to the route | **73** → 0 | 12 → 0 |
