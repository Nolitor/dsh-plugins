# @nolit/dsh-antigravity-cli

> ## ⚠️ ARCHIVED / SUPERSEDED — do not install this package
>
> This package was **absorbed into `@nolit/dsh-antigravity`** on 2026-11-05 and moved to
> `archive/` on the owner's instruction: same owner instruction: the absorbed CLI surface lives in the merged package
>
> | | |
> | :--- | :--- |
> | **Replacement** | `@nolit/dsh-antigravity` |
> | **Surface now in the replacement** | `/agy` command and `agy_worker` tool |
> | **Measured state (2026-11-05)** | the merged package exports `/agy` and `agy_worker`; this track is absent from the profile `dependencies`, from `dsh.profile.bundles`, and contributes **0** rows to `dsh --profile web --dump-config` |
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
> | **Surfaces now in the replacement** | `/agy` command, `agy_worker` tool |
> | **Why** | The owner asked for one package per vendor so a single install carries every surface. Two packages registering the same names cannot coexist: a duplicate `ctx.subagents.registerProvider` name **silently shadows** the other, and a duplicate tool or command name **aborts the whole plugin row**. |
> | **What to do** | Install `@nolit/dsh-antigravity` instead. If this package is still mounted, remove its bundle row: the replacement detects the duplicate provider with `getProvider()` and yields with a warning rather than shadowing. |
>
> The code here still works and still passes its own tests; it is not broken, only superseded.
> See the replacement CHANGELOG for the merge record.

Antigravity (`agy`) CLI worker tool for DeepSeek Harness — the "Antigravity subagent" plugin.

## What it is

One tool, `agy_worker`, that runs **one isolated Antigravity CLI call per invocation**. The worker sees only the task text the caller passes (never the host conversation) and returns its final message plus any collected artifacts. Defaults: `gemini-3.8-flash-low` — gemini-3.8-flash with low thinking effort.

This is a **tool**, not an LLM provider route: no provider/model registration, no conversation streaming into the chat.

## Tool parameters

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `task` | string | yes | Complete instruction for the worker; it has no conversation context. |
| `cwd` | string | yes | Absolute directory the worker may modify. |
| `model` | string | no | `agy` model id. Defaults to config `model`. |
| `effort` | string | no | `low` \| `medium` \| `high` \| `xhigh` \| `max`. Defaults to config `effort`. |
| `timeoutMs` | number | no | Hard budget in milliseconds. Defaults to config `timeoutMs`. |
| `collect` | string[] | no | Globs relative to `cwd` returned as hashed artifacts. |

Result keys: `ok`, `exitCode`, `signal`, `timedOut`, `truncated`, `summary`, `conversationId`, `status`, `inputTokens`, `outputTokens`, `thinkingTokens`, `cacheReadTokens`, `stderrTail`, `artifacts[]`, `missing[]`, `skipped`.

## Configuration

```yaml
- insert:
    - id: dsh-antigravity-cli-worker
      name: '@nolit/dsh-antigravity-cli'
      config:
        agyPath: agy
        model: gemini-3.8-flash-low
        effort: low
        timeoutMs: 600000
        maxOutputBytes: 262144
        artifactLimit: 100
        workerEnabled: true
        forwardEnv: [PATH, HOME, USER, XDG_CONFIG_HOME, XDG_DATA_HOME, XDG_CACHE_HOME, GEMINI_CONFIG_DIR, GOOGLE_APPLICATION_CREDENTIALS]
        extraArgs: []
```

## Measured `agy` surface

`agy` 1.4.10, one-shot print mode:

```
agy -p "<task>" --model <model> --effort <effort> --output-format json
```

prints one JSON object:

```json
{"conversation_id":"…","status":"SUCCESS","response":"…","usage":{"input_tokens":10229,"output_tokens":2,"thinking_tokens":0,"cache_read_tokens":0}}
```

Two measured constraints drive the implementation:

1. **The prompt must ride beside `-p`.** `agy -p --model …` fails with `-p took "--model" as its prompt, so the intended prompt was left as an argument and ignored`, and the turn is not executed.
2. **Usage is per call here.** Unlike the stream-json multi-turn worker, one print-mode call reports its own `usage`, so no cumulative-to-delta subtraction is needed.

## Install

The bundle declares `dsh.bundle.patch`, so a profile installs it like any other out-of-tree bundle:

```bash
cd ~/.dsh/profiles/<profile>
pnpm add link:/absolute/path/to/dsh-antigravity-cli-worker
```

then add `@nolit/dsh-antigravity-cli` to `dsh.profile.bundles` in that profile's `package.json`.

Using `link:` (not `file:`) keeps the profile entry a symlink, so the plugin's own `node_modules` — where `@deepseek-ai/schemastery` and friends resolve — is used exactly as for the other `@nolit` plugins.

## Requirements

- `agy` installed and already authenticated (this plugin never handles credentials).
- `@deepseek-ai/schemastery` imported as the **default export**; the package has no named `Schema` export.

## References

- `../dsh-opencode-v2/` — the worker tool pattern this follows (`defineTool`, `ctx.subprocess.spawn`, artifact collection).
- `/.agents/skills/dsh-prose-standard/` and DSH docs `docs/cookbook/adding-a-package.md` for plugin display metadata.