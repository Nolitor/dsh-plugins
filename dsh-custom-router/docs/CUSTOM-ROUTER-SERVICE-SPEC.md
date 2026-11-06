# Custom Router Service — Standard Baseline, Coexistence Verdict, and Activation Spec

<!-- skeleton:
version: 0.0.1-rc.1
kind: spec
status: active
updated: 2026-11-06
summary: Measured DSH standard serving/router first (incl. discount / new-model / usage gaps), then the real-mount coexistence verdict, then the tool-preset activation model.
-->

> Status: **specification built on measurement**. Baseline: DSH `0.2.2-rc.1`,
> `@deepseek-ai/dsh-llm@0.2.2-rc.1`, 2026-11-06. No runtime code, live profile, service
> restart, or plugin version was changed in the session that produced it.
> Reading order: **§1 standard baseline → §2 coexistence verdict → §3 service definition →
> §4 activation model**. Skipping §1/§2 was the defect of v1.0, which asserted the standard
> router was "insufficient" before measuring it.
> Protocol detail: [CUSTOM-ROUTER-PROTOCOL-STANDARD.md](./CUSTOM-ROUTER-PROTOCOL-STANDARD.md).

## 1. Measured DSH standard model serving and router (do this first)

Source of truth: the **installed** runtime, not docs or memory.

### 1.1 The pieces

| Piece | Measured identity | Role |
| :--- | :--- | :--- |
| `@deepseek-ai/dsh-llm` | `0.2.2-rc.1`, `lib/index.js` | the provider-neutral LLM **runtime**; owns the adapter registry, directory, discovery and dispatch |
| `@deepseek-ai/dsh-base` | `cordis.patch.yml` | mounts `@deepseek-ai/dsh-llm`, `dsh-agent-default-model`, `dsh-llm-retry`, account/credential services, and `dsh-llm-pi-ai` |
| `dsh-llm-deepseek-account` | provider `deepseek-account` | web-account route; `registerConfigurableProviders` + `registerDeepSeekProvider` |
| `dsh-llm-deepseek-api-key` | provider `deepseek-official` | raw API-key route; `registerConfigurableProviders` + `registerDeepSeekProvider` |
| `dsh-llm-pi-ai` | dynamic routes | multi-provider twin; `registerConfigurableProviders` + `registerModelDiscovery` + `registerAdapter(routes, adapter)` |

### 1.2 What the standard already provides (v1.0 wrongly denied this)

Read from `dsh-llm/lib/index.js`:

| Capability | Implementation | Line |
| :--- | :--- | :--- |
| Route registration | `LlmRuntime.registerAdapter(providers, adapter)` — `ctx.effect`, all-or-nothing, disposer + `handle.replace(next)` | 1842–1861 |
| Duplicate protection | `prepareRoutes` throws `LlmError(..., "DUPLICATE_ADAPTER")`; a rejected candidate leaves the registry untouched | 1867–1887 |
| Atomic route swap | `commitRoutes` deletes old + sets new in one synchronous section, then emits `llm/adapters-updated` | 1895–1903 |
| Configurable provider directory | `registerConfigurableProviders(entries)` with `DUPLICATE_DIRECTORY` and `handle.replace` | 1919–1959 |
| Model discovery | `registerModelDiscovery(settingsNs, discover)`, `discoverModels(...)`, `DUPLICATE_DISCOVERY` | 1977–2008 |
| Adapter lifecycle surface | `providerInfo`, `providerRetryPolicy`, `imageRequestPricing`, `imageRequestTarget`, `listModels`, `resolveModel`, `prepareCall`, abstract `stream()` | 1670–1740 |
| Dispatch | `registration(provider)` → `NO_ADAPTER` if absent; `adapterStream` selects adapter, projects files/images/tools, builds the terminal failure chunk | 2267–2350 |
| Attribution | "Every provider HTTP request must include `attributionHeaders()`" | 1665–1668 |

