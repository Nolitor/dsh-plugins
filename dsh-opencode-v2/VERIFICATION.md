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

---

## 12. v0.1.2 — reasoning levels (사고력) on the `opencode-agent` route

**Defect measured before the fix.** The prompt's thinking selector is rendered from
`model.reasoning` in the Host catalog, and `buildModelCatalog` fills it from
`llm.resolveModelInfo()` (`dsh-api-session-controller/lib/index.js:473-495`). The route returned
no `reasoning`, so OpenCode models had no level choices and an explicit level was rejected with
`UNSUPPORTED_REASONING_EFFORT`. `--thinking` was already passed, but it only controls whether
reasoning blocks are *streamed*; it cannot select a level.

**Measured OpenCode v2.2.0 surface.**

| Probe | Result |
|---|---|
| `opencode run --help` | `--model, -m string  Model to use in the format provider/model#variant` |
| `GET /api/model` (serve) | 45 models, **35 with `variants`**; ids `low` 29, `high` 30, `max` 22, `medium` 20, `xhigh` 17, `none` 13, `minimal` 4, `thinking` 1 |
| variant payload | `{ id, settings: { reasoningEffort } }` or `{ id, settings: { thinkingConfig / thinking } }` |
| unknown variant | `{"type":"error","error":{"type":"provider.no-route","message":"Variant unavailable for opencode/deepseek-v4.1-flash-free: bogus"}}` |
| `-m opencode/deepseek-v4.1-flash-free#low` vs `#high` | both run; reasoning text 46 vs 4 chars — the variant reaches the provider |

**Fix.** `modelFromApiEntry()` keeps `variants`; `reasoningEffortsFromVariants()` maps them onto
`LlmModelReasoningInfo.efforts` (canonical order, unknown ids kept); `resolveModel()` publishes
`reasoning` only for routes that declare variants and sets no `defaultEffort`; `stream()` composes
`-m provider/model#<reasoningEffort>` via `withVariant()`. Discovery is now single-flight: the
catalog resolves every route at once, so one probe per cache window replaces one per route.

**Verification (all executed against the real host registry and the real CLI).**

```
$ node /tmp/opencode/ocv2-measure/e2e-reasoning.mjs
MEASURED resolveModelInfo().reasoning = {"efforts":[{"id":"low","name":"Low"},{"id":"high","name":"High"},{"id":"max","name":"Max"}]}
MEASURED context = {"contextWindow":1000000}
MEASURED catalog = {"routes":46,"withReasoning":35,"levelCounts":{"1":1,"2":4,"3":13,"4":4,"5":6,"6":7},"discoveryProbes":0}
MEASURED prepareCall(high).config.reasoningEffort = high
MEASURED unadvertised effort rejected = UNSUPPORTED_REASONING_EFFORT - provider "opencode-agent" model "opencode-go/deepseek-v4.1-flash" does not support reasoning effort "off"
MEASURED spawns = [
 "/home/minami/.bun/bin/opencode serve --port 0",
 "/home/minami/.bun/bin/opencode run -m opencode-go/deepseek-v4.1-flash#high --auto --thinking --format json -- …"
]
MEASURED stream = {"types":["block-start","reasoning-delta","text-delta","block-end","finish"],"reasoning":"17*23 = 391…","text":"391","finish":{"kind":"stop"}}

$ npm test
ℹ tests 99
ℹ pass 99
ℹ fail 0
```

`test/reasoning.test.mjs` (15 tests) pins: variant discovery, canonical ordering, dedupe/unknown
ids, `reasoning` present only when variants exist, `default` route inheritance, host-normalizer
validity, `withVariant()` composition, the `-m …#<level>` wire value with and without a level, and
single-flight discovery for a concurrently resolved catalog.

**Status: applied pending restart.** The live profile's
`node_modules/@nolit/dsh-opencode-v2` is a symlink to this workspace, but the running `dsh web`
process still holds the pre-change module; the selector appears after a restart.

### 12.1 Second defect, found while measuring §12 — discovery never read the serve banner

`discoverModelsViaServe()` spawned `opencode serve` with a **collect-mode** stdout
(`stdout: { maxBytes }`) and then read `handle.stdout`. `dsh-subprocess` documents and enforces
`readonly stdout: Readable | undefined` — *"present iff spawned with `stdout: 'pipe'`"*
(`dsh-subprocess/lib/types/types.d.ts:159`) — so the stream was always `undefined` and discovery
returned `null` before starting the HTTP call. Every route then fell back to the CLI listing:
the conservative `32768` context floor and **no variants**.

Proof, measured through a real profile mount (`DSH_HOME=/tmp/opencode/ocv2-live-iso`, boot probe
on the copied live profile, `skippedBundles: 0`, `VERDICT: PASS`):

| Catalog row | Before (v0.1.1 code) | After (v0.1.2) |
|---|---|---|
| `opencode-go/deepseek-v4.1-flash` | `levels=- ctx=32768` | `levels=low\|high\|max ctx=1000000` |
| `opencode-go/kimi-k3.1-pro` | `levels=- ctx=32768` | `levels=low\|high\|max ctx=1048576` |
| `opencode/flint-40b-free` | `levels=- ctx=32768` | `levels=low\|medium\|high\|xhigh\|max ctx=262144` |
| routes with levels | 0 / 46 | **35 / 46** (the 11 without are 10 variant-less models + `default`) |

Fix: spawn with `stdout: 'pipe'`, parse the banner with `parseServeBanner()`, and bound the wait
with an abortable readiness budget so a silent child cannot stall the catalog. `stderr` stays in
bounded collect mode so serve logs never flood the host.

`test/discovery.test.mjs` (8 tests) pins the spawn disposition (`stdio.stdout === 'pipe'`), banner
parsing across split chunks, `/api/model` mapping with basic auth, `null` on a missing stream
(the regression), the readiness budget, and a non-OK HTTP response.

Updated totals: `npm test` → **107/107**.

> This corrects the v0.1.1 claim that real discovery returned 45 models with limits in 1.6 s:
> that measurement did not run through `dsh-subprocess`, so it could not observe the missing
> stream. The 32768 floor kept `compaction-basic` working, which is why nothing failed loudly.

### 12.2 GUI-path proof (`sessionController.modelCatalog`)

The Web picker reads `remote.session.modelCatalog()`. Queried on the booted isolated profile:

```
gui.catalog.default: {"provider":"opencode-agent","model":"opencode-go/deepseek-v4.1-flash"}
gui.catalog.opencode-agent:
  {"id":"default", …}                                          # no levels: the model is unknown
  {"id":"opencode/beam-free", "reasoning":{"efforts":[low,medium,high,"Extra high",max]}}
  {"id":"opencode-go/deepseek-v4.1-flash", "reasoning":{"efforts":[low,high,max]}}
```

`opencode/deepseek-v4.1-flash-free` likewise carries `low|high|max`; the 10 variant-less models
carry no `reasoning`, so the picker offers only "Default" for them instead of a wrong level.

---

## 13. v0.1.3 — prompt on stdin (spawn E2BIG on every long session)

**Defect measured.** Linux caps a single argv string at 128 KiB (`MAX_ARG_STRLEN` = 32 pages);
`getconf ARG_MAX` is 2,097,152 but that is the whole env+argv block, not one argument.

| Probe | Result |
|---|---|
| `spawnSync('echo', ['x'.repeat(140000)])` | `E2BIG` |
| `spawnSync('echo', ['x'.repeat(120000)])` | exit 0 |
| LIVE session 10:17 (`session-6b20dd2d`): turn 1-3 | `turn/end` ×3 → `OPENCODE_SPAWN` "spawn E2BIG" |
| that session's largest message | 369,805-byte assistant message (flattened into one argv string) |

v0.1.2 did `argv.push('--', prompt)` in both `runOpencode()` (`lib/index.js`) and the LLM route
(`lib/provider.js:592-607`), and spawned with `stdin: 'ignore'` — so any transcript above ~128 KiB
failed before `opencode` started. Tests could not see it: the fake seam accepted argv of any size.

**Measured replacement surface (v2.2.0).**

```
$ printf 'say STDINOK' | opencode run -m opencode/beam-free --format json   # → text "STDINOK"
$ opencode run -m opencode/beam-free --format json < /tmp/bigprompt.txt     # 200 KB → answered
```

