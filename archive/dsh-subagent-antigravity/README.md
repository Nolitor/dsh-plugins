# @nolit/dsh-subagent-antigravity

<!-- skeleton:
version: 1.0
kind: readme
status: archived
updated: 2026-11-05
summary: @nolit/dsh-subagent-antigravity absorbed into @nolit/dsh-antigravity.
-->


> ## ⚠️ ARCHIVED / SUPERSEDED — do not install this package
>
> This package was **absorbed into `@nolit/dsh-antigravity`** on 2026-11-05 and moved to
> `archive/` on the owner's instruction: "이미 서브에이전트는 안티그래비티에 통합되어 서비스 되고 있는데 … 서브에이전트도 아카이브에 들어가야 하는거 잖아" (owner, 2026-11-05)
>
> | | |
> | :--- | :--- |
> | **Replacement** | `@nolit/dsh-antigravity` |
> | **Surface now in the replacement** | the `antigravity` subagent provider (`subagent_antigravity` tool row plus `lib/subagent.js`) |
> | **Measured state (2026-11-05)** | provider `antigravity` is registered by `@nolit/dsh-antigravity/lib/index.js`; a live boot composes the single `tool-subagent-antigravity` row from that package; this track contributes **0** rows and is not in the profile |
> | **Why it cannot be reinstalled alongside the replacement** | the merged package already registers the same provider/tool names; a duplicate tool name aborts the whole plugin row and a duplicate provider name silently shadows (docs/RULES.md §4, docs/PLUGIN-CONSOLIDATION.md) |
> | **What to do** | Nothing. Read it as history. Install `@nolit/dsh-antigravity`. |
>
> Its tests still pass; it is superseded, not broken.

> ## ⚠️ SUPERSEDED — do not install this package
>
> This package was **absorbed into `@nolit/dsh-antigravity`** on 2026-11-05.
> It is kept only as the historical record of what shipped before the merge.
>
> | | |
> | :--- | :--- |
> | **Replacement** | `@nolit/dsh-antigravity` |
> | **Surfaces now in the replacement** | `subagent_antigravity` provider |
> | **Why** | The owner asked for one package per vendor so a single install carries every surface. Two packages registering the same names cannot coexist: a duplicate `ctx.subagents.registerProvider` name **silently shadows** the other, and a duplicate tool or command name **aborts the whole plugin row**. |
> | **What to do** | Install `@nolit/dsh-antigravity` instead. If this package is still mounted, remove its bundle row: the replacement detects the duplicate provider with `getProvider()` and yields with a warning rather than shadowing. |
>
> The code here still works and still passes its own tests; it is not broken, only superseded.
> See the replacement CHANGELOG for the merge record.

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