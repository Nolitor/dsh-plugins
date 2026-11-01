# Interrupt Architecture — Coupling Review (A: in-watchdog vs B: standalone)

<!-- skeleton:
version: 1.0
kind: spec
status: active
updated: 2026-11-02
summary: Compares wiring the interrupt capability into the TokenEconomizer watchdog (A) against a standalone dsh-interrupt plugin (B), on failure isolation, blast radius, mount-surface risk, maintenance and event lifecycle, and records the measured facts that decide it.
-->

> Status: active · Measured 2026-11-02 · Companion: [INTERRUPT-LIFECYCLE.md](./INTERRUPT-LIFECYCLE.md),
> [../CROSS-PROJECT-COLLABORATION.md](./CROSS-PROJECT-COLLABORATION.md)

## 0. The question

The interrupt capability exists in two halves today. The **watchdog** lives inside
`@nolit/dsh-tokeneconomizer`; the **registry, command and skill** live in `@nolit/dsh-skill-interrupt`
(a separate git repository at `projects/total_skill`). They are joined by an absolute
`file://` import. Should the interrupt move *into* the watchdog (A), or become an autonomous
plugin (B)?

## 1. What is actually true today (measured, not assumed)

| Fact | Evidence |
|---|---|
| The two halves are one import apart | `dsh-tokeneconomizer/lib/interrupt-bridge.js:12` — `DEFAULT_CORE_URL = 'file:///home/minami/Workspace/projects/total_skill/src/interrupt-core.js'` |
| That import is **absolute and machine-scoped** | moving or renaming `total_skill` makes the import fail |
| Failure is silent by design | `interrupt-bridge.js:39-42` catches everything and leaves `core = null`; `record()` then returns `{recorded:false, detail:'registry unavailable'}` |
| Consequence of that silence | the turn is still cancelled, but the **turn-exit reason loses its issuer** and reads as an anonymous abort |
| The two are separate git repositories | `dsh-plugins/.git` vs `total_skill/.git` |
| Both plugins are mounted in the live profile | `dsh --profile web --dump-config` shows `dsh-skill-interrupt` and `tokeneconomizer-dsh` |
| Two plugins registering one name is a **hard mount failure** | `docs/RULES.md:52` |

The last row is the constraint that decides this review. Any option that ends with **two**
plugins owning `/interrupt` or `interrupt-guide` does not degrade gracefully; it fails to mount.

## 2. Option A — wire interrupt into the TokenEconomizer watchdog

The watchdog already owns the clock, the turn-scope cancel call (`lib/index.js:984`) and the
config surface. Option A makes it also own the registry, the command and the skill.

### What it buys

* **One mount row.** No duplicate-registration risk, because only one plugin registers the surfaces.
* **No cross-repository import.** The `file://` coupling disappears.
* **Atomic state.** The interrupt bit and the watchdog budget are the same process, so
  "the watchdog fired" and "the interrupt was recorded" cannot disagree.

### What it costs

* **Blast radius grows into the data plane.** TokenEconomizer is the component that *rewrites
  model-visible context* (tiering, dedup, surface replace, ~1.25 M chars of savings). Its own
  surface is already large: tiering, dedup, loop breaker, watchdog, recall, micro-skills,
  toolprune — 73 tests. Putting the control surface inside it means an interrupt bug ships on
  the same release train as a context-rewriting bug.
* **Failure isolation is inverted.** Today, an interrupt-registry failure is contained by
  fail-open. Under A, a defect in interrupt registration can stop the *whole* plugin from
  mounting — and a token economizer that does not mount silently stops saving without saying so.
* **`inject` surface widens.** The plugin would add `commands` and `skills` to its exported
  `inject` list. Per `docs/FAILURE-LEDGER.md` **F-1**, a declared-but-unexported or wrongly
  exported inject list has already taken down the entire web shell here once.
* **Two release cadences collapse into one.** A copy change in the interrupt guide would require
  a TokenEconomizer version bump.

## 3. Option B — an autonomous `dsh-interrupt` plugin

