# Custom Router — Settings-Models (Custom) Preset Surface Spec

<!-- skeleton:
version: 0.0.1-rc.1
kind: spec
status: blocked
updated: 2026-11-06
summary: Specification only, not implemented (ROADMAP P2-6, owner-gated). Owner-approved plan B: a separate plugin-owned Settings-Models (Custom) surface, with per-service tool presets, credential interception vs separate input, install/web-auth checks, and OpenCode plan detection.
-->

> **SPECIFICATION ONLY (2026-11-14).** This surface is not implemented; it is [ROADMAP.md](./ROADMAP.md) P2-6, blocked on owner approval. Do not read the gates below as current work.

> Status: **specification only.** Owner decision 2026-11-06, confirmed 2026-11-06: **a new
> separate surface (plan B)** — not tabs inside the
> standard Settings → Models page, but a **separate custom settings surface owned by this
> workspace's plugin**. Baseline measured on DSH `0.2.2-rc.1`, 2026-11-06. No code, live
> profile, plugin manifest, or version was changed; the document starts at `0.0.1-rc1` and no
> `rc#` was advanced by the agent (global AGENTS.md §6).
> Parent: [CUSTOM-ROUTER-SERVICE-SPEC.md](./CUSTOM-ROUTER-SERVICE-SPEC.md) and
> [CUSTOM-ROUTER-PROTOCOL-STANDARD.md](./CUSTOM-ROUTER-PROTOCOL-STANDARD.md).
> Reading order for this document: **§1 measured contracts → §2 the four owner questions →
> §3 surface spec → §4 gates**.

## 1. Measured contracts this surface must sit on

### 1.1 Why a separate surface (plan B), not tabs in the standard page

Measured in `@deepseek-ai/dsh-client-ui-settings-models/lib/client.js`: the standard Models page
is one `section` (`zGbnIq_section`) with a `rows` list of `rowCard` provider cards and
`addModel`/`customized` panels — **row-based, not tab-based**. `dsh-client-ui-settings` has
no `registerTab`/`addTab` API (grep: 0 hits). The extension point is `settings.section`, a
**list** slot with a stable id and locale-aware label
([UI-SLOT-ARCHITECTURE.md §5](../../docs/UI-SLOT-ARCHITECTURE.md)). A tab strip inside the standard page
would require editing the DSH host package, which is outside the single-writer scope
([RULES.md §3](../../docs/RULES.md)). Therefore the custom surface is a **new `settings.section` owned by a
workspace plugin**, rendering its own service-tab strip. It does not modify the host.

### 1.2 The credential store (for the "가로채기" question)

Source: `@deepseek-ai/dsh-credentials` + `@deepseek-ai/dsh-credentials-local`.

| Fact | Measurement |
| :--- | :--- |
| Store file | `$DSH_HOME/.credentials.yaml`, structure `version: 1`, `refs:`, `records:` (live file measured: exactly those three top-level keys). |
| Precedence | managed file > inherited process env > cwd `.env` > `$DSH_HOME/.env`. *"The managed store wins because a credential the user explicitly saved in the product must take effect consistently for every provider."* |
| Read API | `credentials.resolve(credentialRef(name))` — any mounted service with `ctx.get("credentials")` can resolve **any ref in that file**, e.g. `DEEPSEEK_API_KEY`. Used by `dsh-llm-deepseek-api-key/lib/index.js` 53–63. |
| Record key | `credentialKey(scope, id)` → `"<scope>/<id>"`; `scope` is *"the owning plugin's registered name, such as `llm-pi-ai`"*. Records are tagged mappings under `records:`. |
| Secret field | `Schema.string().role('secret').volatile()`; the settings service redacts it — the server never returns the saved value. DeepInfra `lib/index.js:79`, client hint: *"Stored as a secret: the server never returns it"*. |
| Write path | `settings.update('dsh-deepinfra', { apiKey })` in `dsh-deepinfra/lib/server.js:238,276`; the client sends a typed key from `draft.apiKey` (`lib/client.js:481–496`). The value lands in the plugin's own cordis config, **not** in `.credentials.yaml` refs. |

**Consequence for "가로채기":** there are two different stores. The standard router's key lives in
`.credentials.yaml` as a `credentialRef`; each custom plugin's typed key lives in its own
cordis config as a `role('secret')` field. A custom preset **can read** the standard key by
calling `credentials.resolve(ref)` (the service is global), but it **cannot "intercept" a write**
the standard Models page makes — that page writes its own namespace. So the design must be
**explicit adoption**, not silent interception:

