# DSH parent + DeepSeek API capability re-measurement — usage, cluster host controller, cache nesting

<!-- skeleton:
version: 1.0
kind: measurement
status: measured
updated: 2026-10-29
summary: Measured whether usage, a cluster host controller, and cache nesting can be added as one DSH plugin, and whether the DeepSeek API supplies them; verified by isolated mount.
-->

> Status: **measured** · Runtime: DSH `0.2.2-alpha.2` (`/home/minami/.local/nodejs/lib/node_modules/@deepseek-ai/dsh/`) ·
> Upstream source: `/home/minami/.local/share/dsh` @ `1f81c047` ·
> Live service: `~/.dsh/profiles/web`, PID `267797`, `127.0.0.1:3080` (untouched) ·
> Method: source reading of the installed tree + **isolated `DSH_HOME` mount** of a throwaway probe plugin
> (`/tmp/opencode/probe`, `/tmp/opencode/probe2`) + live DeepSeek Platform and Inference API probes.

## 0. Answer up front

**Yes — all three can be added, and they can be added together, in one plugin, on top of the DSH parent.**

The probe plugin mounted once in an isolated `DSH_HOME` and reached all five seams it needed
(§4). The one genuinely new surface is `total_costs` (cumulative spend), which the DeepSeek
Platform already returns but the shipped DSH adapter discards (§2.1).

The DeepSeek API is **not** the source for any of the three. It supplies the *numbers* for two of
them (spend, cache-hit counters) and nothing for the third. The "cluster host controller" is a
pure DSH-side feature: DSH has no cluster concept at all, so it must be built on DSH's existing
multi-process surfaces (§2.3).

## 1. What was measured, and how

| # | Question | Method | Result file |
|---|---|---|---|
| 1 | Does the DSH parent already expose usage? | Read `dsh-token-meter`, `dsh-session-stats`, `dsh-client-ui-chat`, `dsh-client-ui-settings-account`, `dsh-api-account-controller` type surfaces | §2.1 |
| 2 | Does the DeepSeek API expose usage/spend? | Live `GET /user/balance` (API key) and live `GET /api/v0/users/get_user_summary` (Platform grant) | §2.1, §3 |
| 3 | Does DSH have a cluster / host-registry concept? | Grep of the whole installed tree for `cluster`, `hostId`, `multi-host`, `node controller`; read of `dsh-api-remotes`, `dsh-api-remote-access`, `dsh-client-connection`, `dsh-sdk-*`, `dsh-acp`, `dsh-experimental-forge`, `dsh-experimental-liveshare` | §2.3 |
| 4 | Can a plugin drive a *second* DSH host? | Isolated mount: probe spawned two `dsh --profile sdk` children and completed `initialize` on both | §4.3 |
| 5 | Does DSH have a nested/hierarchical cache concept? | Grep for `hierarchical cache`, `nested cache`, `multi-level`, `two-level`, `L1`, `L2`, `tiered`; read of every `cache`-bearing package | §2.2 |
| 6 | Can a plugin observe provider cache counters? | Isolated mount: 3 real DeepSeek calls through the plugin's `llm/stream` listener | §4.4 |

Everything under `/tmp/opencode/`. The live service (PID 267797) was **not** restarted and its
plugin rows were not changed. See §7 for the exact live-state footprint, which is **not zero** —
read it before assuming the live profile is untouched.

## 2. DSH parent surfaces (measured)

### 2.1 Usage — mostly present; the spend field is the gap

