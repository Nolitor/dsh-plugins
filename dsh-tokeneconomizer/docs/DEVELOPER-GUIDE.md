# TokenEconomizer — Developer Guide

<!-- skeleton:
version: 1.0
kind: spec
status: active
updated: 2026-11-15
summary: The developer-facing guide to @nolit/dsh-tokeneconomizer at 0.0.1-rc.8 — the three surfaces a developer touches (the engine boundary, the settings API and the Web client), how to change each one without breaking the other two, the three regression gates that guard the contracts, and the measured facts each of them rests on.
-->

> History lives in [CHANGELOG.md](../CHANGELOG.md). This file is the **working** view: what a
> developer needs to change this plugin safely. The architecture is in
> [ARCHITECTURE.md](ARCHITECTURE.md); the operator's runbook is in
> [OPERATIONS.md](OPERATIONS.md).

## 1. What this plugin is, in one paragraph

A DSH plugin that embeds Microsoft's TokenEconomizer engine. The engine is **not vendored in
this package**: `scripts/bootstrap.mjs` clones ONE pinned upstream commit
(`6141bb9251a7d5cccc1b97ae340c7b872108292c`) into the TokenEconomizer state root, applies this
package's patch (`patch/0001-add-dsh-host.patch`), and writes two launchers (`bin/te`,
`bin/te-hook`). Everything this plugin does at runtime crosses that process boundary.

There are **three surfaces**, and each one has a contract with the other two:

```
                    ┌─────────────────────────────────────────┐
  Web client        │  lib/client.js   (browser half)         │
  lib/client.js  ──▶│  routes, i18n, the settings surface     │
                    └───────────────┬─────────────────────────┘
                                    │ HTTP (8 routes)
                    ┌───────────────▼─────────────────────────┐
  Host plugin       │  lib/settings-api.js  (route half)      │
  lib/index.js  ───▶│  lib/settings-contract.js (shared data) │
                    └───────────────┬─────────────────────────┘
                                    │ child_process
                    ┌───────────────▼─────────────────────────┐
  Engine            │  bin/te  →  vendor/TokenEconomizer-<sha> │
  (upstream + patch)│  patched by patch/0001-add-dsh-host.patch│
                    └─────────────────────────────────────────┘
```

## 2. The shared contract, and why it exists twice

`lib/settings-contract.js` is the **single source of truth** for the settings surface: the route
paths, the mode vocabulary, the threshold specs, and the model slots. It is deliberately free of
imports — no `node:` builtins, no relative specifiers — so both halves can read it.

**The Web half cannot import it.** `lib/client.js` is served verbatim and evaluated by
`window.__ModuleLoader__` as a CommonJS factory; the loader exposes a fixed module table and the
file must carry no import statements. So the client **mirrors** the contract as literals.

**A mirror is a drift waiting to happen.** Three gates pin it:

| Gate | File | What it pins |
|---|---|---|
| route literals | `test/client.test.mjs` | every path constant in the contract appears in the client |
| model slots | `test/client.test.mjs` | every slot's `key` AND `label` appear, and no slot name collides with a mechanism mode |
| locale tables | `test/client.test.mjs` | the client's inline `I18N` / `SETTINGS_I18N` equal `locale/*.json` key for key |

**When you add a setting, these four files change together** (and the gates will tell you):

1. `lib/settings-contract.js` — the constant.
2. `lib/settings-api.js` — the read payload and the write branch.
3. `lib/client.js` — the inline `SETTINGS_I18N` (en + ko) and the render.
4. `locale/en.json` + `locale/ko.json` — the same strings.

The locale files are **generated from the client's inline tables**; `locale/*.json` is the
tooling source of truth and the client is the served copy. Keep them in step by editing the
client's table and re-deriving the JSON.

### 2.1 The slot key / slot label distinction — read this before touching the model slots

A model slot carries **two different strings**:

| Field | Value | Used for |
|---|---|---|
| `key` | `model.microskills` | the **write** payload: `set["model.microskills"]` |
| `label` | `microskills` | the **read** payload: `modelSlots.microskills` |

