# `@nolit/dsh-opencode-v2` — Verification (boot card §7.5 / task-5)

> **Status: PASS** — all 18 checked items pass on the final tree (`lib/**` @ 09:42, `package.json` @ 09:43).
> Round 1 (09:20–09:50) found 2 blocking defects (**P0-1** peerDependencies, **P0-2** unhandledRejection); the builder
> fixed them and this document records the independent re-run that closed both. See §5 for before/after transcripts.
>
> Verified: 2026-10-29 ~09:20–09:58 KST · DSH `0.2.2-alpha.2` · Node `v24.22.1` · opencode `v2.2.0`
> (`~/.bun/bin/opencode`, SHA-256 `87a4d6ac…91fad0`) · verifier: independent (never wrote `lib/**` or `package.json`).
>
> Every command below is copy-pasteable. Raw transcripts are under `/tmp/ocv2-verify/`.
> Nothing in `~/.dsh` was written; the live 3080 service (PID 267797) was not restarted.
> The user's real `opencode serve --service` (PID 280829) was **used, never killed**.

---

## ⚠️ Read this first — `--dump-config` exit 0 does NOT prove the plugin mounts

Measured twice, both directions:

* **Case B** (`@quonaro` rows **and** v2 rows enabled): `--dump-config` → **exit 0, 0 skipped bundles**, yet a real
  mount throws `tool "opencode" is already registered` + `adapter for provider "opencode-agent" is already registered`.
* **Case A as shipped** (v2 rows only): `--dump-config` → **exit 0, 0 skipped bundles**, yet a real mount fails both
  rows with `ERR_MODULE_NOT_FOUND: @deepseek-ai/dsh-tools`.

`--dump-config` only composes YAML patch layers; it never imports a module, never registers a tool, never registers
an adapter, and never runs `auditStartupEntries`. **Only a real mount (or `boot-probe.mjs`) is a valid install gate.**
This is the single most important install-time fact in this document.

---

## 0. Verdict table

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | `node --check` on every `lib/*.js` | **PASS** | §1 |
| 2 | `engines.dsh` exactly `>=0.2.2-alpha.2 <0.3.0` | **PASS** | §1 |
| 3 | `exports` / `dsh.bundle.patch` / `main` resolve on disk | **PASS** | §1 |
| 4 | No imports of `@quonaro` private hashed files | **PASS** (comments only) | §1 |
| 5 | `npm test` green | **PASS** — **71/71** (was 65; +6 regression tests) | §2 |
| 6 | Isolated `--dump-config` composes, **0 skipped bundles** | **PASS** | §3.1 |
| 7 | Isolated **real mount** (Case A: v2 only) | **PASS** — zero warnings (was FAIL: P0-1, now closed) | §3.2, §5 |
| 8 | Case B (both `@quonaro` + v2 rows) — lead's prediction | **CONFIRMED FAIL** — verbatim errors captured | §3.3 |
| 9 | Live token probe via plugin's own parser | **PASS** — non-zero in/out/reasoning/cache | §4.1 |
| 10 | Reasoning text parsed + own block index | **PASS** | §4.1 |
| 11 | Provider `stream()` end-to-end with `usage` chunk | **PASS** | §4.2 |
| 12 | Timeout → `OPENCODE_TIMEOUT`, exit → `OPENCODE_EXIT` | **PASS** | §4.3 |
| 13 | Spawn failure must **never crash the host** | **PASS** — `finish{kind:'error'}`, exit 0 (was FAIL: P0-2, now closed) | §5 |
| 14 | Live profile untouched (read-only proof) | **PASS** — tree SHA unchanged | §3.4 |
| 15 | Stale `opencode serve --service` on 49374 | **Present, but it is the REAL user service — reported, not killed** | §6 |
| 16 | Row ids === plugin names === package exports | **PASS** | §3.5 |
| 17 | Baseline (upstream `@quonaro@0.1.2`) for comparison | **PASS** — measured | §7 |
| 18 | Manifest integrity (cross-package mis-write) | **PASS** — current manifest correct; suite catches the incident manifest (7 failures) | §10 |