| Surface | Where | Carries |
|---|---|---|
| `tokenUsage` projection | `dsh-token-meter/lib/types/projection.d.ts:12` | `uncachedInputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens` (whole durable log) |
| `contextPressure` projection | `dsh-token-meter/lib/types/projection.d.ts:28` | `pressureTokens?`, `projectedTokens?`, `contextWindow?` |
| `contextBreakdown` projection | `dsh-token-meter/lib/types/projection.d.ts:56` | `systemTokens`, `toolsTokens`, `messageTokens` (heuristic) |
| `sessionStats` projection | `dsh-session-stats/lib/types/types.d.ts:18` | `turns`, `steps`, `llmMs`, `toolMs`, `ttftMs`, `ttftSteps`, `decodeMs`, `decodeTokens` |
| `ctx.tokenMeter` service | `dsh-token-meter/lib/types/index.d.ts:53` | `measure()`, `contextPressure()`, `estimateMessage()` |
| `deriveTurnTokenUsage()` | `dsh-token-meter/lib/types/turn-usage.ts:32` | exact per-turn usage incl. optional `cacheReadTokens`/`cacheWriteTokens`/`reasoningTokens` |
| `UsagePill` | `dsh-client-ui-chat/lib/types/client/chat/StatsPills.d.ts:69` | whole-log token total + cache-hit %; `cacheHitPercent()`, `billedInputTokens()` |
| Account balance RPC | `dsh-api-account-controller/lib/types/index.d.ts:27` | `account/getBalance` → recharge + bonus wallets (CNY/USD decimal strings) |
| Account UI | `dsh-client-ui-settings-account/lib/types/client/locales.d.ts` | `balance`, `bonusBalance`, `usage` (a *link* to the Platform web page), `topUp` |

**The gap.** The shipped balance projection parses only two of the three wallet arrays the Platform
returns:

```ts
// packages/credentials/deepseek-account-platform/src/details.ts:17
const summary = z.object({ normal_wallets: z.array(wallet), bonus_wallets: z.array(wallet) })
```

`total_costs` is **not** in that schema, so it is dropped by `zod`'s default strip behavior. The
Platform *does* return it — measured live, §3. A plugin that wants cumulative spend therefore
either (a) reads `get_user_summary` itself, or (b) the upstream schema gains a `total_costs` field.
Option (a) is measured working in the isolated mount (§4.2); option (b) is a one-line upstream change
but is not required for a plugin.

### 2.2 Cache — the provider cache is fully instrumented; there is no *nested* cache

- `dsh-llm` reports `TokenUsage.cacheReadTokens` / `cacheWriteTokens`
  (`packages/llm/llm/src/types.ts:167`). The two buckets are disjoint from `inputTokens`.
- `dsh-llm-deepseek` maps the Anthropic-Messages wire fields
  `cache_read_input_tokens` → `cacheReadTokens` and `cache_creation_input_tokens` →
  `cacheWriteTokens` (`packages/llm/llm-deepseek/src/translate.ts:36`). Its base URL is
  `https://api.deepseek.com/anthropic` (`packages/llm/llm-deepseek/src/config.ts:116`).
- The DeepSeek **OpenAI-compatible** route reports the same thing under different names:
  `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`. Those two names appear **nowhere** in the
  installed tree — DSH uses the Anthropic-compatible endpoint, so it never needs them. The upstream
  e2e test's comment at `packages/core/agent-loop/tests/request-cache.e2e.ts:18` says "the adapter
  maps the provider's `prompt_cache_hit_tokens`"; that is **not** what the code does. The code maps
  `cache_read_input_tokens`. The observable is the same (`cacheReadTokens > 0`), the comment is wrong.
- **No hierarchical / nested / multi-level cache exists.** Grep for `hierarchical cache`,
  `nested cache`, `multi-level cache`, `two-level`, `tiered cache`, `L1 cache`, `L2 cache` over the
  whole installed tree returns **zero** hits. Every cache is single-level:
  `ctx.sessionProjectionCache` (per-session projection checkpoints, no TTL, no eviction),
  `SessionObservationReader` (bounded LRU, cap 5), `RepositoryCache` (plugin market, LRU by bytes),
  `ModelListingCache` (`modelsMaxAgeMs` = 600000), `SkillRegistry.collectCache`,
  `OfficeToPdf` content cache, plus client-side maps.
- So "cache nesting" has two distinct readings, and they have different answers:
  - **Provider KV cache (the DeepSeek one)** — already fully wired and already surfaced. Nothing to
    build; a plugin only *reads* it.
  - **A nested L1/L2 harness cache** — does not exist. A plugin could add one, but it would be a
    new capability seam, not an extension of an existing one, and it has no current consumer.