**Fix.** `buildRunArgv(flags)` no longer takes or appends a prompt; `sendPrompt(handle, prompt)`
writes it to a piped stdin and ends the stream (EPIPE/no-stdin returns `false` instead of
throwing). Both spawn sites use `stdio.stdin: 'pipe'`. The provider attaches `handle.done`'s
settlement handler before delivery, so a rejecting `done` is still consumed (P0-2 invariant) and a
pipe-less seam yields `OPENCODE_SPAWN`, never an unhandled rejection.

**Verification (real CLI, real adapter, 189 KB prompt).**

```
$ node /tmp/opencode/ocv2-measure/e2e-stdin.mjs
MEASURED prompt bytes = 189051 (single-arg limit is 131072)
MEASURED argv chars = 88 | stdin pipe = true
MEASURED argv tail = ["--auto","--thinking","--format","json"]
MEASURED stream types = ["block-start","reasoning-delta","block-start","text-delta","block-end","block-end","finish"]
MEASURED text = "PONG"
MEASURED finish = {"kind":"stop"}

$ npm test
ℹ tests 111
ℹ pass 111
ℹ fail 0
```

New/updated tests: `sendPrompt` writes the whole prompt and closes stdin; a 300 KB prompt is
carried; absent/broken stdin returns `false`; argv never contains the prompt or a `--` marker;
tool and provider spawns assert the stdin delivery.

**Status: applied pending restart** (same reason as §12: the live 3080 process, PID 267797, was
started 09:00:48 and holds pre-change modules; v0.1.1/v0.1.2 were written 10:05-10:32).

---

## 14. v0.2.0 — HTTP provider (`opencode-http-agent`) + A/B against the CLI route

Scope: a second LLM route in the same package that drives the OpenCode v2.2.0 HTTP API
(measured in `../OPENCODE-V2-HTTP-API-MEASUREMENT.md`). The CLI route is unchanged and remains the
default; the HTTP route is opt-in via its own cordis row.

### 14.1 Implementation map

| Concern | Code |
|---|---|
| server resolution (baseUrl / daemon state / spawn `--port 0`) | `lib/http.js` `ServerManager` |
| banner parse + readiness | `readBanner()` / `parseBanner()` (measured banner) |
| model catalog | `GET /api/model` → `contextWindow`, `defaultMaxTokens`, `variants` |
| session mapping | one OpenCode session per `GenerateOptions.sessionId`; only new user text on later calls |
| streaming | `GET /api/event?types=…` → `block-start` / `text-delta` / `reasoning-delta` / `block-end` |
| usage | `session.step.ended.tokens` → `usage` (disjoint buckets, cache read/write) |
| permissions | `permission.asked` → `POST …/permission/{rid}/reply` (config `permissionDecision`) |
| abort | `signal` → `POST …/interrupt`, finish `OPENCODE_INTERRUPTED` |

### 14.2 Unit tests

`test/http.test.mjs` (15 tests, fake node:http server implementing the measured routes):
SSE delta mapping, usage mapping, session reuse (one create, second prompt is only the new user
text), variant on create, permission reply, failed execution, cross-session event filtering,
ephemeral session delete, local titles, banner/route/usage helpers.

```
$ npm test        # 126 tests total (111 existing + 15 http)
ℹ tests 126
ℹ pass 126
ℹ fail 0
```

### 14.3 Isolated profile mount

```
DSH_HOME=/tmp/opencode/http-poc dsh --profile web --host 127.0.0.1 --port 39321 --no-open
```

- composed config (`--dump-config`) contains `- id: dsh-opencode-v2-http`,
  `name: '@nolit/dsh-opencode-v2/http'` (a patch **insert** entry; a plain `- id:` patch only
  targets existing rows and warns `entry "…" not found`).
- the profile also drops `@quonaro/dsh-plugin-opencode` from its bundle list, because that
  bundle registers the same `opencode` tool/`opencode-agent` adapter and produced two
  "did not activate" warnings. After the drop: **boot log has zero activation warnings** and the
  web app issues `http://127.0.0.1:39321/?token=…`.

### 14.4 A/B: same real host runtime, same real `opencode` binary/server

Both adapters registered in one real `LlmRuntime`; `opencode/beam-free`; one DSH `sessionId`.
Adapter `stream()` called directly (the host's `prepared.stream` wrapper rejected a hand-built
assistant message on the second call with `Cannot read properties of undefined (reading
'replayState')`; real loop messages carry the host envelope, and both adapters pass the first
call through the same wrapper).

| Metric | CLI route | HTTP route |
|---|---|---|
| `resolveModelInfo().context.contextWindow` | 32,768 (discovery off in this run) | **1,048,576** (live `/api/model`) |
| turn 1 wall / first token | 1,735 ms / 1,581 ms | 2,152 ms / **946 ms** |
| turn 1 input / cache read | 2,541 / 1,728 | **45** / 4,224 |
| turn 2 wall / input / cache read | 1,002 ms / 66 / 4,224 | **739 ms / 2 / 4,288** |
| turn 2 answer | `42` | `42` |
| abort (1.5 s) | child killed, no terminal event guarantee | `OPENCODE_INTERRUPTED`, reasoning deltas already streamed |

Turn-2 input of 2 tokens vs 66 is the session-continuity effect: the HTTP route sends only the new
user text, while the CLI route re-sends the flattened transcript every call. Cache read stays in
the same range in both because both hit the provider prefix cache.

### 14.5 Status

`applied pending restart` — the package is 0.2.0 and the CLI behaviour is untouched; no live
`~/.dsh` profile or 3080 process was modified. The HTTP row exists only in the isolated profile
until the user adds it to a live profile.

---

## 15. v0.2.1 — "provider present, no models" after the live restart

**Symptom (user-reported).** After the live restart the Models page showed the new provider
`OpenCode v2 (HTTP)` but no models under it, while the CLI route still listed its routes.

**Measured cause.** Two independent facts, both reproduced in an isolated mirror of the live
profile (`DSH_HOME=/tmp/opencode/live-mirror`, in-process boot probe):

| Fact | Measurement |
|---|---|
| The OpenCode daemon is **not** a service | `serve --service` PID 280829 (started 09:23) was gone after the live restart; the next daemon (PID 460200) only started at **12:20:11**, five minutes *after* the host booted at 12:15:06 |
| The host PATH cannot resolve a bare `opencode` | `dsh-web-start.sh` exports `PATH=/home/minami/.local/nodejs/bin:/home/minami/.local/bin:$PATH` — **no `~/.bun/bin`**, and the OpenCode binary lives at `/home/minami/.bun/bin/opencode` |

So at first catalog fetch: the daemon state file named a dead pid → attach failed → the spawn
fallback ran `opencode serve` with the unresolved bare name → that failed too → the adapter
silently degraded to the `default` pseudo-route only.

Reproduced exactly, with the row pointed at a dead daemon and an unresolvable binary:

```
listModels(opencode-agent)     = 46 ["default","opencode-go/iceman-contributor-free", …]
listModels(opencode-http-agent) = 1  ["default"]
catalog.group opencode-http-agent "OpenCode v2 (HTTP)" models=1 ["default"]
```

**Fixes.**

1. `attach()` now verifies the endpoint with `GET /api/info` (a live pid whose port is gone is
   not a server) and records *why* it could not attach.
2. `resolve()` falls back to spawning `opencode serve --port 0` and, when both paths fail,
   throws one message carrying both reasons.
3. `request()` re-resolves the endpoint and retries once when a network failure hits a daemon we
   merely attached to (the daemon is replaced by a new one as the CLI restarts it).
4. `listModels` **throws** with the concrete reason instead of degrading to a one-entry list, so
   the host renders a provider failure with the cause.
5. The live profile row pins `opencodePath: /home/minami/.bun/bin/opencode`.
6. Route names carry the transport: `OpenCode v2 (CLI)` / `OpenCode v2 (HTTP)`; the advertised
   model description names the serving build (`OpenCode v2 server 2.2.0 via HTTP API`).

**Verification (isolated mirror, no daemon available).** With `serviceStatePath` pointed at a
missing file and `opencodePath` set to the absolute binary, the adapter spawns its own server and
the catalog is complete:

```
listModels(opencode-agent)     = 46
listModels(opencode-http-agent) = 46
catalog.group opencode-agent     "OpenCode v2 (CLI)"  models=46
catalog.group opencode-http-agent "OpenCode v2 (HTTP)" models=46
BOOT PASS
# after shutdown: no orphan `opencode serve` child
```