**Bottom line:** all 18 items pass on the final tree. The v2 logic (argv, parser, usage mapping, reasoning
streaming, error codes) is correct and measurably better than upstream (**5292 total tokens vs upstream's 0**), and
the two round-1 blockers are closed with regression tests that pin them. Case B (both row sets) still fails by
design — that is the install shape, not a defect; see the warning above and §3.3.

---

## 1. Static checks — PASS

```bash
cd /home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-opencode-v2
for f in lib/*.js; do node --check "$f" && echo "OK $f"; done
node -e 'const m=require("./package.json"); console.log(m.engines.dsh, m.engines.dsh===">=0.2.2-alpha.2 <0.3.0")'
node -e '
const fs=require("fs"),path=require("path"),m=require("./package.json");
for (const [k,v] of Object.entries(m.exports)) {
  const t=typeof v==="string"?v:v.default;
  console.log(k,"->",t,"exists="+fs.existsSync(path.resolve(t)));
}
console.log("dsh.bundle.patch ->",m.dsh.bundle.patch,"exists="+fs.existsSync(m.dsh.bundle.patch));
console.log("main ->",m.main,"exists="+fs.existsSync(m.main));'
grep -rn "@quonaro" lib/
```

Transcript (`/tmp/ocv2-verify/step1-static.txt`):

```
  OK lib/index.js
  OK lib/provider.js
  OK lib/shared.js
engines.dsh = ">=0.2.2-alpha.2 <0.3.0"
EXACT MATCH
  exports["."] -> ./lib/index.js exists=true
  exports["./provider"] -> ./lib/provider.js exists=true
  exports["./cordis.patch.yml"] -> ./cordis.patch.yml exists=true
  exports["./package.json"] -> ./package.json exists=true
  dsh.bundle.patch -> ./cordis.patch.yml exists=true
  main=lib/index.js exists=true
```

`@quonaro` appears **only in comments**; the only runtime imports are `@deepseek-ai/schemastery` and `./shared.js`.
The only `--attach`/`--pure` string literals are in `stripUnsupportedFlags()` (they are *removed*, never emitted).

---

## 2. Unit tests — PASS, 71/71

```bash
cd /home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-opencode-v2 && npm test
```

```
ℹ tests 71
ℹ suites 0
ℹ pass 71
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 268.225473
```

Round 1 measured **65/65**; the builder added 6 regression tests for P0-1/P0-2 (see §5). New in the suite:

* `P0-1: every host import is declared as a peerDependency` — asserts the exact peer map.
* `P0-1: schemastery is a peer (runtime value), never a bare dependency` — pins the value-import requirement.
* `P0-1: no source file imports a bare package that is not a peer` — generic guard over every `lib/*.js`.
* P0-2 spawn-failure / stdout-consumed-first cases.
* `--dump-config`-style bundle assertions unchanged.

Covers: argv never contains attach/pure; reasoning+text cumulative-snapshot diffing; missing `step_finish`;
malformed lines; session id capture; exact `TokenUsage` mapping incl. cache and total; `fetchUsage` null-paths;
bundle/patch/engines assertions. **No test touches the network, `~/.dsh`, or real opencode.**

> Note: the suite cannot catch P0-1 (it stubs `@deepseek-ai/dsh-tools` via `test/helpers/dsh-tools-stub.mjs`)
> nor P0-2 (the fake subprocess there never rejects `done`).

---

## 3. Isolated boot — boot card rule 3

All isolation lives under **`/tmp`**. `DSH_HOME=/tmp/dshhome-ocv2`. `~/.dsh` is only *read* (as a source of
npm trees) and never written.

### 3.0 Why `cp -a ~/.dsh/profiles/web /tmp/...` is NOT enough

`dsh-app-boot`'s `resolveBundleDir()` resolves bundles through
`createRequire(<profileDir>/package.json).resolve.paths()`. The live profile's `node_modules` is a pnpm tree whose
`@nolit/*` entries are **relative** symlinks (`../../../../../Workspace/...`) — from `/tmp` they dangle. A naive
copy therefore reports:

```
dsh: skipping profile bundle "@nolit/dsh-korean-locale": Error: dsh: cannot resolve profile bundle ...
dsh: skipping profile bundle "@nolit/dsh-sidebar-manager": ...
dsh: skipping profile bundle "@nolit/dsh-notify-web": ...
```

A `--dump-config` exit 0 out of that state proves nothing. **The pass condition used here is
`grep -c "skipping profile bundle" == 0`**, not the exit code.

### 3.1 Isolated recipe used (`/tmp/ocv2-verify/mk-iso2.sh`)

* `@deepseek-ai/*` → absolute links to the **installation** tree
  (`/home/minami/.local/nodejs/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/*`)
  — exactly the anchor the launcher resolves first.
* every other live-profile package → absolute links.
* `@quonaro/dsh-plugin-opencode` → physical copy (as in the live profile).
* `@nolit/*` → absolute links to `/home/minami/Workspace/projects/dsh-workspace/dsh-plugins/*`.

```bash
/tmp/ocv2-verify/mk-iso2.sh v2-only     # or: both
DSH_HOME=/tmp/dshhome-ocv2 dsh --profile web --dump-config > /tmp/ocv2-verify/dump.yml 2> /tmp/ocv2-verify/dump.err
echo "exit=$?"; grep -c "skipping profile bundle" /tmp/ocv2-verify/dump.err
```

Both modes: **exit 0 and `skipping profile bundle` count = 0** (identical empty skip list before and after adding
the plugin, so the plugin contributes no missing dependency).

Composed v2 rows from the dump (`dump-both-link.yml:1338`):

```yaml
# == @nolit/dsh-opencode-v2
- id: dsh-opencode-v2
  name: '@nolit/dsh-opencode-v2'
  config:
    opencodePath: opencode
    auto: true
    model: opencode/deepseek-v4.1-flash-free
    agent: ''
    thinking: true
    title: ''
    timeoutMs: 600000
    maxOutputBytes: 1048576
    forwardEnv: [PATH, HOME, USER, XDG_CONFIG_HOME, XDG_DATA_HOME, XDG_CACHE_HOME, OPENCODE_CONFIG, OPENCODE_SERVER_USERNAME, OPENCODE_SERVER_PASSWORD]
    extraArgs: []
    exportTimeoutMs: 60000
- id: dsh-opencode-v2-provider
  name: '@nolit/dsh-opencode-v2/provider'
  config: { opencodePath: opencode, auto: true, thinking: true, cwd: '', timeoutMs: 1800000, ... }
```

### 3.2 Case A — real mount, ONLY the v2 rows (supported install shape)

`--dump-config` never mounts, so a **real boot** is required. Harness `/tmp/ocv2-verify/boot-probe.mjs` mirrors
`lib/profile-boot.js#runProfile()` (same `loadProfile` → `createRuntimeResolution` → `readProfilePatches` →
`boot`, plus `PluginPackages` and `provideCmdline`), only binding a non-3080 port.

```bash
DSH_HOME=/tmp/dshhome-ocv2 PROBE_PORT=39201 node /tmp/ocv2-verify/boot-probe.mjs web
```

**Round 1 — as shipped at 09:27: FAIL** (kept for the record; closed in §5)

```
bundles loaded: 8 | ... @nolit/dsh-opencode-v2
skippedBundles: 0 []
dsh: warning: 2 entries did not activate
dsh-opencode-v2 (@nolit/dsh-opencode-v2): Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@deepseek-ai/dsh-tools' imported from …/dsh-opencode-v2/lib/index.js
dsh-opencode-v2-provider (@nolit/dsh-opencode-v2/provider): Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@deepseek-ai/dsh-tools' imported from …/dsh-opencode-v2/lib/provider.js
```

**Final tree (09:43) — PASS, zero warnings** (re-run against the live workspace plugin, not a copy):

```
$ DSH_HOME=/tmp/dshhome-ocv2 PROBE_PORT=39201 node /tmp/ocv2-verify/boot-probe.mjs web
bundles loaded: 8 | …, @nolit/dsh-opencode-v2
skippedBundles: 0 []
dsh web: http://127.0.0.1:39201/?token=…
tools.visible: opencode,working_directory
llm.providers: ["deepseek-official","deepseek-account","opencode-agent"]
BOOT PASS
VERDICT: PASS
```

**Round-1 hypothesis test for the record** — before the builder acted, this peer set was proven sufficient on a
`/tmp` copy (`/tmp/ocv2-peertest`):

```json
"peerDependencies": {
  "@deepseek-ai/cordis": "^4.0.4",
  "@deepseek-ai/dsh-llm": "^0.2.2-alpha.2",
  "@deepseek-ai/dsh-subprocess": "^0.2.2-alpha.2",
  "@deepseek-ai/dsh-tools": "^0.2.2-alpha.2",
  "@deepseek-ai/schemastery": "~3.18.4"
}
```


Its `/tmp` mount printed `skippedBundles: 0 []` + `tools.visible: opencode` + `llm.providers: [..., "opencode-agent"]` → `VERDICT: PASS`, which is what motivated sending the fix to the builder.

### 3.3 Case B — BOTH row sets enabled (negative test the Lead requested)

**Lead's prediction is CONFIRMED**, verbatim from a real mount
(`/tmp/ocv2-verify/boot-iso2-peers2.txt`):

```
dsh-opencode-v2 (@nolit/dsh-opencode-v2): Error: tool "opencode" is already registered (for a per-agent variant, register through that agent's `agent.ctx` instead)
dsh-opencode-v2-provider (@nolit/dsh-opencode-v2/provider): LlmError: an adapter for provider "opencode-agent" is already registered
    at Proxy.prepareRoutes (…/dsh-llm/lib/index.js:1872:92)
    at Proxy.registerAdapter (…/dsh-llm/lib/index.js:1845:29)
    at new apply (…/dsh-opencode-v2/lib/provider.js:483:11)
```

Important nuance (measured, not assumed):

* `--dump-config` for Case B **exit 0, 0 skipped bundles** — the composer does **not** detect the collision.
  A dump-only check would falsely pass.
* The **failure surfaces only at mount** (`auditStartupEntries`). Both messages above require P0-1 to be fixed
  first; before that, both rows die earlier on `ERR_MODULE_NOT_FOUND`.
* The host **survives** (`VERDICT: PASS`, other plugins active; `tools.visible: opencode`, the `@quonaro` one won)
  — the new rows fail to activate rather than taking the tree down. Still a broken install shape.

**Supported install shape = Case A: remove the two `@quonaro` rows, keep only the v2 rows.**

**Re-checked on the final tree (09:57)** — unchanged, as expected (this is the install shape, not a code defect):

```
$ DSH_HOME=/tmp/dshhome-ocv2 dsh --profile web --dump-config      # both row sets
dump exit=0  skipped=0                     <-- still a FALSE PASS
$ DSH_HOME=/tmp/dshhome-ocv2 PROBE_PORT=39203 node /tmp/ocv2-verify/boot-probe.mjs web
dsh-opencode-v2 (@nolit/dsh-opencode-v2): Error: tool "opencode" is already registered (for a per-agent variant, register through that agent's `agent.ctx` instead)
dsh-opencode-v2-provider (@nolit/dsh-opencode-v2/provider): LlmError: an adapter for provider "opencode-agent" is already registered
tools.visible: opencode,working_directory
llm.providers: ["deepseek-official","deepseek-account","opencode-agent"]
VERDICT: PASS      <-- host survives; the NEW rows are the ones that fail to activate
```

### 3.4 Isolation Leg B — real profile + `--patch`, read-only proof

```bash
LIVE=/home/minami/.dsh/profiles/web
snap() { find "$LIVE" -type f -printf '%P\t%T@\t%s\n' | sort; }
sha()  { find "$LIVE" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum; }
sha > /tmp/ocv2-verify/live-before.sha; snap > /tmp/ocv2-verify/live-before.snap
DSH_HOME=/tmp/dshhome-legb dsh --profile web --patch /tmp/ocv2-overlay.yml --dump-config > /tmp/ocv2-verify/legb-dump.yml
sha > /tmp/ocv2-verify/live-after.sha;  snap > /tmp/ocv2-verify/live-after.snap
diff /tmp/ocv2-verify/live-before.sha /tmp/ocv2-verify/live-after.sha && echo UNCHANGED
```

```
BEFORE: 105 files | tree sha: aa03f10a2b786c3da19a27238f52ab3b7f9dac6b60df550e05c7a5cd03305b82
AFTER:  105 files | tree sha: aa03f10a2b786c3da19a27238f52ab3b7f9dac6b60df550e05c7a5cd03305b82
PASS: live profile tree sha256 UNCHANGED
PASS: no file mtime/size changed
```

and the overlay rows landed (`legb-dump.yml:1232`): `- id: dsh-opencode-v2-isolated / name: '@nolit/dsh-opencode-v2'`.
**`~/.dsh` was never written.** PID 267797 (3080) untouched.

### 3.5 Row ids === plugin names === package exports — PASS

```
rows: dsh-opencode-v2 -> @nolit/dsh-opencode-v2 | dsh-opencode-v2-provider -> @nolit/dsh-opencode-v2/provider
  row id "dsh-opencode-v2" | module name "dsh-opencode-v2" | MATCH: true
  row id "dsh-opencode-v2-provider" | module name "dsh-opencode-v2-provider" | MATCH: true
row count === 2: true
no attach/pure keys in config: true
tool row model: opencode/deepseek-v4.1-flash-free
package name: @nolit/dsh-opencode-v2 | "." export resolves row0 name: true
"./provider" export resolves row1 name: true
```

---

## 4. Live probe (REAL `HOME=/home/minami`, opencode needs auth)

Env sanitised first, per instruction:

```bash
unset HOME XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME
export HOME=/home/minami PATH=/home/minami/.local/nodejs/bin:/home/minami/.bun/bin:/usr/local/bin:/usr/bin:/bin
```

Probes run **through the plugin's own modules** (`lib/index.js#runOpencode`, `lib/shared.js#JsonRunParser`,
`lib/provider.js#OpencodeLlmAdapter`) over a thin `ctx.subprocess` shim wrapping `node:child_process`, so the
code path is the production one. cwd `/tmp/ocv2-probe` (never the repo).