They differ on purpose. The `key` is namespaced because the slot and the mechanism mode share
one `set` object on the write path — the engine's `microskills` key is the **mode**
(`envfacts+distiller`), and an unnamespaced slot of the same name would be two different
settings under one key.

**Measured 2026-11-15 — the bug this distinction exists because of.** The client's slots
declared only `key`, while the stored value was read as `modelSlots[slot.label]`. `label` was
`undefined`, so every stored value read as `undefined` and the select showed the deployment
default even after the engine had persisted the choice. `REGRESSION GATE: every model slot
carries the label the read payload is keyed by` now pins it.

## 3. The engine boundary

`lib/bridge.js` owns the whole process boundary. Every engine call is bounded, fails open, and
returns a neutral value on any failure — a cost optimizer must never break the session it is
observing.

| Function | Engine call | Returns |
|---|---|---|
| `hook(bins, payload)` | `te-hook --host dsh` | the hook object (`{}` changes nothing) |
| `brief(bins, cwd, tools)` | `te --host dsh --cwd <cwd> dsh-session` | the facts and the tool mask |
| `statusJson(bins, cwd)` | `te --host dsh --cwd <cwd> status --json` | the operator view |
| `importExport(bins, path, cwd)` | `te --host dsh --cwd <cwd> dsh-import <path>` | the fold summary |

**`--cwd` is not optional.** The engine keys its per-repository config by the directory it is
asked about. The settings page's engine call therefore names **this package's own directory**
explicitly. Measured 2026-11-15: without it, the engine used the **host process's** working
directory — the web profile's cwd is `~/.dsh` — so a save landed in
`repos/deepseek-harness-bbcdb118d8/config.json` while the operator's own repository kept its old
value, and the setting looked like it reverted to the default on every save.

`packageDir()` resolves that directory: `new URL('..', import.meta.url)` **already is** the
package root, and a `dirname` on top climbs one level too far.

## 4. The settings API

Eight routes, all under `/api/local/tokeneconomizer/settings`. They are registered through an
injected `register(method, path, handler)` callback, and the host groups them one registration
per path because DSH rejects a duplicate path.

| Route | Method | What it does |
|---|---|---|
| `/settings` | GET | the aggregate read: modes, thresholds, model slots, mechanism status, judge status |
| `/settings/config` | POST | the batched write — one result per key |
| `/settings/restore` | POST | undo the tool-prune restriction |
| `/settings/reset` | POST | drop stored overrides |
| `/settings/import` | POST | start the history import; answers **202** plus a job id |
| `/settings/import?jobId=<id>` | GET | the job's status |
| `/settings/upstream-check` | GET | the engine identity and the upstream comparison |
| `/settings/models` | GET | the registered provider/model pairs |

Two rules the routes hold to:

**A write is confirmed by a re-read.** The response carries the **persisted** value, never the
posted one. A key the engine did not persist comes back as `ok: false`.

**The upstream route answers 200 in every case**, including the failure cases. The distinction
is in `ok`: `false` means the question could not be answered, and the reasons are in `errors`.
`updateAvailable` is `null` when the question could not be answered — **never `true`**. An
out-of-date claim that turns out to be a network problem teaches the reader to ignore the
button, and the next real update goes unnoticed.

## 5. The upstream check, and the two versions

`lib/upstream.js` answers "which engine am I running, and is upstream ahead?".

**The engine has no version string of its own.** Measured: no `__version__`, no `VERSION` file,
and `te --version` is not even a valid invocation (the CLI requires a subcommand). The engine's
version is therefore derived from the tag history of the pinned checkout:

| Situation | Label |
|---|---|
| the checkout carries a tag | `git describe --tags` → `v0.1.0-22-g6141bb9` → `v0.1.0+22.g6141bb9` |
| the checkout carries **no** tag | `git describe` FAILS → `unreleased+6141bb92` |

A filtered clone of one commit has no tags, so the second row is the common case in a fresh
install — the fallback is not an edge case, it is the default.

**TWO VERSIONS, AND THEY MUST NOT BE CONFUSED.** The page shows the **plugin's** own version
(`0.0.1-rc.N`, read from its manifest) and the **engine's** version under separate labels. A
card that shows only the upstream tag reads as "the plugin is v0.1.0", which is false: the tag
belongs to `microsoft/TokenEconomizer`, and this plugin's release line is `0.0.1-rc.N`.

