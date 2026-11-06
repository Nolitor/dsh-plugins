# Route benchmark

<!-- skeleton:
version: 1.0
kind: readme
status: active
updated: 2026-10-30
summary: Isolated per-route benchmark for DSH model routes; metrics, usage, and known limits.
-->


Compares DSH model routes end to end on the same task.

```bash
node dsh-subrouter/bench/dsh-bench.mjs \
  --routes subrouter-openai/deepseek-v4.1-flash,subrouter-anthropic/claude-haiku-5-5 \
  --runs 3 --json bench/result.json
```

Each run boots an isolated `dsh headless` process against the `bench` profile
(created once from the shipped headless template), pinned to one route through a
temporary `--patch` overlay. No live profile is edited.

## Metrics

| metric | source | meaning |
|---|---|---|
| `ok` | run exit + call/result match | route completed the task with every tool call answered |
| `wallMs` | wall clock | whole process, includes DSH boot |
| `ttftToolMs` | `turn/start` → first `tool/call` | first model decision latency |
| `steps` | `step/start` count | model round trips |
| `calls` / `results` / `matched` | `tool/call`, `tool/result` | DSH-owned execution fidelity |
| `inTok` / `outTok` / `cacheTok` | `assistant/message` usage | adapter usage mapping |
| `finish` | `turn/end` reason | completion vs error |
| `diagnostics` | tokeneconomizer | agent/root delivery of `tools/result` and `tools/post-execute` |

## Notes

- `deepseek-account` needs an in-process sign-in; a headless subprocess cannot
  reach the account token, so it reports `ACCOUNT_SIGN_IN_REQUIRED`. Measure it
  from the running web server instead.
- Anthropic-route input tokens are larger because Anthropic counts the system
  prompt and tool schemas separately from cache reads.