### 4.1 Token probe through `runOpencode()` — PASS

```bash
node /tmp/ocv2-verify/live-probe.mjs
```

Real command executed by the plugin:
`opencode run -m opencode/deepseek-v4.1-flash-free --auto --thinking --format json -- "Reply with exactly: PONG"`

```
RUN ms = 2369
ok = true | exitCode = 0 | timedOut = false | truncated = false
sessionId = ses_e7ae98028ffe2LJaonzuZ0F1cy
stdout = "PONG"
stderr = ""
result.inputTokens = 3460 | result.outputTokens = 4
usage = {"inputTokens":3460,"outputTokens":4,"reasoningTokens":35,"cacheReadTokens":1792,"cacheWriteTokens":0,"totalTokens":5291}
formatUsage = usage: input 3460 output 4 reasoning 35 cache read 1792 cache write 0 total 5291
NONZERO FIELDS: inputTokens,outputTokens,reasoningTokens,cacheReadTokens
ASSERT input>0: true | output>0: true | cacheRead>0: true | total>0: true
ASSERT total === input+output+reasoning+read+write: true
```

**Measured token numbers (this run)**

| field | value | source |
|---|---:|---|
| `inputTokens` | **3460** | `info.tokens.input` (uncached only) |
| `outputTokens` | **4** | `info.tokens.output` |
| `reasoningTokens` | **35** | `info.tokens.reasoning` |
| `cacheReadTokens` | **1792** | `info.tokens.cache.read` |
| `cacheWriteTokens` | **0** | `info.tokens.cache.write` |
| `totalTokens` | **5291** | disjoint sum |