**But registration capability is NOT functional sufficiency.** The owner asked three concrete
questions — model discounts, new-model additions, per-service usage checks — and the standard
answer is **no to all three** (measured in §1.3 below). pi-ai being *dormant by design* only
means it registers zero routes until configured; it does not mean the standard serves these
facts. The workspace policy already records the verdict:
[DSH-HARNESS-POLICY.md §1.1](../../docs/DSH-HARNESS-POLICY.md) — *"`llm-pi-ai` is deprecated and is not
restored … Every model-serving integration is its own autonomous router … owns its catalog,
`reasoning.efforts`, disjoint usage accounting, session mapping, and stable error codes."*

`dsh-base/cordis.patch.yml` lines 128–134:
*"mounted dormant: zero routes (and no extra models in the picker) until a `llm-pi-ai:`
settings section supplies provider profiles — then those routes register live … and drop again
when the section empties."* Its `ensureRegistrationFacts()` calls `registerAdapter(routes, adapter)`
on first non-empty config and `registration.replace(routes)` thereafter
(`dsh-llm-pi-ai/lib/index.js` 2985–2999). So the standard router **already supports dynamic,
settings-driven custom routes**.

**Therefore the honest reason for Custom Router is that the standard does NOT serve these facts.**
It can register a route, but it cannot report a discount, cannot follow a provider adding a new
model without a DSH release, and cannot expose per-service usage/quota. The three custom services
implement exactly those missing facts (§1.3). This is a **capability gap**, not a mere fit
preference — v1.0 of this document called it "fit, not capability" and was wrong.

### 1.3 The three owner questions, answered by measurement

| Owner question | Standard DSH answer | Measured evidence | Custom answer |
| :--- | :--- | :--- | :--- |
| **모델 할인** | **NO** | `dsh-llm-pi-ai/lib/index.js` 271–275: *"The harness never reads pi-ai's cost metadata — `replay.ts` zeroes it and no consumer reports spend"*; `NO_COST` = all zeros; `emptyPiUsage()` zeroes `cost`. No `discount` field exists in `dsh-llm`/pi-ai (grep: 0 hits). | DeepInfra `lib/catalog.js` `promotionOf()`: `metadata.discount` on **8 of 91 chat routes**, 0.10–0.75 (pay 90%→25%), derived because tags are capability-only; `/v1/request-costs` returns `costNanoUsd`; `cost.js` records it. |
| **신규 모델 추가** | **NO without a DSH release** | `PROVIDER_DATA`: *"Generated from the installed pi-ai catalog. Run `pnpm gen-provider-data`; do not edit."* The catalog is **baked into the installed DSH version**. `catalogModels()` reads that frozen table; `modelOverrides` can only patch a model the installed catalog already describes. `sharedCatalogApi` admits the intent — *"lets a deployment add a model the installed catalog has not caught up with"* — but the operator must hand-declare it; no live refresh. | DeepInfra `fetchCatalog(.../models)` on a 30-min TTL — live, public, no key. OpenCode `rankingUrl: https://opencode.ai/data/index.json` + `NEW_MODEL_DAYS = 7` + `isNewModel()` + `firstSeen` ledger + "New" badge. Antigravity `fetchAvailableModels` + 15-min `catalogTtlMs` + quota summary. |
| **각 서비스 사용량 체크** | **NO** | `emptyPiUsage()` returns all zeros; `mapUsage()` (1451–1459) maps only pi-ai's own cumulative `input/output` — no per-service quota, no account allowance, no plan burn, no cost chip. `dsh-client-ui-settings-models` shows credential dots and model rows, not usage. | Antigravity `retrieveUserQuotaSummary` → weekly / 5-hour buckets per family + usage chip. OpenCode `session export` / `/api/experimental/usage/limits` → disjoint buckets + cost pill + plan panel. DeepInfra trailing usage chunk + `/v1/request-costs` → estimated/exact cost chip. |

**Owner point 3, confirmed:** pi-ai ships an **installed-version snapshot** of the model catalog.
When a provider adds a model, the DSH release must regenerate `provider-data.generated`; until
then the standard prints only the models hardcoded at that DSH version. Calling *that* "the
standard" and teaching the owner it is sufficient was the error in the earlier version of this
document. [dsh-opencode-v2/docs/OPENCODE-V2-SURFACE-MEASUREMENT.md](../../dsh-opencode-v2/docs/OPENCODE-V2-SURFACE-MEASUREMENT.md) already
measured the contrast: OpenCode Go served **45 models** (30 `opencode-go/*`, 15 `opencode/*`)
against the CLI, while the standard pi-ai table is frozen per release.

