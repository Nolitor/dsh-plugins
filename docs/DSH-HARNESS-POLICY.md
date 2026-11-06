# DSH Plugin Harness Policy & Version Changelog
<!-- skeleton:
version: 2.8
kind: policy
status: active
updated: 2026-11-06
summary: Authoritative harness policy: versions, live-state gates, single-writer rule, 4-step plugin replacement, autonomous model-serving (llm-pi-ai deprecated), release rules, and the browser-boot verification gate.
-->


> Status: active · Last updated: 2026-10-29 (single-writer + replacement rules) · Applies to: DSH `0.2.2-alpha.2` · Boot index: [AGENTS.md](../AGENTS.md)

## 1. Purpose

This workspace continuously manages these DSH web plugins:

- `@nolit/dsh-korean-locale`
- `@nolit/dsh-sidebar-manager`
- `@nolit/dsh-notify-web`
- `@nolit/dsh-opencode-v2` (wraps `@quonaro/dsh-plugin-opencode` as a dependency)

The harness must keep runtime compatibility, release artifacts, policy decisions, and measured
evidence together. A report is not a measurement unless it names the actual boot/route/browser
result it came from.

## 1.1 Model-serving policy (2026-10-30)

- **`llm-pi-ai` is deprecated and is not restored.** It is a generic multi-provider layer, not a
  required harness capability.
- **Every model-serving integration is its own autonomous router.** It registers its adapter
  directly with `ctx.llm.registerAdapter([providerId], adapter)` and owns its catalog,
  `reasoning.efforts`, disjoint usage accounting, session mapping, and stable error codes.
- **No intermediary bridge/proxy plugin.** Reuse another plugin's measured serving surface by
  importing its adapter/library, never by inserting a second route table between it and the host.
- **Extensions must export `apply`.** A module without `apply` is a library and must not be listed
  as a bundle row.
- **Model visibility is display-only (2026-10-30).** A serving plugin may publish fewer routes to the
  prompt picker than its catalog serves, but the filter must change *only* what is offered:
  empty means unrestricted, and a session that already selected a hidden route keeps running.
  Entitlement is measured per account once (backend answer to a one-shot request), never guessed
  from `/api/model`'s `status`/`enabled`, which are uniformly active.
- **Conflict handling is local.** A plugin may warn or yield its own namespace when a legacy
  provider is active; it must never unload or mutate a sibling plugin's registration.
- Rationale and incident record: [dsh-opencode-v2/docs/OPENCODE-MODEL-SERVING-PLAN.md](../dsh-opencode-v2/docs/OPENCODE-MODEL-SERVING-PLAN.md).

## 2. Version policy

| Area | Current policy |
|---|---|
| Runtime | DSH `0.2.2-alpha.2`, Cordis `4.0.6-alpha.1`, Node `v24.22.1` |
| `engines.dsh` | `>=0.2.2-alpha.2 <0.3.0` for all three plugins |
| Manifest | `dsh.manifestVersion: 1`, bundle patch, web client factory |
| Prerelease handling | Pin the exact prerelease floor; do not rely on a lower prerelease window |
| Upgrade gate | Re-run: package scan, isolated `dsh web` boot, **browser boot** (shell mounts, no `web boot:` verdict), routes/UI probes, tests. Route probes alone do not prove a client half activates |

### 2.1 Version changelog