**Unit tests.** `npm test` → **131/131** (20 in `test/http.test.mjs`): health probe, version in
the description, unreachable server reported, missing daemon state named, transport in the
provider name.

---

## 15. v0.2.2 — route names without a version, readable execution errors

Two UI/observability corrections after the 0.2.1 model-serving fix:

1. **Route names.** The provider display names carried the protocol version
   (`OpenCode v2 (CLI)` / `OpenCode v2 (HTTP)`). The version belongs to the build, not the route
   label, so the names are now `OpenCode (CLI)` and `OpenCode (HTTP)`. The model descriptions
   still state the serving build (`OpenCode server 2.2.0 via HTTP API`).
2. **Structured execution errors.** An OpenCode `session.execution.failed` event can carry an
   object (`{"type":"provider.quota","message":"…","status":402}`), which was stringified to
   `[object Object]` in the finish failure. `errorText()` now prefers `.message` /
   `.error.message` and falls back to JSON, so a 402 shows "Upstream request failed: Insufficient
   account funds" instead of an opaque token.

Both routes still advertise the **same** OpenCode model catalog: `/api/model` is the single source
(measured: 46 routes), so every model id offered under `OpenCode (CLI)` is offered under
`OpenCode (HTTP)`; only the transport differs.

`npm test` → **132/132**.

**Status: applied pending restart.** The live service was started 12:32:43, before the profile row
gained the pinned `opencodePath` (12:34:34) and before this 0.2.2 tree; it still advertises the HTTP
provider with an unavailable catalog. One restart applies both.


---

## 16. v0.2.3 — HTTP-primary with CLI fallback; unique model labels

### 16.1 Requirements

- HTTP must be used when it works ("CLI off" for that turn), and the CLI route must take over when
  HTTP cannot be used at all.
- A model label must not appear twice for different routes.

### 16.2 Fallback (implemented)

`OpencodeHttpAdapter.stream()` is now an HTTP-first wrapper over `streamHttp()`:

| Situation | Behaviour |
|---|---|
| HTTP request/attach/spawn fails before any chunk | re-run the generation through the lazily built CLI adapter (`fallbackStream`) |
| HTTP streams content, then fails | error is reported; no replay (avoids duplicate output) |
| model-level `execution.failed` (e.g. 402 quota) | reported as-is; **no** CLI fallback (same upstream) |
| `fallbackToCli: false` | transport error is reported (`OPENCODE_HTTP` / `OPENCODE_SPAWN`) |
| `listModels()` with an unreachable server | falls back to the CLI catalog when enabled, else throws the measured reason |

The CLI adapter is constructed on first fallback only; no CLI child exists while HTTP is healthy.

### 16.3 Duplicate model rows (measured)

`GET /api/model` returns **45 entries with 0 duplicate route ids**, but **7 display names appear
twice** because the same model is offered by both the `opencode` (Zen) and `opencode-go` providers:

```
"DeepSeek V4.1 Flash" -> opencode/deepseek-v4.1-flash, opencode-go/deepseek-v4.1-flash
"Beam Free"           -> opencode/beam-free,           opencode-go/beam-free
… (Gemini 4 Argon, Claude Haiku 5.5, GPT-6 Luna, Qwen3.8 Flash, GLM-5.3-Flash)
```

Reasoning variants are **not** the cause: a route's `variants[]` are one entry with an efforts list
(the UI renders a separate thinking selector), not extra model rows. `modelsFromApiPayload()` now
appends the provider id to colliding names only (`DeepSeek V4.1 Flash (opencode-go)`), leaving unique
names untouched.

**Status: applied pending restart.** `npm test` → 136/136.


---

## 17. v0.2.4 — one OpenCode model group, and cancellations are "aborted" not "error"

### 17.1 Duplicate model rows

Measured cause: the bundle inserted **both** rows (`dsh-opencode-v2-provider` and the HTTP row that
the live profile inserts), and both adapters advertise the same `/api/model` catalog. The picker
therefore rendered every model twice, once per transport group (and the seven cross-provider name
collisions made it look even worse).

Fix: the package bundle now inserts **only the delegation tool**. The live profile keeps a single
`dsh-opencode-v2-http` insert row, so exactly one `OpenCode (HTTP)` group is shown; the CLI adapter
is constructed lazily for the fallback and never registered as a provider. `registerCliProvider:
true` restores the second group for A/B. The live profile's `allowedModels` were migrated from
`opencode-agent` to `opencode-http-agent` (14 entries, one provider).

### 17.2 Model switch mid-turn produced a turn error

Measured: when a model switch (or a user stop) cancels the in-flight generation, both adapters
yielded `finish{kind:'error', failure:{code:'OPENCODE_TIMEOUT'|'OPENCODE_INTERRUPTED'|…}}`. The
host records a cancel as `turn/end{kind:'aborted'}` only for `finish.kind === 'aborted'`
(`FinishReasonMap`, `dsh-llm/lib/types/types.d.ts:138-156`; adapter throws are classified by
`adapterFailureChunk()` in `dsh-llm/lib/index.js:2404-2418`), so the cancelled turn was persisted as
an error instead.

Fix: both adapters now yield `{kind:'aborted', failure:{code:'ABORTED'}}` when
`options.signal.aborted` is true. A timeout remains `{kind:'error'}`; a model-level failure (402)
remains an error with its real message (the `[object Object]` formatting was fixed in §15).

`npm test` → **136/136**. Status: **applied pending restart** (the live service predates this tree
and the profile row change).

## 18. v0.3.0 — catalog snapshot: 0 ms cold start, background revalidation

Problem measured in §17's design: `listModels()` awaited a live probe whenever the 5-minute cache
was cold, so every host boot and every post-TTL catalog read paid a `GET /api/model` round trip (or
a `opencode serve`/`opencode models` child), and a daemon that was down left the picker with no
OpenCode rows at all.

Design: `lib/catalog-cache.js` owns a `CatalogLifecycle` per adapter.

| Phase | Behaviour | Measured |
|---|---|---|
| Activation | `opencode-models.json` read synchronously from the profile dir (`profileContext.dir`), `$DSH_HOME/cache` fallback, in-memory when neither exists | snapshot written: 45 routes, 6261 bytes |
| First read | snapshot answers; no probe on the read path | 31.5 ms first `session/modelCatalog`, 11.1 ms next |
| Revalidation | background probe once stale (`discoveryCacheMs`, default 300 s), single-flight; `catalogSyncMs` timer (default 300 s) keeps it warm | one probe for 8 concurrent `resolveModel` calls |
| Change | catalog signature differs → snapshot rewritten atomically, `llm/models-updated` emitted with the provider id | emitted once per changed catalog, never for identical lists |
| Failure | last good catalog survives; probe error logged, `lastError` exposed | dead `baseUrl` + `spawnServer:false` + `fallbackToCli:false` still listed 46 models; snapshot mtime unchanged |

A/B-ready: `catalogPath` (explicit file), `catalogSyncMs: 0` (no timer), `discoveryCacheMs`
(freshness). The CLI fallback keeps its own `opencode-models-cli.json`.

`npm test` → **146/146** (10 new cases in `test/catalog.test.mjs`). Status: **applied pending
restart** for the live service.

## 19. v0.3.1 — status-bar speed counted wall time and dropped nested usage

Measured on a live 3-turn session (`session-bfeb1eaa…`, OpenCode HTTP route):

| Turn | upstream calls in the step | tokens persisted | wall decode | displayed |
|---|---|---|---|---|
| 1 | 91 | 891 (+449 reasoning) | 606 s | 1.5 tok/s |
| 2 | 44 | 1,319 (+357) | 622 s | 2.1 tok/s |
| 3 | 96 | 1,861 (+551) | 790 s | 2.4 tok/s |

Two defects, both structural:

1. **Usage was last-wins.** One DSH generation contains many OpenCode steps
   (`session.step.ended` per internal upstream call). `lib/http.js` assigned
   `usage = usageFromTokens(tokens)`, so the settled message kept only the final
   call's tokens: 4,071 of the real 108,611 generated tokens survived (3.7 %).
   Fix: accumulate a running total (`addUsage`) before each `usage` chunk.
