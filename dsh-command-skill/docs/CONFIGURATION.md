# Configuration Schema — TokenEconomizer + interrupt boundary

<!-- skeleton:
version: 1.0
kind: spec
status: active
updated: 2026-11-02
summary: Where every tunable value lives today, why they are currently scattered across three layers, and the target externalized schema with precedence, validation and fail-open behaviour.
-->

> Status: active · Measured 2026-11-02

## 0. The problem

An option has no single home. `tierMinChars`, for example, is written in the code default, again in
the plugin's bundle patch, and (mistakenly) expected in the user profile patch — where it does not
exist. A value changed in the wrong layer is silently overridden by the layer that actually wins.

## 1. Where a value actually comes from (measured precedence)

| Layer | File | Wins over |
|---|---|---|
| 1. code default | `dsh-tokeneconomizer/lib/index.js` `DEFAULT_CONFIG` | nothing (lowest) |
| 2. bundle patch | `dsh-tokeneconomizer/cordis.patch.yml` | code default |
| 3. profile patch | `~/.dsh/profiles/web/cordis.patch.yml` | bundle patch |
| 4. home patch | `$DSH_HOME/cordis.patch.yml` | profile patch |
| 5. CLI overlay | `dsh --patch <file>` | everything |

Measured on an isolated `DSH_HOME` by resolving one key through every layer:
`3700` (bundle) -> `1234` (profile) -> `999` (home) -> `7` (CLI overlay).

### The hazard: a patch `config` REPLACES the whole config

DSH's own schema says it plainly
(`dsh-app-boot/lib/index.js:3261`):

> "Bundle, profile, home, and CLI layers apply in that order. **A patch config replaces the whole
> config.**"

Verified with a synthetic plugin: bundle `{alpha:111,beta:222,gamma:333}` plus a profile patch
declaring only `{beta:2}` yields the plugin seeing **`{beta:2}` alone** — `alpha` and `gamma` are
gone, falling back to code defaults rather than to the bundle's values.

**Consequence for this plugin:** a profile patch that sets one TokenEconomizer key silently resets
the other 34 to code defaults. This is invisible today only because the bundle patch is currently a
verbatim copy of the defaults; it becomes a live hazard the moment the two diverge.

Measured fact that caused a near miss: the live value of `tierMinChars` resolves from **layer 2**,
not layer 3. Editing only the profile patch neither applies the new value reliably nor leaves the
other keys alone.

```sh
dsh --profile web --dump-config | grep tierMinChars   # authoritative resolved value
```

## 2. Tunables that should be externalized

### Tiering (turn-based context lifecycle)

| Key | Current | Meaning |
|---|---|---|
| `tierHotTurns` | `5` | turns kept byte-identical (in-memory, full fidelity) |
| `tierWarmTurns` | `15` | turns after which an output becomes a structural index |
| `tierMinChars` | `3700` | smallest output worth rewriting; below this the summary can be larger than the original |
| `tierHeadChars` | `2000` | head bytes retained in a warm summary |
| `tierTailChars` | `600` | tail bytes retained in a warm summary |

Owner's stated intent — *turns 1-6 in memory, 7-15 index, 16+ to the log* — maps to
`tierHotTurns: 6` with `tierWarmTurns: 15` unchanged. The code's `age = currentTurn - turn`, with
`age < hotTurns` as hot, makes `6` the correct value for that sentence; today's `5` keeps only five
turns whole.

### Watchdog

| Key | Current | Meaning |
|---|---|---|
| `watchdogThresholdMs` | `600000` | progress-free budget of one turn |
| `watchdogToolThresholdMs` | `600000` | separate budget for a tool call in flight |
| `watchdogWarnMs` | `300000` | soft warning point, once per budget |
| `watchdogAction` | `interrupt` | `warn` never ends the turn; `interrupt` cancels |
| `watchdogProgress` | `any` | `any` = any event counts, `committed` = only committed progress |

### Interrupt boundary

| Key | Current | Meaning |
|---|---|---|
| `DSH_INTERRUPT_CORE_URL` | absolute `file://` | module URL of the interrupt registry |
| `DSH_INTERRUPT_REASONS_URL` | absolute `file://` | module URL of the issuer wording |

## 3. Target schema

One file, resolved from `TOKENECONOMIZER_HOME` (default `~/.tokeneconomizer`), named
`config.json`. Absent file means "use defaults" — never an error.

```jsonc
{
  "version": 1,
  "tiering": {
    "hotTurns": 6,
    "warmTurns": 15,
    "minChars": 3700,
    "headChars": 2000,
    "tailChars": 600
  },
  "watchdog": {
    "thresholdMs": 600000,
    "toolThresholdMs": 600000,
    "warnMs": 300000,
    "action": "interrupt",
    "progress": "any"
  },
  "interrupt": {
    "contractMajor": 1
  }
}
```

