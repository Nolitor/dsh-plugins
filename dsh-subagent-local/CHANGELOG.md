# Changelog — @nolit/dsh-subagent-local

<!-- skeleton:
version: 1.0
kind: report
status: active
updated: 2026-11-05
summary: Engineering history for the experimental local-CLI delegation plugin: rc.1 surfaces, the Invalid-effect activation defect found and fixed during the isolated boot, and the subagent_oar compatibility verdict.
-->

Current version: `0.0.1-rc.1`

Version policy: the owner normalized every `@nolit` track to `0.0.1-rc.N`; this is a new track, so
it starts at `0.0.1-rc.1`. Versions are owner-owned; do not bump without instruction.

## 0.0.1-rc.1 — experimental local-CLI delegation + `subagent_oar` compatibility report — 2026-11-05

New track. Created after the owner asked for an experimental tool that delegates independent work
to Antigravity, OpenCode CLI, Codex/Claude local CLIs, and asked to check compatibility with
@tianyicui's `subagent_oar` feature (DSH `0.2.2-rc.1` release note).

### What was added

| Surface | Detail |
| :--- | :--- |
| Tool | `delegate_local` (one canonical JSON result: text + exit/usage/artifact facts). Reserved names always yield; `delegate_local` is unique in the measured profile. |
| Backends | `antigravity` (`agy`), `opencode`, `codex`, `claude`; explicit argv builder per backend; `auto` resolution order with a measured per-candidate failure report. |
| Prompt transport | stdin for opencode/codex/claude; argv beside `-p` for `agy` (measured: print mode ignores stdin, 131,071-byte argv cap enforced before spawn). |
| Process control | one child per call, deadline, bounded stdout/stderr, termination grace, forwarded-environment allowlist (credentials not forwarded by default). |
| Artifacts | glob collection with sha256/bytes, `missing[]` and `skipped` accounting; optional cwd-relative `artifactDir` writing `stdout.txt`/`stderr.txt`/`result.json` per run. |
| Locale | English tool description always; localization of rendered result text only when `locale: "ko"` (English fallback for any other value). |
| Bundle | `cordis.patch.yml` with one row; `dsh.manifestVersion: 1`; `dsh.bundle.patch`; `icon.svg` + `./icon.svg` export; `locale/*.json` exports; no client half. |
| rc.1 compliance | `engines.node >= 24.9`; `engines.dsh >= 0.2.2-alpha.2 < 0.3.0`; Cordis peer `^4.1.0`; `defineTool({ output: { schema, render } })`; step activation via `ToolRegistrationOptions.when`; no `tools.resolve`/`tools.executable` reads. |
| Collision policy | registers no provider and no command; yields instead of hard-failing when the tool name is taken or reserved; optional `yieldToProviders` backend→provider yield. |
| Docs | `README.md`, `COMPATIBILITY.md` (exact npm artifacts/versions/sha256 + verdict), `VERIFICATION.md`, this changelog. |

### Defect found and fixed during verification

The first isolated rc.1 boot reported:

```text
dsh: warning: 1 entry did not activate
dsh-subagent-local (@nolit/dsh-subagent-local): TypeError: Invalid effect
    at safeCollect (.../cordis/lib/index.js:434:42)
    at async Fiber._reload (.../cordis/lib/index.js:677:41)
```

| Before | After |
| :--- | :--- |
| `apply()` was `async` and returned the mount-state object. Cordis runs a plugin's `apply` as an effect: a resolved non-function object is rejected by `safeCollect` as `TypeError: Invalid effect`, so the row failed activation. | `apply()` returns `undefined`; the state-returning seam is exported as `mount()`. Re-boot: no `did not activate` warning, plugin card renders, 0 page errors. |
| Unit tests would not have caught it: they called `apply()` directly and read its return value, never through the Cordis effect runner. | Added a regression test asserting `await apply(...) === undefined`, plus the real isolated boot as the mount proof. |

### Measured compatibility result (summary; evidence in COMPATIBILITY.md)

- `subagent_oar` is `@deepseek-ai/dsh-experimental-tool-subagent-oar` (tool, default name
  `subagent_oar`) plus `@deepseek-ai/dsh-experimental-subagent-oar` (provider, default `oar`).
- Under rc.1 use `0.2.2-rc.1` (npm `next`); `latest` `0.2.2-alpha.2` declares Cordis
  `~4.0.6-alpha.1` and DSH peers `0.2.2-alpha.2` and is peer-incompatible with the installed
  runtime. Neither is installed in the rc.1 base tree (measured).
- Registration-level compatibility: **compatible** — no shared tool/provider/command name.
- Combined mount with OAR + this package: **UNVERIFIED** (OAR not installed; native `codex`/`claude`
  CLIs absent on this host).
- Official `dsh-subagent-codex` / `dsh-subagent-claude-code` rc.1 bundles register
  `subagent_codex` / `subagent_claude_code` tools and `codex` / `claude-code` providers; this
  package claims neither name.

### Unverified / follow-ups

- `opencode`, `codex`, `claude` adapters are **UNVERIFIED-LOCALLY** (binaries absent); only `agy`
  (1.5.0) is installed on this host.
- Combined OAR + local-delegation boot, and OAR's non-Codex/Claude runtimes, are unverified.
- The plugin is **not** installed in the live profile; verification used an isolated `DSH_HOME`.