2. **The denominator was wall clock.** `dsh-session-stats` measured
   `assistant/message time − first token`; with ~96 nested calls per step that
   span is mostly queueing and per-call TTFT (790 s vs 113 s of token flow).
   Fix (local patch, `scripts/patch-session-stats.mjs`): sum the packed delta-run
   delays (`dt` of `text-chunks`/`reasoning-chunks`/`tool-call-chunks`) for the
   pure generation span, count `outputTokens + reasoningTokens`, and bump
   `stateVersion` to 2 so cached projections recompute.

Result on the same log: **2.0 → 363.6 tok/s** (108,611 tokens over 298.7 s of
token flow). Sessions from single-call providers are unaffected in magnitude
(the measured DeepSeek session moved 189.3 → 192.2 tok/s); only the small
assembly gap and reasoning tokens change.

Also in this version: colliding OpenCode model labels read `(Go)` and `(Zen)`
instead of the raw `opencode-go` / `opencode` route ids.

`npm test` → **147/147**. Status: **applied pending restart**; the stats patch is
local to this install and must be re-applied after a `dsh` upgrade.

## 19. v0.3.2 — A/B (HTTP vs CLI), official-docs delta, durable session map

### 19.1 Setup

Isolated `DSH_HOME` with the shipped `headless` profile and two `--patch` overlays that differ
only in the provider row and `agent-default-model`: `@nolit/dsh-opencode-v2/http`
(`opencode-http-agent`) versus `@nolit/dsh-opencode-v2/provider` (`opencode-agent`). Same model,
same prompts; one session per route: turn 1 `Reply with exactly: OK`, turn 2 a bash-tool task.
Metrics are folded from `session.v4.jsonl.zstd` (`turn/start`→`turn/end`, first stream record,
packed `dt` sums, `assistant/message` usage), not from wall-clock process time alone.

### 19.2 Measured

Same model `opencode-go/deepseek-v4.1-flash`, one session per route:

| Metric | HTTP route | CLI route |
|---|---|---|
| process wall (turn 1 / turn 2) | 7.33 s / 12.23 s | 7.65 s / 7.53 s |
| turn wall | 5.39 s / 10.28 s | 5.34 s / 5.26 s |
| TTFT | 5.05 s / 6.09 s | 5.09 s / 5.00 s |
| streamed deltas | yes (packed `dt` 230 / 485 ms) | **none** (one block per message) |
| generated tokens (out + reasoning) | 73 / 256 | 3 / 82 |
| input tokens | 6,019 / 12,497 | 259 / 4,377 |
| cache read | 0 / 0 | 5,760 / 7,808 |
| tool task completed | yes (`live-http.txt`) | yes (`live-cli.txt`) |

Secondary sample, `opencode/beam-free`, two sessions per route, chat only:

| Metric | HTTP route | CLI route |
|---|---|---|
| process wall | 5.10 s / 6.17 s | 5.06 s / 6.90 s; 6.36 s / 7.25 s |
| turn 2 wall | 4.17 s / 4.19 s | 5.00 s / 4.69 s |
| turn 2 TTFT | 3.28 s / 2.87 s | 4.4 s (block delivery) |
| turn 2 decode | 0.83 s / 1.14 s | n/a |
| turn 2 generated tokens | 544 / 533 | 530 / 495 |

### 19.3 Findings

- **CLI does not stream.** `opencode run --format json` emits one event per block
  (`dt` arrays are empty), so TTFT equals the full generation and the UI shows nothing until the
  message settles. The HTTP SSE path emits real per-token deltas.
- **Cross-process resume replays the transcript.** A new adapter instance has no OpenCode session,
  so the first turn sends `buildPrompt()` (full flattened history): 12,497 input tokens and a
  10.3 s turn for the tool task versus 4,377 input tokens and 5.3 s through the CLI prompt path.
  Inside one host process the HTTP route sends only the new user text (§14.4: turn-2 input 2 vs
  66), so HTTP remains the better transport while the process lives.
- Neither route used DSH tools: the model backend is OpenCode itself, which ran its own bash tool
  inside the daemon/child. DSH observed only text, which is why `tool/call` events are absent.

### 19.4 Official-docs delta (opencode.ai, measured against v2.2.0)

| Fact | Official docs | Internal measurement docs | Measured 2026-10-29 |
|---|---|---|---|
| API document | v1 `/docs/server` links `/doc`; v2 links "API reference `/api`" | `GET /openapi.json`: OpenAPI 3.1.0, 130 paths, 337 schemas | exact match: 318,080 B, 130 paths, **337** schemas; `/doc` is the 9,610 B HTML UI |
| Auth | `OPENCODE_SERVER_PASSWORD`, Basic user `opencode` | same, password from banner or `service.json` | 401 without, 200 with |
| Server lifecycle | v2: one **shared background service** per user; `--standalone` / `--server`; `opencode service set disabled true` | §15 "the daemon is not a service" (v2 `serve --service` gone; daemon died on restart) | `opencode service` **does** exist (start/restart/status/stop/get/set/unset); here `status=stopped`, `get={}` — DSH spawns a private daemon, so the wording in §15 needs the shared-service nuance |
| `opencode run` flags | v1: `--attach`, `--password`, `--username`, `--dir`, `--port`, `--auto`, global `--pure` | v2 rejects `--attach` / `--pure` | v2.2.0 has `--session`, `--model provider/model#variant`, `--format`, `--thinking`, `--fork`, `--file`; global `--standalone` / `--server`; no `--attach` / `--pure` / `--password` |
| CLI docs coverage | v2 page documents only intro, `run`, `mini`, `service`, `paths`, `uninstall` | internal docs cover `serve`, `/api/model`, `/api/event`, limits | internal measurement remains the only source for the `/api/*` surface |
| Model cache | `opencode models --refresh`; `OPENCODE_MODELS_PATH` loads a local catalog | DSH-side `opencode-models.json` snapshot | consistent at a different layer; no conflict |
| Connection reuse | Node `fetch` is undici with keep-alive (default `keepAliveTimeout` 4 s, `keepAliveMaxTimeout` 600 s) | adapter reuses the global dispatcher; SSE holds one connection per generation | no per-request handshake measured; `/api/model` warm calls ~10–13 ms |

### 19.5 Optimization — durable session map

`lib/session-map.js` persists `{DSH session id → OpenCode session id, modelKey, directory}` in
`<profile>/opencode-sessions.json` (`sessionMapPath` overrides). `sessionFor()` adopts a persisted
id only after `GET /api/session/{id}` confirms it, switches the model when it differs, and drops a
404 instead of replaying blindly.

Unit proof: a second adapter instance over the same map reuses `ses_1` (`state.creates === 1`) and
the second prompt is exactly `two`, i.e. only the new user text. Limit: the current live profile
spawns a private daemon that dies with the host, so after a host restart the id 404s and the
transcript is replayed; the map pays off under attach / shared-service mode (`opencode service`).

`npm test` → **150/150**. Status: **applied pending restart** (workspace source; the live service
still runs the 0.3.0 adapter in memory).

## 20. v0.3.3 — HTTP-only conversation pipeline; CLI becomes a batch worker

### 20.1 Decision

§19 measured two facts that settle the transport split: `opencode run --format json` delivers whole
blocks (empty `dt` runs, so TTFT equals the full generation) and spawns one process per generation.
Chat/streaming/reasoning therefore belong to the HTTP adapter alone; the CLI is a one-shot worker.
Design: `docs/CLI-WORKER-PLUGIN-DESIGN.md` (tool `cli_worker`, backends `opencode`/`codex`/`claude`,
artifact collection, isolation, no LLM registration).

### 20.2 Code changes

| Concern | Change |
|---|---|
| Fallback | Removed `fallbackToCli`, `registerCliProvider`, `TRANSPORT_FAILURES`, `stream()/streamHttp()` wrapper, `fallbackStream()`, `cli()`. A transport failure is the turn failure. |
| CLI route | `lib/provider.js` exports no `apply`/`inject`: it cannot be mounted as a conversation provider and registers no adapter. `./provider` stays exported as the worker backend. |
| Availability | `modelsFromApiPayload()` drops `enabled === false` or `status === "disabled"`; `resolveModel()` warns when a configured route is absent from the served catalog. |
| Attach | `serviceStateCandidates()` + `attachCandidate()`: `serviceStatePath`, `$OPENCODE_SERVICE_STATE`, `$XDG_STATE_HOME/opencode/service.json`, `$XDG_CONFIG_HOME/opencode/service.json`; each validated with `/api/info` before adoption. |

