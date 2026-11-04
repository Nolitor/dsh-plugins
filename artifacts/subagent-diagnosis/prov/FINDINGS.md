# Subagent provider catalog — root cause for session `e42cf5d8`

Task: task-1 (owner: provider-analyst). Measured 2026-11-05 07:49–07:56 KST.
Raw command output: [`raw/measurements.log`](raw/measurements.log), [`raw/verify-policy-vs-config.txt`](raw/verify-policy-vs-config.txt).
Read-only: nothing under `~/.dsh`, no repo source, no config was modified. Only writes: `artifacts/subagent-diagnosis/prov/`.

---

## 0. Verdict (one paragraph)

The session's subagent catalog is a **durable per-session snapshot**, not a live view of the provider
registry. `subagent/model-selection-policy` is written **once, at agent creation**, from the then-current
profile config value `subagent-model-selection-settings.allowedModels`, and is never re-resolved
(`dsh-tool-subagent/lib/model-selection-settings.js:52-58, 86-101`). Session
`session-e42cf5d8-b927-42fc-814b-6b30a38f9983` was created **2026-11-05 05:42:45.900 KST**; at that
instant the profile's `allowedModels` was exactly the **8 `opencode-http-agent` routes** that appear as
the session's policy event (`.912 KST`, seq 3). The `deepinfra` and `antigravity` routes were added to the
same config **after** the session was created — the config now holds **11 routes** — so no amount of
restarting or config reloading could ever add them to that session. `list_subagent_models` is also
**policy-filtered**: its no-argument form lists only registered providers whose id appears in the
session's allowed routes (`dsh-tool-subagent/lib/index.js:189-191`), and `provider`-scoped calls reject at
the allow-list check (`:194-196`) *before* the registration check (`:197`). Therefore "only
opencode-http-agent is available" measures the **session policy**, not the registered provider set.

Consequence for the two parent assertions in the brief:

| Parent assertion | Verdict | Basis |
|---|---|---|
| "이 세션에서 subagent에 허용된 provider는 opencode-http-agent 하나뿐" | **Correct for that session at that time**, but the observed `list_subagent_models` output is *not* evidence about registered providers (it is policy-filtered). | policy event seq 3 = 8 routes / 1 provider (measured); index.js:190 filter; index.js:194-196 reject-before-registration |
| "Gemini 3.5는 레지스트리에 없고 antigravity 플러그인 기본값은 gemini-3.8-flash" | **Gemini 3.5 claim REFUTED.** "Default = gemini-3.8-flash" is only the *default model id*, not the catalog. | `dsh-antigravity/lib/catalog.js:37-41` maps `gemini-2.5-flash*` → base id **`gemini-3.5-flash-lite`**; `lib/backends.js:16` `DEFAULT_MODEL='gemini-3.8-flash-low'`; live probe at 07:50:24 returned `PROBE_OK antigravity gemini-3.5-flash-lite` |

---

## 1. Measured timeline (KST, 2026-11-05)