`reasoning` is non-zero here because the prompt encouraged thinking; the short "PONG" probes in §4.2 can yield
`reasoningTokens: 0` legitimately.

Reasoning parsing (`/tmp/ocv2-verify/reason-probe.mjs`):

```
run exit= 0 ms= 1367
event kinds: ["reasoning","text"]
text: "391"
reasoning length: 56
reasoning excerpt: "The user asks the same question twice. Just answer: 391."
sessionId: ses_e7ae955dbffeQoccEhgtfgyagO
legacy step_finish tokens (expected 0 on v2): 0 0
provider chunks: ["start(1:reasoning)","reasoning-delta","start(0:text)","text-delta","end(1)","end(0)"]
reasoning index 1 text index 0 | distinct: true
```

→ `reasoning-delta` sits on block index **1**, text on **0** (host `StreamChunk` contract satisfied).

### 4.2 Provider `stream()` end-to-end — PASS

```bash
node /tmp/ocv2-verify/provider-live.mjs
```

```
stream ms = 1409
chunk types: ["block-start","text-delta","block-end","usage","finish"]
usage chunk: {"inputTokens":1318,"outputTokens":3,"reasoningTokens":0,"cacheReadTokens":4096,"cacheWriteTokens":0,"totalTokens":5417}
finish: {"type":"finish","reason":{"kind":"stop"}}
assembled text: "PONG"
text block-end: [{"type":"text","text":"PONG"}]
ASSERT usage emitted: true
ASSERT usage.inputTokens>0: true | cacheRead>0: true | reasoning>0: false
ASSERT finish stop: true
ASSERT usage precedes finish: true
```

