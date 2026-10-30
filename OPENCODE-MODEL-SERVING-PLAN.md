# OpenCode Model Serving — Incident Post-Mortem, Autonomous Router Policy, and Decommission Record

<!-- skeleton:
version: 2.5
kind: report
status: active
updated: 2026-10-31
summary: Post-mortem of the subrouter detour and the nested-harness HTTP route, the permanent autonomous pure-router policy, the subrouter decommission, the direct OpenAI-compatible backend pattern, the measured live 400 MissingSessionID + 401 revoked-key defects, the measurable per-account model allow-list with its settings tab, and the 0.6.0 client-half activation defect that killed the web shell.
-->

> Owner: root record for the OpenCode model-serving track. `dsh-subrouter/README.md` and
> `dsh-opencode-v2/README.md` are implementation detail; this file is the record a later session
> must find (docs/RULES.md §6 track-not-indexed rule).

## 1. Incident summary (measured, not intended)

A session added `@nolit/dsh-subrouter` (commit `e709ec3`) and repointed the live `web` profile in
one pass. Two mistakes compounded:

1. **Ordering** — code → live profile → restart happened before docs were read, the incumbent was
   measured, or approval was requested. `docs/RULES.md` §1, §2, §4 and §6 were all violated.
2. **Architecture** — an *internal adapter bridge* was mistaken for an *isolated standalone
   router*. `dsh-subrouter` re-implemented provider wire transports that the native adapter
   already owned, which produced:

| Symptom | Measured evidence | Root cause |
|---|---|---|
| Redundant SSE parsing | `dsh-subrouter/lib/adapter.js` + `lib/anthropic.js` (~900 lines) re-parse OpenAI/Anthropic streams | serving was duplicated instead of delegated to the measured OpenCode v2 surface |
| Static model hardcoding | 28 models × 2 protocols = 56 hand-typed entries in `dsh-subrouter/cordis.patch.yml` | no use of `GET /api/model` discovery or the durable catalog |
| Bypassed native waterfall controls | subrouter registered its own adapter instead of the native one; `llm-pi-ai` was disabled to avoid route duplication | a second provider layer sat beside the harness instead of inside it |
| Losing the reasoning control | `grep reasoningEffort dsh-subrouter/lib/adapter.js` → none; `llm-pi-ai` disabled | the bridge never implemented `LlmModelReasoningInfo` |
| Missing session identity | `MissingSessionID` from `opencode.ai/inference/go/v1` on session-less dispatches | hand-built headers instead of a persistent native session |
| "Registered" claimed from a dump | only `--dump-config` was run | `docs/RULES.md` §4: a dump is not a mount |

## 2. Architectural policy (permanent)

1. **`llm-pi-ai` is deprecated and must not be restored.** There is no product requirement for a
   generic multi-provider layer in this workspace.
2. **Every model-serving integration is its own autonomous router.** A plugin registers its
   adapter **directly** through `ctx.llm.registerAdapter([providerId], adapter)` and owns its
   catalog, reasoning levels, usage accounting, session mapping, and error codes.
3. **No intermediary proxy/bridge plugins.** A plugin must never be inserted between the harness
   and another plugin's measured serving surface. Reuse is by **importing the adapter/library**,
   not by standing up a parallel route table.
4. **The harness waterfall is the only control plane.** Interception (token meter, session title,
   tool reminders, token economizer) happens at `llm/stream` / agent/tool events. Native
   registration is required to be subject to it; a side channel is a defect.
5. **Extensions must be `apply`-mountable.** A module with no `apply` (`lib/provider.js`) is a
   library, never a row.
6. **Conflict handling stays local.** A plugin may warn or yield its own namespace when a legacy
   provider is active; it must never unload or mutate a sibling plugin's registry entries.
7. **A vendor agent/session endpoint is forbidden as a model route.** A model-serving adapter must
   call the vendor's raw OpenAI-compatible (or equivalent) generation endpoint. It may use the
   vendor's local server only as a control plane for catalog/provider metadata/credentials.
   `POST /api/session/{id}/prompt`, `agent:"build"`, persona briefs, `[note: caller declared ...]`,
   vendor permission prompts, and vendor tool loops are all defects in this layer.
