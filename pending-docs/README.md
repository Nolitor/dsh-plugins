# Pending Documents — 미승격 · 미구현 · 폐기 · 미정

<!-- skeleton:
version: 1.0
kind: readme
status: active
updated: 2026-11-06
summary: The home for shared documents whose lifecycle is not "active track doc": unpromoted, unimplemented, deprecated, or undecided. One folder per state.
-->

> Authority: [docs/RULES.md](../docs/RULES.md) §6.2. Generated index: [INDEX.md](INDEX.md).

This is a real subproject, not a folder of leftovers. It exists so an **undecided shared
document has an explicit, greppable home** instead of drifting into the workspace `docs/` and
silently pretending to be authority.

**A document here is not a rule and not a commitment.** It must not be cited as authority —
cite it as evidence or as a proposal, naming its lifecycle.

## The four buckets

| Folder | Meaning | What would move it out |
| :--- | :--- | :--- |
| [`unpromoted/`](unpromoted/) | 구현·실측 완료. 라이브 프로파일에는 올리지 않음 — implemented and measured, not promoted to a live profile | the owner decides to promote it → it becomes a track document in `dsh-<track>/docs/` |
| [`unimplemented/`](unimplemented/) | 설계·실측만 존재, 코드 없음 — designed or measured, no code shipped | someone starts the work → the resulting design moves to `dsh-<track>/docs/` |
| [`deprecated/`](deprecated/) | 대체됨. 증거로만 보존 — superseded, kept only as evidence | nothing; retirement is settled. Removed only on owner instruction |
| [`undecided/`](undecided/) | 성격 미정 — nobody has classified it | someone classifies it into one of the three buckets above, a track, or a rule |

## How to add a document here

1. Pick the bucket that is **true today**. If you are unsure, `undecided/` is the honest answer —
   that is what the bucket is for.
2. Write the skeleton header with `lifecycle: <bucket>` matching the folder exactly.
3. Add a visible lifecycle banner right after the header (every current document has one).
4. State the document's **exit condition**: what would promote it, implement it, or replace it.
5. Run `npm run docs:index` at the workspace root, then `npm run docs:check`.

## How to take a document out of here

Moving a document out is a **decision**, not housekeeping. It requires:

- the destination home to be named (`dsh-<track>/docs/`, `docs/` as a rule, or deleted), and
- a one-line entry in [HISTORY.md](../HISTORY.md) recording what moved, where, and why.

Moving a document **in** is free — an honest "we have not decided" is better than a false entry
in `docs/` that a future agent reads as a rule.

## Current inventory

See the generated [INDEX.md](INDEX.md) for the authoritative list, one table per lifecycle.
