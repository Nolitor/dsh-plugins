# DSH Plugin Harness Policy & Version Changelog

> Status: active · Last updated: 2026-10-29 · Applies to: DSH `0.2.2-alpha.2` · Boot index: [AGENTS.md](../AGENTS.md)

## 1. Purpose

This workspace continuously manages three DSH web plugins:

- `@nolit/dsh-korean-locale`
- `@nolit/dsh-sidebar-manager`
- `@nolit/dsh-notify-web`

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

## 4. Release policy

- Every package change bumps `version`.
- Run `npm pack` into `artifacts/` and update the matching `SHA256SUMS.*`.
- Never claim a release without a matching immutable artifact.
- Keep `market/index.json` version and `engines.dsh` in sync with `package.json`.

Current artifacts:

| Plugin | Version | SHA-256 |
|---|---|---|
| Korean locale | `0.2.3` | `c6afbcea8dec596832e6e29a4878cedc3653dacb50066d8a2b16f08c38f33394` |
| Sidebar Manager | `0.1.1` | `8863088db5a28b148f4066c2b8c24cd1067fb50ddb73ac5997025458511c74c2` |
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
