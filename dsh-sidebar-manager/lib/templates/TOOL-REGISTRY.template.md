# Shared tool registry (IDs only — no schemas)

> Budget: **≤120 tokens**. Schemas are resolved at call time by the runtime.
> Never paste a JSON schema into an AGENTS.md or capsule.

| ID | Purpose (≤80 chars) | Entry |
|---|---|---|
| `session-log` | Read/verify DSH session logs | `lib/session-log.mjs` |
| `groups` | Group registry read/write | `lib/groups.mjs` |
| `batch-validate` | Pre-flight batch rename checks | `lib/batch-validate.mjs` |
| `hq-tree` | Control-tower tree derivation | `lib/hq-tree.mjs` |

Usage: `call tools.<id>`. Variants declare `{"extends":"<id>"}` — never a second copy.