### 20.3 Measurements

| Fact | Measured |
|---|---|
| Raw `/api/model` availability | 45 routes, **45 × `{enabled:true, status:"active"}`**, 0 disabled |
| Earlier "unavailable free model" | `opencode-go/deepseek-v4.1-flash-free` is **absent from the catalog** (the served free route is `opencode/deepseek-v4.1-flash-free`); it was an A/B overlay config, not a disabled entry |
| Attach candidates | `serviceStateCandidates('/explicit.json')` → 3 paths (explicit, `~/.local/state/…`, `~/.config/…`) |
| Live attach outcome | `~/.config/opencode/service.json` holds `{password}` only → rejected (`no url/password`) → spawn path, unchanged |
| HTTP-only smoke (headless, new tree) | `Reply with exactly: OK` → text `OK`, usage input 6,019 / output 3 / reasoning 66 |

### 20.4 Status

`npm test` → **151/151**, `npm run check` pass, `npm run docs:index` → 36 docs, `docs:check` OK.
Status: **applied pending restart** (the live service still runs the 0.3.0 adapter; session-map and
this split load on the next restart).

## 21. v0.3.4–v0.3.5 — cumulative usage correction; CLI worker folded in and verified live

### 21.1 Restart evidence (21:05 service, 21:11 first write)

| Fact | Measured |
|---|---|
| Host process | `node …/dsh --profile web … --port 3080`, PID 734846, started 21:05 |
| OpenCode daemon | `opencode serve --hostname 127.0.0.1 --port 0`, PID 734883, listening `127.0.0.1:46255` |
| Session map | `/home/minami/.dsh/profiles/web/opencode-sessions.json`, `version: 1`, one entry `session-bfeb1eaa-40a7-45ef-9f54-35ea1bec4f47` → `ses_e786d3789ffek922Dzbt58VCLH`, `modelKey: opencode-go/deepseek-v4.1-flash`, `directory: /home/minami/.local/share/dsh` |
| Catalog snapshot | `opencode-models.json`, 6,163 B, rewritten 21:11 |

The map file proves the 0.3.3 write path: adoption happened during the first turn
after restart, and the entry is keyed by the **DSH** session id while carrying the
OpenCode id in `sessionID`.

### 21.2 The 5,680 tok/s freeze was double-counted cumulative usage

The composer read `5,680.3 tok/s`. Replaying `session.v4.jsonl.zstd` reproduced
the exact figure: `decodeTokens / decodeMs = 4,385,897 / 772,118 ms`.

Cause: `addUsage()` in `lib/http.js` emits the **running total of one generation**
after every OpenCode step (`session.step.ended`). The v0.3.1 projection patch
summed every `usage` chunk of the step, so a cumulative snapshot was counted once
per step:

| Settled step | usage chunks | v2 sum (reported) | real generation total | tok/s (v2 → v3) |
|---|---|---|---|---|
| 1 (old adapter, per-call chunks) | 91 | 38,936 | 38,936 | 354.7 → 354.7 |
| 4 (old adapter) | 55 | 39,705 | 39,705 | 321.2 → 321.2 |
| 6 (running-total chunks) | 96 | **3,241,713** | 72,421 | 12,517 → 279.6 |
| 7 (running-total chunks) | 54 | **994,433** | 33,425 | 12,021 → 404.1 |

Steps 1–4 came from the 0.3.0 adapter still in memory before the 21:05 restart
(one `usage` chunk per upstream call, oscillating sequence); steps 6–7 came from
the running-total adapter (non-decreasing sequence). One log therefore contains
both semantics, so the fix cannot assume either.

`streamGeneratedTokens()` now classifies the sequence: a non-decreasing token
series is a cumulative snapshot and contributes its **last** value; an oscillating
series is per-call and contributes the **sum**. Aggregate on the same log:
**5,680.3 → 331.0 tok/s** (255,597 tokens / 772,118 ms), and each new turn moves
it (no more freeze).

### 21.3 Denominator exceptions

`streamDecodeSpan()` uses the packed `dt` sum only when it is positive; an
all-zero gap run (a provider that coalesces a burst into one record) or an
unpacked stream falls back to `settled − firstToken`. The projection adds a step
only when `generatedTokens !== null && decodeSpan > 0`, so a zero-span step can
neither divide by zero nor invent a speed. `stateVersion` is **3**; the cached
projection recomputes from the log on the next start.

### 21.4 CLI worker is an internal module, not a package

`docs/CLI-WORKER-PLUGIN-DESIGN.md` described a second package
(`@nolit/dsh-cli-workers`). That split was cancelled: the worker tracks the same
OpenCode surface and version as the conversation route, and a second package adds
a profile row, an install dependency, and a version pair to keep in sync.

| Concern | Location |
|---|---|
| Backends (`argv` + parser) | `lib/workers/backends.js` |
| Artifacts (glob, sha256, limits) | `lib/workers/artifacts.js` |
| Spawn, stdin, timeout, result | `lib/workers/run.js` |
| Tool + `/worker` registration | `lib/workers/index.js` |
| Config | `lib/index.js` row: `workerEnabled`, `workerBackend`, `workerTimeoutMs`, `workerMaxOutputBytes`, `workerArtifactLimit` |

`apply()` registers `cli_worker` from the same row that provides the `opencode`
tool, so one install and one profile row enable the chat route, the delegation
tool, and isolated batch work.

### 21.5 Status

`npm test` → **164/164** (13 new worker tests), `npm run check` pass.
Status: **applied** (plugin 0.3.4 on disk; the running host keeps 0.3.3 in memory
until its next restart). Stats patch: **applied to the installed
`dsh-session-stats`**, effective after a restart.

### 21.6 Live `cli_worker` call (v0.3.5)

Real `opencode` binary (`/home/minami/.bun/bin/opencode`), real argv/stdin/parse/artifact path,
`opencode-go/deepseek-v4.1-flash`, one temp `cwd` per run.

| Run | Result | Evidence |
|---|---|---|
| First call (no `--standalone`, no `PWD` pin) | `ok:true`, `summary:"DONE"`, 17.3 s, tokens 11,882/126 | `report.txt` (`worker-ok`, 10 B) was written to `/home/minami/Workspace/.../dsh-opencode-v2/`, not to the requested `cwd`; `collect:["*.txt"]` returned `missing` |
| `pwd` probe through the same tool | `summary:"/home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-opencode-v2"` | proves the child resolved its session directory from the inherited `PWD`, not from `spawn.cwd` |
| After pinning `PWD` | `ok:true`, `exitCode:0`, `summary:"DONE"`, 5.99 s, tokens 3,479/46 | `artifacts:[{path:"report.txt", bytes:10, sha256:"9ff7c64c60288482b00b78cf3ff813788bd5fb9ae8c4db6492f1f06a7181e522"}]`, `missing:[]`, file content `worker-ok\n` |
| Negative (`opencode/beam-free`) | `ok:false`, `exitCode:1`, 2.3 s | `stderrTail:"Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models."` (HTTP 429 `provider.free-limit`) |

Two defects the live call exposed, both fixed:

1. **`opencode run` used the shared service.** The default CLI path connects to, and if absent
   starts, `opencode service` (`opencode.exe serve --service`, pid 759394, `127.0.0.1:49374`,
   state file `~/.local/state/opencode/service.json` at 21:43:25). That startup interrupted the
   conversation route's live stream. The worker now passes `--standalone` (private server) so a
   batch run can never start, restart, or contend with the conversation daemon.
2. **`cwd` was advisory.** `opencode` resolves its session directory from `$PWD`, which the spawn
   inherits from the host. `runWorker()` now merges `PWD: cwd` into the child environment.

Also: a provider failure arrives as a stdout `{"type":"error"}` event, so the earlier empty
`stderrTail` hid a 429. `parseOpencode()` now returns `errors`, and `runWorker()` folds them into
`stderrTail`, which also sets `ok:false` even when the process exits 0.

Harness: `test/live/cli-worker-live.mjs` (manual; `WORKER_BACKEND`/`WORKER_MODEL`/`WORKER_TASK`
overrides, `{cwd}` placeholder). Unit suite: **165/165**, `npm run check` pass.