| Time | Evidence | Meaning |
|---|---|---|
| 05:13:47 | mtime of `cordis.patch.yml.bak.before-{antigravity-rc4,subagent-removal}-*` (preserved copy of source) | last content edit of `cordis.patch.yml` **before** the session: `allowedModels` = **8 opencode routes**, no `dsh-antigravity` row |
| 05:42:29 | backup filename `…before-antigravity-rc4-20261105_054229`; `.plugin-manager/logs/operation-8Pbqk2` | profile edit/install immediately before session creation |
| 05:42:32 | mtime preserved in `package.json.bak.before-subagent-removal-…` | `package.json` last edited (antigravity added to deps + bundles) |
| **05:42:45.900** | `parent.v4.jsonl` event 1 (`type:"session"`, `createdAt:1793824965900`) | **session `e42cf5d8` created** |
| **05:42:45.912** | `parent.v4.jsonl` seq 3 `subagent/model-selection-policy` | **policy snapshot: 8 routes, provider set = {opencode-http-agent}**; byte-for-byte equal to the 8-route `allowedModels` block in the 06:05:54 backup (verified: `raw/verify-policy-vs-config.txt`) |
| 06:05:54 / 06:05:57 / 06:09:10-11 | backup `…before-subagent-removal-20261105_060554`; `.plugin-manager/logs/operation-3NSMEJ`, `-4ZzgA8`, `-Ih6xWp` | subagent-* bundle removal; `cordis.patch.yml` still at the 05:13:47 state |
| 06:27:02 | seq 4 `session/end-seed` | seed phase ends |
| 07:17:09 | `stat ~/.dsh/profiles/web/cordis.yml` mtime | **a `dsh --profile web` process booted here** (`prepareProfile` always rewrites the empty root config: `dsh/lib/profile-boot-e2mS45fC.js:214-222`, called by `dump-config-D97dwXdd.js:25`; no `--dump-config` was run today — 0 occurrences in both session transcripts, `~/.bash_history` mtime 11-04) |
| 07:20:15 | `stat ~/.dsh/profiles/web/package.json` mtime | bundles edited (adds `@deepseek-ai/dsh-experimental-agent-team-profile`; antigravity/deepinfra/opencode-v2 retained) |
| 07:20:30 | `session-e42cf5d8…/session.lock` created | session reopened (only session that is active from that boot: the same second the UI re-attached) |
| 07:20:36 | seq 5 `agent-preset/selected` = `ptc` | this is why the session's tool catalog is the fixed ptc preset list (see §4) |
| 07:24:09 | seq 17 `system/message`, seq 24 `request/header` | first turn; parent model = `deepseek-account/deepseek-flash` |
| 07:24:30 | seq 68-78 `tool/ptc-dispatch` | `list_subagent_models({})` → `opencode-http-agent — OpenCode Go (direct)`; `provider` probes for `deepseek-account`, `deepseek-official`, `opencode-go`, `antigravity`, `deepmind` all fail with **"is not allowed for this Session"** (a policy error, not a registration error) |
| 07:25:47 | seq 211 tool result | parent's evidence for the Gemini claim: `grep -rn "gemini…" dsh-antigravity/lib/*.js \| head -5` → exactly 5 lines, all from `adapter.js`/`auth.js`/`backends.js`; **`catalog.js` was cut off by `head -5`** |
| 07:41:18 | session `session-55b09c80` event 1 (`createdAt:1793832078701`) | **new top-level session; its policy event (seq 3, 07:41:18) has 11 routes incl. `deepinfra` + `antigravity/gemini-3.5-flash-lite`** → the config value had already changed by 07:41:18 |
| 07:43:39 | seq 1004 `turn/end` (turn 3) | end of the snapshot decompressed into `parent.v4.jsonl`… |
| 07:47:11.253 | seq 4 `model/selection` (lead session) | model pick in the UI |
| **07:47:11.394** | `stat` birth/mtime of `~/.dsh/profiles/web/cordis.patch.yml` | the settings service **atomically replaced** the patch document (`dsh-config-editor/lib/index.js:8,122`); it now contains **11** `allowedModels` (lines 83-105) + the `dsh-antigravity` block (lines 139-171). This is a re-serialization of the live config, **not** the moment the routes were added |
| 07:48:23 | lead session seq 168 | `list_subagent_models({})` = `deepinfra`, `antigravity`, `opencode-http-agent` (3 providers) |
| 07:49:10 / 07:53:15 | **live** `session-e42cf5d8` seq 1006 / 1087 (`turn/start` 4 / 5) | the investigated session is **still running** after the 07:43 snapshot; its only policy event is still seq 3 with 8 routes |
| 07:50:19-24 | lead session seq 383-391 + child sessions 54938eea / e62712fa | subagents actually launched with `antigravity/gemini-3.5-flash-lite` and `deepinfra/deepseek-ai/DeepSeek-V4.1-Flash-1017`; both returned `PROBE_OK`; child `request/header` confirms `{"provider":"antigravity","model":"gemini-3.5-flash-lite","reasoningEffort":"low"}` and `{"provider":"deepinfra","model":"deepseek-ai/DeepSeek-V4.1-Flash-1017"}`; both children inherited the parent's 11-route policy |

Timeline conclusion: **the config change (8 → 11 routes) happened after 05:42:45.900 and before
07:41:18**, i.e. after the investigated session's creation and even after its last turn in the supplied
snapshot. There is no scenario in which that session could have shown deepinfra or antigravity.

## 2. Mechanism — where the policy comes from and why it never changes

`@deepseek-ai/dsh-tool-subagent/model-selection-settings` (`lib/model-selection-settings.js`):

- `:75-78` config schema — `enabled` + `allowedModels` are `volatile()` (live-settings fields).
- `:83-103` `[Service.init]`: on **`agent/created`** it resolves the policy and appends it:
  - `:90` if the session already has a policy → `return` (never overwritten);
  - `:92-99` a *subagent* inherits its parent session's policy; a **top-level session with
    `firstLiveSeq === 0`** (fresh) takes `this.current()`;
  - `:100` `target.append("subagent/model-selection-policy", { allowedModels })` — durable event.
- `:108-117` `current()` returns `config.allowedModels` **verbatim** — no intersection with registered
  providers, no filtering, no model validation.
