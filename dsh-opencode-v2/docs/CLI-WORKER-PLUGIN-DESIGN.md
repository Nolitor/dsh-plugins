<!-- skeleton:
version: 2.0
kind: design
status: implemented
updated: 2026-10-29
summary: The built-in `cli_worker` tool inside @nolit/dsh-opencode-v2 — role split between the HTTP conversation pipeline and one-shot CLI batch workers (OpenCode, Codex, Claude Code), with the tool contract, isolation, artifact collection, and verification plan for an internal module rather than a separate plugin.
-->

> Status: **implemented** (v0.3.4) · Scope: `@nolit/dsh-opencode-v2/lib/workers/**` ·
> Evidence: `dsh-opencode-v2/VERIFICATION.md` §19–§21.

## 1. Role split

| Concern | Owner |
|---|---|
| Chat, streaming, reasoning, model catalog | `lib/http.js` (`opencode-http-agent`) — the only conversation route |
| Tool-calling agent loop | DSH `dsh-agent` (unchanged) |
| One-shot isolated work (file edits, batch scripts, build/test) | the `cli_worker` tool in `lib/workers/` |
| Background scheduling of those workers | `dsh-jobs-local` (existing seam) |

The CLI is **not** a conversation fallback. A/B measured two structural reasons:
`opencode run --format json` delivers whole blocks (no deltas → TTFT equals the
full generation) and every generation spawns a process. Both are acceptable for a
batch worker and unacceptable for chat.

## 2. Why one package

The worker and the HTTP route are the same dependency: both parse OpenCode v2
surfaces and must move together when that surface changes. A second package
(`@nolit/dsh-cli-workers`) adds a profile row, an install dependency, and a
version pair to keep in sync for no isolation benefit — the tool already runs
each task in its own child process.

Integration point: `lib/index.js` `apply()` calls `registerCliWorker(ctx, config)`
after registering the `opencode` tool. One profile row (`dsh-opencode-v2`) enables
the delegation tool, the `/ocode` command and `cli_worker` together. There is no
`/worker` command: `workerEnabled` gates the `cli_worker` tool alone.

## 3. Module layout

| File | Responsibility |
|---|---|
| `lib/workers/backends.js` | backend table: executable, `argv(options)`, `parse(stdout)` |
| `lib/workers/artifacts.js` | glob → RegExp, bounded walk, sha256, `limit`/`missing` reporting |
| `lib/workers/run.js` | cwd validation, env allow-list, spawn, stdin delivery, timeout, result |
| `lib/workers/index.js` | parameter map, output schema, renderer, tool registration |

Each backend is data, not a class, so `argv`/`parse` are unit-testable without the
real binary.

## 4. Tool contract

Input (`parameters()`):

| Field | Type | Meaning |
|---|---|---|
| `task` | string, required | Natural-language instruction; passed on stdin, never argv (128 KiB `MAX_ARG_STRLEN`) |
| `backend` | `"opencode" \| "codex" \| "claude"` | Worker executable family; defaults to `workerBackend` |
| `cwd` | string, required | Absolute directory the worker may modify; a relative path is rejected before spawn |
| `model` | string? | Backend-specific route |
| `timeoutMs` | number? | Hard budget (default `workerTimeoutMs`, 15 min) |
| `collect` | string[]? | Globs relative to `cwd`; matches are hashed and returned |

Output (`outputSchema()`):

`{ ok, backend, exitCode, timedOut, truncated, summary, artifacts: [{path, bytes, sha256}], missing, skipped, inputTokens, outputTokens, stderrTail }`

`summary` is the worker's final message (bounded), never its stream; the
conversation never sees intermediate steps. `missing` names every glob that
matched nothing. `skipped` counts matches dropped by `workerArtifactLimit`.

## 5. Isolation and lifecycle

- One process per invocation through `ctx.subprocess.spawn` — the same seam the
  `opencode` tool uses.
- Working directory must be absolute and an existing directory; artifacts resolve
  strictly inside it, and a deleted file is not reported as a phantom artifact.
- `env`: only the mounted `forwardEnv` allow-list; the subprocess service scrubs
  credential-shaped names from the parent base before merging it.
- Cancellation: the tool `signal` maps onto the spawn signal; a cancelled call
  returns `ok: false` with the process exit facts.
- Output caps: `workerMaxOutputBytes` per stream (tail kept, `truncated` reports
  loss); stderr is reduced to a 4,000-character tail for diagnostics.
- Network confinement is **not** this tool's: it forwards no credentials, but a
  child that needs real confinement belongs under `dsh-sandbox`.

## 6. Backend adapters

| Backend | argv | Parser |
|---|---|---|
| `opencode` | `run --format json --thinking --auto [-m model]` | `JsonRunParser`: assembled text parts; `step_finish` sums usage |
| `codex` | `exec --json --skip-git-repo-check - [--model model]` | JSONL: last `item.completed` `agent_message`; `turn.completed.usage` |
| `claude` | `-p --output-format json [--model model]` | result envelope `{result, usage}`; raw text when the envelope is absent |

`opencode` is the measured v2.2.0 surface. `codex`/`claude` follow their
documented one-shot modes and degrade to the raw tail when the envelope is not
recognised — an unparsed success still returns the text rather than an empty
summary.

## 7. Out of scope

- Streaming to the conversation; the worker returns only its result.
- Model listing: workers do not participate in `session/modelCatalog`.
- Automatic fallback or retry: a failed worker returns its exit facts; the caller
  decides.

## 8. Verification

1. Unit (`test/workers.test.mjs`): argv builders, all three parsers, schema/backend
   sync, renderer branches, glob syntax.
2. Contract: a stub subprocess service runs a real node child to prove stdin
   delivery, artifact collection (byte count + sha256), timeout termination, and
   relative-`cwd` rejection.
3. Real: `opencode run` through `cli_worker` after the next host restart.