**The commit distance is `ahead_by`, not `behind_by`.** The GitHub compare API's `behind_by`
counts the commits the **pin** has and the head does not. The number an operator wants — how far
the HEAD is ahead of the pin — is `ahead_by`. Measured live on 2026-11-15: `behind_by` was 0 and
`ahead_by` was 187, so reading `behind_by` would have reported "the pin is current" on every
run.

## 6. The side-call model slots

The Micro-skills proposer and the Loop Guard judge are the two LLM side calls the engine makes
per session. Both were hard-wired to the deployment's own route.

| Slot | Engine config key | Writable? |
|---|---|---|
| `model.default` | *(none)* | **no** — the engine has no such setting, so it is a read-only fact |
| `model.microskills` | `microskills_model` | yes |
| `model.loopguard` | `loopguard_model` | yes |

**Measured 2026-11-15 — why `model.default` is not a control.** It was a `<select>`: it accepted
a value, the client sent it, the server answered `ok: true` with the value **empty** (there was
nowhere to put it), and the select snapped back to "deployment default" on the next read. A
control that silently discards its own choice is worse than one that says it has nowhere to put
it, so it is now a stated fact. `REGRESSION GATE: the default model slot is a fact, never a
control` pins it.

**The value is a `provider/model` pair** (`deepseek-account/deepseek-flash`) — DSH routes by
provider, and a model id alone belongs to one. A string without the separator names no provider
and is refused at the boundary rather than written and silently ignored.

**The dropdown lists the host's own LLM registry** (`ctx.llm.listProviders()` and
`ctx.llm.listModels(provider)`), so it names only routes this deployment can actually take. A
deployment with no registry answers an empty list and the page says so.

### 6.1 The engine side

The engine carries the model to the call through the `--patch` overlay it already writes for the
throwaway session store — one extra `agent-default-model` row, so the call runs on that
provider/model **for that call only**:

```yaml
- id: agent-default-model
  config:
    provider: "deepseek-account"
    model: "deepseek-flash"
```

Measured end to end: the patched engine writes exactly that, and real
`dsh --profile headless --patch <overlay> --dump-config` composes it as
`{provider: deepseek-account, model: deepseek-flash}`.

The engine's `runner_for(host_name, config, slot)` gained an optional third parameter
(`"default"` | `"microskills"` | `"loopguard"`), so the two mechanisms can run on two different
models. The existing two-argument call signature still works, and the other hosts keep using
`paid_model` — a provider-qualified pair means nothing to them.

**To change the engine**, edit the vendored tree and regenerate the patch. The procedure is
exact and reproducible:

```bash
git clone --quiet --filter=blob:none https://github.com/microsoft/TokenEconomizer.git <tree>
cd <tree> && git checkout --quiet 6141bb9251a7d5cccc1b97ae340c7b872108292c
git apply <the current patch>          # apply the shipped patch FIRST
# ... edit the engine ...
git add -N tokeneconomizer/trace/dsh.py tests/test_dsh_trace.py   # intent-to-add for new files
git diff > new.patch
```

Two traps, both measured:

- **`git add -N` is required** for the files the patch ADDS, or `git diff` omits them.
- **Do not hand-edit a hunk header.** The shipped patch carried `@@ -344,4 +393,6 @@` where the
  regenerated value is `@@ -344,4 +408,6 @@`. The tree it produced was correct, so nothing
  failed — but the patch could no longer be regenerated from its own source, which is the
  property that makes it auditable.

Verify the result: apply it to a **fresh** clone at the pinned sha, then confirm
`git apply --reverse --check` succeeds (this is what `scripts/bootstrap.mjs` uses to detect an
already-applied patch) and that the resulting tree matches the edited one.

## 7. The Web client

`lib/client.js` registers **one** `settings.section` seat (`tokeneconomizer`, order 62) with two
internal tabs — `환경설정` and `통계`. One navigation row for one product surface.