8. **Workspace cwd is DSH-owned.** Resolve it from
   `ctx.sessions.get(options.sessionId).header.cwd`; never pin a static `cwd` for model context.

## 3. Decommission of `@nolit/dsh-subrouter` (measured 2026-10-30)

| Action | Result |
|---|---|
| Live profile backup | `~/.dsh/profiles/web/cordis.patch.yml.bak.before-autonomous-router-20261030_204733` and matching `package.json` backup (created 2026-10-30 20:47) |
| Dependency removed | `@nolit/dsh-subrouter` removed from `~/.dsh/profiles/web/package.json` `dependencies` |
| Bundle removed | `@nolit/dsh-subrouter` removed from `dsh.profile.bundles` |
| Route references repointed | every `subrouter-openai/*` and `subrouter-anthropic/*` entry in `subagent-model-selection-settings.allowedModels` → `opencode-http-agent/opencode-go/*` (29 entries; providers `deepseek-account` + `opencode-http-agent`) |
| Node modules | orphan `profiles/web/node_modules/@nolit/dsh-subrouter` symlink removed after the package/bundle edits |
| Default route | unchanged `deepseek-account / deepseek-flash` (served by `@deepseek-ai/dsh-llm-deepseek-account`, never by the subrouter) |
| Session pins | measured 0 sessions pinned to a `subrouter-*` provider before removal |
| Orphan test profile | `~/.dsh/profiles/verify-subrouter/` archived/deleted after verification (isolated, not live) |

## 4. Pure native router now in place

`@nolit/dsh-opencode-v2/http` (package `0.5.0`) is the autonomous serving route and the golden
reference for future vendor adapters:

- bundle rows: `dsh-opencode-v2` (tool `/ocode`/`cli_worker`) + `dsh-opencode-v2-http`
  (`opencode-http-agent`);
- **data plane:** `POST {backendBaseUrl}/chat/completions` with `stream:true`,
  `stream_options.include_usage:true`, DSH `messages`/`tools` verbatim, and `reasoning_effort`;
- **control plane only:** local OpenCode `GET /api/model`, `GET /api/provider/{id}`,
  `GET /api/credential`; results are cached for `credentialCacheMs` and refreshed once on 401;
- **stream normalization:** OpenAI SSE deltas → DSH `block-start` / `text-delta` /
  `reasoning-delta` (`reasoningField`) / `tool-call-delta` / `block-end` / `usage` / `finish`;
- **usage:** cached tokens are subtracted from `prompt_tokens` (disjoint buckets), and
  `reasoning_tokens` is recorded but never added to `totalTokens` (it is part of output);
- **workspace:** `ctx.sessions.get(options.sessionId).header.cwd`; no static path override;
- conflict guard (`lib/conflicts.js`) warns when `opencode-go`/`opencode` (legacy pi-ai) is active,
  yields on `conflictPolicy: 'stand-down'`, and skips a second instance.

### 4.1 Correction: the session-prompt route was a nested harness

Measured on OpenCode v2.2.0 OpenAPI and a live session:

- `POST /api/session/{id}/prompt` always ran `agent:"build"` with OpenCode's own system prompt and
  tool loop; the adapter's `brief` default explicitly said *"You are OpenCode, an autonomous
  software-engineering agent..."* and appended `[note: the caller declared N tools ...]`.
- The model therefore ignored DSH's tool governance and answered as an OpenCode agent.
- The stateless server alternative `POST /api/experimental/generate/text` returns only
  `{data:{text}}` — no streaming, no tools, no usage — so it is not a valid DSH adapter.
- The corrected design bypasses both: raw OpenAI-compatible backend streaming, normalized into
  the same DSH `StreamChunk` contract used by `deepseek-account` (which speaks Anthropic Messages
  with `thinking_delta` and `cache_read_input_tokens`; the OpenAI adapter maps
  `reasoning_content` → `reasoning-delta` and `cached_tokens` → `cacheReadTokens`).

## 5. Verification

```bash
(cd dsh-opencode-v2 && npm test)      # 180/180
(cd dsh-opencode-v2 && npm run check) # node --check all lib files
npm run docs:index && npm run docs:check
```

Measured on the installed live profile before restart:

- `dsh --profile web --dump-config` → `dump_rc=0`, and the dump contains both
  `dsh-opencode-v2` and `dsh-opencode-v2-http` rows.
- `grep -n subrouter` over `~/.dsh/profiles/web/{package.json,cordis.patch.yml}` → no matches
  (`NO_SUBROUTER_REFS`).
- `allowedModels: 29 providers: deepseek-account,opencode-http-agent`.

Real-mount verification is performed after the approved `dsh-web.service` restart; a
`--dump-config` result is **not** mount evidence (`docs/RULES.md` §4).

## 5.1 Measured 2026-10-30 22:42–22:52 KST — the live failure and its two causes

After the 22:36 restart every `opencode-http-agent` turn failed with:

```
OpenCode backend HTTP 400: {"type":"error","error":{"type":"MissingSessionID",
 "message":"Request is missing x-opencode-session and cannot be routed efficiently.
  Please see https://opencode.ai/v2/docs/console/go/#where-can-i-use-it"}}
```

Read-only measurement (real credential, real endpoint, invalid/minimal bodies; no live state
written). Both defects are in the **current** `dsh-opencode-v2@0.5.0` adapter — not in the
decommissioned subrouter, which had the header (`sessionHeader`/`sessionFallback`, `lib/adapter.js:392-395`).

### Defect A — the session header is never sent

`lib/http.js:847-853` built the request headers from `attributionHeaders()` (user-agent only),
provider headers and `authorization`. `grep 'x-opencode-session' lib/ test/` → **0 matches**.

| Probe at `https://opencode.ai/inference/go/openai/v1/chat/completions` | Result |
|---|---|
| no `x-opencode-session` | **400** `MissingSessionID` |
| `x-opencode-session: <id>` present | 400 gone (proceeds to credential check) |