| Mode | Mechanism | Measured feasibility |
| :--- | :--- | :--- |
| A. **Read-only reference to the DSH-managed key (owner decision 2026-11-06)** | preset resolves `credentialRef(name)` through `ctx.get("credentials")` and reports only **found / missing + ref name**; **never copies, never writes, never displays the value** | **Possible today**; any plugin can call `resolve()` |
| B. Separate input in the custom surface | a `role('secret')` field in the plugin's own namespace, written via `settings.update`; precedence: this field, then `apiKeyEnv`, then (for OpenCode) the local credential store | **Possible today**; DeepInfra already implements exactly this |
| C. Silent interception of the standard page's write | — | **Not supported by the contract.** No hook; `refs` is a strict map owned by the standard plugin's config `apiKeyEnv`. Do not claim it. |

**Rule (owner decision 2026-11-06):** the custom surface offers **A (read-only key reference)
+ B (separate input)**, never C. A is **reporting only** — no adopt action, no one-click copy, no
write into the plugin's own secret field. The DSH-managed key is consulted as a *hint*: if the
service authenticates by **web auth (oauth / token file)** and that auth is present, no key is
asked for; **if web auth is absent, the preset shows B (a separate key input) as the fallback**.
It never reaches into another plugin's namespace unasked (RULES.md §3).

### 1.3 Agent-installed / web-auth checks

| Service | Measured check chain | Where |
| :--- | :--- | :--- |
| Antigravity | `agy` binary must exist and `agy models` must list models ("proving the sign-in works"); the credential file `~/.gemini/antigravity-cli/{jetski-standalone-,}antigravity-oauth-token` must contain a `refresh_token`; `POST oauth2.googleapis.com/token` refreshes it; **no API-key path** (`GEMINI_API_KEY` does not authenticate). 401 on generation triggers one refresh+retry; `invalid_grant` means revoked/rotated. | [dsh-antigravity/README.md](../vendor/antigravity/README.md) §1–2; `lib/auth.js` 27–46, 118–161; `lib/adapter.js:259` |
| OpenCode v2 | `opencodePath` (PATH or absolute, systemctl-safe), `opencode serve` daemon reachable or spawnable; `GET /api/credential` returns stored entries; rank active `oauth` before `key`; 401 forces one refresh. | `dsh-opencode-v2/lib/http.js` 1124–1245, 1168–1191; [dsh-opencode-v2/docs/OPENCODE-V2-HTTP-API-MEASUREMENT.md](../../archive/dsh-opencode-v2/docs/OPENCODE-V2-HTTP-API-MEASUREMENT.md) |

**These checks must live in each service's preset**, not in a central place: the binary path, the
token file, and the credential-store integration id are service-specific. A preset that activates
a service without running its own check would register a route that fails at first turn with
`NO_ADAPTER`-class errors (parent spec §2.1 S8).

### 1.4 OpenCode go plan — does it need a separate API key? (owner question 4)

Measured on this host, 2026-11-06:

| Fact | Value |
| :--- | :--- |
| Live config | `activePlan: go`, `backendProviderId: opencode-go`, `apiKey: ''`, `apiKeyEnv: OPENCODE_API_KEY`, 14 `opencode-go/*` enabled models |
| Daemon `service.json` | `http://127.0.0.1:49374`, pid 104336, version 2.2.0 |
| `GET /api/credential` | **3 entries**: `Master Key 1` (key, active **false**), `Master Key 2` (key, active **false**), `Personal` (**oauth, active true**) |
| Credential resolution code | `activeCredential()` ranks `oauth → key → other`; *"the Go endpoint rejects a revoked key credential with 401 while the active web oauth token is accepted"* (`http.js` 1199–1245) |
| Plan identity | `PLAN_PROVIDERS = { go: 'opencode-go', zen: 'opencode' }`; `planOfRoute()` reads the `provider/model` prefix (`plans.js` 22–48) |
| Endpoint probe (oauth token, no key typed) | go + `deepseek-v4.1-flash` → upstream `[overloaded]` (route reachable, transient); go + `pulse-alpha-free` → `Model is unavailable`; zen + `pulse-alpha-free` → `FreeUsageLimitError` ("subscribe to OpenCode"). The three answers are **distinguishable**. |

**Answer:** go 플랜에서 **별도 API 키를 입력할 필요가 없습니다.** 웹 로그인 oauth 하나로
인증되며, 코드가 oauth를 우선합니다. 다만 **"플랜에 맞는지 체크"는 두 층으로 해야 합니다**:

1. **정적 판정(무료, 즉시)**: 선택된 라우트의 prefix로 `planOfRoute()` → `go|zen|other`, 현재
   `activePlan`과 대조. 라이브 `enabledModels` 14개는 전부 `opencode-go/*`라 go와 일치.
2. **동적 판정(실측 필요)**: 엔드포인트에 1회 probe → go/zen 각각 `Model is unavailable` /
   `FreeUsageLimitError` / `billing_source`로 구독 상태·모델 가용성 확인.
   `test/live/endpoint-plan-probe.mjs`가 이미 이 probe를 구현해 놓았습니다.