| Date | Runtime | Change | Action |
|---|---|---|---|
| 2026-11-06 | — | `@nolit/dsh-subrouter` **retired**: the directory was still in the active tree although 2026-10-30 already recorded it decommissioned (F-50) | moved to `archive/dsh-subrouter/`; removed from `verify-subrouter` (dependency, bundle row, `node_modules` link); `scripts/check-disposal-safety.mjs` now gates this |
| 2026-10-31 | DSH `0.2.2-alpha.2` | Ranking refreshed daily and a brand-new route buried behind 40 ranked models (no usage rank yet) | `dsh-opencode-v2@0.7.2`: `rankingTtlMs` = **5 days**; `opencode-known-models.json` gives a first-seen stamp per route, so a route that appears later is served **first** in the settings list and in the prompt picker for `newModelDays` (7) — **plan gate unchanged**; see [plan](../dsh-opencode-v2/docs/OPENCODE-MODEL-SERVING-PLAN.md) §5.2.11 |
| 2026-10-31 | DSH `0.2.2-alpha.2` | 0.6.0's client half killed the whole web UI after the 23:34 restart: `web boot: 1 entry did not activate` / `@nolit/dsh-opencode-v2: failed` — `lib/client.js` declared `const inject = ['slots']` and never exported it, so `ctx.slots` was undefined at activation | `dsh-opencode-v2@0.6.1` exports `inject`; contract test added; verification gate now requires a **browser boot**, not route probes; see [plan](../dsh-opencode-v2/docs/OPENCODE-MODEL-SERVING-PLAN.md) §5.2.8 |
| 2026-10-31 | DSH `0.2.2-alpha.2` | The entitlement sweep spent **one real completion per catalog route** (49 requests/press) against a request-counted quota; no cheaper truthful surface exists (provider `/models` 404, `/api/model` uniform `active`, `opencode models` = static catalog, no OpenAPI availability route) | `dsh-opencode-v2@0.7.0` drops the sweep: availability is the plan (`opencode-go` subscription / `opencode` Zen) chosen in the tab, ordering uses the public `opencode.ai/data` ranking (one cached GET), and backend refusals are recorded free from real turns |
| 2026-10-31 | DSH `0.2.2-alpha.2` | Settings-tab usability: 49 rows in catalog order after every open, sweep results lost on close, tab labelled `OpenCode v2`, and Notification's hardcoded Korean label leaked into an English UI | `dsh-opencode-v2@0.6.2` sorts usable → unchecked → rejected, puts the verdict beside the checkbox, persists the sweep to `opencode-model-verdicts.json` and only refreshes on the button; `dsh-notify-web@0.1.7` moves to order 50 (below 에이전트 프리셋) and localizes its label (`알림` / `Notifications`) |
| 2026-10-30 | DSH `0.2.2-alpha.2` | `llm-pi-ai` deprecated; autonomous native router policy adopted; `@nolit/dsh-subrouter` decommissioned | `dsh-opencode-v2@0.4.0` mounts `@nolit/dsh-opencode-v2/http` natively; profile repointed to `opencode-http-agent` |
| 2026-10-30 | DSH `0.2.2-alpha.2` | Live 400 `MissingSessionID` (no `x-opencode-session`) and 401 from a revoked `key` credential preferred over the web OAuth login | `dsh-opencode-v2@0.5.1` sends the session header and ranks oauth over key; see [plan](../dsh-opencode-v2/docs/OPENCODE-MODEL-SERVING-PLAN.md) §5.1 |
| 2026-10-30 | DSH `0.2.2-alpha.2` | Prompt picker offered all 49 catalog routes; only 35 usable on this account | `dsh-opencode-v2@0.6.0` adds `enabledModels` (empty = unrestricted) plus an OpenCode v2 settings tab and an explicit entitlement sweep; see [plan](../dsh-opencode-v2/docs/OPENCODE-MODEL-SERVING-PLAN.md) §5.2 |
| 2026-10-30 | DSH `0.2.2-alpha.2` | `dsh-opencode-v2@0.6.0` added to the live profile (in-place upgrade of the same rows) | artifact `251ef4f7…936`; mount verified on a clone; live restart pending |
| 2026-10-29 | DSH `0.2.2-alpha.2` | Cordis `4.0.6-alpha.1`, Node `v24.22.1`; current engines/manifests still valid | Re-measured all three plugins; pinned engines to alpha.2 floor |
| 2026-10-29 | DSH `0.2.2-alpha.2` | Built-in client dictionaries changed; Korean pack stale by 117 keys | Refreshed to 68 namespaces / 3,019 keys; en/zh parity 0 |
| 2026-10-29 | DSH `0.2.2-alpha.2` | Experimental Forge/Worktrees exposed in official plugin list | Measured isolated boot and UTM policy overlap; advisory guardrails required |
| 2026-10-24 | DSH `0.2.1-rc.3` | Previous verified baseline | Retained in runtime spec as historical evidence |