### 1.4 Settings → Models: is there a per-service tab? (owner question 4)

Measured in `@deepseek-ai/dsh-client-ui-settings-models/lib/client.js` and
[UI-SLOT-ARCHITECTURE.md §5](../../docs/UI-SLOT-ARCHITECTURE.md):

| Fact | Measurement |
| :--- | :--- |
| Standard "Models" page | one `section` (CSS `zGbnIq_section`), a `rows` list of `rowCard` provider cards, `addModel` / `customized` panels. **Row-based, not tab-based.** |
| Extension point | `settings.section` — a **list** slot with a stable id and locale-aware label (UI-SLOT-ARCHITECTURE.md §5). No `registerTab` / `addTab` API in `dsh-client-ui-settings` (grep: 0 hits). |
| What the 3 plugins do today | each injects its **own `settings.section`**: OpenCode V2 section (`lib/client.js`), Antigravity "settings tab" with grouped model selection (README), DeepInfra settings + promotions panel. Already separate sections, not tabs inside the standard Models page. |
| Can the standard Models page become per-service tabs? | **Not without a host change.** Its component is a flat section; a tab strip is a new client component in the DSH package — outside this workspace's single-writer scope (RULES.md §3). |

**Decision (owner 2026-11-06): plan B.** 서비스별 프리셋화는 표준 설정-모델 안의 탭이 아니라
`설정-모델(커스텀)`이라는 **별도 커스텀 설정 surface**에 구현한다. 호스트 패키지 수정이 아니라
**워크스페이스 플러그인이 소유하는 새 `settings.section`**이며,其内部 탭 strip은 그 플러그인의
자체 React state다. 상세 명세(자격증명 채택/별도 입력/서비스별 인증·플랜 체크)는
[CUSTOM-ROUTER-PRESET-SURFACE.md](./CUSTOM-ROUTER-PRESET-SURFACE.md)에 있다.

### 1.5 Live composition (measured, read-only)

- `llm-pi-ai`: `disabled: true`
- `llm-deepseek` (`dsh-llm-deepseek-api-key`): `disabled: true`
- `agent-default-model`: `provider: opencode-http-agent`, `model: opencode-go/hy4`, `reasoningEffort: high`
- `deepseek-account` remains mounted; isolated boot logs show
  `[llm-deepseek-account] model listing … loaded 2 model(s)`.

## 2. Coexistence verdict — can we bypass, add 3 custom routers, and keep standard services?

Measured three ways: (a) source-level rules, (b) the **real `LlmRuntime` in-process** with a real
Cordis `Context`, (c) **isolated `DSH_HOME` boots + browser boots** (throwaway homes only; live
home never written; temp homes removed afterwards).

### 2.1 In-process runtime scenarios (actual execution, not reading)

| # | Scenario | Result |
| :--- | :--- | :--- |
| S1 | register only `deepseek-account` | `[{id:deepseek-account}]` |
| S2 | add 3 distinct custom ids | `[deepseek-account, opencode-http-agent, antigravity, deepinfra]` — **all 4 coexist** |
| S3 | re-register an existing custom id | `THROW LlmError DUPLICATE_ADAPTER`: *"an adapter for provider \"opencode-http-agent\" is already registered"* — all-or-nothing |
| S4 | `handle.replace(['opencode-http-agent','antigravity'])` | atomic swap; old route set replaced in one commit |
| S5 | dispose one custom registration | custom route gone, `deepseek-account` **survives** |
| S6 | directory + adapter with the **same** id | both lists hold the id; the two registries are separate |
| S7 | `replace([])` (pi-ai pattern) | routes drop to `[]`, no error |
| S8 | look up an unregistered provider | `NO_ADAPTER` |

### 2.2 Isolated real mounts

| Run | Config | `did not activate` | duplicate/conflict errors | Browser boot |
| :--- | :--- | :--- | :--- | :--- |
| A | live config (pi-ai `disabled: true`) | **0** | **0** | 81 entries, 7 `@nolit`, `pageErrors: []`, shell rendered |
| B | pi-ai **re-enabled** (`disabled` line removed, verified) | **0** | **0** | 81 entries, 7 `@nolit`, `pageErrors: []`, shell rendered |