즉 `activePlan`은 **설정값**이고, 실제 계정이 그 플랜을 쓰는지는 **엔드포인트 응답으로만**
확인됩니다. 프리셋은 이 둘을 분리해서 보여줘야 합니다("설정된 플랜: go / 확인된 응답: …").
별도 키 입력은 **oauth가 없거나 key 계정으로 강제하려 할 때(`credentialLabel` pin)만** 필요하며,
그 경우에만 `apiKey` / `apiKeyEnv` 입력창을 노출합니다.

## 2. The four owner questions — verdict table

| # | Owner question | Verdict | Basis |
| :--- | :--- | :--- | :--- |
| Q1 | DSH 라우터가 가진 api키를 서비스별 프리셋에서 가로챌 수 있는 구조인가 | **읽기 전용 참고만. 쓰기 가로채기·adopt 불가** → A(보고만)+B(별도 입력) | §1.2; owner decision 2026-11-06; `credentials.resolve` global, `refs` strict, no write hook |
| Q2 | b안 별도 입력창에 입력할 수 있는가 | **가능 — 단 웹인증이 없을 때만 요구** (읽기 전용 키 참고는 상시) | §1.2 B + owner decision; `role('secret')` + `settings.update` |
| Q3 | Antigravity / OpenCode v2의 에이전트 설치·웹인증 체크가 각 서비스별 프리셋에 구현되어야 하는가 | **그렇다. 서비스별로 구현해야 함** — 체인이 서로 다름 | §1.3; no shared check exists |
| Q4 | OpenCode go 플랜: 플랜 체크 가능한가 / 별도 키가 필요한가 | **플랜 체크 가능(정적+동적 2층), 별도 키 불필요(oauth 활성)** | §1.4; real `/api/credential` + endpoint probe |

## 3. Surface specification (plan B)

### 3.1 Identity and placement

| Field | Value |
| :--- | :--- |
| Surface | `settings.section` (list slot), stable id `@nolit/dsh-custom-router-presets`, locale-aware label ("모델 (커스텀)" / "Models (Custom)") |
| Owner | a **workspace plugin**, not the DSH host. Single-writer scope preserved (RULES.md §3). |
| Internal shape | a tab strip with one tab per service: `OpenCode v2`, `Antigravity`, `DeepInfra`. Tabs are this plugin's own React state, not a host tab API. |
| Standard page | untouched. `llm-pi-ai`/standard rows remain where they are; parent spec §2 real-mount A/B proved coexistence. |

### 3.2 Per-service preset (one tool = one service)

Each tab is the **tool preset** for one service (parent spec §4): presence of the tab's activation
switch mounts that service's row; removing it disposes only that service's routes.

| Tab section | Contents | Backed by (measured) |
| :--- | :--- | :--- |
| **Activation** | master switch → mounts/unmounts the service row (`registerAdapter` disposer) | parent spec §4.2; `DUPLICATE_ADAPTER` guard |
| **Credential** | (a) **read-only** "DSH 관리 키 참고" → `credentials.resolve(credentialRef(name))` → found/missing + ref name only, no copy/no write; (b) **웹인증 없을 때만** "별도 키 입력" → `role('secret')` + `settings.update`; precedence shown | §1.2 A/B + owner decision; DeepInfra `lib/client.js` 67–70, `lib/server.js` 238 |
| **Readiness** | service-specific install/web-auth checklist, each with a measured pass/fail | §1.3 |
| **Plan / catalog** | service's own live catalog + plan/quota/promotion facts (the three standard gaps the owner named) | parent spec §1.3; [protocol standard §2](./CUSTOM-ROUTER-PROTOCOL-STANDARD.md) |
| **Model allow-list** | per-service enabled models (go/zen prefix filter for OpenCode, effort-suffixed ids for Antigravity, chat-tagged ids for DeepInfra) | `cordis.patch.yml` rows of each plugin |

### 3.3 Readiness checklist per tab (normative)

**OpenCode v2 tab**
1. `opencodePath` resolves (PATH or absolute; systemd PATH measured unsafe → prefer absolute).
2. `opencode serve` daemon reachable (`service.json`) or `spawnServer` succeeds.
3. `GET /api/credential` has an **active** entry; report its `type` (`oauth` preferred, `key` fallback) and label — never its value.
4. Static plan: `activePlan` vs `planOfRoute()` of every enabled model; flag mismatches.
5. Dynamic plan: one endpoint probe per plan (1-token, `stream:false`), report `billing_source` / `Model is unavailable` / `FreeUsageLimitError`; **no key input shown while oauth is active (measured: `Personal` active oauth, no key typed)** — the separate key input appears only if step 3 finds no active web-auth credential, or `credentialLabel` pinning is requested.

