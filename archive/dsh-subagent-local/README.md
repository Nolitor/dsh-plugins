# @nolit/dsh-subagent-local — experimental local-CLI delegation

<!-- skeleton:
version: 1.0
kind: readme
status: active
updated: 2026-11-05
summary: Operator manual for the experimental delegate_local tool (agy, opencode, codex, claude backends), its config, prompt transport, artifacts and collision-yield policy.
-->

> ## ⚠️ ARCHIVED / SUPERSEDED — do not install this package
>
> Absorbed into `@nolit/dsh-antigravity` (synchronous `agy_cli` batch tool, `cliBatch`) and
> `@nolit/dsh-opencode-v2` (the `cli_worker` per-backend gates and measured run facts), per owner
> decision 1(a) 2026-11-07. Archived 2026-11-07; removed from the live `web` profile.


Experimental DeepSeek Harness tool plugin. It runs **one self-contained task to completion in one
isolated local coding CLI** and returns the answer text plus exit, usage and artifact metadata:
a CLI-worker the model can call when no integrated provider is mounted for a backend.

| | |
| :--- | :--- |
| Tool | `delegate_local` (configurable; reserved names never claimed) |
| Backends | `antigravity` (`agy`), `opencode`, `codex`, `claude`; `auto` picks the first resolvable |
| Registers | **only the tool** — no subagent provider, no command, no HTTP route, no client half |
| Version | `0.0.1-rc.1` |
| Status | experimental; see [COMPATIBILITY.md](COMPATIBILITY.md) for the `subagent_oar` verdict |

## Why it exists

The rc.1 line ships integrated delegation (`dsh-subagent-codex`, `dsh-subagent-claude-code`,
`ctx.subagents` providers) and the experimental `subagent_oar` tool delegates to Codex/Claude
through OAR. Those surfaces are asynchronous activations: the tool returns a child id and the answer
arrives in a completion notice, and they need their own provider rows.

`delegate_local` covers the remaining shape: **one call = one CLI process = the answer in the
result**, with the process exit facts, bounded stdout, and hashed artifacts. It is useful for
Antigravity/OpenCode, for a machine where only the raw CLI is installed, and for diagnostics where a
synchronous exit code matters.

## Install (isolated profile first)

```sh
# from a checkout
dsh plugin --profile web add link:/path/to/dsh-subagent-local
```

The package declares `dsh.bundle.patch`, so `dsh plugin add` appends
`@nolit/dsh-subagent-local` to `dsh.profile.bundles`. Do not add it to the live profile without the
owner's approval; the tracked verification builds an isolated `DSH_HOME` instead
([VERIFICATION.md](VERIFICATION.md)).

## Configuration

Full defaults are in [cordis.patch.yml](cordis.patch.yml). Fields read at registration time:
`enabled`, `toolName`, `yieldToMountedTool`. Everything else is read live per call.

| Field | Default | Meaning |
| :--- | :--- | :--- |
| `enabled` | `true` | Mount switch. A `when` condition also hides the tool from a step while `false`. |
| `toolName` | `delegate_local` | Model-facing tool name. Must stay unique in the profile. |
| `backend` | `auto` | Default backend; `auto` walks `autoOrder`. |
| `autoOrder` | `[antigravity, opencode, codex, claude]` | Resolution order for `auto`. |
| `yieldToMountedTool` | `true` | Yield (mount without registering) when the name is taken or reserved. |
| `yieldToProviders` | `{}` | Map e.g. `{ codex: oar-codex }` to report a mounted provider instead of spawning a second CLI. |
| `timeoutMs` | `600000` | Hard deadline per call. |
| `maxOutputBytes` | `8388608` | Per-stream collected-output bound; a lossy read sets `truncated`. |
| `artifactLimit` | `100` | Maximum collected artifacts reported. |
| `artifactDir` | `''` | Optional cwd-relative directory for per-run `stdout.txt`, `stderr.txt`, `result.json`. |
| `disposeGraceMs` | `5000` | Termination grace passed to the subprocess seam. |
| `locale` | `en` | Result text language: `en` or `ko`. `ko` is used only when selected; the model-facing description stays English. |
| `forwardEnv` | PATH, HOME, USER, SHELL, TERM, LANG, LC_ALL, XDG_*, GEMINI_CONFIG_DIR, GOOGLE_APPLICATION_CREDENTIALS, CLAUDE_CONFIG_DIR, CODEX_HOME | Environment entries copied to the child. Credential-shaped names are **not** forwarded by default; add one explicitly if a CLI needs it. |
| `backends.<id>` | path, model, effort, mode, timeoutMs, auto, extraArgs, enabled | Per-backend overrides. `timeoutMs: 0` inherits the global value. |

Default backend values: antigravity `agy` / `gemini-3.8-flash-low` / `low` / `accept-edits`;
opencode `opencode`; codex `codex`; claude `claude` (the latter three use the CLI's own defaults).

## Tool contract

Parameters: `task` (required), `cwd` (absolute; defaults to the calling session's working
directory), `backend`, `model`, `effort`, `mode`, `timeoutMs`, `collect` (glob list).

The canonical result is JSON with a fixed shape: `ok`, `backend`, `executable`, `model`,
`promptTransport`, `exitCode`, `signal`, `timedOut`, `truncated`, `elapsedMs`, `promptBytes`,
`usage.{inputTokens,outputTokens,thinkingTokens,cacheReadTokens}`, `summary`, `diagnostic`,
`errorKind`, `yieldedProvider`, `stderrTail`, `artifacts[{path,bytes,sha256}]`, `missing`, `skipped`,
`artifactDir`.

Failure rules:
- A missing executable, spawn failure, non-zero exit, CLI-reported error, or deadline produces a
  result with `ok: false` and a diagnostic — the tool does not throw for runtime failures.
- A missing/relative `cwd`, an empty task, or an unknown backend throws a caller error before any
  process starts.
- `mode: plan` (agy) is a real run that writes nothing; it is reported as a success with the plan
  text. Do not treat it as a completed edit.

## Prompt transport (measured)

The task text is delivered over **stdin for opencode, codex and claude**, so it never appears in a
process list and is not bounded by the kernel argument limit.

`agy` is the measured exception: its print mode ignores stdin (`-p -` reads an empty prompt), so the
task rides beside `-p` in argv and is capped at 131,071 bytes; an overlong task is rejected with
guidance before the CLI starts. See [COMPATIBILITY.md](COMPATIBILITY.md) §6.

## Collision policy

Two plugins registering the same tool or provider is a hard mount failure. This package:

1. registers **no** `ctx.subagents` provider and no command, so provider names (`codex`,
   `claude-code`, `oar`, `antigravity`, `opencode`) are never claimed;
2. checks `ctx.tools.get(toolName)` before registering and **yields** (mounts without the tool) when
   the name is already taken;
3. refuses to claim known delegation names (`subagent_oar`, `subagent`, `subagent_*`) even when they
   are not currently mounted;
4. can yield per backend to an already-mounted provider through `yieldToProviders`.

A yield is logged as a warning and is not an activation failure: the profile keeps booting.

## Tests

```sh
npm test   # node --check is not part of this script; run it separately
```
