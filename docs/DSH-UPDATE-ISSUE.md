# DSH Update Issues — compatibility, version lock, and infrastructure

<!-- skeleton:
version: 1.0
kind: report
status: active
updated: 2026-11-13
summary: What breaks or silently degrades when the DSH host version moves — the measured version pins across every tracked plugin, the peer/schemas/engine ranges that already disagree with the running host, the cordis and schemastery coupling, the client-bundle rebuild boundary, and the infrastructure dependencies (Lightpanda daemon, dsh-web service, credential store, provider CLIs) that an upgrade must re-verify rather than assume.
-->

> Status: **measured 2026-11-13** against DSH `0.2.2-rc.1` on Node `v24.22.1`. Every pin and version
> in this document was read from `package.json` files on disk, not from memory. Where a claim could
> not be measured it is marked **unverified** instead of being stated as fact.

## 1. When to read this

Read this **before** any of the following, and not after:

- bumping `@deepseek-ai/dsh` (the global install under
  `/home/minami/.local/nodejs/lib/node_modules/@deepseek-ai/dsh`);
- raising a plugin's `engines.dsh` or any `@deepseek-ai/*` peer range;
- adding a plugin that imports a host service (`credentials`, `skills`, `settings`, `llm`, …);
- a host release note mentions cordis, schemastery, the loader, the client bundle, or provider rows.

An upgrade is **not** "run npm and restart". The gate is §6.

## 2. The version surface — measured pins

### 2.1 The host itself

| Item | Value | Source |
| :--- | :--- | :--- |
| DSH version | `0.2.2-rc.1` | `@deepseek-ai/dsh/package.json` |
| `engines.node` | `>=24.9.0` | same |
| Running Node | `v24.22.1` | `node -v` |
| cordis | `~4.1.0` | host `dependencies` |
| schemastery | `~3.19.0` | host `dependencies` |

### 2.2 Every tracked package

| Package | Version | `engines.dsh` | Notable peers |
| :--- | :--- | :--- | :--- |
| `@nolit/dsh-custom-router` | `0.0.1-rc.13` | `>=0.2.2-alpha.2 <0.3.0` | `schemastery ^3.18.4` (root) |
| `@nolit/dsh-antigravity` (vendor) | `0.0.1-rc.12` | `>=0.2.2-alpha.2 <0.3.0` | `cordis ^4.0.4`, `dsh-llm ^0.2.2-alpha.2`, `dsh-tools`, `dsh-subprocess` |
| `@nolit/dsh-deepinfra` (vendor) | `0.0.1-rc.13` | **`>=0.2.2-alpha.3 <0.3.0`** | `cordis ^4.0.4`, `dsh-llm **^0.2.2-alpha.3**`, `schemastery ~3.18.4` |
| `@nolit/dsh-opencode-v2` (vendor) | `0.0.1-rc.6` | `>=0.2.2-alpha.2 <0.3.0` | `cordis ^4.0.4`, `dsh-llm ^0.2.2-alpha.2`, `schemastery ~3.18.4` |
| `@nolit/dsh-sidebar-manager` | `0.0.1-rc.2` | `>=0.2.2-alpha.2 <0.3.0` | — |
| `@nolit/dsh-notify` | `0.0.1-rc.5` | `>=0.2.2-alpha.2 <0.3.0` | — |
| `@nolit/dsh-tokeneconomizer` | `0.0.1-rc.2` | `>=0.2.2-alpha.2 <0.3.0` | — |
| `@nolit/dsh-korean-locale` | `0.0.1-rc.1` | `>=0.2.2-alpha.2 <0.3.0` | — |
| `@nolit/dsh-command-skill` | `0.0.1-rc.1` | `>=0.2.2-alpha.2 <0.3.0` | — |
| `@nolit/dsh-opencode-v2` (top-level track) | `0.0.1-rc.5` | `>=0.2.2-alpha.2 <0.3.0` | — |

## 3. Version-lock defects that already exist

These are **measured today**, before any upgrade. They are listed first because an upgrade turns a
silent disagreement into a loud or confusing failure.

### V1 — `schemastery ~3.18.4` does not satisfy the host's `3.19.0` (live, silent)

