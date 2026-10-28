# GROUP {{GROUP}} — capsule

> Resident budget: **≤400 tokens**. This file is injected once per group and
> shared by every sub-module. Never copy it into a sub-module.

Control tower: `{{GROUP}}-00-{{MAIN}}`
Purpose: shared invariants, module index, and tool pointers for `{{GROUP}}`.

## Invariants
1. **Title is the source of truth; path is derived.** Never treat a directory name as identity.
2. **Grouping is metadata** (`groups.json`). The filesystem stays flat siblings.
3. **Live sessions are never moved.** Use `handoff` (new id, `parentSession`).
4. **No cross-group fork.** Forking a session across a group boundary re-bills the
   parent transcript (`session-log.mjs` copies every event frame).
5. **Record-level rollback only.** Never restore `workspace.json` wholesale.

## Sub-modules
{{MODULES}}

## Master specifications
{{SPECS}}

## Tools
Reference by ID from `docs/shared/TOOL-REGISTRY.md`. Never paste a schema.