(`reasoning>0: false` is correct for this short prompt — real `reasoning` was 0 in the export, and the adapter
does **not** fabricate numbers.)

### 4.3 Error codes — PASS

```bash
node /tmp/ocv2-verify/error-paths2.mjs
```

```
2) timeout finish: {"kind":"error","failure":{"code":"OPENCODE_TIMEOUT","message":"opencode exceeded timeoutMs=300 and was terminated"}}
   OPENCODE_TIMEOUT: true
3) bad model finish: {"kind":"error","failure":{"code":"OPENCODE_EXIT","message":"opencode exited 1 — Model unavailable: opencode/definitely-not-a-model"}}
   OPENCODE_EXIT: true
```

### 4.4 Hostile legacy `extraArgs` — PASS

```bash
node /tmp/ocv2-verify/extraargs-defence.mjs   # config extraArgs: ['--attach','http://127.0.0.1:4096','--pure']
```

```
run argv sent: ["/home/minami/.bun/bin/opencode","run","-m","opencode/deepseek-v4.1-flash-free","--auto","--thinking","--format","json","--","Reply with exactly: PONG"]
contains --attach/--pure: false
ok= true exit= 0 text= "PONG"
```

Defensive stripping works end-to-end in both halves.

---

## 5. DEFECTS FOUND IN ROUND 1 — both CLOSED and re-verified

Round 1 (`lib/**` @ 09:27–09:28, `package.json` @ 09:27) had two blocking defects. The builder's fixes landed at
`lib/provider.js`/`lib/shared.js` @ 09:42 and `package.json` @ 09:43. Everything below was re-measured by the
verifier against the **real workspace tree** (no `/tmp` copy), not taken on report.

### P0-1 — missing `peerDependencies` — **CLOSED**

**Before** (`package.json` @ 09:27, `dependencies` only):

```
dsh-opencode-v2 (@nolit/dsh-opencode-v2): Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@deepseek-ai/dsh-tools' imported from …/dsh-opencode-v2/lib/index.js
dsh-opencode-v2-provider (@nolit/dsh-opencode-v2/provider): Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@deepseek-ai/dsh-tools' imported from …/dsh-opencode-v2/lib/provider.js
```

**Cause (measured):** `dsh-app-boot/lib/index.js:1774` routes a bare package import to the installation copy only
when the importing package lists it in `peerDependencies` (`readPeerNames(directory).has(name)`).

**After** (`package.json` @ 09:43):

```json
"peerDependencies": {
  "@deepseek-ai/cordis": "^4.0.4",
  "@deepseek-ai/dsh-llm": "^0.2.2-alpha.2",
  "@deepseek-ai/dsh-subprocess": "^0.2.2-alpha.2",
  "@deepseek-ai/dsh-tools": "^0.2.2-alpha.2",
  "@deepseek-ai/schemastery": "~3.18.4"
},
"dependencies": { "@quonaro/dsh-plugin-opencode": "^0.1.2" }
```

