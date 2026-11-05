# DSH_HOME isolation for scripts and test harnesses

<!-- skeleton:
version: 1.0
kind: rule
status: active
updated: 2026-11-05
summary: Every repo script/test that launches dsh or a TokenEconomizer engine must own a throwaway DSH_HOME (plus TOKENECONOMIZER_HOME when applicable), clean it up, and never write the live home; enforced by scripts/check-dsh-isolation.mjs and its tests.
-->

> Status: **mandatory** · Measured 2026-11-05 · Applies to `scripts/`, `dsh-*/test/`, `dsh-*/scripts/`, and docs examples
> Related: [RULES.md](RULES.md) §2 (live state) · [ORPHAN-SESSION-CLEANUP.md](ORPHAN-SESSION-CLEANUP.md) (the damage this prevents)

## 1. The rule

A script or test that launches the `dsh` CLI — or launches a TokenEconomizer engine (`bin/te`,
`bin/te-hook`) that spawns `dsh --profile headless` for side calls — **must own a throwaway
`DSH_HOME`** for the run:

```bash
iso="$(mktemp -d "${TMPDIR:-/tmp}/dsh-<purpose>-XXXX")"
trap 'rm -rf "$iso"' EXIT
DSH_HOME="$iso" TOKENECONOMIZER_HOME="$iso/tk-home" timeout 60 dsh web --no-open --port 0
```

Rules that follow:

1. **Temp home, cleaned up.** `mkdtemp`/`mktemp -d` per run; remove it on exit (trap) even on
   failure. A leftover `/tmp/dsh-*` directory holding session logs is still isolation — it is
   outside the live sidebar — but it is litter, so clean it.
2. **Copied profile points at itself.** When isolating a boot from the live profile, rewrite any
   absolute `$HOME/.dsh` value inside the copied `cordis.patch.yml` to the temp home. Otherwise a
   composed service can still write the live session-search index or another live path
   (measured 2026-11-05: `dsh: warning: 4 entries did not activate / attempt to write a readonly
   database` in the sandbox; outside the sandbox it would be a real live write).
3. **Engine home too.** The TokenEconomizer engine keeps state under `TOKENECONOMIZER_HOME`
   (default `~/.tokeneconomizer`) and exports session logs under its own state root; isolation
   means both roots are temp.
