# OpenCode Model Serving — Incident Post-Mortem, Autonomous Router Policy, and Decommission Record

<!-- skeleton:
version: 2.1
kind: report
status: active
updated: 2026-10-30
summary: Post-mortem of the subrouter detour and the nested-harness HTTP route, the permanent autonomous pure-router policy for all model-serving plugins, the measured decommission of @nolit/dsh-subrouter, and the direct OpenAI-compatible backend pattern.
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

## 6. Rules restated for the next session

1. Read `~/.dsh/AGENTS.md` → `docs/RULES.md` → `docs/SKELETON.md` → latest boot card before acting.
2. Measure the incumbent implementation before writing a replacement.
3. `~/.dsh` and the 3080 service are the user's; no writes or restarts without explicit approval.
4. `--dump-config` is not a mount. Verify by real mount in an isolated `DSH_HOME`.
5. Measurements and decisions belong in a root doc like this one, not only in a track README.