B's pi-ai has no `llm-pi-ai:` settings section, so it is dormant with 0 routes — but it is
**mounted**, and the standard `deepseek-account` route is live. Both survive the 3 custom routes.

A `dsh --profile web --dump-config` was **not** used as evidence: it fails with `EROFS` because the
live `cordis.yml` is read-only, and a config dump is not a mount (RULES.md §4). The browser boot
above is the mount proof.

### 2.3 Verdict

| Question | Verdict | Condition |
| :--- | :--- | :--- |
| Bypass the standard router | **POSSIBLE — already done** | Each custom service registers a **different provider id**. The standard does not own or reserve a global route namespace; `registerAdapter` is additive per id. |
| Add 3 custom model-serving routers | **POSSIBLE** | 3 distinct ids; no duplicate tool/command/slot; each row mounts clean (A/B real mount). |
| Keep existing standard services | **POSSIBLE** | `deepseek-account` and the dormant pi-ai both survive (B). Disposing a custom route does not remove them (S5). |
| What is **IMPOSSIBLE** | **Duplicate id / duplicate tool** | `DUPLICATE_ADAPTER` aborts the whole registration (S3); a duplicate tool/command name aborts the plugin row (RULES.md §4). Activation must be a 4-step replacement, never a second declaration. |
| What is **NOT YET VERIFIED** | A real generation on each route | This session measured **mount**, not a model turn. `NO_ADAPTER` at dispatch (S8) is the failure mode if a route is ever dropped. |

**This is the answer to "추가 및 기존 서비스를 유지할 수 있는지 없는지": 가능하다.** 단, 조건은
*provider id 유일성* 하나로 귀결되고, 이미 라이브 프로필이 그 조건을 만족하며 실마운트로 확인했다.

**공존 가능 ≠ 표준 충분.** §1.3이 실측했듯 표준은 할인·신규모델·사용량 체크를 제공하지 않는다.
공존은 "표준을 지우지 않고도 커스텀 라우터를 더할 수 있다"는 뜻일 뿐, "표준으로 충분하다"는
뜻이 아니다. [DSH-HARNESS-POLICY.md §1.1](../../docs/DSH-HARNESS-POLICY.md)이 이미 `llm-pi-ai`를
**deprecated, not restored**로 못박은 이유가 바로 이것이다.

## 3. Service definition

**Custom Router** is a distinct **service class** (agent/model API routing + model serving), not a
plugin named `dsh-subrouter` and not a second router layer beside the harness. It registers
**inside** the standard `LlmRuntime` through `ctx.llm.registerAdapter` (§1.2), i.e. it *uses*
the standard **registration contract** while replacing pi-ai's **stale, feature-poor serving
implementation** (§1.3). It does not replace the harness. The decommissioned `@nolit/dsh-subrouter`
(2026-10-30, [OPENCODE-MODEL-SERVING-PLAN.md §3](../../dsh-opencode-v2/docs/OPENCODE-MODEL-SERVING-PLAN.md)) sat beside
the harness and lost retry/attribution/discovery; that is the pattern this definition forbids.

| Responsibility | Meaning |
| :--- | :--- |
| **Agent / model API router** | Resolve which external service serves a generation, with its own identity, credential, catalog and endpoint, at call time. |
| **Model serving** | Translate `GenerateOptions` into that service's wire protocol and stream the harness `StreamChunk` vocabulary back. |

### 3.1 The three services in scope

| Service | Package | Route id | Serves | Credential boundary |
| :--- | :--- | :--- | :--- | :--- |
| OpenCode v2 | `@nolit/dsh-opencode-v2` `0.0.1-rc.1` | `opencode-http-agent` | OpenCode Go/Zen plane + `opencode`, `/ocode`, `cli_worker` | local `opencode serve` control plane; oauth-before-key ranking |
| Antigravity | `@nolit/dsh-antigravity` `0.0.1-rc.7` | `antigravity` | Gemini on consumer cloudcode-pa + `/agy`, `agy_worker` | `~/.gemini/antigravity-cli/*oauth-token` + refresh grant |
| DeepInfra | `@nolit/dsh-deepinfra` `0.0.1-rc.8` | `deepinfra` | public OpenAI-compatible catalog (91 chat routes) | one `DEEPINFRA_API_KEY` bearer / Settings-saved key |

