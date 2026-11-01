# TE option externalization — measured design

<!-- skeleton:
version: 1.0
kind: design
status: draft
updated: 2026-11-02
summary: Measured option-resolution chain for @nolit/dsh-tokeneconomizer, the config sources DSH actually supports, and a fail-open JSON settings-file schema.
-->

> **Provenance.** Produced 2026-11-02 by the read-only `config-architect` investigation and kept
> here because the measurements outlive the session. Every probe ran against a throwaway
> `DSH_HOME` under `/tmp`; nothing was written to `~/.dsh` or any repository. Line numbers refer to
> `dsh-tokeneconomizer/lib/index.js` **before** the `isOwnNotice` watchdog fix (commit `ebc4aa5`);
> that diff touches no config key, so the option-chain numbers stand. See
> [../CONFIGURATION.md](../CONFIGURATION.md) for the adopted conclusions.

Read-only investigation. Numbers measured on this host 2026-11-02 08:02–08:25 KST.
No file under ~/.dsh, ~/.tokeneconomizer or any repository was written.
Repo untouched: dsh-plugins @ d1547b9, git status --porcelain -- dsh-tokeneconomizer = empty.

Plugin: /home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-tokeneconomizer (@nolit/dsh-tokeneconomizer 0.2.0)
Live profile: dsh --profile web, pid 3296447, started 2026-11-02 07:52:33 KST, DSH_HOME=/home/minami/.dsh
Live dump: /tmp/te-cfg-tmp-dump.yml (52,109 B), TE row lines 1376-1414

---

## 1. Current option-resolution chain — 35 keys, THREE copies, zero drift guards

### 1.1 Where each layer lives

| Layer | File | Lines | Keys it decides |
|---|---|---|---|
| code defaults | lib/index.js DEFAULTS | 89-167 | all 35 |
| tier code constants | lib/tiering.js TIER_DEFAULTS | 37-43 | hotTurns/warmTurns/headChars/tailChars/minChars, indexed into DEFAULTS at 142-150 |
| watchdog code constants | lib/watchdog.js DEFAULT_THRESHOLD_MS=600000, DEFAULT_WARN_RATIO=0.5 | 16, 19 | fallbacks; the same literals are ALSO hardcoded in DEFAULTS 127/132/134 |
| timeout code constants | lib/bridge.js DEFAULT_HOOK_TIMEOUT_MS=8000, DEFAULT_CLI_TIMEOUT_MS=20000 | 27-28 | duplicated into DEFAULTS 103/105 |
| validator | lib/index.js resolveConfig() | 228-268 | type / enum / minimum / cross-key |
| validator constants | CONFIG_KEYS 170, ENUM_SETTINGS 173-178, MINIMUM_SETTINGS 181-184, MIN_PINNED_RULES_ORDER 190 | — | — |
| plugin bundle patch | cordis.patch.yml config block | 12-79 | all 35, explicitly |
| provider profile patch | ~/.dsh/profiles/web/cordis.patch.yml | — | ZERO TE rows (only a comment at line 119) |
| launcher overlay | /home/minami/.local/share/dsh/cordis.local-bridge.patch.yml | — | ZERO TE rows |
| live resolved | dsh --profile web --dump-config | 1376-1414 | all 35 |

### 1.2 Three-way comparison (script /tmp/te-cfg/three-way.mjs)

Result: {"keyCount":35,"rowsWithAnyDelta":0,"allThreeAgree":true}

The bundle cordis.patch.yml is a VERBATIM 1:1 copy of the code defaults: 35/35 keys, 35/35 identical values, inYmlNotDefaults=[] and inDefaultsNotYml=[].
It therefore contributes ZERO effective configuration today — it is document-shaped duplication only.
That is what makes this refactor low-risk right now, and also why any config layer placed BELOW the cordis layer would be dead on arrival.

### 1.3 Full key table (key | code default | bundle yml | live resolved)

All 35 rows satisfy code default == bundle yml == live resolved.

