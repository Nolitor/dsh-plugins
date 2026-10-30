# @nolit/dsh-subrouter

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