`sessionStats` on the live session after the restart: `ver: 3`, `decodeTokens 311,156`,
`decodeMs 956,802` → **325.2 tok/s** (was the frozen 5,680.3). `toolMs` stays 0 on this route
because the OpenCode HTTP adapter emits no `tool/call` events — DSH sees only text/usage, so tool
time is not separable in the projection yet.

## 22. v0.3.5 — `toolMs` mapping for provider-side agent loops (projection v4)

### 22.1 Why `toolMs` was always 0

`sessionStats` pairs `tool/call` with `tool/result` (`dsh-session-stats/lib/index.js`,
`case "tool/result"`). On the OpenCode HTTP route DSH never logs those events: the model's
tool calls execute inside the OpenCode session, so a whole agentic step (up to 96 upstream
calls plus their tool work) looks like one silent DSH step. The status-bar dialog therefore
showed `Tool time 0` for every OpenCode session while `LLM time` absorbed everything.

Live evidence: the session projection carried `toolMs: 0` with `llmMs: 4,174,053` — and the
session log contains **0 `tool/call` and 0 `tool/result` events** (grep over
`session.v4.jsonl.zstd`), while the adapter already subscribes to the provider's
`session.tool.called|success|failed` SSE events (`lib/http.js`, `TOOL_EVENTS` list) and drops them.

### 22.2 Mapping

`scripts/patch-session-stats.mjs` v4 (stateVersion **4**) attributes, for steps whose settled
message source provider is `opencode-http-agent`:

```
toolMs += max(0, stepWall - ttft - decodeSpan)
```

`stepWall` is `assistant/message.time − step/start.time`, `ttft` is first token − step start, and
`decodeSpan` is the packed `dt` sum. DSH tool pairing still contributes for native tools, so the
two sources add up rather than replace each other.

Replay of the live session `session-bfeb1eaa…` (11 settled steps) through the new rule:

| Metric | Value |
|---|---|
| `llmMs` | 4,966,794 ms |
| `ttftMs` | 40,935 ms (11 steps) |
| `decodeMs` | 1,163,143 ms |
| `decodeTokens` | 361,116 (310.5 tok/s) |
| `toolMs` | **3,762,716 ms** (was 0) |

Semantics: the attributed figure is an **upper bound** — it covers OpenCode's tool execution plus
the upstream queue time between its internal calls, which the log cannot separate. It is reported
as tool/background time, never as model generation time.

All three upgrade paths of the patch (stock v1 → v4, v2 → v4, v3 → v4) were reconstructed and
verified byte-identical to the installed v4 output.

## 23. v0.3.5 — context gauge and Korean tooltip corrections

### 23.1 Double percent in the tooltip

`ContextMeter` builds `reading = `${percent}%`` and passes it to
`t("context.aria", { percent: reading })` (`dsh-client-ui-conversation/lib/client.js:21492-21493`).
The Korean dictionary supplied its own trailing `%`:

- `/home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-korean-locale/data/ko.json`
  `conversation["context.aria"]` was `"컨텍스트 {percent}% 사용됨"` → rendered `컨텍스트 100%% 사용됨`.
- Fixed to `"컨텍스트 {percent} 사용됨"` in both `data/ko.json` and `lib/client.js`.

### 23.2 Gauge pinned at 100%

`contextOccupancy()` (`dsh-client-ui-conversation/lib/client.js:21379-21385`) divides
`pressure.projectedTokens ?? pressure.pressureTokens` by `pressure.contextWindow`.
`contextPressure` (`dsh-token-meter/lib/index.js:450`) fed it `pressureFrom(usage) = inputTokens +
cacheReadTokens + cacheWriteTokens` of the **settled** message.

On this route the settled usage is the generation running total (`addUsage()`), so one step reports
the sum of ~96 prompt reads. Live proof from the session projection:

| Before | Value |
|---|---|
| `contextWindow` | 1,000,000 |
| `pressureTokens` | **9,493,863** (950 % → clamped 100 %) |
| `surfaceTokens` / `sampledSurfaceTokens` | 132,807 / 120,453 |

Fix in `scripts/patch-session-stats.mjs` (`patchTokenMeter`): `requestPressureUsage(event)` scans the
settled stream's usage chunks, requires a non-decreasing prompt sequence (the cumulative adapter
signature), and returns the **last sample minus the previous one** — the prompt size of the final
upstream request. Per-call adapters keep oscillating samples and fall through to the settled usage.
`contextPressure` `stateVersion` 5 → **6**.

Replaying the 12 settlements of `session-bfeb1eaa…`:

| Step | settled prompt | corrected cursor | gauge |
|---|---|---|---|
| 1 | 125,548 | 878 | 0.1 % |
| 6 | 14,931,372 | 208,650 | 20.9 % |
| 10 | 12,819,198 | 226,255 | 22.6 % |
| 11 | 9,441,486 | 281,194 | 28.1 % |
| 12 | 9,493,863 | 317,986 | **31.8 %** |

### 23.3 Also re-checked

- `toolMs` v4 is live after the 22:12 restart: `sessionStats` `ver: 4` with `toolMs 3,918,297`
  (was 0), `decodeTokens 383,237`, `decodeMs 1,248,943` → 306.8 tok/s.
- `contextWindow` 1,000,000 is correct for `opencode-go/deepseek-v4.1-flash`; the window was never
  the bug.
- `(Go)` / `(Zen)` model labels and the catalog snapshot path are unaffected by this patch.

## 24. v0.3.6 — why only some models offer a thinking level; `default` row inherits its route

### 24.1 The reported asymmetry is an OpenCode catalog fact

Question measured: in the prompt's model picker, some routes offer a thinking level and some do not.
The chain is unchanged from §12: `buildModelCatalog()` (`dsh-api-session-controller/lib/index.js`)
fills `model.reasoning` from `llm.resolveModelInfo()`, and the picker builds no effort rows when it
is absent (`ui-model-selection` `effortChoices` is `[]`, so the pane shows
"이 모델은 추론 강도 단계를 제공하지 않습니다."). The adapter publishes `reasoning.efforts` only
for a route whose `/api/model` entry carries `variants`.

Re-measured 2026-10-30 against the live account and the running app's own cache:

```
$ opencode serve --port 0 && curl -s -u opencode:<pw> /api/model
entries 45 | with variants 35
variant id counts {"low":29,"high":30,"max":22,"medium":20,"xhigh":17,"none":13,"minimal":4,"thinking":1}

$ node -e '... modelsFromApiPayload(...)'
routes parsed: 45 with variants: 35        # same projection the adapter stores
no-variant routes: opencode-go/iceman-contributor-free, opencode-go/mimo-v2.6-flash,
opencode-go/mimo-v2.6-pro, opencode/mimo-v2.6-flash-free, opencode/nemotron-3.5-lightning-free,
opencode-go/longcat-2.0, opencode-go/kimi-k2.7-code, opencode-go/mimo-v2.5,
opencode-go/mimo-v2.5-pro, opencode/big-pickle

$ ~/.dsh/profiles/web/opencode-models.json      # the live profile's cached catalog, saved 00:25
models 45 with variants 35                       # identical id set
```

So the 10 variant-less routes have no selectable level because OpenCode declares none for them —
not because discovery failed, the cache is stale, or the mapping dropped them. `--thinking`
(streaming) is orthogonal and still configurable per plugin.

### 24.2 Defect found while answering: the `default` row lost its route's levels

`OpencodeHttpAdapter.lookupModel()` computed `const route = model === 'default' ? defaultModel : model`
and then matched the catalog against the literal `model`, never `route`. The `default` row therefore
resolved to `null` and fell back to `contextWindow 32768` / no `reasoning`, even though `stream()`
ran the resolved route through `modelRefFromRoute()` and that route had a 200 KB–1 MB window and
levels.

Measured before the fix (`test/http.test.mjs`, fake catalog `opencode/beam-free` 200000 / `low,high`):

```
resolveModel('default').context.contextWindow === 32768      # expected 200000
resolveModel('default').reasoning === undefined              # expected low|high
```

Fix: `lookupModel()` resolves `default` through the same `modelRefFromRoute('default', models,
defaultModel)` call the wire uses, then matches the resulting `provider/id`. The route table's
`default.opencodeModel` still overrides `defaultModel`, and an override route without variants
still advertises no levels.

New test: `resolveModel default route inherits the route it actually runs` covers both the
`defaultModel` inheritance and the table override.

### 24.3 Verification