**Re-run — Case A real mount, against the live workspace plugin (symlink target verified):**

```
$ ls -la /tmp/dshhome-ocv2/profiles/web/node_modules/@nolit/dsh-opencode-v2
… -> /home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-opencode-v2

$ DSH_HOME=/tmp/dshhome-ocv2 PROBE_PORT=39201 node /tmp/ocv2-verify/boot-probe.mjs web
bundles loaded: 8 | …, @nolit/dsh-opencode-v2
skippedBundles: 0 []
dsh web: http://127.0.0.1:39201/?token=…
tools.visible: opencode,working_directory
llm.providers: ["deepseek-official","deepseek-account","opencode-agent"]
BOOT PASS
VERDICT: PASS
```

**Zero `did not activate` warnings.** Tool/route introspection on the live host registry:

```
tool name: opencode
projected params: prompt,cwd,model,agent,session,continueLast,auto,thinking,title,files,timeoutMs
output additionalProperties: false
opencode-agent provider: {"id":"opencode-agent","name":"OpenCode v2"}
configurable settingsNs: dsh-opencode-v2-provider
```

**Not masking anything — the `@deepseek-ai/schemastery` question (verifier flagged this in round 1):**
`schemastery` is a **runtime value import** (`Schema.object(...)` runs at module scope), not type-only. The fix
correctly moved it from `dependencies` to `peerDependencies` — the same shape upstream uses. Verified:

```
schemastery in peers (not deps): true
deps: {"@quonaro/dsh-plugin-opencode":"^0.1.2"}
```

Resolvable at runtime because the host installation provides it through the peer route; the mount above proves
it (both modules import `Schema` at top level and both activated).

**Residual trap worth knowing (not a defect):** the extra peer list now lists packages the plugin does not
`import` (`cordis`, `dsh-llm`, `dsh-subprocess`) — mirroring upstream. They are inert unless imported; keeping
them documents the seam contract and lets the loader route them if a future change imports them.

### P0-2 — `handle.done` rejection could kill the process — **CLOSED**

**Before** (`lib/provider.js` @ 09:27): `for await (const chunk of stdout)` at :386 preceded `await handle.done`
at :401, so a spawn failure rejected unhandled before any handler existed; `installFailLoud`
(`dsh-app-boot/lib/index.js:4305`) turned that into `process.exit(1)`.

```
dsh: fatal load failure: ENOENT
PROCESS EXIT CODE: 1
```

**After** (`lib/provider.js` @ 09:42): `settled = handle.done.then(v => ({ok:true,value:v}), e => ({ok:false,error:e}))`
is assigned **immediately after `spawn()`** (:374), stdout is consumed, then `const end = await settled` (:408).

**Re-run — both repros now survive:**

```
$ node /tmp/ocv2-verify/failloud-proof.mjs
stream completed normally with: [{"type":"finish","reason":{"kind":"error","failure":{"code":"OPENCODE_SPAWN","message":"spawn /nonexistent/opencode ENOENT"}}}]
SURVIVED (no fatal exit)
PROCESS EXIT CODE: 0

$ node /tmp/ocv2-verify/spawn-fail.mjs
chunks: [{"type":"finish","reason":{"kind":"error","failure":{"code":"OPENCODE_SPAWN","message":"spawn /nonexistent/opencode ENOENT"}}}]
finish kind: error | code: OPENCODE_SPAWN
```

No `unhandledRejection` is emitted at all (round 1 emitted one). The failure is now a normal
`finish{kind:'error'}` — exactly what the task-3 contract requires.

### P2-1 — `buildRunArgv()` passed `extraArgs` through verbatim — **CLOSED**

Round 1 noted the defensive strip lived in `index.js`/`provider.js` rather than in `buildRunArgv` itself. It is
now stripped inside `buildRunArgv` (`lib/shared.js:98`), so the invariant is local to the function. The
hostile-config probe (§4.4) still passes.

### Re-verified after the fixes (spot checks, not full re-run)

| Check | Result |
|---|---|
| `node --check lib/*.js` | PASS (3/3) |
| `npm test` | **PASS 71/71** |
| Case A real mount | PASS — 0 skipped, 0 warnings, tool + route registered |
| Case B still both rows | dump exit 0 / mount throws both duplicate errors (**unchanged — by design**) |
| Live token probe | PASS — input 4 · output 4 · reasoning 36 · cacheRead 5248 · **total 5292** (1566 ms) |
| Spawn failure | PASS — `OPENCODE_SPAWN`, exit 0 |

---

## 6. Port 49374 stale-service check — REPORTED, NOT KILLED

### 6.1 Remediation for the user — a `--service` from a *different* HOME squats 49374

