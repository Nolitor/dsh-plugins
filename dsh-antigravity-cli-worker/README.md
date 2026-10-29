# @nolit/dsh-antigravity-cli-worker

Antigravity (agy) CLI worker tool plugin for DeepSeek Harness.

## Purpose
Provides a dedicated CLI worker tool `agy_worker` that uses the official `agy` CLI to run simple, isolated tasks. Optimized for quick/simple tasks using `gemini-3.8-flash-low` with low thinking effort by default.

## Tool: `agy_worker`
- **prompt** (required): Task text to send to worker
- **cwd** (required): Absolute working directory
- **model** (optional): Override model (default: `gemini-3.8-flash-low`)
- **effort** (optional): Reasoning effort `low|medium|high|xhigh|max`
- **timeoutMs** (optional): Timeout
- **artifacts** (optional): Glob patterns to collect files

Returns: `{ok, summary, usage{inputTokens,outputTokens,thinkingTokens,cacheReadTokens}, conversationId, artifacts, ...}`

## Installation
This is a local plugin in the DSH plugins workspace. Load via bundle patch or add to cordis config.

## Configuration (cordis.patch.yml)
```yaml
- insert:
  - id: dsh-antigravity-cli-worker
    name: '@nolit/dsh-antigravity-cli-worker'
    config:
      agyPath: 'agy'
      model: 'gemini-3.8-flash-low'
      effort: 'low'
      timeoutMs: 600000
```

## Notes
- Uses one-shot `agy -p ... --output-format json` mode (simple, fast)
- For multi-turn conversations, the stream-json worker pattern is better (like Hermes) - this is optimized for simple isolated tasks
- Requires `agy` CLI installed and authenticated
- Tested with agy v1.4.10

## References
- [dsh-opencode-v2 cli_worker](../dsh-opencode-v2/) - pattern reference
- [Core-02-HUB Antigravity docs](../../../../Workspace/projects/Core-02-HUB/docs/unified-ai-hub/sources/antigravity/)
- Hermes antigravity plugins for more advanced patterns
