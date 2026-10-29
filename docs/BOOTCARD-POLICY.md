# Boot Card Policy

<!-- skeleton:
version: 2.0
kind: policy
status: active
updated: 2026-10-29
summary: Boot card generation and read rules; AGENTS.md stays a thin pointer to the newest card, rules live in docs/RULES.md.
-->

> Rules: [RULES.md](RULES.md) · Doc index: [SKELETON.md](SKELETON.md) · Index: [../AGENTS.md](../AGENTS.md)

## Rule

`AGENTS.md` is intentionally tiny: read order (global rules → `docs/RULES.md` → this index →
newest boot card) plus the pointer to the **newest timestamped boot card**.

Rules belong in [RULES.md](RULES.md) / [DSH-HARNESS-POLICY.md](DSH-HARNESS-POLICY.md), **not** in
`AGENTS.md` — `AGENTS.md` is auto-loaded into every session's context, so growing it costs
context on every turn.

## Generate

```bash
npm run bootcard -- "short session note"
# or: node scripts/new-bootcard.mjs "short session note"
```

The generator:

1. Creates `bootcards/YYYY-MM-DDTHHmm+0900.md` with a `skeleton` header (`kind: boot`).
2. Appends it newest-first to `bootcards/INDEX.md`.
3. Replaces only the `LATEST_BOOT_CARD` block in `AGENTS.md`.
4. Run `npm run docs:index` afterwards so the card appears in the skeleton index.

## Read

- Every agent invocation: `~/.dsh/AGENTS.md` (auto) → `AGENTS.md` (auto) → `docs/RULES.md`
  → `docs/SKELETON.md` → only the linked latest boot card.
- Compare with older cards only when investigating a policy/version delta.

## Content contract

- DSH/Node/Cordis versions
- plugin versions + `engines.dsh` + artifact hashes
- non-negotiable safety/release rules (reference, do not duplicate)
- current policy deltas and known risks
- verification commands

## Language

Boot cards are written in **English**. Older Korean cards are historical evidence and are not
retro-translated.