OpenCode v2 runs delegation through one background managed service (`opencode serve --service`, default port
**49374**). There is no per-HOME port negotiation: whichever service holds the port owns it globally, and a client
under a *different* `HOME` cannot reuse it. **Measured** exactly what a foreign-HOME client sees
(reproduced on a spare port with `HOME=/tmp/ocv2-client-home` while the real user service held 49374):

```
{"type":"error","sessionID":"","error":{"type":"unknown","message":
"Server process exited with code 1\nError: Managed service port 49374 on 127.0.0.1 is already in use by
PID 280829 (/home/minami/.bun/install/global/node_modules/@opencode/cli/bin/opencode.exe serve --service).
Configure another port with `opencode service set port <port>` and start the service again."}}
```

It surfaces as a normal `{"type":"error"}` event (exit 1) — **every** `opencode run` / `session export` fails this
way while the squatter holds the port. For the DSH plugin this becomes `OPENCODE_EXIT` on the provider route and
`ok:false` on the `opencode` tool, which is the *correct* contained failure — but nothing works.

Diagnose before touching anything — compare the holder's real HOME/cwd with yours:

```bash
PID=$(ss -ltnp | grep 49374 | grep -oP 'pid=\K\d+')
tr '\0' '\n' < /proc/$PID/environ | grep -E '^(HOME|OPENCODE_CONFIG)='
readlink /proc/$PID/cwd
ps -o pid,lstart,args -p $PID
```

Two remedies, in order of preference:

1. **Give your HOME its own port** (documented by opencode itself, non-destructive, keeps the other service alive):
   ```bash
   opencode service set port 49375     # then re-run; no process needs to be killed
   ```
2. **Stop the leftover** — only when its `HOME`/`cwd` are *not* your real home:
   ```bash
   kill $PID
   ```
   Never `kill` the service that matches your real `HOME` (see §6.2), and never touch the 3080 DSH service.

> Verified while writing this: a second `serve --service` on the *same* port exits quietly with code 0 rather than
> reporting a conflict — so a silent no-op is **not** proof the service is yours. Always check `/proc/<pid>/environ`.

### 6.2 This verification run

```
LISTEN 0 512 127.0.0.1:49374  users:(("opencode.exe",pid=280829,fd=8))
280829  /home/minami/.bun/install/global/node_modules/@opencode/cli/bin/opencode.exe serve --service
cwd=/home/minami   HOME=HOME=/home/minami
```

This is the **real user's** managed service (real `HOME`, real cwd) — **not** a leftover `/tmp` experiment.
It was **left running**; it was also *used* successfully by every probe above (no `Managed service port 49374
already in use` error occurred). Nothing from earlier verifier work was left on that port.

Live DSH service PID **267797** (`dsh --profile web … --port 3080`) was **not** restarted or signalled.

---

## 7. Baseline: upstream `@quonaro/dsh-plugin-opencode@0.1.2` on opencode v2.2.0

```bash
node /tmp/ocv2-verify/baseline2.mjs    # argv
node /tmp/ocv2-verify/baseline3.mjs    # 3 real runs through upstream JsonRunParser
node /tmp/ocv2-verify/baseline4.mjs    # structural limitation
node /tmp/ocv2-verify/upstream-baseline.mjs
```

```
default config (attach:"", pure:false) -> ["run","--auto","--format","json","--","hi"]
attach set (URL)                        -> ["run","--auto","--attach","http://127.0.0.1:4096", …]
pure:true                               -> ["run","--auto","--pure", …]

run1: exit=0 types=["step_start","reasoning","text"] in=0 out=0
run2: exit=0 types=["text"]                          in=0 out=0
run3: exit=0 types=["text"]                          in=0 out=0

fixture WITH step_finish -> in=3459 out=4
real v2 stream           -> in=0 out=0
```

**Corrected baseline facts** (my earlier assumption about `--attach`/`--pure` was wrong):

| Claim | Measured reality |
|---|---|
| "upstream passes `--attach`/`--pure` unconditionally" | **False.** It passes them only when truthy. With default config (`attach:''`, `pure:false`) it emits neither. It is a latent trap (any user who sets `attach` or `pure:true` bricks every run) but not an unconditional failure. `--pure` on v2 → exit 1, usage text on stdout (confirmed). |
| "upstream emits tokens=0" | **True for a tool-free v2 run** (0/0, no `step_finish` is sent). A run that **uses a tool** does send a `step_finish` carrying that step's `tokens`, so upstream reports a partial per-step total instead of 0. Even when usage *is* present upstream maps only input/output and silently drops `reasoning`/`cache.read`/`cache.write`, and it never sums across steps. |
| v2 stream shape | Tool-free run: `step_start`+`reasoning`+`text`, no `step_finish` (confirmed 4/4 runs). Tool-using run: `step_start`+`tool_use`+`step_finish`(+`tokens`)+`step_start`+`text` — the `step_finish` is per-step, never a whole-run total. |
| `totalTokens` | Upstream has no concept; v2's `totalTokens` = 5291 vs upstream 0. |

