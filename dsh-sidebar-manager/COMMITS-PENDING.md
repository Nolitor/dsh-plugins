# Pending Commits — Session 2026-10-25

<!-- skeleton:
version: 1.0
kind: reference
status: historical
updated: 2026-10-25
summary: Commits left pending at the end of the 2026-10-25 session: what was staged, what was withheld, and why.
-->


> **Status:** awaiting `git init` (no repository exists yet)
> **Reason:** none of `dsh-sidebar-manager`, `dsh-plugins`, `dsh-workspace`,
> `Core-00-System`, or `project-promotion-manager` is a git work tree, and no
> enclosing repository exists. `user.name` / `user.email` are also unset.
> The planner chose **option C** (record the messages, defer initialisation).
>
> **All work is saved on disk.** Nothing was lost. Run the commands below when a
> repository structure is chosen.

---

## 0. Prerequisites

```bash
git config --global user.name  "<your name>"
git config --global user.email "<your email>"
```

---

## 1. `dsh-sidebar-manager` (plugin) — primary commit

**Suggested repo:** `~/Workspace/projects/dsh-workspace/dsh-plugins/dsh-sidebar-manager`
(remote declared in `package.json`: `github.com/linuxsung/dsh-sidebar-manager.git`)

```bash
cd ~/Workspace/projects/dsh-workspace/dsh-plugins/dsh-sidebar-manager
git init -b main
# create .gitignore first (see §4) before `git add -A`
git add -A
git commit -m "feat(groups): schema v3 with advisory soft-lint engine

Add virtual project grouping metadata and a non-blocking governance layer.

Schema v3 (additive):
- member.role: contract | implementation (descriptive only)
- member.policy.access: read-only | self-contained (+ reason)
- group.upstream: one-way downstream -> contract-group link
- v1/v2 -> v3 migration preserves behaviour (absent policy = no policy)

Advisory engine (never blocking):
- groups/advisory -> observations[], always HTTP 200, blocking:false
- groups/mutation-check -> explicit softRejection (HTTP 200, with detail+hint)
- ARTIFACTS_IN_CONTRACT_NODE is a notice badge, nothing is moved or blocked
- workflow routes (rename/move/promotion/order) never consult role/policy

Rollback & safety:
- record-level workspace.json rollback replaces whole-file restore (audit L4)
- rename-batch journal: staged two-phase moves + reverse rollback + boot recovery
- batch-validate: pre-flight path/binding/swap checks (read-only)

Lifecycle & audit tooling:
- HQ promotion ({GROUP}-00-{MAIN}) via promotion/apply mode:existing
- HQ tree derivation with control-tower rollup
- orphan classifier (membership by session id, 60 unregistered / 23 in total_skill)
- sub-agent capture guard (59/60 artifacts attributed to parent workspace)
- promotion gate G1-G6 as an advisory checklist
- harness diet budgets (CAPSULE <=400 tok, resident <=1500 tok/sub)

Manifest conformance (runtime spec 2.1): client.immediately, { default } exports.

Tests: 121/121 passing (manifest, promotion, safety, rollback, groups-v2,
hq-tree, phase5, advisory-v3)."
```

---

## 2. `Core-00-System` (specification authority) — docs commit

**Suggested repo:** `~/Workspace/projects/Core-00-System` (separate docs repo)

```bash
cd ~/Workspace/projects/Core-00-System
git init -b main
printf '.dsh-hq.json\n' > .gitignore
git add -A
git commit -m "docs(core): add canonical UTM architecture specification

- docs/UTM-ARCHITECTURE-SPEC.md: system role, decoupled 1:N contract/
  implementation pattern, selective governance rules, non-blocking
  advisory principles, structural invariants, reference table
- CAPSULE.md: index the spec under Master specifications and a new
  Documentation registry; list Core-01-UTM / Core-99-UROH with policies

Markdown permissions normalised to 644."
```

---

## 3. Optional — live state snapshot (NOT recommended to track)

`~/.dsh/sidebar-manager/groups.json` is **runtime state**, not source.
It currently holds schema v3 with:

| Workspace | role | policy | meaning |
|---|---|---|---|
| `Core-00-System` | contract | `read-only` | canonical specs / rollups |
| `Core-01-UTM` | contract | `read-only` | routing; cannot mutate upstream specs |
| `Core-99-UROH` | contract | `self-contained` | audit trail mutated only inside UROH |

If a snapshot is wanted for reference, copy it into the repo as
`docs/examples/groups.example.json` — never track the live file.

---

## 4. Required `.gitignore` before any `git add -A`

```gitignore
node_modules/
.DS_Store
*.log

# runtime / credentials — never commit
.env
.env.*
!.env.example
*.secret_token
.credentials.yaml

# DSH runtime state
.dsh-hq.json
```

> ⚠️ **Do not run `git add -A` at `~/Workspace/projects` root** without a
> .gitignore first: it would capture `minamiv21` (deprecated), venvs, session
> databases, and credentials.

---

## 5. Work summary (2026-10-25)

| Phase | Delivered |
|---|---|
| Audit A–G | lifecycle, UI/UX, token cost, slot collision, cosmetic feasibility, refined UI/safety, deprecated-workspace ledger |
| Phase 1–3 | record-level rollback, batch validation, `groups.json` registry, dry-run |
| Phase 4 | HQ tree, `insertBefore` ordering with reverse rollback, Manager UI |
| Phase 5 | HQ promotion, `rename-batch` journal, orphan classifier, harness diet, sub-agent guard, G1–G6 gate |
| Phase 6 | schema v3, advisory soft lint, selective policies (UTM read-only / UROH self-contained) |
| Docs | `Core-00-System/docs/UTM-ARCHITECTURE-SPEC.md` + CAPSULE registry |
| Credentials | `minamiv21` secrets migrated to `~/.env` / `~/.minami.secret_token` (600) |

**Final state:** 121/121 tests passing · `groups.json` v3 · live Core order
`Core-00-System → Core-01-UTM → Core-99-UROH`.

**Deferred to a future session:** sidebar visibility and UI isolation options.