The client half is served verbatim and evaluated by `window.__ModuleLoader__`. Two constraints
follow, and both have bitten before:

- **No `import`/`export`.** An ESM `import` in this file passes `node --check` and every unit
  test, then fails the real boot as "web boot: 1 entry did not activate".
- **No relative module paths.** The loader exposes a fixed module table.

The client reads its strings from two inline tables, `I18N` (the devstats block) and
`SETTINGS_I18N` (the settings block). `locale/en.json` and `locale/ko.json` carry the same
content, and `test/client.test.mjs` asserts the two agree key for key.

## 8. The manifest self-check

The host does **not** enforce `dsh.manifestVersion`. Measured in the installed
`dsh-package-manifest` README: "Current installers and loaders do not enforce
`dsh.manifestVersion` or `engines.dsh`".

So the plugin checks its own field at activation (`lib/index.js`, `checkManifestVersion`). A
mismatch **warns and degrades; it never throws** — a throw inside `apply()` costs the entire
plugin, and a cost optimizer must not be the reason a session breaks.

`node bin/dsh-te.mjs doctor` reports the same comparison, next to the install, the plugin's
36 configuration keys, and the engine's repository key for the current directory.

## 9. The gates

| Gate | Command | What it protects |
|---|---|---|
| unit / regression | `npm test` | the whole plugin: **260 tests, 259 passing, 1 skipped** (measured 2026-11-15 at `0.0.1-rc.8`) |
| syntax | `npm run check` | every module under `lib/`, `bin/`, `scripts/` parses — the script **walks** the tree, so a new module is checked the moment it exists |
| deprecations | `npm run audit:deprecations` | the consumed DSH seams are present and none is newly deprecated |
| doctor | `node bin/dsh-te.mjs doctor` | the install, the manifest, the 36 config keys, the identity |
| engine suite | `python -m pytest tests/ -q` in the vendored tree | the engine's own tests: **419 passed, 1 skipped** (8 of them new for the side-call model slots) |
| docs | `npm run docs:check` at the repo root | the skeleton headers, the generated indexes, the relative links |
| history | `node scripts/check-plugin-history.mjs` | every plugin track owns its CHANGELOG |

**The three regression gates that guard this session's contracts** — if one of them fails, the
thing it protects has regressed:

1. `REGRESSION GATE: every model slot carries the label the read payload is keyed by`
2. `REGRESSION GATE: the default model slot is a fact, never a control`
3. `REGRESSION GATE: the settings engine calls name the repository explicitly`

## 10. The rules that bite

- **Never edit the engine's copy in place.** The patched tree is a pinned clone under
  `$TOKENECONOMIZER_HOME/vendor/TokenEconomizer-<sha>`; an edit there is lost on the next
  bootstrap. Change the patch, not the tree.
- **Never write to `~/.dsh` or `~/.tokeneconomizer` from a test.** Both are the user's live
  state. The harness points `DSH_HOME` at a temporary directory for exactly this reason.
- **The live service restart is the owner's.** A restart cuts the owner's session. Report what
  needs one; do not run it.
- **The numeric part of the version (`0.0.1`) is the owner's.** The `rc.<n>` suffix is this
  track's history marker and is bumped once per session in which the plugin's files changed.

## 11. Where to look next

| Question | Document |
|---|---|
| how the DSH lifecycle is mapped | [ARCHITECTURE.md](ARCHITECTURE.md) |
| how to install, verify, roll back, and what every setting does | [OPERATIONS.md](OPERATIONS.md) |
| what the engine's settings are and how the page edits them | [OPERATIONS.md](OPERATIONS.md) §5 |
| the host-local levers in detail | [IN_MEMORY_FEATURES.md](IN_MEMORY_FEATURES.md) |
| what was built, and what was not | [DSH-SCHEMA-IMPLEMENTATION.md](DSH-SCHEMA-IMPLEMENTATION.md) |
| what actually saved tokens | [TOKEN-ECONOMIZER-SAVING-MEASUREMENT.md](TOKEN-ECONOMIZER-SAVING-MEASUREMENT.md) |
| what changed, and why | [CHANGELOG.md](../CHANGELOG.md) |