| key | code default | bundle yml | live |
|---|---|---|---|
| tePath | '' | '' | '' |
| hookPath | '' | '' | '' |
| stateHome | '' | '' | '' |
| microskills | true | true | true |
| toolprune | true | true | true |
| loopguard | true | true | true |
| hookTimeoutMs | 8000 | 8000 | 8000 |
| cliTimeoutMs | 20000 | 20000 | 20000 |
| headless | auto | auto | auto |
| dedup | true | true | true |
| dedupMinChars | 200 | 200 | 200 |
| dedupMaxEntries | 512 | 512 | 512 |
| pinnedRules | '' | '' | '' |
| pinnedRulesOrder | 50 | 50 | 50 |
| loopBreaker | true | true | true |
| loopBreakerThreshold | 3 | 3 | 3 |
| loopBreakerWindow | 5 | 5 | 5 |
| **watchdog** | true | true | true |
| **watchdogThresholdMs** | 600000 | 600000 | 600000 |
| **watchdogToolThresholdMs** | 600000 | 600000 | 600000 |
| **watchdogWarnMs** | 300000 | 300000 | 300000 |
| **watchdogAction** | interrupt | interrupt | interrupt |
| **watchdogProgress** | any | any | any |
| **tiering** | true | true | true |
| **tierHotTurns** | 5 | 5 | 5 |
| **tierWarmTurns** | 15 | 15 | 15 |
| **tierHeadChars** | 2000 | 2000 | 2000 |
| **tierTailChars** | 600 | 600 | 600 |
| **tierMinChars** | 3700 | 3700 | 3700 |
| thinkInCode | true | true | true |
| recallPriorSessions | true | true | true |
| recallLimit | 3 | 3 | 3 |
| recallMaxChars | 900 | 900 | 900 |
| exportSessions | true | true | true |
| mode | apply | apply | apply |

tierMinChars=3700 confirmed live (dump line 1405) and agrees with TIER_DEFAULTS.minChars (tiering.js:42) and cordis.patch.yml:59.
So 3700 lives in THREE places with no test, build step or lint enforcing agreement. Commit d1547b9 had to edit two by hand and its message says so ("The value lives in two places that must agree"); lib/tiering.js makes it three.

---

## 2. What config sources DSH actually supports (measured)

### 2.1 ctx.settings — EXISTS, but NOT a usable externalization path for this plugin

| Fact | Evidence |
|---|---|
| Package exists: @deepseek-ai/dsh-settings 0.2.2-alpha.2, "Abstract user-settings seam (ctx.settings)" | .../dsh/node_modules/@deepseek-ai/dsh-settings/package.json |
| Service name "settings", injects ['configEditor','profileContext'] | dsh-settings/lib/index.js:322,324 |
| Row IS in the live profile | dump 66-68: - id: settings / name: '@deepseek-ai/dsh-settings' / disabled: !!js '!ctx.get(''profileContext'')' |
| Reachable once the loader settles | probe: ctx.get('settings')=true, configEditor=true, sessionQuery=true, hmr=true |
| It ONLY projects .volatile() config fields | schema(entry) returns entry.fiber?.runtime?.Config; volatileForm() keeps only meta.volatile fields (index.js:122-133, 538-541) |
| TE declares NO Config schema, so it is invisible | plugin exports = DEFAULTS, DELIVERY, apply, configValue, default, inject, name, resolveConfig, writeDelivery — no Config, no schema |
| DSH itself reports the row as unschemad | --dump-config-schema: tokeneconomizer-dsh -> "status": "absent", configRef "#/$defs/unknownConfig"; sibling dsh-antigravity-cli -> "status": "schema" |
| A settings-form write persists into the PROFILE Cordis patch | README: "Changes persist through the active profile's Cordis patch"; documentPath = profileContext.patchPath |

VERDICT: ctx.settings is a UI projection of an existing Config schema, not an independent settings file. Using it requires (a) replacing DEFAULTS + the custom validator with a schemastery Config, and (b) accepting that saves rewrite the profile patch — it relocates the code edits, it does not remove them.

