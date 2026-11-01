# dsh-command-skill

<!-- skeleton:
version: 1.0
kind: readme
status: active
updated: 2026-11-02
summary: Documentation and contract authority for DSH system-level command + skill surfaces; records the interrupt architecture review, the measured lifecycle defects, and the cross-project contract with total_skill. Registers nothing at runtime.
-->

> **This package registers nothing.** It is a documentation and contract authority inside
> `dsh-plugins`. The live `/interrupt` and `interrupt-guide` surfaces are still owned by
> `@nolit/dsh-skill-interrupt` in `projects/total_skill`. Moving them requires the four-step
> replacement in [`docs/CROSS-PROJECT-COLLABORATION.md`](docs/CROSS-PROJECT-COLLABORATION.md) §4.

## Why a directory with no runtime code

The interrupt capability is split across two git repositories that are joined at runtime by an
absolute `file://` import. Nothing in either repository can see the other's rules, so the rules that
span the boundary need a home that is *neither* plugin. That is this directory.

Stated plainly: this is where the contract lives, not where the code ships. Creating it is
**documentation consolidation**, and per `dsh-plugins/docs/RULES.md` §4 it is *not* a plugin
replacement and does not move a registration.

## Contents

| Document | Answers |
|---|---|
| [`docs/INTERRUPT-ARCHITECTURE.md`](docs/INTERRUPT-ARCHITECTURE.md) | Should the interrupt live inside the TokenEconomizer watchdog (A) or in its own plugin (B)? Trade-offs on failure isolation, blast radius, mount risk, maintenance and lifecycle. |
| [`docs/INTERRUPT-LIFECYCLE.md`](docs/INTERRUPT-LIFECYCLE.md) | Measured root causes: why the watchdog never interrupts, why `/interrupt` aborts before hand-off, and why the guide promises tools that do not exist. |
| [`docs/CROSS-PROJECT-COLLABORATION.md`](docs/CROSS-PROJECT-COLLABORATION.md) | The shared contract with `total_skill`: ownership map, endpoint shape, version handshake, duplicate-name gate, change protocol, live ledger. |

## The three measured findings, in one screen

1. **The watchdog warns forever.** `dsh-tokeneconomizer/lib/index.js:776` calls
   `watchdog.progress()` on every session event, and the watchdog's own warning is injected as a
   `user/message` — so the warning resets the budget that was about to expire. Measured: 24
   `warning only` lines, 0 `action=interrupted`, and a probe reproducing 8 warnings / 0 timeouts.
2. **`/interrupt` stops the turn before reading the operator.** The handler cancels first and steers
   second (deliberately, to promote the text to `next-turn`), so the in-flight work is gone even
   though the message survives.
3. **The guide describes four tools that do not exist.** `interrupt_status`, `interrupt_request`,
   `interrupt_clear`, `interrupt_yield` were removed with `src/tool-specs.js` in commit `407611e`;
   the skill body still tells the model to call them. The plugin's `inject` is
   `['commands', 'skills']` — it registers no tools.

## Conventions this package follows

* Every document carries a `<!-- skeleton: -->` header.
* `docs/` here is inside a `dsh-*` directory, which `scripts/doc-index.mjs` skips by design
  (plugin tracks keep their own READMEs). The workspace `docs:check` therefore stays at 69 docs and
  is not an authority for this directory.
* Nothing here writes to `~/.dsh`.

## Verification

```sh
npm run check              # syntax-check the contract verifier
node scripts/verify-contract.mjs   # report whether the live wiring still matches the contract
```
