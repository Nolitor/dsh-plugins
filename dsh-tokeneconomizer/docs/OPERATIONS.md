# Operations

<!-- skeleton:
version: 1.2
kind: spec
status: active
updated: 2026-10-30
summary: Bootstrap, profile install, cold start, verification, rollback, the configuration reference, and the live-state rules for the DSH TokenEconomizer bridge.
-->

## 0. Rules that apply to every step

1. `~/.dsh` (profiles, sessions, credentials) and `~/.tokeneconomizer` are the user's live state.
   Nothing here writes them without the operator running the command: the bootstrap writes the
   state root only when invoked, and `--home` keeps an experiment out of the live tree.
2. `dsh plugin add` installs a package; it does not compose it. A bundle must also appear in
   `dsh.profile.bundles`, and only a real mount proves the row loaded. `--dump-config` does not.
3. Two plugins registering the same tool or route is a hard mount failure. This plugin registers
   none: it only calls `tools.restrict` and `systemPrompt.context` on an agent's own scope.
4. Never edit the engine's copy in place. The patched tree is a pinned clone under
   `$TOKENECONOMIZER_HOME/vendor/TokenEconomizer-<sha>`; `--force`-style edits there are lost on
   the next bootstrap.

## 1. Bootstrap the engine

```sh
cd dsh-tokeneconomizer
node scripts/bootstrap.mjs
```

What it does, in order: clone `https://github.com/microsoft/TokenEconomizer.git` at
`6141bb9251a7d5cccc1b97ae340c7b872108292c` (or `--source <checkout>`), apply
`patch/0001-add-dsh-host.patch`, write `bin/te` and `bin/te-hook` with mode `0700`, and run
`te --host dsh --cwd <cwd> status --json` requiring `host: dsh`.

Re-running is safe. An already-applied patch is detected with `git apply --reverse --check` and
left alone; a different HEAD is checked out back to the pin first.

Offline or air-gapped: `node scripts/bootstrap.mjs --source /path/to/TokenEconomizer`, where the
checkout already holds the pinned commit.

## 2. Install into a profile

```sh
dsh plugin --profile web add link:$PWD/dsh-tokeneconomizer
```

Then add the bundle to `$DSH_HOME/profiles/web/package.json`:

```json
"dsh": { "profile": { "bundles": [ "...", "@nolit/dsh-tokeneconomizer" ] } }
```

and restart that profile. The row is inserted by `cordis.patch.yml`
(`id: tokeneconomizer-dsh`). Verify the mount, not the config dump:

```sh
node bin/te-dsh.mjs status --cwd <repository>
```

`status` reads `te status --json` for that repository: `host: dsh`, `state`,
`toolprune.proposal`, `microskills.injected_lines`, `ledger.sessions`. A session that ran with the
plugin mounted shows up there after `agent/disposed` folds it.

## 3. Cold start (learn from sessions that already ran)

```sh
node bin/te-dsh.mjs cold-start --dry-run      # list what would be folded
node bin/te-dsh.mjs cold-start                # decompress, import, fold
node bin/te-dsh.mjs cold-start --limit 20     # newest 20 only
```

It walks `$DSH_HOME/sessions/<project>/<session>/session.v*.jsonl.zstd`, decompresses with Node's
`zstdDecompressSync` (Node ≥ 22.15), writes
`$TOKENECONOMIZER_HOME/dsh-sessions/<id>.jsonl`, and calls
`te --host dsh --cwd <cwd> dsh-import <export>` once per session. A log modified in the last
minute is skipped unless `--all`, because the harness may still be writing it. Folded sessions are
keyed by id, so a second run folds nothing twice.

The engine folds each session: micro-skills evidence, tool-prune evidence and the ledger record.
What a session taught is available from the next session start; the loop guard needs five
ended-green turns before it has a repository envelope.

`DSH_HOME` decides the source tree; `--dsh-home` overrides it; `--home` (or
`TOKENECONOMIZER_HOME`) decides where the engine state goes. Both are honored by every command.

## 4. Configure the mechanisms

The engine's settings are the source of truth:

```sh
te --host dsh --cwd <repo> config show
te --host dsh --cwd <repo> config set microskills=on
te --host dsh --cwd <repo> config set loopguard=off
te --host dsh --cwd <repo> microskills
te --host dsh --cwd <repo> toolprune show
```

Defaults on DSH: `microskills=off`, `toolprune=auto` (read as `propose`), `loopguard=nudge`.
`microskills=on` enables the free envfacts layer plus a model proposer every
`microskills_propose_every` sessions, through `dsh --profile headless`; `envfacts` keeps it free.