### 2.2 Env-var override pattern — present, but only for out-of-band switches

| variable | read at | effect |
|---|---|---|
| TE_DISABLE | lib/bridge.js:269-271 isInert() | whole plugin inert |
| TE_SIDECALL | same | one side call stays inert |
| TE_DIAG | lib/index.js:332 diagnosticsEnabled() | writes <state root>/diagnostics.json |
| TOKENECONOMIZER_HOME | lib/bridge.js:36 stateRoot() | state root |
| DSH_INTERRUPT_CORE_URL / DSH_INTERRUPT_REASONS_URL | lib/interrupt-bridge.js:27-28 | registry module URL |

ZERO of the 35 DEFAULTS keys is env-readable today. DEFAULTS is consumed only via resolveConfig(config), where config is the composed Cordis row config.

DSH's own .env layering works and DOES reach the plugin (app-boot loadLayeredEnv, dsh-app-boot/lib/index.js:3756-3799):

| probe | result |
|---|---|
| $DSH_HOME/.env with TE_PROBE_MIN=4321 | plugin saw process.env.TE_PROBE_MIN="4321"; !!js expression resolved it to tierMinChars: 4321 |
| <cwd>/.env with TE_PROBE_MIN=5555 | tierMinChars: 5555 |
| $DSH_HOME/.env with DSH_PROBE=nope | HARD boot error: 'dsh: .../.env sets "DSH_PROBE", which only the launching environment may set' |

TE_* names are accepted; any DSH_/XDG_/DYLD_/BASH_FUNC_* name is refused (BOOTSTRAP_PREFIXES 3716-3721).

### 2.3 Precedence: profile patch vs plugin bundle patch — MEASURED on an isolated DSH_HOME

Probe /tmp/te-cfg/probe-dsh (throwaway DSH_HOME; live one never touched), TE linked at the same absolute path the web profile uses.

| layer set | resolved tierMinChars | winner |
|---|---|---|
| bundle cordis.patch.yml only | 3700 | bundle |
| bundle + profile patch 1234 | 1234 | profile beats bundle |
| bundle + profile 1234 + $DSH_HOME/cordis.patch.yml 999 | 999 | home beats profile |
| + --patch overlay.yml 7 | 7 | launcher overlay wins |

Order (matches app-boot readProfilePatches 1212-1222):
bundle patch -> profile/cordis.patch.yml -> $DSH_HOME/cordis.patch.yml -> --patch overlays

### 2.4 DECISIVE: a patch "config" REPLACES the whole config, it does not merge

DSH's own generated schema ($comment from --dump-config-schema):
"Bundle, profile, home, and CLI layers apply in that order. A patch config replaces the whole config."

Measured with a synthetic plugin whose bundle row ships {alpha:111, beta:222, gamma:333}:

| profile patch | config the plugin actually received |
|---|---|
| none | {alpha:111, beta:222, gamma:333} |
| - id: probe-merge / config: {beta: 2} | {beta: 2} ONLY |

Same for TE: '- id: tokeneconomizer-dsh / config: {tierMinChars: 1234}' produced a dump whose config block held ONLY tierMinChars: 1234; resolveConfig then backfills the other 34 from code DEFAULTS.

Consequence: a one-key profile override silently drops the bundle's watchdog*/tier* values back to code defaults. Invisible today only because bundle == code defaults (delta 0). The moment the bundle patch carries any non-default value, a one-key profile override becomes a silent config reset.

Also measured: a name: that does not match the row's real module is skipped with a warning and the row is left untouched:
'dsh: [...] patch: name mismatch for "tokeneconomizer-dsh" (expected "@nolit/dsh-tokeneconomizer", got "@nolit/wrong-name"), skipping'

### 2.5 Precedent for a plugin reading its own JSON file — exactly one, and it is NOT a settings file