All three are `link:` dependencies in the live `web` profile, listed in `dsh.profile.bundles`,
and each calls `ctx.llm.registerAdapter()` ([http.js:2408](../../dsh-opencode-v2/lib/http.js),
[index.js:413](../../dsh-antigravity/lib/index.js), [index.js:239](../../dsh-deepinfra/lib/index.js)).
The **service** is the specification unit; the **package** is the current packaging decision
([PLUGIN-CONSOLIDATION.md](../../docs/PLUGIN-CONSOLIDATION.md): one package per vendor).

## 4. Activation model — a service is a tool

Owner definition 2026-11-06: an **agent** (OpenCode CLI, Antigravity `agy`) or an **API key**
(DeepInfra) is treated as **one tool**; adding that tool to the tool preset activates the service.

### 4.1 Tool preset ≠ model route (measured host contract)

DSH `agentPreset` is a **tool preset**, not a model-route selector. `@deepseek-ai/dsh-agent-preset`
declares `Config = z.object({ id, name, description, order, plugins: z.array(z.any()).required() })`
and calls `ctx.agentPresets.register(config)`. `@deepseek-ai/dsh-agent-preset-registry` stores
`default` / `selectedDefault` and records `agent-preset/selected` per session. Model selection
is owned separately:

| Concept | Owns | Live value (measured) |
| :--- | :--- | :--- |
| Tool preset (`agentPreset`) | tool schemas / prompt sections / plugin tree | `default: standard`; no custom preset declared |
| Model route | `provider/model/reasoningEffort` | `opencode-http-agent / opencode-go/hy4 / high` |
| Allowed models | routes a delegated agent may pick | `allowedModels` already lists all 3 providers |

### 4.2 Activation contract (normative, built on §2)

1. **One service = one activation unit.** A tool entry names exactly one service and carries its
   identity (agent binary + default model/effort, or API-key-bearing route).
2. **Adding the tool activates the service.** The preset mounts the service row; the row registers
   its route id with `registerAdapter` (§2.1 S2).
3. **Removing the tool deactivates only that service.** The disposer releases its own routes;
   standard routes survive (§2.1 S5).
4. **Preset and route are bound, not unified.** A preset may enable three tools while one
   `agent-default-model` value stays the session's default.
5. **Uniqueness is the hard gate.** A second row with the same provider id throws
   `DUPLICATE_ADAPTER` (S3); the same tool/command name aborts the row (RULES.md §4). Use the
   4-step replacement: disable → remove → add → verify by **real mount** (§2.2).
6. **Mount proof, not config proof.** `--dump-config` is not evidence; a browser boot with zero
   `web boot: N entries did not activate` and zero page errors is (RULES.md §4).

### 4.3 Activation matrix (target state — specification, not applied)

| Tool entry | Service activated | Registrations on add | Released on remove |
| :--- | :--- | :--- | :--- |
| `opencode` agent | OpenCode v2 | `opencode-http-agent`, `opencode`/`/ocode`/`cli_worker`, `subagent_opencode` | route + tool + provider |
| `agy` agent | Antigravity | `antigravity`, `/agy`/`agy_worker`, `subagent_antigravity`, usage chip | route + tool + provider + chip |
| `deepinfra` API key | DeepInfra | `deepinfra`, catalog, cost chip | route + chip |

No preset row, plugin manifest, or live profile was changed in this session.

## 5. Boundary rules

| # | Rule | Measured reason |
| :--- | :--- | :--- |
| B1 | One autonomous router per service, registered **inside** `LlmRuntime`. | §1.2; the old subrouter lost retry/attribution/discovery. |
| B2 | Never re-implement a transport the harness normalises; map into `StreamChunk`. | `types.d.ts` chunk contract. |
| B3 | Credentials stay in each service's own settings namespace. | 3 different measured boundaries (§3.1). |
| B4 | Catalogs are provider-owned; DSH consumes `listModels` / `resolveModel` / discovery. | §1.2 `listModels` doc; pi-ai discovery pattern. |
| B5 | UI seats use additive **list** slots. | `conversation.input.activity` single-slot collision measured earlier. |
| B6 | A service row never writes a sibling track or the live profile unasked. | RULES.md §2–§3. |

