# @nolit/dsh-subrouter

<!-- skeleton:
version: 1.1
kind: readme
status: archived
updated: 2026-11-06
summary: Implementation detail for @nolit/dsh-subrouter. Root record and open defects: ../OPENCODE-MODEL-SERVING-PLAN.md
-->

>
> ## ⚠️ ARCHIVED / SUPERSEDED — do not install this package
>
> **Retired 2026-11-06** by owner instruction (*"dsh-subrouter는 폐기 처리"*). This package is
> **superseded by `@nolit/dsh-opencode-v2/http`**, which is mounted in the live `web` profile
> (`opencode-http-agent`) and serves the model-route surface this package registered through
> `ctx.llm.registerAdapter()`. This package was already recorded as
> *decommissioned* in [docs/DSH-HARNESS-POLICY.md](../../docs/DSH-HARNESS-POLICY.md) on
> 2026-10-30 while the directory stayed in the active tree; that gap is F-50, and this move
> closes it.
>
> Measured before the move (2026-11-06): installed in `verify-subrouter` only — not in `web`;
> 0 active tracks imported it; its 12 tests passed; it was the only track in the tree that
> implemented the `anthropic-messages` wire protocol, and the live profile does not use that
> protocol (`agent-default-model` = `opencode-http-agent` / `opencode-go/deepseek-v4.1-flash`).
>
> The code is kept as history. `node scripts/check-disposal-safety.mjs` asserts it stays gone
> from every profile and from every importer.


Adds one or more OpenAI/Anthropic-compatible model routes to DSH without
editing `dsh-llm-pi-ai` or any canonical DSH package.

```text
DSH AgentLoop
  ├─ existing provider: opencode-go          (dsh-llm-pi-ai)
  ├─ subrouter-openai:  openai-completions
  └─ subrouter-anthropic: anthropic-messages
```

The plugin calls `ctx.llm.registerAdapter()` in `apply()` and uses
`ctx.effect()` to release every registration when the plugin is unloaded. Tool
execution remains in DSH: these adapters only translate model stream chunks and
emit `tool-call-delta`; they never execute a tool themselves.

## Protocol support

- `openai-completions` — OpenCode Go, OpenRouter, DeepInfra, and compatible gateways
- `anthropic-messages` — Anthropic Messages API and compatible gateways

Anthropic Messages is a model wire protocol. MCP is a separate tool/context
transport and is not required for this adapter.

## Route configuration

`cordis.patch.yml` ships two routes. Each route can override `provider`,
`displayName`, `protocol`, `baseURL`, `apiKeyEnv`, `sessionHeader`, and `models`.
The top-level fields are inherited defaults.

For a native Anthropic API route, set:

```yaml
protocol: anthropic-messages
baseURL: https://api.anthropic.com/v1
apiKeyEnv: ANTHROPIC_API_KEY
sessionHeader: ''
```

For OpenRouter or DeepInfra, use `protocol: openai-completions` and that
provider's OpenAI-compatible base URL.

## Lifecycle

- Plugin load: every configured route appears alongside existing routes.
- Plugin unload: all route registrations are released atomically.
- A session already pinned to a removed subrouter route must be switched back to
  an existing model before the plugin is disabled.
