<!-- skeleton:
version: 1.0
kind: readme
status: active
updated: 2026-11-04
summary: Beta track for @nolit/dsh-opencode-v2 — a canonical DeepSeek V4/V4.1 special-token state machine parser (Tier B) derived from deepseek-ai/deepseek-recipe, plus a recipe-derived conformance and re-chunking oracle (Tier C). Ships unmounted and enforces mutual exclusion with the stable package.
-->

# @nolit/dsh-opencode-v2-beta

The beta track. It carries the two changes the stable package cannot take without
altering its parse path, and it enforces mutual exclusion with the stable package
because both claim the same route, tool and commands.

| | |
|---|---|
| Package | `@nolit/dsh-opencode-v2-beta` |
| Version | `0.0.2-beta.1` |
| Peer | `@nolit/dsh-opencode-v2` `~0.0.2` (guard is imported from it) |
| Status | **unmounted by default** |
| Ladder | `0.0.2-beta.1` → `-beta.2` … → promoted to `@nolit/dsh-opencode-v2` `0.0.3`; `0.0.2` then becomes the lower version |

## What it contains

| Tier | Module | Purpose |
|---|---|---|
| B | `lib/canonical-tokens.js` | The DeepSeek V4/V4.1 special-token table, extracted code point by code point from `deepseek-recipe-core/src/special_tokens.rs` |
| B | `lib/protocol-parser.js` | A staged parser modelled on recipe's `OutputParser`: markers are plain+special segments, hold-back is bounded by the longest matched marker, unterminated blocks are dropped and reported |
| C | `lib/conformance.js` | The corpus plus the re-chunking oracle. Every case names the recipe source it came from |
| — | `lib/index.js` | Refuses to activate when the stable package is live; runs the self-check |

## Why a separate package

The stable plugin's classifier is a regex state machine with a 16-code-unit hold-back
and roughly 1,000 lines of repair code around it. Replacing it changes the parse path
for every live session, so the replacement is measured here first:

```bash
npm run conformance
# { "conformance": { "ok": true, "checked": 7 },
#   "invariance":  { "ok": true, "checked": 300 } }
```

Invariance means: the same bytes split into every fixed size and several random
splits produce the same parts in the same order.

## Mutual exclusion

Both packages register `opencode-http-agent`, the `opencode` tool and the same
commands, so both loaded is a broken profile, not a degraded one. The claim file is
authoritative (both packages share the provider id, so its presence cannot name an
owner); the runtime check covers the shared tool name. See the stable README section
"Mutual exclusion with the beta package"; the implementation is shared
(`@nolit/dsh-opencode-v2/lib/exclusion.js`).

## Mounting it

```bash
# remove the stable row first — the claim file will refuse the second activation
dsh plugin --profile web remove @nolit/dsh-opencode-v2
dsh plugin --profile web add /home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-opencode-v2-beta
```

The beta package does not serve a route yet: it activates, verifies itself, and stays
out of the way. Enabling it as the served route is a separate, measured step.
