# DSH Plugin Harness Policy & Version Changelog
<!-- skeleton:
version: 2.0
kind: policy
status: active
updated: 2026-10-29
summary: Authoritative harness policy: versions, live-state gates, single-writer rule, 4-step plugin replacement, release rules.
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

## 2. Version policy

| Area | Current policy |
|---|---|
| Runtime | DSH `0.2.2-alpha.2`, Cordis `4.0.6-alpha.1`, Node `v24.22.1` |
| `engines.dsh` | `>=0.2.2-alpha.2 <0.3.0` for all three plugins |
| Manifest | `dsh.manifestVersion: 1`, bundle patch, web client factory |
| Prerelease handling | Pin the exact prerelease floor; do not rely on a lower prerelease window |
| Upgrade gate | Re-run: package scan, isolated `dsh web` boot, browser console, routes/UI probes, tests |

### 2.1 Version changelog

| Date | Runtime | Change | Action |
|---|---|---|---|
| 2026-10-29 | DSH `0.2.2-alpha.2` | Cordis `4.0.6-alpha.1`, Node `v24.22.1`; current engines/manifests still valid | Re-measured all three plugins; pinned engines to alpha.2 floor |
| 2026-10-29 | DSH `0.2.2-alpha.2` | Built-in client dictionaries changed; Korean pack stale by 117 keys | Refreshed to 68 namespaces / 3,019 keys; en/zh parity 0 |
| 2026-10-29 | DSH `0.2.2-alpha.2` | Experimental Forge/Worktrees exposed in official plugin list | Measured isolated boot and UTM policy overlap; advisory guardrails required |
| 2026-10-24 | DSH `0.2.1-rc.3` | Previous verified baseline | Retained in runtime spec as historical evidence |

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
- See [UTM review](../UTM-REVIEW-FORGE-VS-SIDEBAR.md) and
  [Forge runtime measurement](../FORGE-VS-SIDEBAR-UTM-RUNTIME-MEASUREMENT.md).

## 7. Boot card policy

- Each generation writes `bootcards/YYYY-MM-DDTHHmm+0900.md`.
- `AGENTS.md` is a lightweight index; it points only to the newest boot card.
- Agents read only the latest boot card by default. Older cards are evidence for historical diffs.
- Regenerate with `node scripts/new-bootcard.mjs "note"`.
- The card must include: runtime version, managed plugin versions, artifact hashes, non-negotiable
  rules, current policy deltas, and verification commands.