**Delta vs v2 plugin:** `inputTokens 3460 / outputTokens 4 / reasoningTokens 35 / cacheRead 1792 / total 5291`
vs upstream `0 / 0 / (none) / (none) / 0`.

---

## 8. What was NOT done (by instruction)

* No `dsh plugin add` into `~/.dsh/profiles/web` — that is the user's action (boot card §7.4).
* No restart of the 3080 service.
* No edits to `lib/**` or `package.json`; the peer fix was proven on a `/tmp` copy only.
* No `artifacts/SHA256SUMS.*` entry (rule 5) — a `.tgz` must not be frozen while P0 fixes are in flight.

> **Test suite is repo-side evidence, not shippable.** `package.json#files` ships only `lib/`, `cordis.patch.yml`
> and `README.md`; `npm pack` therefore **excludes `test/`** (those tests also need dev-only `js-yaml`). The unit
> test count below is evidence *in this repository*, and cannot be used to argue the published tarball was tested.

## 10. Manifest-integrity note — cross-package mis-write (recorded, adjudicated)

**Incident.** Mid-session, `dsh-opencode-v2/package.json` was found overwritten with a manifest that had empty
deps/peers, a test script naming `argv.test.mjs`/`parser.test.mjs`/`manifest.test.mjs`, `exports["./icon"]`,
`market/`, `README.ko.md`, `icon.svg`, and `devDependencies` `dsh-package-manifest` + `dsh-plugin-market-index`.
Traced (Lead) to **`dsh-sidebar-manager`'s** manifest — sidebar declares exactly those exports and that devDep
pair. It was a **cross-package mis-write by a concurrent sibling agent**, not an external actor.

**(a) The integrity risk is real and recurrence is possible.** Multiple agents editing sibling package trees in one
workspace using *relative* paths can write one package's manifest into another. Verified the blast radius is
currently contained: the sidebar tree itself is untouched (`find dsh-sidebar-manager -newermt "2026-10-29 09:20"
-type f` → empty), and `dsh-opencode-v2`'s manifest is correct:

```
name: @nolit/dsh-opencode-v2
exports: [".","./provider","./cordis.patch.yml","./package.json"]
has market/icon?: false
deps: {"@quonaro/dsh-plugin-opencode":"^0.1.2"}
peers: cordis, dsh-llm, dsh-subprocess, dsh-tools, schemastery
```

**(b) The current manifest is correct and regression-pinned.** The suite now fails loudly against the incident
manifest — measured by injecting sidebar's `package.json` into a `/tmp` copy of the plugin and running the tests:

```
$ node --test test/*.test.mjs
ℹ pass 64
ℹ fail 7
```

The 7 failures come from the peer-map assertion, the "no bare import without a peer" guard, and the row-id/export
assertions — i.e. the mis-write cannot pass CI silently.

**(c) Recommendation for future parallel work.** Forbid bare relative writes into sibling trees; scope every agent
to its own package directory; and **assert `package.json.name === expected` before and after any manifest write.**
Measured usefulness of a one-line name assertion against the exact incident file:

```
guard result on injected sidebar manifest: CAUGHT: name is @nolit/dsh-sidebar-manager not @nolit/dsh-opencode-v2
```

Defence in depth, cheapest first: (1) name assertion on write, (2) the builder's generic guard that every bare
import appears in `deps ∪ peers` (already present, catches peer drift), (3) the row-id === export-name test
(already present).

> Note: `name` is currently pinned only *implicitly* (bundle tests compare row ids to `pkg.name`). A literal
> `assert.equal(pkg.name, '@nolit/dsh-opencode-v2')` would make the failure message immediate rather than
> indirect — recommended, non-blocking.

---

## 11. Reproduce everything

```bash
# probe harness already present in /tmp/ocv2-verify (scripts are self-contained, no repo mutation)
/tmp/ocv2-verify/mk-iso2.sh v2-only
DSH_HOME=/tmp/dshhome-ocv2 dsh --profile web --dump-config 2>&1 | tee /tmp/ocv2-verify/dump.err
grep -c "skipping profile bundle" /tmp/ocv2-verify/dump.err        # expect 0
DSH_HOME=/tmp/dshhome-ocv2 PROBE_PORT=39201 node /tmp/ocv2-verify/boot-probe.mjs web
                                                # expect: skippedBundles 0, tools.visible has opencode,
                                                #         llm.providers has opencode-agent, VERDICT: PASS
node /tmp/ocv2-verify/live-probe.mjs            # real tokens (input>0, cacheRead>0)
node /tmp/ocv2-verify/provider-live.mjs         # stream(): block-start..usage..finish
node /tmp/ocv2-verify/error-paths2.mjs          # OPENCODE_TIMEOUT / OPENCODE_EXIT
node /tmp/ocv2-verify/failloud-proof.mjs        # expect: OPENCODE_SPAWN finish, SURVIVED, EXIT CODE: 0
cd /home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-opencode-v2 && npm test   # expect 71/71
```