Grep over all 8 sibling @nolit plugins: ZERO plugins read a settings/config YAML or JSON as their option source.

| plugin | file | behaviour |
|---|---|---|
| @nolit/dsh-opencode-v2 | $DSH_HOME/cli-worker-selection.json (lib/selection.js:13) | process.env.DSH_HOME ?? ~/.dsh, resolved at call time; catch -> {} (fail-open); atomic write (tmp + rename) |
| @nolit/dsh-antigravity-cli | same file name (lib/selection.js:13) | same convention, shared store |
| live artefact | ~/.dsh/cli-worker-selection.json, 172 B | exists |

The only in-tree precedent is a 252-byte UI preference store, not a settings layer. It IS however exactly the right read/write contract to copy (lazy path resolve, fail-open read, atomic write).

### 2.6 Dependency reality: TE cannot parse YAML and cannot import schemastery today

| fact | measured |
|---|---|
| TE package.json dependencies / peerDependencies | BOTH EMPTY; description promises "Zero runtime imports outside node: builtins" |
| TE node_modules/@deepseek-ai/{schemastery,cosmokit} | symlinks -> /home/minami/.dsh/profiles/web/node_modules/@deepseek-ai/..., and THAT DIRECTORY DOES NOT EXIST |
| import('@deepseek-ai/schemastery') from the TE dir | ERR_MODULE_NOT_FOUND |
| same import from inside a real DSH mount | ERR_MODULE_NOT_FOUND |
| sibling dsh-antigravity-cli | import Schema from '@deepseek-ai/schemastery', symlinked to the dsh INSTALL's node_modules (which does exist) |

So any YAML or schemastery-based design must either repair those two dangling symlinks or add a real dependency — both break the plugin's stated zero-dependency property.

### 2.7 Live-profile facts that constrain the migration

| fact | value |
|---|---|
| live process | pid 3296447, node /home/minami/.local/bin/dsh --profile web --patch /home/minami/.local/share/dsh/cordis.local-bridge.patch.yml --host 127.0.0.1 --port 3080 ..., started 07:52:33 |
| TE mount | ~/.dsh/profiles/web/node_modules/@nolit/dsh-tokeneconomizer -> workspace dir (realpath identical) |
| plugin is running right now | newest export ~/.tokeneconomizer/dsh-sessions/session-1.jsonl at 08:20; 172 exports total |
| TE_DIAG | off -> no diagnostics.json |
| $DSH_HOME/.env | absent; live process env has NO TE_*/TOKENECONOMIZER_* vars |
| HMR watch list | [profile/cordis.patch.yml, $DSH_HOME/cordis.patch.yml, profile/package.json] (dsh-hmr 850, 872-873) — the bundle patch inside the linked package is NOT watched |
| HMR condition in live log | 'hmr warn config reload at .../profiles/web/package.json failed' + 'Error: HMR is disposed'; live env has no --expose-internals and node-addon-require-builtin is MODULE_NOT_FOUND |

### 2.8 Validation-failure behaviour (measured end to end)

| probe | result |
|---|---|
| --dump-config with an unknown key in the row config | exit 0, unknown key printed verbatim. --dump-config does NOT validate plugin config at all |
| same with watchdogAction: kill | exit 0, printed |
| real mount with watchdogAction: kill | 'dsh: warning: 1 entry did not activate' / 'tokeneconomizer-dsh: TypeError: tokeneconomizer: watchdogAction must be warn, interrupt, not kill'; process keeps running, rc=0, TE entirely inert (every saving silently lost) |
| --dump-config with a !!js expression | prints the UNEVALUATED '!!js Number(process.env.TE_PROBE_MIN ?? 3700)' (and an empty watchdogAction:), even though the mount resolves it correctly to 4444 / warn |

resolveConfig matrix (/tmp/te-cfg/probe-resolve.mjs):