**Antigravity tab**
1. `agy` binary found and `agy --version` succeeds.
2. `agy models` lists models (sign-in proof) — or, for the pure HTTP surface, the token file exists with a `refresh_token`.
3. Refresh grant to `oauth2.googleapis.com/token` succeeds; report `invalid_grant` distinctly.
4. `loadCodeAssist` / `fetchAvailableModels` reachable; `retrieveUserQuotaSummary` weekly/5h buckets.
5. **No API-key field at all** — README: `GEMINI_API_KEY` does not authenticate this plugin.

**DeepInfra tab**
1. `apiKey` (typed secret) or `DEEPINFRA_API_KEY` env present; report source (`ui|env|none`).
2. Public `GET /v1/openai/models` reachable (no auth); report chat-route count.
3. Promotions: `promotionOf()` count (8/92 measured 2026-11-14), `/v1/request-costs` reachable.
4. No agent-install check — pure fetch; say so explicitly.

### 3.4 Credential precedence (normative, per service)

```
OpenCode v2 : typed apiKey > apiKeyEnv (OPENCODE_API_KEY) > GET /api/credential(oauth > key)
Antigravity : refreshToken/typed > tokenFile (~/.gemini/antigravity-cli/*) > [no key path]
DeepInfra   : typed apiKey (role secret) > DEEPINFRA_API_KEY env
DSH adopt   : credentials.resolve(credentialRef(name)) — read-only, explicit adopt only
```

A preset must never write another plugin's namespace, never print a secret, and never claim a
credential works without its service's own readiness probe.

## 4. Gates before implementation

| # | Gate | Threshold |
| :--- | :--- | :--- |
| P1 | New surface owns a `settings.section` id | no host package edit; standard Models page unchanged |
| P2 | Each tab implements §3.3 in full | all checks produce pass/fail, no silent default |
| P3 | Credential modes A+B only | A is **read-only reporting** (no adopt, no copy); B appears only when web auth is absent; no write hook into `refs` |
| P4 | Real isolated + browser boot | 0 `did not activate`, 0 page errors (RULES.md §4); `--dump-config` is not evidence |
| P5 | Standard services survive | `deepseek-account` still registered after adding/removing a tab (parent spec §2.1 S5) |
| P6 | Per-plugin CHANGELOG measured before/after | RULES.md §6.1 |
| P7 | Version | `0.0.1-rc1` start; `rc#` only by owner instruction in the session that changed it |

## 5. Not decided / not done here

- Which plugin track owns the new surface (new track vs an existing one) — owner decision.
- Any live-profile edit, service restart, real generation turn, or browser boot for the **new**
  surface (this session measured contracts only; no surface was built).
- Plugin versions, rc numbers, `dsh-subrouter` P-4 disposition, stage-2 work.

## 6. References

- [PRESET-SCHEMA-AND-EXTENSION.md](./PRESET-SCHEMA-AND-EXTENSION.md) — per-service preset schema, extension limits, future-service coverage tiers


- [CUSTOM-ROUTER-SERVICE-SPEC.md](./CUSTOM-ROUTER-SERVICE-SPEC.md), [CUSTOM-ROUTER-PROTOCOL-STANDARD.md](./CUSTOM-ROUTER-PROTOCOL-STANDARD.md)
- [CUSTOM-ROUTER-ARCHITECTURE.md](./CUSTOM-ROUTER-ARCHITECTURE.md) — composition diagrams + normative per-service module contract
- [UI-SLOT-ARCHITECTURE.md](../../docs/UI-SLOT-ARCHITECTURE.md), [RULES.md](../../docs/RULES.md), [DSH-HARNESS-POLICY.md](../../docs/DSH-HARNESS-POLICY.md)
- [dsh-antigravity/README.md](../vendor/antigravity/README.md), [dsh-opencode-v2/README.md](../../archive/dsh-opencode-v2/README.md), [dsh-deepinfra/README.md](../vendor/deepinfra/README.md)
- [dsh-opencode-v2/docs/OPENCODE-V2-HTTP-API-MEASUREMENT.md](../../archive/dsh-opencode-v2/docs/OPENCODE-V2-HTTP-API-MEASUREMENT.md), [dsh-opencode-v2/docs/OPENCODE-V2-SURFACE-MEASUREMENT.md](../../archive/dsh-opencode-v2/docs/OPENCODE-V2-SURFACE-MEASUREMENT.md)
- Installed `@deepseek-ai/dsh-credentials`, `dsh-credentials-local`, `dsh-client-ui-settings*`, `dsh-llm-deepseek-api-key`

## Cross-reference

- [WEB-AUTH-PIPELINE-ENGINE.md](./WEB-AUTH-PIPELINE-ENGINE.md) — upper/lower web-auth ownership; standard vs per-service layer verdict
