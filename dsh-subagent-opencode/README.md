# @nolit/dsh-subagent-opencode

OpenCode subagent provider for DeepSeek Harness.

## What it is

A `ctx.subagents` provider plus the shared delegation tool bound to it:

| Row | Role |
|---|---|
| `@nolit/dsh-subagent-opencode` | registers the `opencode` provider |
| `@deepseek-ai/dsh-tool-subagent` | binds the shared tool as `subagent_opencode` |

The model-facing `subagent_opencode` tool starts an independently managed child, returns its id immediately, and reports the final answer when it settles.

## Behavior

- One `opencode run` process per delegation, in the child's `cwd`
- Prompt goes to stdin (a flattened transcript can exceed the argv cap)
- Output is parsed from the `--format json` NDJSON stream; only assistant `text` parts are kept, so reasoning and tool traffic stay out of the parent session
- `dispose()` terminates the process and awaits settlement
- Cancellation follows the request signal; a timeout reports `stopReason: error`

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `opencode` | Registry name on `ctx.subagents`; unique per mounted instance |
| `opencodePath` | `opencode` | Executable name or absolute path |
| `model` | `opencode-go/beam-free` | Route in `provider/model#variant` form |
| `agent` | `''` | Optional OpenCode agent name |
| `auto` | `true` | Auto-approve permissions the run does not explicitly deny |
| `timeoutMs` | `900000` | Hard budget per delegation |
| `disposeGraceMs` | `5000` | Termination grace before the process is signalled |
| `env` | `{}` | Extra child environment layered over the parent environment |

## Isolation

`inheritsParentContext = false` with every start capability `false`, matching the shipped ACP provider: the child starts fresh and the seam enforces no `agentOptions`, `agentPreset`, `outputSchema`, or depth limit at start.

## Requirements

- `opencode` installed and authenticated; this plugin never handles credentials
- A route your account can actually run — a free-tier route reports its quota error through `stopReason: error` and a bounded diagnostic
- The bundle installed in the profile (`pnpm add link:<dir>`) and listed in `dsh.profile.bundles`