| input | outcome |
|---|---|
| {} | ok, defaults |
| {bogusKey: 9} | throw "unknown setting bogusKey" |
| {tierHotTurns: '5'} | throw "must be number, not string" |
| {tierMinChars: null} | throw "must be number, not object" |
| {tierMinChars: '3700'} | throw (no string coercion) |
| {tierHeadChars: -5} | throw "must be positive" |
| {watchdogAction: 'kill'} / {mode:'off'} | throw, enum listed |
| {tierHotTurns: 10, tierWarmTurns: 10} | throw "tierWarmTurns ... must be greater than tierHotTurns" |
| {pinnedRulesOrder: -1000} | throw "must be an integer >= -999" |
| {loopBreakerThreshold: 1} | throw "must be >= 2" |
| {watchdogToolThresholdMs: 0} | throw (positive only; 0 is not expressible, Infinity is the documented disable) |
| {watchdogToolThresholdMs: Infinity} | ACCEPTED (no throw) |
| {watchdogWarnMs: 900000} | CLAMPED to 300000, no throw |
| {tierMinChars: {get: () => 4242}} | accepted as 4242 (schemastery accessor unwrapped) |

Thirteen tests depend on the throwing behaviour (test/mount.test.mjs:156-178, assert.throws x13; suite currently 72 pass / 0 fail / 1 skip). Any fail-open change must not weaken resolveConfig for the Cordis path.

---

## 3. Recommended schema

### 3.1 The constraint that decides the design

apply(ctx, config) receives the COMPOSED config only. It cannot tell whether a key came from the bundle row, the profile patch, the home patch or --patch. Therefore a layer sitting BETWEEN bundle and profile is not implementable without harness changes. Two implementable shapes:

| shape | semantics | verdict |
|---|---|---|
| A. file BELOW cordis config | {...file, ...config} (config wins) | dead on arrival today: the bundle patch already pins all 35 keys, so the file could never win anything. Would require pruning the bundle patch to "values that differ from code defaults", which is currently the empty set |
| B. file ABOVE cordis config | {...config, ...file} (file wins) | RECOMMENDED, with a per-key shadow warning when config[key] !== file[key]. Works with the bundle patch untouched; one implementation point |

Recommend B. Do NOT turn the file into a patch layer: that reintroduces the whole-config replacement hazard of 2.4 and would require editing the launcher command, which is outside this package.

### 3.2 Location

| candidate | pro | con | verdict |
|---|---|---|---|
| $DSH_HOME/tokeneconomizer.json (~/.dsh/tokeneconomizer.json) | matches the only precedent (cli-worker-selection.json); sits beside the profile that composes the row; $DSH_HOME is already the user's own layer | writes into ~/.dsh, which project rules treat as live state | RECOMMENDED |
| $TOKENECONOMIZER_HOME/config.json (~/.tokeneconomizer/config.json) | TE-independent of DSH; already the plugin's own root | that root is machine-written (index.json, errors.log, vendor/, dsh-sessions/) and is the target of te-dsh purge | acceptable alternative; must be excluded from purge |
| $DSH_HOME/profiles/<name>/tokeneconomizer.json | per-profile | new file per profile; no precedent | optional overlay only |

Resolution order (all $-prefixed keys are meta and ignored by the validator):
1. $TE_CONFIG if set (absolute path; one-shot debug) — else
2. $DSH_HOME/tokeneconomizer.json, where DSH_HOME = process.env.DSH_HOME ?? ~/.dsh, resolved AT CALL TIME (the selection.js precedent)
3. optional per-profile overlay $DSH_HOME/profiles/<profile>/tokeneconomizer.json, keyed off ctx.get('profileContext')?.name

Format: JSON ONLY. YAML would need a dependency TE does not have and cannot currently resolve (2.6).

### 3.3 Key naming — keep the flat camelCase, one vocabulary

Keep the exact DEFAULTS / Cordis config names. Measured reasons:
- the file can then be fed to the existing resolveConfig unchanged; a nested scheme (tier.minChars) needs a translation table, i.e. a FOURTH place for the values to drift apart — the exact defect being fixed;
- the keys are already namespaced (tier*, watchdog*, recall*, loopBreaker*);
- one name appears in code, yml, file, env and docs, so one grep finds every occurrence.

