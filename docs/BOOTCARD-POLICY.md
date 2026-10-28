# Boot Card Policy

> Status: active · Last updated: 2026-10-29 · Index: [AGENTS.md](../AGENTS.md) · Cards: [bootcards/](../bootcards/)

## Rule

`AGENTS.md` is intentionally tiny. It contains only the pointer to the **newest timestamped boot
card** and the rule that older cards are historical.

## Generate

```bash
node scripts/new-bootcard.mjs "short session note"
```

The generator:

1. Creates `bootcards/YYYY-MM-DDTHHmm+0900.md`.
2. Appends it newest-first to `bootcards/INDEX.md`.
3. Replaces only the `LATEST_BOOT_CARD` block in `AGENTS.md`.

## Read

- Every agent invocation: read `AGENTS.md`, then only the linked latest boot card.
- Compare with older cards only when investigating a policy/version delta.

## Content contract

- DSH/Node/Cordis versions
- plugin versions + `engines.dsh` + artifact hashes
- non-negotiable safety/release rules
- current policy deltas and known risks
- verification commands
