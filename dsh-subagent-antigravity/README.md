# @nolit/dsh-subagent-antigravity

Antigravity (`agy`) subagent provider for DeepSeek Harness.

## What it is

A `ctx.subagents` provider, not a chat tool of its own. Its bundle adds two rows:

| Row | Role |
|---|---|
| `@nolit/dsh-subagent-antigravity` | registers the `antigravity` provider |
| `@deepseek-ai/dsh-tool-subagent` | binds the shared delegation tool as `subagent_antigravity` |

The model-facing `subagent_antigravity` tool starts an independently managed child run, returns its id immediately, and reports the final answer when it finishes.

## Behavior

- One `agy` process per delegation, in the child's `cwd`
- Prompt is `ContentBlock[]` text joined with newlines
- Final answer is the CLI's `response` text; reasoning, tool traffic, and usage stay out of the parent session
- `dispose()` terminates the process and awaits settlement
- Cancellation follows the request signal; a timeout is a timeout, reported as `stopReason: error`

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `antigravity` | Registry name on `ctx.subagents`; unique per mounted instance |
| `agyPath` | `agy` | Executable name or absolute path |
| `model` | `gemini-3.8-flash-low` | Model id; `agy` encodes the reasoning level in the id suffix |
| `effort` | `low` | Sent only when the model id does not already encode a level |
| `mode` | `accept-edits` | `accept-edits` \| `auto` \| `plan` |
| `timeoutMs` | `900000` | Hard budget per delegation |
| `disposeGraceMs` | `5000` | Termination grace before the process is signalled |
| `env` | `{}` | Extra child environment layered over the parent environment |

## Isolation

`inheritsParentContext = false` and every start capability is `false`, matching the shipped ACP provider: an out-of-process child starts fresh, and the seam enforces none of `agentOptions`, `agentPreset`, `outputSchema`, or depth limits at start.

## Requirements

- `agy` installed and authenticated; this plugin never handles credentials
- The bundle must be installed in the profile (`pnpm add link:<dir>`) and listed in `dsh.profile.bundles`