Correction (2026-10-31): the 2026-10-30 row above claims "mount verified on a clone; live restart
pending". The restart ran at 23:34:03 and the browser boot failed — the clone check exercised HTTP
routes, not client-half activation. A clone boot plus 200s on every route is not a mount.

## 3. Live-state policy

- Treat `~/.dsh` as **read-only** from the agent sandbox.
- Isolate experiments with a workspace-local `DSH_HOME`.
- Never edit the live profile, sessions, credentials, registry, or running service without explicit
  user approval.
- Profile file changes require a DSH web service restart; runtime state is in-memory until restart.
- Notification/plugin behavior changes must be verified in both isolated and live-like state.

### 3.1 Sidebar Manager installed-vs-packaged gate (mandatory)

The Sidebar Manager is the one plugin UTM may modify outside the normal release flow. Every
session that touches it must do this **before** changing code or bumping the version:

1. Resolve the live profile `link:` target and confirm it equals the workspace track.
2. Run `node scripts/audit-installed-vs-packaged.mjs` and record the tree SHA-256.
3. Run its tests and an isolated `DSH_HOME` boot with live `workspace.json` + `groups.json`.
4. Probe `groups/list`, `groups/view`, advisory and any routes being changed.
5. Compare UTM-modified files with `RECOVERY-NOTES.md`/previous boot cards.
6. Only then version-up, regenerate the artifact, record SHA-256, and re-measure.

Skipping this gate is a policy violation even when the code looks unchanged.

### 3.2 Single-writer rule (mandatory, applies to every agent)

A concurrent agent MUST NOT write outside the package directory it was assigned.

1. **One agent, one package track.** Write only under `dsh-<track>/`. Never write a sibling
   track's files, even "temporarily" or to "fix" something. If another track is broken, report it.
2. **Relative-path writes into sibling trees are forbidden.** A bare relative write
   (`package.json`, `lib/`, `test/`) resolves to the *caller's* cwd, which is not necessarily the
   package you meant. Always write with an absolute path, or `cd` into the track first.
3. **Assert the target identity before writing a manifest.** Before creating or replacing any
   `package.json`, confirm the directory's expected `name` and refuse if it does not match.
   This is enforced repo-side: each track must keep a test asserting
   `package.json.name === "<expected>"`.
4. **Containment check after a mis-write.** If a cross-track write is suspected, run
   `find <other-track> -newermt "<session start>" -type f` and record the result as evidence.

**Why this rule exists (real incident, 2026-10-29):** while building `dsh-opencode-v2`, a
concurrent agent wrote `dsh-sidebar-manager`'s manifest over `dsh-opencode-v2/package.json`
(empty deps/peers, `market/`, `icon.svg`, `README.ko.md`, `dsh-package-manifest` devDeps).
The damage was contained only because a `name` assertion test made the artifact fail loudly
(7/72 tests failed against the overwritten manifest). A missing assertion would have let it ship.

### 3.3 Plugin replacement procedure (mandatory, not advisory)

Installing a replacement plugin is **never** a single `dsh plugin add`. `dsh plugin add` only
appends a dependency and a bundle entry; it does **not** disable an existing row that registers
the same tool or provider route. Two plugins registering the same name is a **hard mount
failure**, not a shadowing warning (`tool "<name>" is already registered`,
`an adapter for provider "<route>" is already registered`).

Run these four steps in order and do not skip any:

1. **Disable** — comment out or remove the incumbent plugin's row(s) in
   `~/.dsh/profiles/web/cordis.patch.yml` (e.g. both `dsh-plugin-opencode` and
   `dsh-plugin-opencode-provider`).
