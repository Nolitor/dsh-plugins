# staging/ — code held for a later stage, never installed

This directory holds work that is **not** part of any installed plugin. Nothing here is
mounted, packed, or imported by a shipped package; it exists so a staged change can be
recovered instead of rewritten.

| Path | Contents | Origin |
|---|---|---|
| `opencode-v2-stage2/lib/canonical-tokens.js` | DeepSeek V4/V4.1 special-token table, extracted from `deepseek-recipe` by code point | `@nolit/dsh-opencode-v2-beta` `0.0.2-beta.1` (removed 2026-11-04) |
| `opencode-v2-stage2/lib/protocol-parser.js` | Staged protocol parser modelled on recipe's `OutputParser` | same |
| `opencode-v2-stage2/lib/conformance.js` | 7-case conformance corpus + re-chunking invariance oracle | same |
| `opencode-v2-stage2/test/conformance.test.mjs` | The oracle's own tests | same |

The beta package that carried this code was deleted because it registered the same tool,
commands, worker and model route as the stable package (mandatory mutual exclusion) and its
plugin card had no title, so the operator could not tell the two apart. The **code** was
worth keeping; the **package** was not.

Reinstating any file here means moving it into `dsh-opencode-v2/lib/` under the stage plan
in `docs/OPENCODE-V2-STAGE-PLAN.md`, with that plan's acceptance gates satisfied first.
