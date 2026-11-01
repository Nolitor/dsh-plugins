# Cross-Project Collaboration — dsh-plugins ↔ total_skill

<!-- skeleton:
version: 1.0
kind: spec
status: active
updated: 2026-11-02
summary: The shared interface contract between dsh-workspace/dsh-plugins and projects/total_skill — integration endpoints, boundary ownership, version handshake, duplicate-name gate, and the change protocol both repositories follow.
-->

> Status: active · Owner: both repositories · Contract version **1.0**
> This file is the single shared channel. `total_skill` carries a pointer to it in its `AGENTS.md`;
> neither side keeps a private copy of the contract.

## 0. Why this exists

The two projects are separate git repositories that are **joined at runtime**. The live profile
symlinks both into one DSH process:

```
~/.dsh/profiles/web/node_modules/@nolit/dsh-tokeneconomizer -> dsh-plugins/dsh-tokeneconomizer
~/.dsh/profiles/web/node_modules/@nolit/dsh-skill-interrupt -> projects/total_skill
```

Because both are `link:`, **a source edit in either repository is live on the next process start**.
Nothing in either repository's local rules can see the other, so the rules that span the boundary
live here.

## 1. Ownership map

| Surface | Owner | Lives in |
|---|---|---|
| Interrupt registry (`interrupts`, scope, generation) | `total_skill` | `src/interrupt-core.js` |
| Issuer wording (`watchdog_timeout` -> prose) | `total_skill` | `src/reasons.js` |
| `/interrupt` command + `interrupt-guide` skill | `total_skill` | `src/command.js` |
| Watchdog clock, budget, turn-scope cancel | `dsh-plugins` | `dsh-tokeneconomizer/lib/watchdog.js`, `lib/index.js` |
| Interrupt **recording** from the watchdog | `dsh-plugins` (client) | `dsh-tokeneconomizer/lib/interrupt-bridge.js` |
| Tiering / dedup / context rewriting | `dsh-plugins` | `dsh-tokeneconomizer/lib/tiering.js` etc. |

Rule of thumb: **`total_skill` owns abort *authority and wording*; `dsh-plugins` owns the *clock*
that decides when to ask for one.**

## 2. The one integration endpoint (and its current shape)

Today the only coupling is an absolute module URL:

```js
// dsh-plugins/dsh-tokeneconomizer/lib/interrupt-bridge.js:12
const DEFAULT_CORE_URL = 'file:///home/minami/Workspace/projects/total_skill/src/interrupt-core.js'
```

### Properties of the current endpoint

| Property | Value | Consequence |
|---|---|---|
| Type | ESM `import()` of an absolute path | not portable, not discoverable |
| Failure mode | caught, `core = null` | **silent** — the turn still cancels, attribution is lost |
| Contract checked | `typeof core.interrupts.requestInterrupt === 'function'` | shape-only, no version |
| Env override | `DSH_INTERRUPT_CORE_URL`, `DSH_INTERRUPT_REASONS_URL` | available, undocumented outside the source |

### Required shape of any replacement — path

If the endpoint stays a `file://` import it must at minimum:

1. resolve from a **configured** root, never a literal `/home/<user>` path;
2. fail **loudly** in the notice text (`registry unavailable` must reach the operator, not just the log);
3. declare a **contract version** the caller checks.

The preferred replacement is a Cordis service lookup (`ctx.get('interrupts')`) resolved at runtime,
which removes the path entirely. See
[INTERRUPT-ARCHITECTURE.md](./INTERRUPT-ARCHITECTURE.md) §5.

## 3. Version handshake

The bridge must not assume the registry's API. Minimum handshake:

```js
// caller (dsh-plugins) accepts only a matching major
if (core?.CONTRACT?.major !== 1) {
  return { recorded: false, detail: 'contract mismatch: ' + String(core?.CONTRACT?.major) }
}
```

**Current state: absent.** `interrupt-core.js` exports no version marker, so the bridge cannot tell a
compatible registry from a broken one. Adding `export const CONTRACT = { major: 1 }` to
`total_skill/src/interrupt-core.js` and checking it in the bridge is the smallest honest handshake.

| Contract version | Meaning |
|---|---|
| `1` | `interrupts.requestInterrupt(scopeId, {reason, hard, requireGeneration})`, `snapshot(scopeId)`, `isScopeInterrupted`, `getGeneration` |

A breaking change to any of those names **must** bump the major and be announced here before release.

## 4. The duplicate-name gate (hard constraint)

`dsh-plugins/docs/RULES.md` §4: *two plugins registering the same tool or provider route is a **hard
mount failure**.*

The names in play are `interrupt` (command) and `interrupt-guide` (skill), currently owned by
`total_skill`. Therefore:

* **Standing up a second plugin that also registers those names is forbidden** until the incumbent
  row is disabled and removed.
* Any move follows the four-step replacement: **disable incumbent row -> remove incumbent package ->
  add new package -> verify by real mount**. A passing `dsh --profile web --dump-config` does **not**
  prove a mount.
* Directory consolidation inside `dsh-plugins` (`dsh-command-skill/`) is **documentation and contract
  authority**; it registers nothing and does not by itself move a surface.

## 5. Change protocol

Either side may change its own surface freely. Cross-boundary changes follow this order:

1. **Announce in this file** — add a row to §6 with the intent before the code moves.
2. **Never break the fail-open path.** `dsh-plugins` must keep working with no registry; `total_skill`
   must keep working with no watchdog.
3. **Re-measure after.** "Applied" is not "verified" (`dsh-plugins/docs/RULES.md` §1).
4. **Restart is required.** Both packages are `link:`, but ESM modules load at process start; a build
   that edits source without a restart is live-file/dead-process. Both repositories' management docs
   say so.

## 6. Active collaboration ledger

| Date | Direction | Change | Status |
|---|---|---|---|
| 2026-11-01 | total_skill -> dsh-plugins | `interrupt-core.js` consumed by `interrupt-bridge.js` via `file://` | active, absolute path |
| 2026-11-02 | dsh-plugins -> total_skill | watchdog records `watchdog_timeout` before cancelling | active |
| 2026-11-02 | measured | watchdog fires 24x, interrupts 0x (self-reset defect) | **open defect** |
| 2026-11-02 | measured | guide promises 4 tools that exist in neither repo | **open defect** |
| 2026-11-02 | measured | `input` declaration: committed code requires it, working tree removes it | **open ambiguity** |

## 7. Known blind spots

* Neither repository can see the other's CI or tests. A green `total_skill` test run does not
  exercise the watchdog bridge, and a green `dsh-tokeneconomizer` run does not exercise the command.
* The bridge's failure is silent, so a broken cross-boundary contract shows up as a vague turn-exit
  reason rather than an error.
* Contract versioning is absent today (§3), so compatibility is assumed rather than checked.