| Fact | Value |
| :--- | :--- |
| Declared by | `vendor/deepinfra`, `vendor/opencode` → `~3.18.4` |
| Installed / resolved at runtime | **`3.19.0`** (host's copy) |
| Satisfies `~3.18.4`? | **No** — `~3.18.4` means `>=3.18.4 <3.19.0` |
| Observed consequence today | none: Node resolves the host's hoisted copy, so the code runs on `3.19.0` |

**Why it matters:** the package declares a contract it does not meet. A `npm install` with peer
checking enabled, a `publish` audit, or a future strict peer policy will fail on it — and until then
it is invisible because the runtime silently uses a version the manifest rejects. Fix by raising both
vendors (and the root `^3.18.4`) to a range that admits `3.19.0`.

### V2 — `engines.dsh` floor disagrees across packages

`vendor/deepinfra` requires `>=0.2.2-alpha.3` (and `dsh-llm ^0.2.2-alpha.3`); every other package
requires `>=0.2.2-alpha.2`. All of them currently **satisfy** the live `0.2.2-rc.1`, so nothing fails
— but the workspace has no single stated floor, which makes "which DSH is this workspace built for?"
a per-package question.

### V3 — two `@nolit/dsh-opencode-v2` tracks

`vendor/opencode` is `0.0.1-rc.6` and the top-level `dsh-opencode-v2/` is `0.0.1-rc.5`. The handoff
records that the top-level track is a **re-export shim**; the versions drift independently. Any
version-lock review must state which one the profile actually mounts, or it will pin the wrong one.

## 4. Compatibility risks by upgrade direction

### 4.1 Prerelease ordering is the trap

`^0.2.2-alpha.2` **does** admit `0.2.2-rc.1` (measured with `semver.satisfies`). That is convenient
and dangerous at once: it means an `alpha → rc` jump crosses no version gate at all, so the host will
change behaviour while every manifest says "compatible". **The manifests cannot be the upgrade gate;
only §6 can.**

Conversely, `^0.2.2-alpha.2` will **not** admit `0.2.3-*` or `0.3.0-*`. A host bump that changes the
minor or major requires a deliberate range edit in every package, which is the correct behaviour —
just remember it is nine files, not one.

### 4.2 cordis and schemastery coupling

| Host module | Host pin | Our pin | Risk |
| :--- | :--- | :--- | :--- |
| cordis | `~4.1.0` | `^4.0.4` | admits `4.1.0`; a tamper with `ctx.plugin` / service semantics is **not** caught by the range |
| schemastery | `~3.19.0` | `~3.18.4` (V1) | already unsatisfied |

cordis version changes have previously broken plugins in this workspace in a way no range could
express — see [FAILURE-LEDGER.md](./FAILURE-LEDGER.md) and the client-half activation rule in §5.
Treat a cordis bump as a **behavioural** change, not a patch bump.

### 4.3 Service contracts we import, not own

These are host internals our code reads directly. A host upgrade may change any of them without a
major version bump:

| Contract | Used by | What to re-check |
| :--- | :--- | :--- |
| `Credentials` (`CredentialRef`, `CredentialKey`, `modifyRecord`, `credentials/*-updated`) | router auth policy | method presence; the empty-is-absent rule |
| `PiAiAdapter` export + constructor options | router lane A | the named option list still accepted |
| `PROTOCOLS` / `transport` lists | `preset-schema.js` | a protocol removed or renamed |
| `skills.register` validation (`source`/`provider` required on first `get`) | skill surfaces | the trap still throws the same way |
| `sales`/`settings` secret projection (`role('secret')`) | dashboard | secrets still stripped from wire reads |
| `llm.registerAdapter`, `tools.register`, `commands.register` | every provider | signature and yield semantics |

### 4.4 The client-half boundary (the failure that already happened)

A client plugin whose `inject` is declared but **not exported** activates against `undefined` and
kills the whole web UI (`web boot: 1 entry did not activate`). This was a real incident
([DSH-HARNESS-POLICY §2.1](./DSH-HARNESS-POLICY.md)). Route probes do **not** catch it — only a real
browser boot does. Any upgrade that touches the client bundle must be verified in the browser.

## 5. Infrastructure dependencies

An upgrade is not finished when the package version changes. These run **outside** the package and
each has its own way of going stale.

| Component | Measured 2026-11-13 | Upgrade obligation |
| :--- | :--- | :--- |
| `dsh-web.service` | `active`, started 10:01:43 KST, `NRestarts=0`, listens `127.0.0.1:3080` | restart after a dependency change; the new code is **`applied pending restart`** until then |
| Lightpanda (`lightpanda` v1.0.2) | process `pid=1432`, CDP on `127.0.0.1:9333`; **no systemd unit** (`systemctl --user is-active lpd` → `inactive`) | see §5.1 — the daemon outlives an upgrade with no supervisor to restart it |
| Credential store (`~/.dsh/.credentials.yaml`) | schema `version`, `records`, `refs`; backed by `dsh-credentials-local` | an upgrade that changes the store schema must be checked for a migrator before auth breaks |
| Provider CLIs (`opencode`, `agy`, `codex`, `claude`) | invoked as subprocess by the worker surfaces | a CLI flag rename silently breaks dispatch; re-run `verify:dispatch` |
| Node runtime | `v24.22.1` (host wants `>=24.9.0`) | a Node bump can change `fetch`/stream/AbortSignal behaviour |

### 5.1 Lightpanda is the weakest link

Measured: the CDP daemon on `:9333` runs as a **bare process** (`pid=1432`), **not** under a
systemd user unit (`is-active` reports `inactive`, there is no matching unit). Consequences for an
upgrade:

1. **No restart hook.** Restarting `dsh-web.service` does not restart Lightpanda; nothing does
   automatically. After an upgrade that touches the browser tooling, the daemon may be running
   **older** code than the workspace expects.
2. **No readiness probe.** A dead daemon looks like "the browser tool failed", not "the daemon is
   down". Check `ss -ltnp | grep 9333` and the `pid=` before concluding a plugin is broken.
3. **Version is pinned by the binary, not by any manifest.** `lightpanda 1.0.2` is whatever is
   installed on `PATH`; no `package.json` records it, so a workspace restore does not restore it.
4. **Session state is not part of the upgrade.** A daemon restart drops any open tabs a verification
   run was using.

**Minimum upgrade-time check:** record `lightpanda version`, the listening `pid`, and whether `:9333`
accepts a CDP connection, both **before** and **after** the upgrade. A daemon that kept running
through the upgrade is not evidence that it works with the new host — it is evidence it never
restarted.

### 5.2 The service restart boundary

`dsh-web.service` holds the pre-upgrade module graph in memory. Until it restarts, on-disk changes
are **`applied pending restart`** — not `done`. Reporting "done" before the restart is the most
common upgrade-reporting error in this workspace, and it has produced a false green at least once
(the `rc.13` round: the handoff asserted "not restarted" while the service had in fact restarted).

## 6. The upgrade gate

Run in this order. Each step names what a skip would have hidden.

| # | Step | Hides this if skipped |
| :--- | :--- | :--- |
| 1 | Record baseline: host version, `node -v`, `lightpanda version`, `:9333` pid, `dsh-web` start time | any later claim about "changed" |
| 2 | `npm run docs:check` + `node scripts/check-plugin-history.mjs` | stale indexes and undocumented changes |
| 3 | `node scripts/audit-installed-vs-packaged.mjs` (sidebar drift gate) | installed ≠ packaged drift |
| 4 | Re-read every `engines.dsh` / peer range against the new host (§3 fixes applied) | V1-class silent disagreement |
| 5 | `(cd dsh-custom-router && npm test)` **plus** the three vendor suites | the vendor suites are separate commands; a passing `npm test` alone is not a verification |
| 6 | `npm run verify:presets`, `verify:refresh`, `verify:stream`, `verify:dispatch` | phantom commands, dead routes, pipe regressions, dispatch breakage |
| 7 | Isolated `dsh --dump-config` boot with a throwaway `DSH_HOME` | config-level breakage |
| 8 | **Real browser boot** against `127.0.0.1:3080` | client-half activation failure (§4.4) — routes and `--dump-config` both pass while the UI is dead |
| 9 | Restart `dsh-web.service` (and the Lightpanda daemon) | everything above stays `applied pending restart` |
| 10 | Re-record the §1 baseline and state it **before → after** | "done" claimed from an exit code |

Steps 1–8 are read-only. Step 9 is a **live-state write** and needs owner approval — per
[RULES.md](./RULES.md) the live service is the owner's.

## 7. Open issues (not fixed by this document)

| # | Issue | Severity | Owner action |
| :--- | :--- | :--- | :--- |
| V1 | `schemastery ~3.18.4` unsatisfied by host `3.19.0` in two vendored packages + root | medium — silent today, fails any strict peer check | raise the range |
| V2 | `engines.dsh` floor differs (deepinfra `alpha.3` vs others `alpha.2`) | low | pick one workspace floor |
| V3 | two `dsh-opencode-v2` versions (`rc.6` vendor / `rc.5` shim) | low — documented but drifting | state the mounted one per release |
| V4 | Lightpanda has no supervisor and no manifest-recorded version (§5.1) | medium — upgrade blindness | consider a user unit; record the version in the boot card |
| V5 | No automated check that `engines.dsh` matches the running host | medium | candidate for `docs:check:all` |
| V6 | Plaintext DeepInfra key in the live patch (see custom-router HANDOFF N5) | high for secrecy | owner-gated migration to the credential store |

## 8. Verification of this document

```bash
node -e "console.log(require('/home/minami/.local/nodejs/lib/node_modules/@deepseek-ai/dsh/package.json').version)"
node -v
lightpanda version
ss -ltnp | grep -E '9333|3080'
systemctl --user show dsh-web.service -p ExecMainStartTimestamp -p NRestarts -p ActiveState
systemctl --user is-active lpd        # no unit today
grep -rn '"@deepseek-ai/schemastery"' */package.json dsh-custom-router/vendor/*/package.json
```

The semver claims in §3 V1 and §4.1 were computed with `semver.satisfies`, not asserted from
reading.

## 9. References

- [DSH-HARNESS-POLICY.md](./DSH-HARNESS-POLICY.md) — version policy, prerelease handling, upgrade gate, client-half incident
- [FAILURE-LEDGER.md](./FAILURE-LEDGER.md) — the defects and wrong turns this list is derived from
- [RULES.md](./RULES.md) — live-state gates and the measurement rule
- [DSH-HOME-ISOLATION.md](./DSH-HOME-ISOLATION.md) — throwaway `DSH_HOME` for every verification boot
- [dsh-custom-router/docs/HANDOFF.md](../dsh-custom-router/docs/HANDOFF.md) — current router state and N-items