### Precedence (revised after measurement)

```
code default  <  config.json  <  cordis config  <  TE_<KEY> environment
```

**The file sits above the cordis layer**, not below it. Two measured reasons forced this:

1. **Environment belongs above, not below.** The cordis layer *already is* the environment layer:
   `!!js` expressions are evaluated inside a patch, so a row can read `process.env` at compose time
   (verified: `!!js Number(process.env.TE_MIN ?? 3700)` resolved to `4444` under a real mount). An
   env layer placed *below* the cordis config would be dead code.
2. **Below the cordis layer the file would be unusable.** Because a patch `config` replaces the
   whole config (§1), any composed profile carries a complete 35-key object, and a file underneath
   it could never win a single key.

Merge as `{ ...cordisConfig, ...fileValues }` and emit a **shadow warning** when the file overrides
a value the patch already set — the operator should know which layer answered.

Do **not** model the file as another Cordis patch layer: that reintroduces the wholesale-replace
semantics of §1 for the sake of one file.

### Validation and failure

* Unknown keys: warn, ignore. Never fail the plugin.
* Wrong type or out-of-range: **fail open** — use the code default for that key, log one warning
  naming the key and the rejected value.
* `version` newer than the code understands: ignore the file entirely and say so. Reading a future
  schema with today's rules is how a config silently inverts its meaning.
* The plugin must mount with **no** file, a corrupt file, and a partially valid file.

### Implementation constraints (measured, non-negotiable)

| Constraint | Evidence | Consequence for the design |
|---|---|---|
| `ctx.settings` cannot carry this | DSH reports the row `"status":"absent"` in `--dump-config-schema` (a sibling reports `"status":"schema"`); it projects only `.volatile()` Config fields and this plugin exports no `Config`; a form write persists into the **profile patch**, which by §1 replaces the whole config | do not build on `ctx.settings`; use a JSON file |
| Any new import fails at mount | `dsh-tokeneconomizer/node_modules/@deepseek-ai/{schemastery,cosmokit}` are **dangling** symlinks into a non-existent profile path | phase 1 must stay JSON + `node:` builtins only |
| A throw in `apply()` costs the entire plugin | measured: `warning: 1 entry did not activate`, exit code **0**, plugin fully inert, no GUI banner | fail-open **per key**, never throw on a bad file |
| `--dump-config` cannot verify this feature | it does not validate plugin config at all (an unknown key and `watchdogAction: 'kill'` both print fine, exit 0), it prints `!!js` **unevaluated**, and a plugin-read file is invisible to it | acceptance needs a resolved-key readback, not `--dump-config` |
| The plugin is not config-hot-reloaded despite `link:` | HMR watches only the profile patch, the home patch and `profile/package.json`; the bundle patch inside a linked package is unwatched, and live HMR is currently disposed (`Error: HMR is disposed`) | a change is `applied pending restart`, and must be reported that way |
| Warnings must use `notice()`, not `noticeUser()` | `noticeUser()` injects a `user/message`, which re-arms the watchdog (see [INTERRUPT-LIFECYCLE.md](./INTERRUPT-LIFECYCLE.md) §1) | a config warning that used `noticeUser()` would restart the very budget it is warning about |

## 4. Migration risks

| Risk | Why | Mitigation |
|---|---|---|
| `link:` means instant live | both plugins symlink into the live profile; an edit is live on next start | no live writes without an explicit restart plan |
| **35 keys are copied in two places with no drift guard** | `DEFAULT_CONFIG` and `cordis.patch.yml` currently agree on all 35 keys, but nothing enforces it; `tierMinChars` lives in **three** files (`lib/tiering.js:42`, `lib/index.js:150`, `cordis.patch.yml:59`) and the last change had to hand-edit two of them | **add a test asserting the bundle patch equals the code defaults**, key by key |
| one-key override wipes the rest | a patch `config` replaces the whole config (§1) | never set a single key in a profile patch; set the full block or use the file |
| silent fallback | fail-open hides a typo | the warning must reach stderr/journal, not just an internal sink |
| future schema | a newer file read by older code | the `version` gate above |

## 5. What is deliberately not configurable

* The **tier semantics** (`age < hotTurns` -> hot). Exposing the comparison itself invites
  unreadable configurations; exposing the three numbers is enough.
* The **abort authority**. `watchdogAction` selects `warn` vs `interrupt`, but the cancel call itself
  stays in code: an abort must not depend on configuration that a stuck turn could change.