### 2.3 Cluster / host control — DSH has no cluster concept; it must be built

Exhaustive grep of the installed tree:

| Search | Result |
|---|---|
| `cluster` (case-insensitive, `.d.ts` + `README.md` + `.yml`) | **8 hits, all metaphorical**: the Client Session object layer (×3), Unicode grapheme clusters (×2), a verb about stream tails (×2), Chrome DevTools layout-shift metric names (excluded) |
| `hostId` / `host_id` / `host-id` | **0 hits** — no host identity type exists anywhere |
| `multi-host` | **1 hit**, and it is a *negative* statement: `dsh-experimental-liveshare/README.md:162` — "Owner share-state updates and gateway ownership are not coordinated across Hosts… **This is not a multi-host authorization service.**" |
| `host controller` | 5 hits, all meaning "the controller inside one host process" (`dsh-api-job-controller`, `dsh-api-workspace-controller`) |
| `node controller` | **0 hits** |

**"Remote" in DSH does not mean remote machine.** `dsh-api-remotes` / `dsh-api-remote-access` are
*typed Client↔Host RPC endpoints* inside one process. `dsh-api-session-controller/.../remotes.d.ts:2`
says "Remote namespaces the Session cluster calls" — that "cluster" is the Client Session object
layer, not a fleet.

What DSH actually offers for driving more than one host:

| Surface | Transport | Notes |
|---|---|---|
| `dsh-sdk-jsonrpc-server` + `dsh-sdk-protocol` | **stdio, newline-delimited JSON-RPC 2.0** | `initialize`, `session/prompt`, `session/resume`, `session/wait`, `shutdown`; no network listener, no auth |
| `dsh-acp` / `dsh-acp-app` | stdio JSON-RPC | one connection, many sessions, all in one process |
| `dsh-client-connection` | HTTP POST `/api` + WebSocket `/connect` | one `HostConnectionService` per Host process; `ConnectionGeneration` carries only `{ id, host: { home } }` — no host address or registry |
| `dsh-experimental-forge` | in-process | code host (GitHub) registry — change requests, **not** compute hosts |
| `dsh-jobs-local` | in-process | jobs are Session-scoped and die with the process |
| `dsh-web` | HTTP | the *web search/fetch* capability seam, unrelated to hosts |

**Conclusion:** a "cluster host controller" is a **new capability seam**. It is not a missing
plugin. The buildable substrate is `ctx.subprocess.spawn()` + the SDK stdio JSON-RPC protocol, with
a plugin-owned host registry on top. §4.3 measures that substrate working.

## 3. DeepSeek API surfaces (measured live)

### 3.1 Inference API — balance only, no usage history

```bash
curl -s https://api.deepseek.com/user/balance -H "Authorization: Bearer $DEEPSEEK_API_KEY"
```
```json
{"is_available":true,"balance_infos":[{"currency":"USD","total_balance":"13.35",
 "granted_balance":"0.00","topped_up_balance":"13.35"}]}
```
HTTP 200. This is the **only** account endpoint in the public API reference. It reports current
balance, not spend and not per-token usage. There is no usage-history endpoint.

### 3.2 Platform API — balance **and** cumulative spend

```bash
curl -s https://platform.deepseek.com/api/v0/users/get_user_summary \
  -H "x-dsh-auth-token: $PLATFORM_TOKEN" -H "x-client-platform: web"
```
```json
{"code":0,"data":{"biz_data":{
  "normal_wallets":[{"currency":"USD","balance":"13.3563585660000000","token_estimation":"0"}],
  "bonus_wallets":[{"currency":"USD","balance":"0","token_estimation":"0"}],
  "total_costs":[{"currency":"USD","amount":"36.6436414340000000"},
                 {"currency":"CNY","amount":"6.1283399200000000"}]}}}
```
HTTP 200. **`total_costs` is present and is dropped by the shipped DSH schema** (§2.1). Probing for
a dedicated usage/breakdown endpoint returned **404** for all of:
`/api/v0/users/get_usage`, `get_usage_summary`, `get_usage_detail`, `get_usage_detail_v2`,
`get_daily_usage`, `get_token_usage`, `get_statistics`, `get_consumption`, `get_bills`,
`get_cost_detail`, `/api/v0/usage/get_summary`, `/api/v0/usage/get_usage`.