Interrupt becomes its own package: registry, command, skill, and (later) the tools the skill
promises. TokenEconomizer keeps only a **client** role: it asks for an interrupt and records one.

### What it buys

* **Correct failure domains.** Context rewriting (data plane) and abort authority (control plane)
  fail independently. A broken interrupt plugin cannot stop token saving, and a tiering bug cannot
  disarm the abort path.
* **Honest blast radius.** The interrupt plugin would touch `commands`, `skills` and `tools`;
  it would never be in the path that rewrites session content.
* **The skill can finally be true.** The guide currently documents four tools
  (`interrupt_status`, `interrupt_request`, `interrupt_clear`, `interrupt_yield`) that **do not
  exist** (see [INTERRUPT-LIFECYCLE.md](./INTERRUPT-LIFECYCLE.md) §3). A plugin that owns both the
  skill and its tools can keep them in step; a plugin that owns only the text cannot.
* **Independent versioning.** The guide is a copy artifact; it should not gate a token-economy release.

### What it costs

* **A second mount row and a second restart** for any coordinated change.
* **A real service contract is required.** The watchdog must call *something*. If that something is
  a `file://` import, B has fixed nothing. The boundary must be a Cordis **service** or an **event**,
  resolved at runtime, not a path baked into source.
* **The duplicate-registration trap must be closed explicitly.** `total_skill` already registers
  `/interrupt` and `interrupt-guide`. Standing up `dsh-interrupt` beside it, unchanged, is a hard
  mount failure. The surfaces have to **move**, not be re-declared — which is exactly the four-step
  replacement rule (`docs/RULES.md` §4): disable incumbent → remove incumbent → add new → verify by
  real mount.

## 4. Trade-offs, side by side

| Axis | A: in the watchdog | B: standalone |
|---|---|---|
| Failure isolation | poor — interrupt defect shares a mount with context rewriting | **good** — independent mount, independent failure |
| Blast radius | whole plugin fails to mount; savings stop silently | interrupt surfaces only |
| Duplicate-registration risk | none (one owner) | **must be managed** by moving the surfaces |
| Cross-repo coupling | removed | removed **only if** the boundary becomes a service/event |
| Maintenance overhead | one package, two unrelated concerns | two packages, one narrow contract |
| Release coupling | interrupt copy changes gate a TE release | independent |
| Event lifecycle clarity | budget, cancel and record are one object | **needs an explicit contract** (who records, who cancels, who reports) |
| Migration risk now | low code motion, high conceptual mixing | needs the 4-step replacement + a real-mount proof |

## 5. Recommendation

**Adopt B, and treat the contract as the deliverable rather than the package split.**

The deciding argument is not tidiness, it is the measured failure mode. The live corpus shows the
watchdog firing **24 times and interrupting 0 times** — an interrupt defect that was invisible
because the only signal was a warning line. That is precisely the class of bug that a shared mount
hides. Separating the abort authority from the context rewriter makes the next such defect local.

Concretely, in order:

1. **Fix the watchdog self-reset first** ([INTERRUPT-LIFECYCLE.md](./INTERRUPT-LIFECYCLE.md) §2).
   Nothing else is measurable until the timeout can fire.
2. **Replace the `file://` import with a service lookup** (`ctx.get('interrupts')`) that fails open
   to "no registry" *and says so in the notice text*, so a missing registry is visible rather than
   silent.
3. **Move** the `/interrupt` and `interrupt-guide` registrations out of `total_skill` into
   `dsh-interrupt` using the four-step replacement, proving the mount with a real boot — not a
   `--dump-config` exit code.
4. Only then consider moving the four promised tools in, so the skill stops describing vapour.

**Option A stays defensible** only if the owner wants one package and accepts that a context-rewriting
release can break the abort path. That is a deliberate trade, not a defect — but it should be written
down, which is why it is recorded here.

## 6. What this review does not decide

Whether the two git repositories should become one. Directory-level consolidation in the workspace
(`dsh-plugins/dsh-command-skill`) is **documentation and contract authority**, not a runtime
registration, and it does not by itself resolve the duplicate-name constraint. That step needs the
four-step replacement and an explicit instruction.