- `:52-58` the projection that reads the policy back is append-once: `if (policy !== null || event.type !== …) return policy`.

Consequences:
1. The policy is frozen at creation. A later config edit, a settings write, a daemon restart, or a
   plugin mount can never extend an existing session's allow-list. (Verified in this case: the live
   session `e42cf5d8` at 07:54 KST still has only seq-3's 8 routes while the same daemon's new sessions
   have 11.)
2. The authoritative runtime value is the **live config document**, not the mtime of the YAML: the
   settings plugin writes the whole override document on the next settings save, which is why the file
   carries a misleading 07:47:11 birth time even though the routes were effective < 07:41:18.

`@deepseek-ai/dsh-tool-subagent` (`lib/index.js`) discovery:

- `:190` `llm.listProviders().filter(p => policy.routes.some(r => r.provider === p.id))` — **the no-arg
  list is the intersection of registered providers × the session policy**.
- `:194-196` a provider not in the policy throws `LLM provider "X" is not allowed for this Session`
  **before** `:197 registeredProvider()` ever consults `llm.listProviders()`. The message in the parent
  transcript ("not allowed for this Session") says nothing about registration.
- Direct proof that the list is policy-filtered, not registry-complete: the running daemon also serves
  `deepseek-account` (the top-level session's own model, `request/header`: `provider:"deepseek-account"`),
  yet `deepseek-account` does **not** appear in the 07:48:23 no-arg list — because it is not in
  `allowedModels`.

## 3. Why the two providers apparently "did not exist"

Registration paths do not depend on credentials/catalog availability at mount time:

- `@nolit/dsh-antigravity`: `lib/index.js:378-405` registers the `antigravity` LLM route from
  `ctx.llm.registerAdapter([PROVIDER_ID], adapter)` (`:400`) when `enabled && modelServing`
  (`modelServing` default `true`, `lib/index.js:91`). Token acquisition is lazy (`TokenProvider`); the
  adapter only *warns* if registration throws. So the provider is present iff the **plugin is mounted**.
- `@nolit/dsh-deepinfra`: `lib/index.js:98,239` — `apply()` calls `ctx.llm.registerAdapter([PROVIDER_ID], adapter)`;
  `apiKey` is `default('')`.role('secret')` with `DEEPINFRA_API_KEY` fallback (`:79`), and `enabledModels`
  (`:89`); registration is not gated on a key.

Whether these plugins were mounted during 05:42–07:43 cannot be read off the session log — and the
parent's two "measurements" cannot decide it:

- Tool absence in the transcript is **not** evidence: session `e42cf5d8` ran under the `ptc` agent preset
  (`agent-preset/selected` at 07:20:36), whose plugin list is fixed in
  `@deepseek-ai/dsh-web-app/presets/ptc.patch.yml` (33 declarations; no `agy_worker`, no `cli_worker`,
  no `subagent_antigravity`). The 33-tool catalog in `parent.v4.jsonl` seq 17 matches that preset, so
  "no antigravity tool in the catalog" only confirms the preset, not the mount state.
- `list_subagent_models` cannot decide it either (see §2).
- Sandbox limitation: the daemon's PID/start time is not observable here (the shell runs in a bwrap PID
  namespace; `ps` shows only the sandbox; `ss -ltnp` shows the 3080 listener without a PID) and
  `~/.dsh/logs/` contains **no startup log after 2026-11-01 07:54** (all `startup-*.log` are older).
  The only measured boot anchor is the `cordis.yml` rewrite at **07:17:09**.

What *is* measured today: in the running daemon both providers are registered and usable — the 07:48:23
no-arg list contains `deepinfra` + `antigravity`, and the 07:50:19 subagent probes resolved real model
metadata (`contextWindow:1048576` for antigravity) and returned `PROBE_OK`.

## 4. The two Gemini claims, line by line

| Claim | Measured | Verdict |
|---|---|---|
| "Gemini 3.5 is not in the registry" | `dsh-antigravity/lib/catalog.js:24-41`: the three Google ids `gemini-2.5-flash-lite` (low), `gemini-2.5-flash` (medium), `gemini-2.5-flash-thinking` (high) are **aliased to base model `gemini-3.5-flash-lite`**; `groupByBase` (`:91-136`) advertises the **base ids**, so the provider advertises `gemini-3.5-flash-lite` (display name "Gemini 3.5 Flash Lite", `:126-129`). Empty `enabledModels` means "every model the account serves" (`dsh-antigravity/cordis.patch.yml`); the live profile sets `enabledModels` to the raw `gemini-2.5-*`/`gemini-3.8-*` ids (`~/.dsh/profiles/web/cordis.patch.yml:155-161`), which group to `gemini-3.5-flash-lite` + `gemini-3.8-flash`. `~/.dsh/profiles/web/cordis.patch.yml:102-103` explicitly allow-lists `antigravity/gemini-3.5-flash-lite`. Live probe 07:50:19-24 resolved it. | **REFUTED** |
| "antigravity plugin default is gemini-3.8-flash" | `lib/backends.js:16` `DEFAULT_MODEL='gemini-3.8-flash-low'`; live config `model: gemini-3.8-flash-low` (`cordis.patch.yml:164`); grouped picker id = `gemini-3.8-flash` (`catalog.js:73-78`). | **PARTLY TRUE** — it is *a default*, not the catalog. The plugin ships/serves both the 3.8 and 3.5 Flash families. |
| Parent's method (07:25:47) | `grep -rn "gemini-3.5\|gemini" dsh-antigravity/lib/*.js \| head -5` produced 5 hits from `adapter.js`, `auth.js`, `backends.js`; `catalog.js` (alphabetically next) was truncated by `head -5`. No `list_subagent_models({provider:"antigravity"})` ever succeeded (policy-blocked), and no catalog/registry dump was taken. | **measurement error** |

## 5. Answers to task-1's five evidence items

1. **Session start vs config mtimes / restart / "applied pending restart".** Session created 05:42:45.900; config then = 8 routes (05:13:47 state, preserved in the 06:05:54 backup, identical to the policy event). The effective config changed to 11 routes after creation and before 07:41:18 (new session's policy). The file's 07:47:11 birth is a later settings re-serialization, not the edit. A web-profile `dsh` boot is measured at 07:17:09 (`cordis.yml` rewrite) — so a daemon/profile reload happened *during* the session's life; the session kept its 05:42 snapshot across it. **The mismatch is not "pending restart": it is the durable creation-time snapshot.** No restart can fix a live session's policy; only a new (top-level) session picks up changed `allowedModels`.
2. **How `allowedModels` resolves.** Read verbatim from config (`model-selection-settings.js:108-117`), frozen per session at `agent/created` (`:86-101`), enforced at delegation (`index.js:89-96` `assertAllowedModelSelection`) and at discovery (`:194-196`); discovery lists registered providers **intersected with** the policy (`:190`). The catalog behind a provider (`llm.listProviders()` / `llm.listModels()`) is the plugin's registered adapter, not the config list.
3. **Why antigravity/deepinfra did/didn't register then.** Registration is mount-gated only (antigravity: `modelServing` default true + lazy auth; deepinfra: `apply()` + optional key). The session log cannot prove mount state because (a) the ptc preset fixes the tool catalog, (b) discovery is policy-filtered, (c) the parent tested `deepseek-account`, `deepseek-official`, `opencode-go`, `antigravity`, `deepmind` — never `deepinfra` — and every failure was the policy error, not a registry error. Today both are measured registered and functional.
4. **Gemini 3.5 / default.** See §4: `gemini-3.5-flash-lite` exists (catalog alias base; allow-listed; probe-verified), `gemini-3.8-flash-low` is the CLI/settings default, `enabledModels` also covers the 2.5 raw ids.
5. **What changed by 07:47.** Only the effective `subagent-model-selection-settings.allowedModels` (8 → 11 routes: +`deepinfra/deepseek-ai/DeepSeek-V4.1-Flash-1017`, +`antigravity/gemini-3.5-flash-lite`, +`opencode-http-agent/opencode-go/hy4`) and the persisted `dsh-antigravity` config block; observed 3 providers in the current session. A **new top-level session is what applies it**; the old session's policy is immutable by construction.

## 6. Limitations / unmeasured

- Daemon process start time is not directly measurable from this sandbox (PID namespace; no startup log
  after 2026-11-01). The 07:17:09 `cordis.yml` rewrite is the strongest available boot anchor; it could in
  principle also be a `dsh --profile web --dump-config` CLI run, but no such run exists in either
  session transcript and the shell history predates today.
- The exact minute the 11-route `allowedModels` edit was made is not recoverable: the file was atomically
  replaced at 07:47:11 (birth time), and no backup was taken between 06:05:54 and then. It is only
  bounded to `(06:05:54, 07:41:18)` by the 8-route policy at 05:42:45 and the 11-route policy at 07:41:18.
- `parent.v4.jsonl` is a snapshot ending 07:43:39; the live session file has since grown (turn 4 at
  07:49:10, turn 5 at 07:53:15, file size 972,104 B at 07:54:03). All parent-side conclusions above use
  the snapshot; the live continuation does not add any new policy event.