2. **Remove** — `dsh plugin --profile <name> remove <incumbent-package>` so the bundle entry and
   `node_modules` copy are gone. Leftover `node_modules` copies keep resolving and mask the
   removal.
3. **Install** — `dsh plugin --profile <name> add <new-package>`, then confirm a row for the new
   plugin's `name` exists in `cordis.patch.yml`. A bundle entry alone does **not** activate the
   plugin. If the bundle ships its own `cordis.patch.yml` (`dsh.bundle.patch`), the rows come from
   that file — verify it applied, or add the rows explicitly.
4. **Verify by mount, not by dump** — start the profile and confirm the plugin actually activated.
   `dsh --dump-config` exits 0 even for a configuration that cannot mount (it never imports,
   never registers, never runs startup audits). A dump is a syntax check, not an install gate.

If step 3 leaves the incumbent's dependency in `package.json`, treat the install as failed and
finish step 2.

## 4. Release policy

- Every package change bumps `version`.
- Run `npm pack` into `artifacts/` and update the matching `SHA256SUMS.*`.
  For the OpenCode packages use `scripts/pack-opencode-v2.sh`: `npm pack` names a tarball
  `<name without scope>-<version>.tgz`, so a package that already carries `-beta` in its
  name produced `...-beta-0.0.2-beta.1.tgz` — the word twice (owner instruction
  2026-11-04). The script renames to `nolit-dsh-opencode-v2-<version>.tgz` and rewrites
  the `SHA256SUMS` rows against the final name.
- Never claim a release without a matching immutable artifact.
- Keep `market/index.json` version and `engines.dsh` in sync with `package.json`.

Current artifacts:

| Plugin | Version | SHA-256 |
|---|---|---|
| Korean locale | `0.2.3` | `c6afbcea8dec596832e6e29a4878cedc3653dacb50066d8a2b16f08c38f33394` |
| Sidebar Manager | `0.1.2` | `fef72c599ef31e7085a8c21b2f47cab309641c92e1e2860c291672696ea8972c` |
| Notify Web | `0.1.6` | `426c36e721884163794f57a464d4d8c60a82b60502e68dececced47ec24ad7a5` |

## 5. Notification delivery policy

1. If Chrome OS notification is allowed and accepted → show OS notification only.
2. If permission is denied, insecure context, unsupported, or `onerror` → show in-app toast,
   tab-title alert, and sound.
3. On first event with permission `default`, request permission at most once per page.
4. Remote HTTP (`http://<LAN-IP>`) cannot produce OS notifications; use HTTPS or localhost tunnel.
5. DSH host notification daemon is irrelevant to a remote browser; the remote client OS governs.

## 6. UTM policy boundary

- UTM role/policy (`read-only`, `self-contained`, contract vs implementation) is **advisory**.
- Do not implement hard write-blocks or disable UI solely from UTM policy.
- Required Forge/Worktree guardrails are non-blocking: preflight observation, warning,
  soft rejection, exception audit, cwd/handoff trace, worktree identity/lifecycle mapping,
  and `.agents/worktrees` contract observation.
- See [UTM review](../dsh-sidebar-manager/docs/UTM-REVIEW-FORGE-VS-SIDEBAR.md) and
  [Forge runtime measurement](../dsh-sidebar-manager/docs/FORGE-VS-SIDEBAR-UTM-RUNTIME-MEASUREMENT.md).

## 7. Boot card policy

- Each generation writes `bootcards/YYYY-MM-DDTHHmm+0900.md`.
- `AGENTS.md` is a lightweight index; it points only to the newest boot card.
- Agents read only the latest boot card by default. Older cards are evidence for historical diffs.
- Regenerate with `node scripts/new-bootcard.mjs "note"`.
- The card must include: runtime version, managed plugin versions, artifact hashes, non-negotiable
  rules, current policy deltas, and verification commands.