`/api/v0/users/get_unnotified_bonuses` → HTTP 200, `biz_data: []`.

**Asymmetry worth knowing before building on this.** The *profile* endpoint and the *wallet*
endpoint behave differently from the same host with the same grant:

| Endpoint | Result with the stored grant |
|---|---|
| `GET /auth-api/v0/users/current` | **403** — CloudFront `Request blocked` HTML page |
| `GET /api/v0/users/get_user_summary` | **200** — JSON with `normal_wallets`, `bonus_wallets`, `total_costs` |

The live service's journal shows the matching `[deepseek-account] request failed … status: 403`
for the profile path, repeatedly, since **09:00:55** — before this session began. So the shipped
`getProfile` fails while `getBalance` succeeds, from this client, today. A usage feature should
read the **summary** endpoint and must not depend on `getProfile` succeeding.

### 3.3 Context caching — enabled by default, no code change needed

Per [Context Caching](https://api-docs.deepseek.com/guides/kv_cache): caching is **on by default**;
a hit requires the request to *fully* match a persisted cache-prefix unit; the response reports
`prompt_cache_hit_tokens` and `prompt_cache_miss_tokens`.

Measured live, same prompt twice, Anthropic-compatible route (the one DSH uses):

| Round | `input_tokens` | `cache_read_input_tokens` | `cache_creation_input_tokens` | `output_tokens` |
|---|---|---|---|---|
| 1 | 365 | **128** | 0 | 1 |
| 2 | 237 | **256** | 0 | 1 |
| 3 | 237 | **256** | 0 | 1 |

Same request on the OpenAI-compatible route: `prompt_cache_hit_tokens: 256`,
`prompt_cache_miss_tokens: 237`, `prompt_tokens_details.cached_tokens: 256`.

**Cache hits are real and are already reported by the DSH adapter.** There is nothing for a plugin
to *enable*; a plugin only *observes* them.

### 3.4 No cluster/host endpoint on the Platform

All of `/api/v0/hosts`, `/api/v0/instances`, `/api/v0/nodes`, `/api/v0/cluster`,
`/api/v0/cluster/nodes`, `/api/v0/compute`, `/api/v0/usage` → **404**. The DeepSeek API does not
expose host or cluster management.

## 4. The decisive test — one plugin, all three features

A throwaway plugin (`/tmp/opencode/probe`) was mounted in an isolated `DSH_HOME`
(`/tmp/opencode/iso`), using a copied credentials document. It is not a deliverable; it is the
evidence.

### 4.1 It mounted and ran

```
[dsh-probe] apply() called; ctx.get is function; ctx.effect is function
[dsh-probe] effect body entered
[dsh-probe] step1: resolving deepseekAccount
[dsh-probe] step1: account = present
[dsh-probe] step1: platformSession = present
[dsh-probe] step1: platform HTTP 200
```

Two service-injection facts that cost real debugging time and are worth recording:

- `ctx.get('deepseekAccount')` returns **`undefined`** unless the plugin declares
  `export const inject = ['deepseekAccount', …]`. Without the declaration the effect runs before
  the account service activates and the probe silently saw "absent".
- `ctx.on('llm/stream', …)` **pends** until `llm` is injected. Declaring `inject = […, 'llm']` is
  what makes the listener register.

### 4.2 Usage — the plugin read live spend

```json
"accountSpend": {
  "ok": true, "httpStatus": 200,
  "balanceKeys": ["normal_wallets", "bonus_wallets", "total_costs"],
  "total_costs": [{"currency":"USD","amount":"36.6436414340000000"},
                  {"currency":"CNY","amount":"6.1283399200000000"}],
  "normal_wallets": [{"currency":"USD","balance":"13.3563585660000000"}],
  "bonus_wallets": [{"currency":"USD","balance":"0"}]
}
```

Reached via `ctx.get('deepseekAccount').getPlatformSession()` → `{ origin, token }` → a direct
`fetch` to `get_user_summary`. `getPlatformSession()` is Host-only and deliberately absent from
the account-controller RPC, so a plugin reads it on the Host side and projects it to the client
itself.

`ctx.tokenMeter` was present with exactly the three public methods
`contextPressure`, `measure`, `estimateMessage`.

### 4.3 Cluster host controller — the plugin drove two extra hosts

```json
"cluster": {"ok": true, "hosts": [
  {"label":"cluster-a","pid":401044,"ok":true,
   "serverInfo":{"name":"deepseek-harness-sdk-runtime","version":"0.0.1"}},
  {"label":"cluster-b","pid":401045,"ok":true,
   "serverInfo":{"name":"deepseek-harness-sdk-runtime","version":"0.0.1"}}]}
```

Two independent `dsh --profile sdk` children, spawned by the plugin, both answered `initialize`
over stdio JSON-RPC. A standalone run outside DSH reproduced this with two concurrent hosts.

### 4.4 Cache — the plugin observed real provider cache hits

Three real calls through the plugin's `llm/stream` listener, model `deepseek-flash`, identical
long system prefix:

| Round | `inputTokens` | `outputTokens` | `cacheReadTokens` | `cacheWriteTokens` | `totalTokens` |
|---|---|---|---|---|---|
| 1 | 298 | 2 | **0** | 0 | 300 |
| 2 | 170 | 2 | **128** | 0 | 300 |
| 3 | 170 | 8 | **128** | 0 | 306 |

Round 1 misses; rounds 2 and 3 hit. The plugin saw the provider's cache counters **without any
adapter change**, and `cacheWriteTokens` is 0 because DeepSeek's disk cache reports hits only.

### 4.5 Host HTTP route — the plugin owned a URL

```js
webServer.register({ kind: 'exact', path: '/probe/usage', handler: … })
```

```bash
$ curl -s http://127.0.0.1:3098/probe/usage
{"spend":[{"currency":"USD","amount":"36.6436414340000000"},
          {"currency":"CNY","amount":"6.1283399200000000"}]}
HTTP:200
```

A plugin can therefore serve a usage endpoint on the existing Host web server. Note the measured
caveat: `dsh-host-webserver` has **no server-wide authentication** ("route owners such as
`dsh-client-connection` enforce their own request policy"), so a plugin that publishes spend data
must apply its own authorization. The probe route answered **HTTP 200 without any token** — that
is a finding about the surface, not a recommendation.

## 5. Can they be done together?

**Yes.** The five seams the probe used are disjoint and additive:

| Feature | Host seam used | Client seam used | Conflicts? |
|---|---|---|---|
| Usage | `ctx.deepseekAccount.getPlatformSession()` + `ctx.tokenMeter` + `ctx.webServer.register()` | `ctx.slots.inject('settings.section', …)` (pattern verified in `dsh-notify/lib/client.js:1588`) | None |
| Cluster host controller | `ctx.subprocess.spawn()` + SDK stdio JSON-RPC | new `settings.section` or a dedicated panel | None |
| Cache nesting (observe) | `ctx.on('llm/stream', …)` waterfall | reads `tokenUsage` projection via `UseProjection` | None |

Measured in one mount, with no tool/route collision and no service conflict.

**Recommended shape: one plugin package with two halves.**

- Host half (`lib/index.js`): the spend reader, the `llm/stream` cache observer, and the host
  registry / child-process supervisor.
- Browser half (`lib/client.js`): the settings section and the cluster roster, following the
  `dsh-notify-web` precedent (`package.json#dsh.client` with `platform: "web"`, `inject`,
  `exports["./client"]`).

**Two cautions before anyone builds this.**

1. **Do not read `total_costs` by scraping a private Platform endpoint from the browser.** The
   Platform path `/api/v0/users/get_user_summary` is undocumented in the public API reference and
   returns `code: 40002` without the Platform grant. The shipped DSH adapter deliberately projects
   only wallets. A plugin that wants spend should either extend the upstream schema (one line at
   `packages/credentials/deepseek-account-platform/src/details.ts:17`, plus the account types) or
   keep the read Host-side behind `getPlatformSession()` — which is what the probe did. The
   browser half must receive the number, not the token.
2. **"Cache nesting" must be pinned to one meaning before it is built.** If it means *observe the
   provider KV cache*, it is a small read-only feature over data DSH already produces (§4.4). If
   it means *a nested L1/L2 harness cache*, it is a new capability seam with no current consumer,
   and it would have to live upstream rather than in a plugin — a plugin cannot add a harness-wide
   cache service that other packages do not consume.

## 6. What the DeepSeek API contributes, restated

| Feature | DeepSeek API contribution | DSH parent contribution | Plugin still needed? |
|---|---|---|---|
| Usage — balances | `GET /user/balance` (public API key) | `account/getBalance` RPC + account UI already ships it | **No** — already in the product |
| Usage — cumulative spend | `total_costs` in `get_user_summary` (undocumented; dropped by the shipped schema) | — | **Yes** (or a one-line upstream schema change) |
| Usage — token/cache counters | provider `usage` block | `tokenUsage` projection, `UsagePill`, `tokenMeter` | **No** — already in the product |
| Cluster host controller | **nothing** (404 on every host/cluster path) | no cluster concept; SDK stdio + `ctx.subprocess` are the substrate | **Yes**, in full |
| Cache — provider KV cache | on by default; `prompt_cache_hit_tokens` (OpenAI route) / `cache_read_input_tokens` (Anthropic route) | already maps to `cacheReadTokens`/`cacheWriteTokens` | **No** to observe; **Yes** only if a new *harness* cache is wanted |

## 7. Corrections and side findings

1. **`packages/core/agent-loop/tests/request-cache.e2e.ts:18` is inaccurate.** It states "the adapter
   maps the provider's `prompt_cache_hit_tokens`". The adapter
   (`packages/llm/llm-deepseek/src/translate.ts:36`) maps `cache_read_input_tokens` /
   `cache_creation_input_tokens`, because DSH uses the Anthropic-compatible base URL
   (`https://api.deepseek.com/anthropic`). The asserted observable (`cacheReadTokens > 0`) holds;
   the named wire field does not. `prompt_cache_hit_tokens` appears nowhere in the installed tree.
2. **`~/.dsh/profiles/sdk/` was created by this session** (measured: directory ctime
   `2026-10-29 10:55:27`). The `dsh --profile sdk` invocations during the cluster measurement made
   the launcher materialize the missing profile. It holds only the generated stub — `cordis.yml` =
   `[]`, an empty `cordis.patch.yml`, a `package.json` naming `dsh-base` + `dsh-sdk-app`, and
   `pnpm-workspace.yaml`. It is **not referenced** by the live `web` profile and no bundle lists
   it. It was left in place rather than deleted, because removing a directory is a destructive
   action outside the session workspace; it is inert and additive.
3. **The live `web` profile patch was rewritten at 11:28:42, and the writer was the live GUI, not
   this measurement.** Measured: the file mtime is **87.9 ms** after the `model/selection` event at
   `seq 31` of session `session-30c5e585-9615-4cb6-bf4f-3d093651b80f`
   (`time: 1793240922491` = 11:28:42.491 KST). That event carries
   `{"provider":"deepseek-account","model":"deepseek-flash","reasoningEffort":"low"}` — exactly
   the values now in the patch's `agent-default-model` row, which the previous backup carried as
   `reasoningEffort: off`. The write path is `agentDefaultModel.saveSelection()` →
   `configEditor.edit()` → `writeFileAtomic(profile patch)`; `saveSelection` is called by
   `session-controller` when the **user changes the model in the GUI**
   (`packages/api/session-controller/src/commands.ts:177`). The same session log shows the user
   message at 11:28:18 and a `[model changed: …]` notice afterwards.
   **This measurement did not cause it.** Two independent checks:
   - `dsh --profile web --dump-config` **does not write `cordis.patch.yml`**: a sentinel line
     added to an isolated profile's patch file survived the command unchanged
     (md5 `9c9216c7…` before and after, sentinel still present).
   - The patch's `agent-default-model` value matches the GUI's `model/selection` payload, not
     anything this session wrote.
   The **`cordis.yml`** file was also rewritten by the same `--dump-config` call
   (`prepareProfile()` writes `PROFILE_ROOT_CONFIG` unconditionally,
   `lib/profile-boot-e2mS45fC.js:221`), but its content is byte-identical to what was already
   there (md5 `da08f433…`, same as the pristine template). Only the mtime moved.
4. **`~/.dsh/storages/workspace.json`** was rewritten at 11:26:46 — the live service's own
   workspace registry, touched by the live GUI session, not by this measurement.
5. **`node scripts/audit-promoted-state.mjs` was not re-run.** The one failing item recorded in
   boot card §7.6 (two `session_projcache` identities without a backing file) is unchanged by this
   measurement.
6. **The live service's `[deepseek-account] request failed` 403s are pre-existing, not caused here.**
   They appear in the journal from **09:00:55**, before this session's first action, and repeat
   every few minutes. A direct probe reproduces the block: `GET
   https://platform.deepseek.com/auth-api/v0/users/current` returns a CloudFront
   `403 Request blocked` HTML page, while `GET /api/v0/users/get_user_summary` with the same grant
   returns HTTP 200. The profile endpoint is edge-blocked for this client; the wallet/summary
   endpoint is not. This is also why the shipped `getProfile` fails while `getBalance` succeeds.
3. **The live service's `[deepseek-account] request failed` 403s are pre-existing** — they appear
   in the journal from **09:00:55**, before this session began. A direct probe shows why:
   `GET /auth-api/v0/users/current` returns a CloudFront `403 Request blocked` page, while
   `GET /api/v0/users/get_user_summary` with the same grant returns HTTP 200. The profile endpoint
   is edge-blocked for this client; the wallet endpoint is not. The shipped `getProfile` therefore
   fails while `getBalance` succeeds — a platform-side condition, not a DSH defect and not caused
   by this measurement.
4. **The probe's own first failure mode is worth recording for whoever builds the real thing:**
   `ctx.get(<service>)` returns `undefined` without a matching `inject` declaration, and
   `ctx.on('llm/stream', …)` silently pends without `inject = ['llm']`. Both look like "the feature
   is not available" and are actually "the plugin declared no dependency".

## 8. Reproduce

```bash
# 1. Isolated probe mount (creates /tmp/opencode/iso, port 3098)
DSH_HOME=/tmp/opencode/iso DSH_PROBE_OUT=/tmp/opencode/probe-out.json \
  dsh --profile probe --port 3098 --host 127.0.0.1 --no-open
curl -s http://127.0.0.1:3098/probe/usage

# 2. Two concurrent DSH hosts over the SDK stdio channel
node /tmp/opencode/sdkdrive.mjs

# 3. Live DeepSeek cache counters (Anthropic route, DSH's own)
curl -s https://api.deepseek.com/anthropic/v1/messages \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" -H 'content-type: application/json' \
  -d '{"model":"deepseek-chat","max_tokens":8,
       "messages":[{"role":"system","content":"…stable prefix…"},
                   {"role":"user","content":"ok"}]}'
#   → usage.cache_read_input_tokens: 256 on the second identical call

# 4. Live Platform spend
curl -s https://platform.deepseek.com/api/v0/users/get_user_summary \
  -H "x-dsh-auth-token: $PLATFORM_TOKEN" -H "x-client-platform: web"
#   → data.biz_data.total_costs
```

Probe sources: `/tmp/opencode/probe/lib/index.js`, `/tmp/opencode/probe2/lib/index.js`.
Evidence: `/tmp/opencode/probe-out.json`, `/tmp/opencode/cache-out.json`.