This plugin's own switches (in the bundle row, or `cordis.yml`): `microskills`, `toolprune`,
`loopguard`, `hookTimeoutMs`, `cliTimeoutMs`, `headless`, and the three path overrides. They are
validated by the plugin itself (`resolveConfig`), because the package carries no schema
dependency; an unknown key or a wrong type fails the row at load.

The host-local, in-memory features have their own switches, which need neither the engine nor a
model call:

| Switch | Default | Effect |
|---|---|---|
| `dedup` | `true` | replace a repeated tool output with a pointer to the step that produced it |
| `dedupMinChars` | `200` | shortest output worth replacing |
| `dedupMaxEntries` | `512` | remembered digests per session |
| `pinnedRules` | `''` | immutable instruction text, mounted in the request's first message |
| `pinnedRulesOrder` | `50` | section order of the pinned rules; the lowest accepted order is `-999` |
| `loopBreaker` | `true` | stop a turn whose identical command keeps failing |
| `loopBreakerThreshold` | `3` | consecutive identical failures that trip the breaker |
| `loopBreakerWindow` | `5` | remembered calls |
| `watchdog` | `true` | interrupt a step that commits no progress |
| `watchdogThresholdMs` | `180000` | progress-free budget of one step |
| `watchdogAction` | `interrupt` | `warn` only writes a notice |
| `watchdogProgress` | `any` | `committed` counts only committed session events as progress |

The turn-based tiered memory has its own switches. They grade old tool outputs by turn and
never touch the newest ones:

| Switch | Default | Effect |
|---|---|---|
| `tiering` | `true` | grade the session's tool outputs by turn |
| `tierHotTurns` | `5` | turns kept at full fidelity, byte-identical |
| `tierWarmTurns` | `15` | turns kept as a structural summary (head, tail, and an index of files and status codes) |
| `tierHeadChars` | `2000` | characters kept from the head of a warm-tier output |
| `tierTailChars` | `600` | characters kept from the tail of a warm-tier output |
| `tierMinChars` | `1200` | shortest output worth grading |

`TE_DIAG=1` writes the tool-event delivery counters to `<state root>/diagnostics.json`. It is
the routing check: a route that runs its tool calls outside the harness never delivers a
`tools/result` event to this plugin, and the plugin says so at the end of such a session.

Their behavior is described in [IN_MEMORY_FEATURES.md](IN_MEMORY_FEATURES.md). Their notices go
to stderr, with the `[tokeneconomizer]` prefix, and the agent's scope carries their state, so
removing the bundle row removes them.

## 5. Verify and diagnose

```sh
node bin/te-dsh.mjs doctor                 # launchers, vendored tree, HEAD, live check
node bin/te-dsh.mjs status --cwd <repo>    # what the engine knows about this repository
npm test                                   # 58 tests, one needs TE_DSH_TEST_HOME
TE_DSH_TEST_HOME=$TOKENECONOMIZER_HOME npm test  # includes the end-to-end session
(cd "$TOKENECONOMIZER_HOME/vendor/TokenEconomizer-<sha>" && python3 -m unittest tests.test_dsh_trace)
```

Failure signals:

| Symptom | Where to look |
|---|---|
| no facts, no proposal | `te-dsh status` shows 0 sessions: the fold never ran (`agent/disposed` not reached, or the engine missing) |
| facts learned but none injected | `microskills` is `off`, or the next session's brief failed (`errors.log`) |
| `errors.log` traceback | engine bug or unreadable state; the session itself was unaffected |
| proposal never forms | catalog missing (`hosts/dsh/catalog.json`) or fewer than 5 sessions / 10 prompts |
| `priced_by: fallback` | expected for DSH model ids; the engine's price table does not carry them yet |

## 6. Rollback

1. Remove `"@nolit/dsh-tokeneconomizer"` from `dsh.profile.bundles` and restart the profile — the
   in-memory tool mask, the injected facts and every listener disappear with the plugin.
2. `dsh plugin --profile web remove @nolit/dsh-tokeneconomizer`.
3. The engine is independent of the plugin: `$TOKENECONOMIZER_HOME` keeps what was learned.
   Removing the state root forgets it; nothing else references the vendor tree.
4. The patch touches only the vendored clone. Upstream, every other agent's integration, and the
   user's repositories are unchanged.

## 7. Live-state note for experiments

Use an isolated home for anything experimental:

```sh
node scripts/bootstrap.mjs --home /tmp/te-probe
DSH_HOME=/tmp/dsh-probe TOKENECONOMIZER_HOME=/tmp/te-probe node bin/te-dsh.mjs cold-start --all
```

`cold-start` passes the same home to `te dsh-import`; a mismatch here would write the live state
from a probe run, which is why the flag is threaded through `--home` and not left to the
environment.