```
$ (cd dsh-opencode-v2 && npm test)
ℹ tests 166
ℹ pass 166
ℹ fail 0
```

Live adapter probe against a fresh `opencode serve --port 0` (real CLI, real `/api/model`,
`defaultModel: opencode/beam-free`), after the fix:

```
default                         ctx=1048576 levels=low|medium|high|xhigh|max
opencode/beam-free              ctx=1048576 levels=low|medium|high|xhigh|max
opencode-go/deepseek-v4.1-flash ctx=1000000 levels=low|high|max
opencode-go/kimi-k3             ctx=1048576 levels=max
opencode-go/minimax-m3          ctx=1000000 levels=none|thinking
opencode-go/mimo-v2.6-flash     ctx=1048576 levels=-          # route declares no variants
opencode/big-pickle             ctx=200000  levels=-
```

The variant-less rows resolve a real context window yet no levels, which separates "OpenCode
declares no variants" from "discovery failed" (the failure mode of §12.1 returned `32768` for
every row). `default` now matches the route `stream()` runs instead of the floor.

Status: code + tests applied in the workspace. The running 3080 process still holds the pre-change
module; the `default` row shows the inherited levels after a restart. Live `~/.dsh` was not written.

## 25. v0.3.7 — preflight validation and a loud discovery fallback

### 25.1 What already existed (and what did not)

The with/without-levels decision is implemented at three layers, not missing:

| Layer | Behaviour | Code |
|---|---|---|
| Catalog | `reasoning.efforts` only when the route has `/api/model` `variants` | `lib/shared.js` `reasoningEffortsFromVariants`, `lib/provider.js` / `lib/http.js` `resolveModel` |
| Host | rejects any requested effort the exact model does not advertise (`UNSUPPORTED_REASONING_EFFORT`); selection drops an effort on model switch | `dsh-llm/src/index.ts` `resolveCallWithInfo`, `dsh-api-session-controller/src/commands.ts` `selectModel` |
| Client | no effort pane when `model.reasoning` is absent; the root menu hides the Effort cell entirely | `dsh-client-ui-model-selection/ModelSelect.tsx:139-151, 509-520` |

The client layer is why the difference is invisible until a level is offered: a variant-less model
shows no Effort row at all, not "no levels available". That is a DSH UI gap, not plugin logic.

### 25.2 Gap 1 — an unadvertised level failed inside OpenCode, not at the seam

Measured against the real CLI:

```
$ printf 'say OK' | opencode run -m opencode-go/mimo-v2.6-flash#high --auto --format json
{"type":"error", ..., "error":{"type":"provider.no-route","message":"Variant unavailable for opencode-go/mimo-v2.6-flash: high"}}
```

`mimo-v2.6-flash` declares no variants, so that argv can only fail after OpenCode starts. The host
normally blocks it first, but direct adapter callers and a selection made against an older catalog
bypass that check and get the opaque provider error.

Fix: both adapters validate `options.reasoningEffort` against the resolved route's variants before
spawning (`opencode-agent`) or creating a session (`opencode-http-agent`), and yield
`{ kind: 'error', failure: { code: 'UNSUPPORTED_REASONING_EFFORT', message } }` with the advertised
list: `… does not support reasoning effort "high" (advertised: none)`. An unknown route (discovery
unavailable) stays unvalidated so a transient catalog failure cannot block a valid call.

### 25.3 Gap 2 — the CLI fallback dropped every level silently

`discoverOnce()` fell through to `opencode models` (ids only) without logging. That path removes
every reasoning level and collapses context windows to `32768`, which looks exactly like "these
models cannot reason". It now logs:

```
opencode-agent: serve discovery unavailable (<reason>); falling back to the CLI listing,
which advertises no reasoning levels and a conservative context window
```

### 25.4 Tests and status

```
$ (cd dsh-opencode-v2 && npm test)
ℹ tests 169
ℹ pass 169
ℹ fail 0
```

New coverage: a variant-less route rejects an effort without spawning; a route with levels rejects a
stale one and names the offered list; the HTTP route rejects before `POST /api/session` (0 creates).
The existing tests still pin that an advertised level reaches `-m …#high` and the HTTP session
`variant`.

Status: applied in the workspace, artifact `0.3.7`. The running 3080 service still holds the
previous module; restart required. Live `~/.dsh` was not written.

## 25. v0.3.7 — reasoning-level handling at the serving boundary

### 25.1 What was already implemented (three layers)

The picker asymmetry from §24 is produced by deliberate logic, not by a missing branch:

| Layer | Code | Behavior |
|---|---|---|
| Plugin catalog | `reasoningEffortsFromVariants()`; `resolveModel()` spreads `reasoning` only `if (efforts.length)` | a route advertises levels iff `/api/model` carries `variants` |
| Host selection | `llm.resolveCallWithInfo()` (`packages/llm/llm/src/index.ts:916-940`) | rejects any effort for a model with no `reasoning`; rejects levels outside `efforts` |
| Client | `ModelSelect.tsx` root pane renders the Effort cell only when `reasoning !== undefined` | no effort entry is shown at all for a variant-less route |

The missing piece was **not** the with/without-model branch; it was what happens at the adapter
when a level is requested anyway, and what the user is told.

### 25.2 Measured defect: an unadvertised level reached the wire

Real CLI against the real account (route `opencode-go/mimo-v2.6-flash`, which advertises no
variants):

```
$ printf 'say OK' | opencode run -m opencode-go/mimo-v2.6-flash#high --auto --format json
{"type":"error", ..., "error":{"type":"provider.no-route",
 "message":"Variant unavailable for opencode-go/mimo-v2.6-flash: high"}}
```

The adapter appended `#high` unconditionally (`withVariant(resolveOpencodeModel(...),
options.reasoningEffort)`); the HTTP adapter passed `variant` the same way. A stale catalog, a
direct adapter caller, or a selection made before a catalog refresh therefore produced an opaque
upstream error mid-run instead of a local, actionable failure.

### 25.3 Fix

- `shared.unsupportedEffortMessage()` produces one message naming the provider, model, requested
  level, and the levels the route advertised (or `none`).
- `OpencodeLlmAdapter.stream()` and `OpencodeHttpAdapter.stream()` now resolve the exact route and
  reject a level it does not advertise **before spawning** / **before creating a session**, yielding
  `finish.kind = "error"` with `code: "UNSUPPORTED_REASONING_EFFORT"` and logging the same message.
  An unknown route (no catalog entry) is left to the server, so a transient discovery failure does
  not block a call the host already validated.
- `discoverOnce()` logs when the `serve` probe is unavailable and the CLI listing is used, because
  that fallback silently removes every level and collapses context windows to the `32768` floor —
  the failure mode that looks like "this model cannot reason".

### 25.4 Verification

```
$ (cd dsh-opencode-v2 && npm test)
ℹ tests 169
ℹ pass 169
ℹ fail 0
```

New tests: `stream rejects a level the route does not advertise before spawning` (no child spawned,
exact failure payload), `stream rejects a stale level on a route that advertises other levels`
(advertised list in the message), and the HTTP equivalent
`stream rejects a level the route does not advertise before creating a session` (`state.creates`
stays 0). Advertised levels still take the existing `-m …#<variant>` / session-variant paths.

Status: applied in the workspace; the running 3080 process needs a restart to load 0.3.6 + 0.3.7.

## 26. v0.5.1 — live 400 `MissingSessionID` and revoked-credential 401 (measured 2026-10-30)

Reported after the 22:36 live restart: every `opencode-http-agent` turn ended with

```
OpenCode backend HTTP 400: {"type":"error","error":{"type":"MissingSessionID",
 "message":"Request is missing x-opencode-session and cannot be routed efficiently. ..."}}
```

### 26.1 Measurement (read-only; real endpoint, real credential)

Probes at `https://opencode.ai/inference/go/openai/v1/chat/completions`:

| Probe | Result |
|---|---|
| no `x-opencode-session` | **400** `MissingSessionID` |
| `x-opencode-session: <id>` | 400 gone (request proceeds to the credential check) |

`grep 'x-opencode-session' lib/ test/` before the fix → **0 matches**: the adapter built headers
from `attributionHeaders()` (user-agent), provider headers and `authorization` only
(`lib/http.js:847-853`).

Credential store (`GET /api/credential`, suffixes only):