The OpenCode console documents the requirement for Go ("Send a stable session ID in
`x-opencode-session` for each conversation") and lists **DeepSeek Harness** under *known
problematic clients*: "Session information arrives on some model paths, but is missing on
others … remaining work is to send it across all adapters."

Reference pattern in the harness itself: `dsh-llm-deepseek/lib/index.js:2243` sends
`x-deepseek-harness-session-id` whenever `options.sessionId` is defined.

### Defect B — credential selection picks a revoked key over the live web (OAuth) token

`lib/http.js:762-773` `activeCredential()` reads `GET /api/credential` and takes the first entry
with `active === true` whose `integrationID` matches either the provider's integration
(`opencode`) or `backendProviderId` (`opencode-go`, the default at line 112).

Live `GET /api/credential` (keys redacted to their last 4 characters):

| id | integrationID | label | active | type | suffix | Go backend result |
|---|---|---|---|---|---|---|
| cred_1 | opencode | Master Key 1 | false | key | 4yhF | — |
| cred_2 | opencode | Master Key 2 | false | key | Cui7 | **403** "An active OpenCode Go subscription is required" |
| cred_14ea… | opencode | **Personal** | **true** | **oauth** | d659 | **200** (real completion, `usage` present) |
| cred_1830… | **opencode-go** | **OpenCode Go** | **true** | key | **4yjF** | **401 Invalid credential** |

The adapter therefore sends the revoked `opencode-go` **key** (`…4yjF`) even though the web
OAuth credential (`…d659`, `methodID: "device"`, `expires` ≈ 2026-11-17) is active and the Go
endpoint accepts it. The answer to "is auth already solved by the HTTP web login?" is **yes** —
the OAuth token works against the Go backend; only the selection order is wrong.

The two defects compound: A returns 400 before credentials are examined, and once A is fixed B
returns 401. Last successful OpenCode run before the restart: 22:03.

## 5.2 Measured 2026-10-30 23:14–23:24 KST — per-account model allow-list

### 5.2.1 The question

The prompt model picker offered all **49** catalog routes even though most cannot be used on this
account (Zen routes and some `-free` routes). Two requirements were measured out before any code:

1. Which routes are *actually usable*, without probing one model per conversation.
2. Let the operator tick routes in a settings tab, and show only those in the picker.

### 5.2.2 Entitlement is measurable in one sweep, not per turn

`/api/model` reports `status: "active"` and `enabled: true` for **all 49** routes (measured), so it
carries **no** entitlement. The account-level `/api/experimental/usage/limits` reports only
rolling/weekly/monthly percentages and a budget list — also no per-model information.

What *does* distinguish them is the backend's own answer to a one-shot request:

| Probe result (measured) | Count | Meaning |
|---|---|---|
| `200` | 35 | usable on this account |
| `400` `Upstream request failed: Model is unavailable.` | 12 | not entitled |
| `410` `Model … has been deprecated. Use …` | 2 | retired upstream |

A sweep of 49 routes at concurrency 8 completed in **20.1 s**, and reproduced the same
35 / 12 / 2 split both in a standalone script and through the adapter method. Two routes answered
a token-floor error (`max_output_tokens must be >= 16`) when probed with `max_tokens: 1`; the
sweep retries those once at 16 and classifies normally.

Measured split: of 19 `opencode/` (Zen) routes only 7 are usable; of 30 `opencode-go/` routes 28
are usable (2 deprecated).

### 5.2.3 Design: display-only filtering

The operator's requirement was "프롬프트 상태에서 표시만 안 해주면 돼" — hide from the picker only,
never disturb historical or running sessions. So the allow-list filters **`listModels()`** and
nothing else; no session is rejected and no stored conversation changes.

- Config `enabledModels: string[]` (volatile). **Empty means unrestricted**, so an unconfigured
  install behaves exactly as before. This default is the safety property that makes the change
  reversible by clearing the list.
- `enabledRouteFilter()` trims entries and returns `null` for an empty list.
- `listModels()` always keeps the `default` row, then keeps only allow-listed catalog ids.

### 5.2.4 Settings tab

`lib/client.js` registers a `settings.section` (`id: "opencode-v2"`, order 60) — the same slot the
built-in Models section uses. The host half serves three routes through
`ctx.connection.fetch.register` (the pattern `dsh-sidebar-manager` already uses):

| Route | Purpose |
|---|---|
| `/api/local/opencode-v2/model-settings` | catalog + current allow-list + what the picker shows |
| `/api/local/opencode-v2/model-settings/apply` | persist a new allow-list via `ctx.settings.update(ns, …)` |
| `/api/local/opencode-v2/model-settings/measure` | explicit entitlement sweep (button only) |

The sweep is **never** called from a conversation; the tab calls it only when the operator presses
the button.

> **Correction (2026-10-31, measured in a browser):** the 0.6.0 tab never rendered. `lib/client.js`
> declared `const inject = ['slots']` but exported only `apply`/`OpenCodeModelSection`, so `ctx.slots`
> was undefined at activation and the shell died with `web boot: 1 entry did not activate` /
> `@nolit/dsh-opencode-v2: failed`. Every point in §5.2.5 below is an HTTP route result — none of them
> exercises the browser boot, which is why the defect passed "verification". Fixed in 0.6.1.

### 5.2.5 Isolated verification (no live state touched)

An isolated `DSH_HOME` copy of the profile was booted on a scratch port:

- Boot log: no `error`, no `did not activate` — the earlier "cannot get property connection without
  inject" failure appeared only once and was fixed by adding `connection` (and `settings`) to
  `inject`.
- `model-settings` → 200, 49 models, 0 enabled, 49 visible.
- `apply` with 3 routes → 200, `visible` = exactly those 3, and the three ids were written into the
  isolated `cordis.patch.yml` under `dsh-opencode-v2-http.config.enabledModels`.
- `measure` → 200 in 19.4 s, returning 35 usable / 12 unavailable / 2 deprecated.

The live profile (`~/.dsh/profiles/web`) was **not** modified; it still has no `enabledModels` key.

### 5.2.6 Test hermeticity defect found and fixed

The suite was not hermetic: an adapter built without a profile context writes
`$DSH_HOME/cache/opencode-models.json`, and this shell exports the **live** `DSH_HOME`. The same
commit therefore passed (0 failures) or failed (2–5) depending on ambient environment — and the
run wrote a stray catalog into the live cache, which was removed.

Fix: `test/setup-isolate.mjs` points `DSH_HOME` at a fresh temp dir for every test process
(`node --import ./test/setup-isolate.mjs --test …`), and the unreachable-control-plane test pins an
explicit `catalogPath` so a cached catalog cannot mask the failure it exists to catch.

### 5.2.7 The revoked OpenCode Go key

The `opencode-go` key (`cred_1830…`, `…4yjF`) re-measured **401 Invalid credential**. The
`opencode` integration entries (`Personal` OAuth active; `Master Key 1/2` inactive) are the DSH web
authentication and are **not** to be deleted — removing them is an outage, not cleanup. Only the
`opencode-go` entry is disposable, via `DELETE /api/credential/{credentialID}`. v0.5.1 already
prefers the active OAuth entry, so deleting the dead key changes selection nothing.

### 5.2.8 Client-half activation defect (0.6.0) and its fix

The 0.6.0 settings tab never rendered, and the whole web UI stopped mounting after the 23:34 live
restart. Measured cause: `lib/client.js` declared `const inject = ['slots']` and used
`ctx.slots.inject('settings.section', …)` in `apply()`, but exported only `apply` and
`OpenCodeModelSection`. The loader injects only `module.exports.inject`, so `ctx.slots` was
`undefined`; the entry landed in `failed` and the shell's `BZ()` printed no detail.

Why the §5.2.5 checks passed: they are HTTP route probes. `--dump-config`, a 200 on the bundle and
`node --check` all pass with an unloadable client module. **Only a browser boot proves activation.**

Fix (0.6.1): `exports.inject = inject` (and the same on the default export face), plus a contract
test that evaluates the served module and asserts the exported `inject` covers every
`ctx.<service>` token used in `apply()`. Verification for 0.6.1 is a browser boot of the live
service, not a route sweep.

Verified (2026-10-31 00:19 KST): `dsh-web.service` restarted at 00:19:18, live profile resolves
`0.6.1`; browser boot renders the shell with no `web boot:` verdict and zero console errors, and
**Settings → OpenCode v2** mounts with all 49 routes listed (`선택 0 / 전체 49`, sweep button
present). The route sweep was not the proof — the rendered tab was.

### 5.2.9 Settings-tab usability: sorted checklist, persisted sweep (0.6.2)

The 0.6.1 tab worked but was awkward: 49 rows in catalog order after every open, the verdict
badge sat at the far right past the name and route, and closing the tab threw the sweep result
away, so the operator paid the ~20 s sweep again to see it.

Shipped in `0.6.2`:

| Piece | Behaviour |
|---|---|
| Sort | `sortModels(models, verdicts)`: usable → unchecked → everything rejected, ties by localized name. Every row is kept; sorting never filters. |
| Badge | Moved immediately beside the checkbox (`input → span → label → code`), fixed min-width so the names line up. |
| Persistence | `model-settings/measure` writes `{verdicts, measuredAt}` to `opencode-model-verdicts.json` (profile dir, `verdictPath` overrides); `model-settings` serves it back. Opening the tab shows `마지막 확인 <time>` and never re-sweeps. |
| Nav label | Follows the UI locale via `ctx.locale.getSnapshot()`: `오픈코드 V2` / `OpenCode V2` (was `OpenCode v2` in both). |

Measured live 2026-10-31 (browser, 3080): sweep 49 routes → **35 usable / 12 unavailable /
2 deprecated** in ~20 s; the tab reopened without a sweep showing `마지막 확인 2026. 10. 31. 오전 12:38:24`,
ordering intact (first rows usable, last rows unavailable), file written at
`~/.dsh/profiles/web/opencode-model-verdicts.json` (2,246 B, 49 routes).

`dsh-notify-web@0.1.7` in the same pass: its settings section moved from order 20 to 50 (below
에이전트 프리셋, above this tab) and its label is now locale-aware (`알림` / `Notifications`) instead
of a hardcoded Korean string.

## 6. Rules restated for the next session

1. Read `~/.dsh/AGENTS.md` → `docs/RULES.md` → `docs/SKELETON.md` → latest boot card before acting.
2. Measure the incumbent implementation before writing a replacement.
3. `~/.dsh` and the 3080 service are the user's; no writes or restarts without explicit approval.
4. `--dump-config` is not a mount. Verify by real mount in an isolated `DSH_HOME`.
5. Measurements and decisions belong in a root doc like this one, not only in a track README.
