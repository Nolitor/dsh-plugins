# @nolit/dsh-tokeneconomizer

<!-- skeleton:
version: 1.2
kind: readme
status: active
updated: 2026-10-30
summary: DSH 0.2.2 bridge for microsoft/TokenEconomizer: lifecycle mapping, in-memory tool mask, DSH trace reader, bootstrap and cold start, plus four host-local in-memory features.
-->

DSH-side bridge for [microsoft/TokenEconomizer](https://github.com/microsoft/TokenEconomizer) (Apache-2.0,
pinned commit `6141bb92`). The economical behaviour stays in TokenEconomizer's stdlib-only Python
engine; this package translates the DeepSeek Harness agent lifecycle into the hook contract that
engine already speaks, and applies its answers with DSH's own levers.

Four features need neither the engine nor a model call, and run in the Host process with
`node:crypto` and timers only: tool-result hash deduplication, a KV-cache-safe prompt slot, a
loop breaker with a thinking watchdog, and the turn-based tiered memory that keeps the newest
turns whole, summarizes the middle ones and evicts the old ones. They are described in
[docs/IN_MEMORY_FEATURES.md](docs/IN_MEMORY_FEATURES.md).

| Mechanism | DSH lever | Written where |
|---|---|---|
| micro-skills (learned repository facts) | `systemPrompt.context()` on the agent's scope | session context only |
| tool pruning (evidence-based deny list) | `tools.restrict({ deny })` on the agent's scope | memory; no source config is edited |
| loop guard (redirect a stuck turn) | `agent.inject()` of one user-role context | session log, through the inbox event |
| session digest | decompressed session export, then detached `te fold` | `$TOKENECONOMIZER_HOME` |
| tool-result dedup | `tools/post-execute` content replacement | memory; the pointer is logged with the result |
| KV-cache-safe prefix slot | `systemPrompt.section()` on the agent's scope | memory; the text lives in the request's first message |
| loop breaker and thinking watchdog | `agent.cancel()` and `agent.inject()` | memory; the notices go to stderr |
| tiered memory for tool outputs | a surface rewrite of the session (`compaction/prune` + a replaced `tool/result`) | the durable log keeps the original; the model context keeps a pointer |

## Install

```sh
# 1. Materialize the patched engine (clones the pinned upstream commit, applies
#    patch/0001-add-dsh-host.patch, writes <state root>/bin/te and bin/te-hook)
node scripts/bootstrap.mjs

# 2. Install this bundle into a profile
dsh plugin --profile web add link:$PWD
# then add "@nolit/dsh-tokeneconomizer" to dsh.profile.bundles in
# $DSH_HOME/profiles/web/package.json and restart that profile

# 3. Teach it from the sessions that already ran
node bin/te-dsh.mjs cold-start
```

`dsh plugin add` installs the package but does not compose it: the bundle must be listed in
`dsh.profile.bundles` for its patch row to be applied. `--dump-config` passing does not prove the
row mounts; check `te-dsh status` after a session and `$TOKENECONOMIZER_HOME/errors.log`.

## Commands

```sh
node scripts/bootstrap.mjs [--source <checkout>] [--sha <commit>] [--home <state root>] [--verify-only]
node bin/te-dsh.mjs cold-start [--dsh-home <dir>] [--limit N] [--all] [--dry-run]
node bin/te-dsh.mjs status [--cwd <dir>]
node bin/te-dsh.mjs doctor
npm test
```

The engine's own settings apply unchanged (`te config set microskills=on`, `loopguard=off`, …);
this plugin only decides whether to apply each answer (see `DEFAULTS` in `lib/index.js`).

The package imports nothing outside `node:` builtins. It never imports a harness package, so a
profile can mount it with no peer dependency, and the TokenEconomizer engine is reached only
through `child_process` (`te`, `te-hook`).

## Layout

```
lib/index.js        Cordis plugin: the DSH lifecycle mapping
lib/bridge.js       the process boundary: te-hook, dsh-session, dsh-import, exports
lib/dedup.js        host-local: tool-result hash deduplication
lib/prefix.js       host-local: the KV-cache-safe prompt slot and its guard
lib/watchdog.js     host-local: the loop breaker and the thinking watchdog
lib/tiering.js      host-local: the turn-based tiered memory for tool outputs
bin/te-dsh.mjs      operator commands: bootstrap, cold-start, status, doctor
scripts/bootstrap.mjs  pinned clone + patch + launchers + verification
patch/              the DSH host patch for the upstream engine (7 files, one new reader)
test/               node --test: bridge shaping, module load, package contract,
                    the four host-local features, one end-to-end session through a
                    bootstrapped engine
docs/               architecture, operations, and the host-local features
```

Design rationale, the per-event contract, and the state/ledger format are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The four host-local, in-memory features are in
[docs/IN_MEMORY_FEATURES.md](docs/IN_MEMORY_FEATURES.md). Install, rollback, and cold-start
procedures are in [docs/OPERATIONS.md](docs/OPERATIONS.md).