| id | integrationID | label | active | type | suffix | Go backend |
|---|---|---|---|---|---|---|
| cred_1 | opencode | Master Key 1 | false | key | 4yhF | — |
| cred_2 | opencode | Master Key 2 | false | key | Cui7 | 403 "active OpenCode Go subscription is required" |
| cred_14ea… | opencode | Personal | **true** | **oauth** | d659 | **200** |
| cred_1830… | opencode-go | OpenCode Go | **true** | key | 4yjF | **401 Invalid credential** |

`activeCredential()` took the first `active === true` entry, so the revoked `opencode-go` key won
over the working web login — and the store files credentials under `opencode` while the route id
is `opencode-go`, which is why the `Personal` entry was not even a candidate.

### 26.2 Fix

- `sessionHeaders()` — `x-opencode-session` = `options.sessionId`, else `sessionFallback`
  (default `deepseek-harness`). Config: `sessionHeader`, `sessionFallback`.
- `activeCredential()` — candidate owner ids are `{provider.integrationID, backendProviderId,
  provider.id, 'opencode-go', 'opencode'}`; candidates are ranked `oauth` → `key` → other;
  optional `credentialLabel` pins an exact store entry.

### 26.3 Verification

```
$ (cd dsh-opencode-v2 && npm test)
ℹ tests 185
ℹ pass 185
ℹ fail 0

$ (cd dsh-opencode-v2 && npm run check)   # all 10 lib files parse
```

New tests: `session header is sent with the DSH session id`, `session header falls back to a
stable value when DSH sends no session id`, `sessionHeaders honours a configured header name and
an empty header config`, `credential selection prefers the active oauth entry over a revoked key`,
`credentialLabel pins an exact store entry`.

Live end-to-end (real control plane, real backend, adapter's own `activeCredential()` and
`sessionHeaders()`):

```
selected credential: st_66…d659 len 39
session header: {"x-opencode-session":"session-7374b765"}
backend status: 200
content: "LIVE_OK"
usage: {"prompt_tokens":208,"completion_tokens":12,...}
```

Status: applied in the workspace at `0.5.1`; the running service must be restarted to load it.

## 27. v0.6.0 — per-account model allow-list and its settings tab (measured 2026-10-30)

### 27.1 Why a sweep is needed

`/api/model` returns `status: "active"` and `enabled: true` for all 49 routes, so neither carries
entitlement; `/api/experimental/usage/limits` exposes only rolling/weekly/monthly percentages.
The backend's answer to a one-shot request is the only reliable signal:

| Result | Count |
|---|---|
| 200 | 35 usable |
| 400 `Model is unavailable.` | 12 |
| 410 `… has been deprecated …` | 2 |

Sweep cost: 49 routes, concurrency 8, **20.1 s**. Two routes needed the `max_tokens >= 16` retry.
Of 19 `opencode/` (Zen) routes 7 are usable; of 30 `opencode-go/` routes 28 (2 deprecated).

### 27.2 Implementation

- `Config.enabledModels` (volatile, default `[]` = unrestricted).
- `enabledRouteFilter(routes)` → `null` for an empty list, else a trimmed `Set`.
- `listModels()` keeps the `default` row plus allow-listed catalog ids. Catalog ids are already
  `provider/model` (there is **no** separate `providerID` field — a first draft compared
  `${model.providerID}/${model.id}`, produced `undefined/…`, and hid everything; caught by the
  workspace prototype before any live change).
- `classifyProbe(status, message)` maps the measured answers.
- `OpencodeHttpAdapter.measureEntitlement({ concurrency })` performs the sweep.
- `registerModelSettingsRoutes()` serves three routes over `ctx.connection.fetch.register`.
- `lib/client.js` registers the `settings.section` tab.
- `inject` gained `connection` and `settings`.

### 27.3 Isolated real-mount verification (live profile untouched)

```
$ DSH_HOME=<isolated copy> dsh --profile web --host 127.0.0.1 --port 3919 --no-open
dsh web: http://127.0.0.1:3919/?token=…
# no error lines, no "did not activate"

POST /api/local/opencode-v2/model-settings            -> 200 {models: 49, enabled: 0, visible: 49}
POST /api/local/opencode-v2/model-settings/apply
     {enabled:[minimax-m3.1-flash, glm-5.3, qwen3.8-flash]}
                                                      -> 200 visible: exactly those 3
# isolated cordis.patch.yml gained dsh-opencode-v2-http.config.enabledModels (3 ids)
POST /api/local/opencode-v2/model-settings/measure    -> 200 in 19.4s
     {usable: 35, unavailable: 12, deprecated: 2}
```

First boot of the isolated copy failed with `cannot get property "connection" without inject`,
taking the whole `dsh-opencode-v2-http` entry down — fixed by declaring `connection` and `settings`
in `inject`. That failure would not have appeared in unit tests; the real mount caught it.

### 27.4 Test suite

```
$ (cd dsh-opencode-v2 && npm test)
ℹ tests 194
ℹ pass 194
ℹ fail 0
$ (cd dsh-opencode-v2 && npm run check)   # 11 files incl. lib/client.js
```

### 27.5 Defect found in the suite itself: not hermetic

An adapter built without a profile context resolves its catalog to `$DSH_HOME/cache/…`. This shell
exports the live `DSH_HOME`, so the same commit measured **0 failures** or **2–5 failures**
depending on environment, and a test run wrote `~/.dsh/cache/opencode-models.json` (removed; the
service cache at `~/.dsh/profiles/web/opencode-models.json` was untouched and belonged to the
service's own sync).

Fix: `test/setup-isolate.mjs` sets `DSH_HOME` to a fresh temp dir for every test process via
`node --import`, and the unreachable-control-plane test pins an explicit `catalogPath`. The suite
now passes identically with the live `DSH_HOME` exported, with it unset, and on repeated runs.

Status: applied in the workspace at `0.6.0`; live profile not modified (no `enabledModels` key yet).

## 28. v0.6.1 — the client half never activated (measured 2026-10-31)

### 28.1 Symptom

`dsh-web.service` was healthy (active since 23:34:03, `:3080` listening, `/` 401 without a token,
200 with one, every asset 200). The browser was not:

```
HARNESS
Failed to load plugins
@nolit/dsh-opencode-v2
web boot: 1 entry did not activate
@nolit/dsh-opencode-v2: failed
```

The body text is only the verdict — **one failed client entry blocks the whole shell**, so the
settings page, the chat and every other tab are unreachable. Reported as "dsh crashed after the
plugin install".

### 28.2 Root cause

`lib/client.js` (added in 0.6.0) declared the service list and used it, but never exported it:

```js
const inject = ['slots']                                  // 220
function apply(ctx) {
  ctx.slots.inject('settings.section', () => …)            // 221
}
exports.apply = apply                                     // 234
exports.OpenCodeModelSection = OpenCodeModelSection        // 235
Object.defineProperty(exports, 'default', { value: { apply } })
```

The loader injects only what `module.exports.inject` lists. With no exported `inject`,
`ctx.slots` is `undefined`, `apply()` throws, the fibre lands in `failed`, and `BZ()` in
`assets/index-*.js` prints `failed` **without any detail** — nothing reaches the journal, so the
server side looks clean.

### 28.3 Why 0.6.0's verification missed it

§27.4 and §5.2.5 of the plan verified the *routes*: `model-settings` 200, `apply` 200, `measure` 200
in 19.4 s. None of those exercises client-half activation. `--dump-config` listed both rows,
the bundle served 200 with the registration present, and `node --check lib/client.js` passed.
Every check that was run could pass while the module was unloadable — the defect only appears at
`web boot:` in a browser.

### 28.4 Fix

```js
exports.inject = inject
Object.defineProperty(exports, 'default', { value: { apply, inject } })
```

plus a contract test (`test/bundle.test.mjs`) that evaluates the served module with a capture loader
and asserts the exported `inject` covers every `ctx.<service>` token used in `apply()` — the class of
bug this was, not just this instance.

Status: fix applied at `0.6.1` and **verified by a real mount** (2026-10-31 00:19 KST): service
restarted, browser boot renders the shell with no `web boot:` verdict and no console errors, and
Settings → OpenCode v2 renders all 49 routes. Suite: 195/195. The served artifact
`artifacts/nolit-dsh-opencode-v2-0.6.1.tgz` (`c6218cb8…a2bfd`) contains the exported `inject`.
