# DSH Plugins — Detailed Rules

<!-- skeleton:
version: 1.0
kind: rule
status: active
updated: 2026-10-29
summary: Detailed project rules (tier 2): measurement, live-state gates, single-writer, plugin replacement, docs/skeleton contract, reporting.
-->

> **Reading chain:** global rules (`~/.dsh/AGENTS.md`) → **this file** (project rules) →
> [docs/SKELETON.md](SKELETON.md) (what exists) → [bootcards/](../bootcards/) (latest dated card).
>
> `AGENTS.md` at the repo root is auto-loaded and intentionally tiny: it points here. Put new
> rules **here**, not there, so the auto-loaded context stays small.

## 0. Precedence

1. Global rules in `~/.dsh/AGENTS.md` always win.
2. This file refines them for this workspace.
3. A boot card records one session's state and may narrow scope for that session only.
4. If a boot card contradicts this file, **stop and ask** the Master; do not pick a side.

## 1. Measure before acting

- Read the real state from its source of truth, not from a boot card, report, or memory.
- State measured facts **before** acting; flag any mismatch, including against an earlier
  statement of your own.
- Re-measure after the change. "Applied" is not "verified".

## 2. Live state is read-only unless asked

- `~/.dsh` (profiles, sessions, credentials, registry) and the running 3080 service are the
  user's. Do not write or restart them without explicit approval.
- Experiments use an isolated `DSH_HOME` under `/tmp` or the workspace.
- After any live change record: what changed, backup path, and the verification command.

## 3. Single-writer rule (see DSH-HARNESS-POLICY §3.2)

- Write only inside your assigned `dsh-<track>/`.
- Never write a sibling track's files, especially with a bare relative path.
- Before replacing any `package.json`, assert the directory's expected `name`.
- Each track keeps a test asserting `package.json.name`; keep it green.

## 4. Plugin replacement is 4 steps (see DSH-HARNESS-POLICY §3.3)

`disable incumbent row` → `remove incumbent package` → `add new package` → `verify by real mount`.

- `dsh plugin add` never disables an existing tool/route registration.
- Two plugins registering the same tool or provider route is a **hard mount failure**.
- `--dump-config` exiting 0 does **not** prove a plugin mounts. Mount or don't claim.

## 5. Sandbox scripts never write through a symlink

A script that builds an isolated tree must not `mkdir -p`, `ln -sfn`, or glob **through a
directory that is a symlink pointing outside the sandbox**. The write lands in the live tree.

Two concrete hazards, both measured:

- `mkdir -p "$DST/node_modules/@scope"` where `@scope` is a link to the live scope dir creates the
  directory **in the live profile**.
- `for c in "$sc"/*` over an **empty** directory yields the literal `*`, so
  `ln -sfn "$c" "$DIR/$(basename "$c")"` writes a self-referential `*` symlink into the live
  profile. It self-amplifies on the next run and breaks `dsh --profile <name>` with `ELOOP`.

Copy real directories, or link the scope dir itself and write only into a fresh local directory.
Never let a glob stand in for an empty listing.

## 6. Documentation contract (skeleton indexing)

Every tracked document (root `*.md` and `docs/**/*.md`) must start with a title, then a
skeleton header:

```
<!-- skeleton:
version: 1.0          # doc revision, bump on substantive change
kind: rule|policy|spec|report|measurement|readme|index
status: active|reference|historical|completed|measured|draft
updated: YYYY-MM-DD
summary: one line, <= 140 chars, what the doc answers
-->
```

- Write **all new documentation in English**. Existing Korean documents are historical and stay
  as-is until substantively rewritten.
- Do not hand-edit `INDEX.md` or `docs/SKELETON.md`; they are generated.
- After adding/renaming a doc run `npm run docs:index`; `npm run docs:check` must pass.

## 7. Reporting format

1. Measured facts (with the command that produced them).
2. What was changed.
3. Verification result.
4. What remains / what the user must do.
5. Any correction to a previous statement — plainly, not silently.

## 8. Verify commands

```bash
npm run docs:check                       # skeleton headers + generated indexes
(cd dsh-korean-locale && npm run verify)
(cd dsh-sidebar-manager && npm test)
(cd dsh-notify && npm test)
(cd dsh-opencode-v2 && npm test)
node scripts/audit-promoted-state.mjs
node scripts/audit-installed-vs-packaged.mjs
```