4. **Read-only means read-only.** A measurement script may READ the live home (that is how the
   owner's data is measured) but must not write it: it must not create `--json` output inside
   `DSH_HOME`, and it must never launch DSH against the live home.
5. **Live writes are explicit.** An owner-run install/restart script whose *purpose* is a live
   write must (a) carry the `live-intentional` annotation and (b) refuse to proceed without the
   owner's explicit confirmation (`DSH_LIVE_INSTALL=1`). No other script may write the live home.
6. **No default home in tests.** `process.env.DSH_HOME` must never be pinned to
   `homedir() + '/.dsh'` in a test.

## 2. The guard

`scripts/check-dsh-isolation.mjs` scans the runnable tree (not prose) and fails on any launcher
that is not isolated or explicitly annotated. It never executes the scanned files.

```bash
node scripts/check-dsh-isolation.mjs            # human report, exit 1 on violations
node scripts/check-dsh-isolation.mjs --json     # machine-readable
node scripts/check-dsh-isolation.mjs --self-test
node --test scripts/check-dsh-isolation.test.mjs
```

It checks:

| Rule | What it catches |
| :--- | :--- |
| `spawn-dsh-without-DSH_HOME` | a JS/TS spawn-like call targeting the `dsh` binary with no `DSH_HOME` in its options |
| `engine-spawn-without-DSH_HOME` | a spawn of `bin/te`, `bin/te-hook`, `te-dsh` (indirect `dsh` launcher) with no `DSH_HOME` |
| `shell-dsh-without-DSH_HOME` | a shell line running `dsh <subcommand>` without a `DSH_HOME=` prefix/script allocation |
| `process-env-pins-live-home` | a test pinning `process.env.DSH_HOME` to the live home |

Two explicit, file-scoped escape hatches — both are listed in every guard run so they stay visible:

| Annotation | Means | Example |
| :--- | :--- | :--- |
| `// dsh-isolation: read-only-live-home` (or `#`) | reads the live home, launches nothing, writes nothing there | `scripts/measure-token-saving.mjs` |
| `# dsh-isolation: live-intentional` | owner-run live write, gated by `DSH_LIVE_INSTALL=1` | `scripts/install-*-live.sh` |

A launcher that satisfies the rule by using a temp home may also carry
`# dsh-isolation: isolated-temp-home` for the reader; the guard does not need it.

## 3. Measured audit and fixes (2026-11-05)

Measured with `node scripts/check-dsh-isolation.mjs` before and after the fixes below.

| Surface | Before | After |
| :--- | :--- | :--- |
| Guard violations | **4** | **0** |
| `dsh-command-skill/scripts/verify-contract.mjs` | `execFileSync('dsh', ['--profile', PROFILE, '--dump-config'])` against the live home — `--dump-config` runs `prepareProfile()`, which **writes** `profiles/<name>/cordis.yml` | runs the dump against a temp `DSH_HOME` built from a copy of the live profile; absolute `$HOME/.dsh` values in the copied patch are rewritten to the temp home; temp removed afterwards; the same contract checks still run |
| `dsh-tokeneconomizer/test/integration.test.mjs` | engine spawn inherited `process.env`; `DSH_HOME` unset → the engine's `dsh --profile headless` side calls could persist to the live home (the historical `/tmp/te-side-*` flood) | test allocates a temp `DSH_HOME` + `TOKENECONOMIZER_HOME`, passes `DSH_HOME` explicitly in the spawn env, restores both env vars and removes the temp home in `t.after` |
| `scripts/antigravity-stabilisation-status.sh` (S4 isolated boot) | temp `DSH_HOME` but **no** `TOKENECONOMIZER_HOME`, copied patch kept live absolute paths, temp home never removed | adds `TOKENECONOMIZER_HOME="$iso/tk-home"`, rewrites `$HOME/.dsh` in the copied patch, `trap 'rm -rf "$iso"' EXIT`; annotated `isolated-temp-home` |
| `scripts/opencode-v2-stabilisation-status.sh` (S4 isolated boot) | same three gaps | same three fixes |
| `dsh-tokeneconomizer/test/tiering-mount.test.mjs` | applied the plugin with the default state root: the session export at `agent/created` tried to write the live `~/.tokeneconomizer/dsh-sessions/` (`EROFS` in the sandbox; a live write outside it) — 2 tests failed | each test now passes a per-test temp `stateHome` and removes it in `t.after`; suite **131 pass / 1 skipped** (was 129 pass / 2 fail), live session logs unchanged at 120, no new live engine files |
| `scripts/install-korean-locale-live.sh` | ran `dsh plugin --profile web add` against the live home with no confirmation | annotated `live-intentional`; refuses unless `DSH_LIVE_INSTALL=1` (exit 3) and prints the live path it is about to write |
| `scripts/install-notify-live.sh` | same | same |
| `scripts/measure-token-saving.mjs` | defaulted `DSH_HOME` to the live home (read-only) with no statement, and `--json` could point inside that home | annotated `read-only-live-home`; prints `[measure] DSH_HOME unset: READING the live home … (read-only)`; refuses `--json` inside `DSH_HOME` (exit 2) |
| Guard + tests | none existed | `scripts/check-dsh-isolation.mjs` (self-test **9/9**) + `scripts/check-dsh-isolation.test.mjs` (**7/7**) + `scripts/cleanup-orphan-sessions.test.mjs` (**3/3**); the last guard test is the workspace gate itself |

Measured proof for the two contract/engine fixes: `node dsh-command-skill/scripts/verify-contract.mjs`
now composes the profile against a temp home and the live `profiles/web/cordis.yml` SHA-256 and
mtime are **unchanged** afterward; `cd dsh-tokeneconomizer && npm test` leaves the live
`~/.dsh/sessions` count at **120** (unchanged) and creates no files in `~/.tokeneconomizer`.

Audited and deliberately unchanged — they are **owner-only live-service operations that do not
launch DSH** (systemd/journalctl/HTTP probes only): `scripts/restart-and-verify-web.sh`,
`scripts/post-restart-verify.sh`, `scripts/verify-antigravity-restart.sh`,
`scripts/verify-opencode-v2-restart.sh`, `scripts/restart-verify-tokeneconomizer.sh`,
`scripts/session-transfer-restart.sh`, `scripts/title-restoration-restart.sh`. They restart or
inspect the live `dsh-web.service` and have no temp-home equivalent.

Docs examples are prose for the owner, not runnable harnesses: `dsh plugin --profile web add`
and `systemctl --user restart dsh-web.service` are intentionally live commands. Any doc that adds
an automated example must follow §1.

## 4. Why this matters (measured)

The sidebar's "그룹 없음" section is **session logs no workspace lists**, not workspaces. Measured
2026-11-03: 202 logs, 116 unregistered, **112 of them `/tmp/te-side-*`** — one permanent session
directory per TokenEconomizer side call, because the call let DSH persist at the default root.
Those were cleaned before this round; the live state at 2026-11-05 is **120 logs: 98 bound, 20
linked child, 2 unregistered**, of which only **2** are true standalone `/tmp/te-*` orphans. See
[ORPHAN-SESSION-CLEANUP.md](ORPHAN-SESSION-CLEANUP.md) for the current cleanup plan.

The engine-side fix (the TokenEconomizer patch re-roots session persistence per side call) is
necessary but not sufficient: a harness that runs the engine or the CLI directly can still create
live sessions. Isolation at the harness is the second half.

## 5. Verify

```bash
node scripts/check-dsh-isolation.mjs
node --test scripts/check-dsh-isolation.test.mjs scripts/cleanup-orphan-sessions.test.mjs
node scripts/cleanup-orphan-sessions.mjs        # dry run only; owner applies
npm run docs:check
```