Only change: allow $-prefixed meta keys ($schemaVersion, $comment) and do not treat them as unknown settings (measured: unknown keys currently throw).

### 3.4 Precedence

    code DEFAULTS                                              (lowest)
      <  $DSH_HOME/tokeneconomizer.json                        (this design, per-key merge)
      <  $DSH_HOME/profiles/<name>/tokeneconomizer.json        (optional, per-key merge)
      <  Cordis row config (bundle patch -> profile patch -> home patch -> --patch)
      <  TE_<KEY> per-key env override                         (highest; debugging only)

This deliberately INVERTS the task's sketch (env below cordis config). Justification, measured: !!js-in-patch already gives per-profile env interpolation at COMPOSE time (tierMinChars: !!js "Number(process.env.TE_MIN ?? 3700)" resolved to 4444 under a real mount), so the Cordis layer already IS the "env wins" layer; a second env layer below it would be dead. The plugin-level TE_<KEY> layer is an explicit escape hatch and must stay documented as debug-only, because it is invisible to --dump-config (2.8) and therefore unverifiable from outside.

Because the bundle patch currently equals the code defaults, the precedence order has NO observable effect today — which is exactly what makes this a zero-risk first landing.

### 3.5 Validation failure behaviour — fail-open PER KEY

Requirements derived from 2.8:
1. NEVER throw from the file path. A throw costs the whole plugin (2.8: entry does not activate, all savings lost, only a stderr warning).
2. Fail open PER KEY, not per file. One bad key must not lose the other 34.
3. Keep resolveConfig STRICT for the Cordis path. Add a separate readSettingsFile() returning {values, warnings} that reuses resolveConfig as the oracle: validate the candidate one key at a time and drop only the offending key. The 13 existing assert.throws tests stay green.
4. Warn to stderr with a stable prefix. notice() already writes '[tokeneconomizer] ...' to stderr (lib/index.js:1149-1152). Do NOT use noticeUser(): it injects a user/message that the watchdog counts as progress (task-4's subject).
5. NEVER write the file. Read-only, like selection.js; the plugin must not own the content.

Decision table:

| condition | behaviour |
|---|---|
| file absent | silent; DEFAULTS + Cordis values |
| file unreadable (EACCES, is a directory) | warn once, ignore file |
| invalid JSON | warn with line/column if available, ignore whole file |
| top level not an object | warn, ignore whole file |
| unknown key | warn "unknown setting <key> in <path>: ignored", drop that key |
| wrong type / enum / minimum / negative | warn "<key>: <resolveConfig's message>", drop that key |
| cross-key violation (tierWarmTurns <= tierHotTurns after merge) | warn, drop BOTH file-supplied tier keys, keep Cordis values |
| watchdogWarnMs >= watchdogThresholdMs after merge | keep the existing clamp (index.js:264-266), no warning (already shipped behaviour) |
| file key differs from the composed Cordis value | warn "<key>: file overrides patch value <v>" — the 2.4 shadow detector |
| $-prefixed key | ignored silently |

Read timing: ONCE per apply(), i.e. once per mount. Do not pretend it is live — measured: the bundle patch is outside HMR's watch list and the live process's HMR is disposed (2.7), so a file edit needs a profile restart either way.

### 3.6 Concrete schema — $DSH_HOME/tokeneconomizer.json

{
  "$schemaVersion": 1,
  "$comment": "TokenEconomizer options. Keys are the plugin config names; unknown keys are ignored with a warning. Overrides the Cordis bundle/profile patch per key.",

  "tiering": true,
  "tierHotTurns": 5,
  "tierWarmTurns": 15,
  "tierHeadChars": 2000,
  "tierTailChars": 600,
  "tierMinChars": 3700,

  "watchdog": true,
  "watchdogThresholdMs": 600000,
  "watchdogToolThresholdMs": 600000,
  "watchdogWarnMs": 300000,
  "watchdogAction": "interrupt",
  "watchdogProgress": "any"
}

Phase 1 scope = the 12 tier + watchdog keys above (the task's target set). The same reader accepts the other 23 DEFAULTS keys unchanged, so later phases need no format revision.

| key | type | constraint (from resolveConfig) | default |
|---|---|---|---|
| tiering | boolean | — | true |
| tierHotTurns | integer | > 0, < tierWarmTurns | 5 |
| tierWarmTurns | integer | > 0, > tierHotTurns | 15 |
| tierHeadChars | integer | > 0 | 2000 |
| tierTailChars | integer | > 0 | 600 |
| tierMinChars | integer | > 0; MEASURED FLOOR 3700 — below the crossover a rewrite inflates the context (commit d1547b9: 1200 -> 341/645 inflating, +245,927 chars; 3700 -> 0 inflating) | 3700 |
| watchdog | boolean | — | true |
| watchdogThresholdMs | integer | > 0 | 600000 |
| watchdogToolThresholdMs | integer | > 0; Infinity = disabled (0 is rejected) | 600000 |
| watchdogWarnMs | integer | > 0; clamped to threshold/2 if >= threshold | 300000 |
| watchdogAction | enum | warn / interrupt | interrupt |
| watchdogProgress | enum | any / committed | any |

Keep cordis.patch.yml as the shipped bundle default (the documented, profile-independent fallback). Do NOT prune it — pruning changes what every other profile inherits.

Recommended cheap guard (the missing piece): one test asserting TIER_DEFAULTS.minChars === DEFAULTS.tierMinChars and that the bundle yml keys are a subset of DEFAULTS. Without it this refactor creates a FOURTH copy of the tier values.

### 3.7 Optional phase 2 — live reload via a real Config schema

If "swap without restart" is a hard requirement, the evidence-backed route is to give TE a schemastery Config with .volatile() on the tunable fields, which unlocks two harness features at once:
- the Settings UI can render it (dsh-settings schema(entry) reads fiber.runtime.Config; today TE is "status":"absent");
- the loader's volatile-only path commits new values into the RUNNING fiber without a restart (cordis-plugin-loader:450-495, _commitVolatile), and an invalid candidate is logged leaving the running references unchanged — exactly the fail-open behaviour 3.5 asks for.

Prerequisites, all measured: repair the two dangling @deepseek-ai/{schemastery,cosmokit} symlinks (repoint to the dsh install, as dsh-antigravity-cli does) or add a real dependency; rewrite the 13 assert.throws tests; accept that a Settings-UI save writes the PROFILE patch (whole-config replacement, 2.4). NOT part of phase 1.

---

## 4. Migration risks — link: makes every source edit live

Measured: ~/.dsh/profiles/web/node_modules/@nolit/dsh-tokeneconomizer is a symlink whose realpath is the workspace directory; package.json declares "@nolit/dsh-tokeneconomizer": "link:/home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-tokeneconomizer". No build and no install step sits between an edit and the next mount.

| # | risk | mechanism | mitigation |
|---|---|---|---|
| R1 | A syntax/type error in lib/index.js takes the whole plugin offline SILENTLY | teardown is fail-soft: apply() throwing yields 'dsh: warning: 1 entry did not activate' and rc=0 (measured 2.8). No savings, no error banner in the Web GUI | node --check lib/index.js + node --test test/*.test.mjs (72-pass baseline) BEFORE any profile restart; never edit the live surface from a long-lived session |
| R2 | A change to cordis.patch.yml is NOT hot-reloaded despite link: | HMR watches only profile/cordis.patch.yml, $DSH_HOME/cordis.patch.yml, profile/package.json (2.7); the bundle patch inside the linked package is not watched, and live HMR is disposed | treat any TE option change as "applied pending restart", never "live". The new JSON file inherits this: it is read at apply() |
| R3 | Whole-config replacement silently resets the bundle patch | a one-key profile override drops the other 34 to code defaults (2.4) | the file ABOVE the cordis layer is what fixes this; additionally emit the 3.5 shadow warning so an accidental profile-patch override is visible |
| R4 | --dump-config CANNOT verify the new layer | (a) it does not validate plugin config at all (unknown key / bad enum print and exit 0); (b) it does not evaluate !!js; (c) a plugin-read JSON file is invisible to it entirely (2.8) | do NOT use --dump-config as the acceptance gate. Add a te-dsh status-style readback that prints the RESOLVED 12 keys plus the file path, and gate on that |
| R5 | A late typo in the JSON file is silent | fail-open is the requirement, but silence is not | the stderr warning must be greppable ('[tokeneconomizer] config file ...') and the R4 readback must show the value actually in force |
| R6 | The node_modules symlinks are ALREADY dangling | @deepseek-ai/{schemastery,cosmokit} -> a non-existent path in ~/.dsh/profiles/web/node_modules; unresolvable from the TE dir and from a real mount (2.6) | any design that adds an import (yaml, schemastery) fails at MOUNT, not at edit time. Keep phase 1 to JSON + node: builtins only |
| R7 | Two (now four) writers on the same values | tier values would live in lib/tiering.js, lib/index.js, cordis.patch.yml AND the new file | ship the agreement test (3.6) in the same change |
| R8 | ~/.dsh is the user's live state | project rule 2 forbids unapproved writes there | the file is created by the operator, never by the plugin or a test; every probe in this report ran against throwaway DSH_HOME roots under /tmp/te-cfg/ |
| R9 | Warning via the wrong channel re-arms the watchdog | noticeUser() injects a user/message which the session/event handler counts as progress (task-4) | use notice() (stderr) for config warnings, never noticeUser() |

---

## 5. Verification commands used

    # live resolved values
    dsh --profile web --dump-config > /tmp/te-cfg-tmp-dump.yml   # TE row: lines 1376-1414
    dsh --profile web --dump-config-schema                       # TE row: "status": "absent"

    # three-way agreement (code default vs bundle yml vs live)
    node /tmp/te-cfg/three-way.mjs    # {"keyCount":35,"rowsWithAnyDelta":0,"allThreeAgree":true}

    # validator behaviour
    node /tmp/te-cfg/probe-resolve.mjs    # 16 probes, table in 2.8

    # isolated precedence probes (throwaway DSH_HOME; live ~/.dsh untouched)
    DSH_HOME=/tmp/te-cfg/probe-dsh dsh --profile probe  --dump-config
    DSH_HOME=/tmp/te-cfg/probe-dsh dsh --profile probe2 --patch /tmp/te-cfg/probe-dsh/overlay.yml --dump-config

    # mount-time failure behaviour (valid vs invalid enum)
    DSH_HOME=/tmp/te-cfg/probe-te2 dsh --profile te

    # state of the shipped package
    cd .../dsh-tokeneconomizer && node --test test/*.test.mjs    # 72 pass / 0 fail / 1 skip

Probe artefacts (all under /tmp/te-cfg/): probe-dsh/, probe-te/, probe-te2/, probe-svc/, probe-merge/, probe-plugin/, probe-merge-plugin/, probe-resolve.mjs, three-way.mjs, diff-yml.mjs, interp.mjs.

---

## 6. Explicit gaps

- No live end-to-end test of the proposed reader: it does not exist yet, so readSettingsFile()'s behaviour is specified from the measured resolveConfig matrix (2.8), not observed.
- The per-profile overlay ($DSH_HOME/profiles/<name>/tokeneconomizer.json) is designed but unprobed; ctx.get('profileContext')?.name was confirmed reachable but its per-profile routing was not exercised.
- Phase 2 (volatile Config / live reload) is specified from cordis-plugin-loader:450-495 and dsh-settings:538-541 source reading; it was NOT mounted, because the schemastery import is currently unresolvable from TE (2.6).