## 6. Open / not decided here

- Package versions (`0.0.<n>-rc.<k>` is owner-owned; RULES.md §6, global AGENTS.md §6).
- Whether `dsh-subrouter` is archived or kept as history (boot card P-4).
- Whether a 4th service is added, or the standard pi-ai slot is used instead for a future
  OpenAI-compatible service (§1.2 shows that slot is viable).
- Any live-profile edit, service restart, real generation turn, or S6 soak confirmation.
- Stage-2 work gated on owner instruction
  ([dsh-opencode-v2/docs/OPENCODE-V2-STAGE-PLAN.md](../../dsh-opencode-v2/docs/OPENCODE-V2-STAGE-PLAN.md), [dsh-antigravity/docs/ANTIGRAVITY-STAGE-PLAN.md](../../dsh-antigravity/docs/ANTIGRAVITY-STAGE-PLAN.md)).

## 7. Reproducing the measurement

```bash
# §1 standard contract
grep -n "registerAdapter\|registerConfigurableProviders\|registerModelDiscovery" \
  /home/minami/.local/nodejs/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js
sed -n '128,137p' .../@deepseek-ai/dsh-base/cordis.patch.yml

# §2 real mount (throwaway home only; live home read-only)
ISO=$(mktemp -d); cp ~/.dsh/profiles/web/{cordis.yml,cordis.patch.yml,package.json} "$ISO/profiles/web/"
DSH_HOME="$ISO" dsh web --no-open --port 0   # then browser-boot the printed URL
node scripts/antigravity-stabilisation-status.sh --boot   # same isolation pattern
```

## 8. Terminology (appendix — not a finding)

| Earlier wording | Correct term |
| :--- | :--- |
| "DeepMind" (spoken, 2026-11-06) | **DeepInfra** — `@nolit/dsh-deepinfra`, route `deepinfra` |
| "subrouter" (the concept) | **Custom Router** service class; `dsh-subrouter` is one decommissioned experiment |
| "preset" (as model selector) | **tool preset**; model route is `agent-default-model` / `allowedModels` |

The repository never contained the "DeepMind" typo; it was spoken. Owner-owned
[HISTORY.md](../../HISTORY.md) and [boot cards](../../bootcards/) were not edited (global AGENTS.md §7,
[RULES.md §6.1](../../docs/RULES.md)).

## 9. References

- [CUSTOM-ROUTER-PROTOCOL-STANDARD.md](./CUSTOM-ROUTER-PROTOCOL-STANDARD.md)
- [CUSTOM-ROUTER-PRESET-SURFACE.md](./CUSTOM-ROUTER-PRESET-SURFACE.md) — owner-approved plan B surface
- [CUSTOM-ROUTER-ARCHITECTURE.md](./CUSTOM-ROUTER-ARCHITECTURE.md) — composition diagrams + normative per-service module contract
- [RULES.md](../../docs/RULES.md), [FAILURE-LEDGER.md](../../docs/FAILURE-LEDGER.md), [PLUGIN-CONSOLIDATION.md](../../docs/PLUGIN-CONSOLIDATION.md)
- [dsh-opencode-v2/docs/OPENCODE-MODEL-SERVING-PLAN.md](../../dsh-opencode-v2/docs/OPENCODE-MODEL-SERVING-PLAN.md), [dsh-deepinfra/docs/DEEPINFRA-ADAPTER-BRIEF.md](../../dsh-deepinfra/docs/DEEPINFRA-ADAPTER-BRIEF.md)
- [dsh-plugin-runtime-spec.md](../../docs/dsh-plugin-runtime-spec.md), [DSH-RC1-PLUGIN-DELTA.md](../../docs/DSH-RC1-PLUGIN-DELTA.md)
- Installed `@deepseek-ai/dsh-llm@0.2.2-rc.1` `lib/index.js` and `lib/types/*.d.ts`
