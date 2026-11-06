# DSH Plugins — Detailed Rules

<!-- skeleton:
version: 2.1
kind: rule
status: active
updated: 2026-11-06
summary: Detailed project rules (tier 2): measurement, live-state gates, single-writer, plugin replacement, per-subproject docs with own skeleton index, pending-docs lifecycle, ownership moves to parent harnesses with verified pointer stubs, absorbed-track archiving, reporting.
-->

> **Reading chain:** global rules (`~/.dsh/AGENTS.md`) → **this file** (project rules) →
> [docs/FAILURE-LEDGER.md](FAILURE-LEDGER.md) (mistakes already made here — read before changing a
> plugin, measuring, or touching live state) → [docs/SKELETON.md](SKELETON.md) (what exists) →
> [bootcards/](../bootcards/) (latest dated card).
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
- **Every script or test that launches `dsh` (or a TokenEconomizer engine that spawns it) must
  own a throwaway `DSH_HOME`** and clean it up; a read-only audit may read the live home but
  never launch or write it; an owner-run live install must be explicitly gated. Enforced by
  `node scripts/check-dsh-isolation.mjs` — see
  [DSH-HOME-ISOLATION.md](DSH-HOME-ISOLATION.md). A harness that leaks into the live home creates
  the sidebar "그룹 없음" orphan logs ([pending-docs/unpromoted/ORPHAN-SESSION-CLEANUP.md](../pending-docs/unpromoted/ORPHAN-SESSION-CLEANUP.md)).
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
- For a browser half, "mount" means **a browser boot**: the shell renders and the page prints no
  `web boot: N entries did not activate`. Route probes, a 200 on the client bundle and
  `node --check` all pass while a client module is unloadable (measured 2026-10-30).

## 4.1 Cross-project boundary (`projects/total_skill`)

`total_skill` is a **separate git repository** that the live profile symlinks into the same process.
The binding contract lives in
[dsh-command-skill/docs/CROSS-PROJECT-COLLABORATION.md](../dsh-command-skill/docs/CROSS-PROJECT-COLLABORATION.md);
this section is the short form.

- **The coupling is an absolute path.** `dsh-tokeneconomizer/lib/interrupt-bridge.js` imports
  `file:///home/minami/Workspace/projects/total_skill/src/interrupt-core.js`. Moving or renaming
  that file breaks the watchdog's attribution **silently** (the bridge is fail-open and reports
  `registry unavailable` only in the notice text).
- **A source edit in either repository is live on the next process start, not now.** Both packages
  are `link:`; the ESM cache is per-process, so a restart is required and must be stated.
- **`interrupt` and `interrupt-guide` are shared registrations.** Standing up a second plugin that
  registers either is a hard mount failure — it needs the 4-step replacement in §4, not a second
  declaration.
- **No contract version exists yet.** The bridge checks shape only. Any signature change in
  `interrupt-core.js` is a silent break until a handshake is added.
- **Verify the boundary, don't infer it:** `node dsh-command-skill/scripts/verify-contract.mjs`
  reports which interrupt surfaces are mounted and whether the absolute imports still resolve.
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

## 5.1 Typography and visual style (mandatory)

Every plugin surface consumes the **live** DSH typography tokens:
`font-size: var(--dsh-content-font-size, 14px)` with
`line-height: calc(22px + var(--dsh-content-font-delta, 0px))`, and the derived secondaries
(`--dsh-content-font-size-secondary`, `--dsh-content-font-delta-secondary`) for hints and meta.
DSH sets these on `body` at runtime from Settings → font size (this profile: 13px; measured
2026-11-05). A hardcoded `14px` is the F-41 defect: it ignores the user's setting and renders one
step too large. Never set `font-family` (inherit) and never target a bare element selector.

Full standard, including the token pitfalls (`--dsw-alias-bg-layer-4` is unset at runtime;
`--dsw-alias-brand-primary` is near-white in dark mode):
[PLUGIN-STYLE-STANDARD.md](PLUGIN-STYLE-STANDARD.md) v2.0.

## 6. Documentation contract — one home per subproject, indexed by skeleton header

**Owner instruction 2026-11-06 (this section supersedes the earlier "root `docs/` only" reading):**

> *"지금 공용 문서에 문서가 많은데, 해당 문서들 모두 각각의 서브 프로젝트에 맞게 서브 프로젝트에 /docs로
> 넣고 스켈레톤 인덱싱 및 헤더 관리 각 서브프로젝트에서 문서 관리할 수 있게 하고 공용문서는 미승격 및
> 미구현 및 폐기 미정 서브프로젝트로 생성 관리하게 규정을 보완해줘"*

Translated into three rules:

1. **A document lives in the subproject it is about**, under `dsh-<track>/docs/`.
2. **Each subproject indexes and gates its own documents** — its own skeleton index and its own
   `npm run docs:check`. The workspace index is not the only index any more.
3. **A shared document that is not (yet) an active track document moves to `pending-docs/`**,
   which is a real subproject with four lifecycle buckets: `unpromoted`, `unimplemented`,
   `deprecated`, `undecided`.

### 6.0 The five homes

| Home | Holds | Index | Gate |
| :--- | :--- | :--- | :--- |
| `~/Workspace/projects/docs/` (host) | documents that govern **every** agent on this machine, above any single project — e.g. the host browser policy | `~/Workspace/projects/docs/README.md` | manual; reviewed when the subsystem changes |
| `dsh-<track>/docs/` | every document about **that one package** — spec, design, measurement, verification, architecture, research | `dsh-<track>/docs/INDEX.md` (generated) | `npm run docs:check` **in the track** |
| `pending-docs/<lifecycle>/` | shared docs whose lifecycle is **not decided or not active** (see §6.2) | `pending-docs/INDEX.md` (generated) | root `npm run docs:check` |
| `docs/` (workspace) | **only** rules, policy, and records that genuinely span several tracks | `docs/SKELETON.md` + `INDEX.md` (generated) | root `npm run docs:check` |
| `bootcards/` | dated session cards, one per session | `bootcards/INDEX.md` | root `npm run docs:check` |

**A document that any agent in any project must obey belongs one level above this workspace**, in
`~/Workspace/projects/docs/` (§6.2b). Filing it in one project makes every other project duplicate it or
lose it.

**If a document is about one package, it does not belong in the workspace `docs/`.** "It is
convenient to have it next to the rules" is not an exception; it is how the workspace `docs/`
became a dumping ground. The workspace `docs/` list is deliberately short — if you are adding a
24th file there, you are almost certainly in the wrong home.

### 6.0a The skeleton header (unchanged, now enforced everywhere)

Every tracked document — workspace, track, and pending — starts with a title, then a skeleton
header:

```
<!-- skeleton:
version: 1.0          # doc revision, bump on substantive change
kind: rule|policy|spec|report|measurement|design|reference|readme|index
status: active|reference|historical|completed|measured|implemented|draft|superseded|archived
updated: YYYY-MM-DD
summary: one line, <= 140 chars, what the doc answers
-->

<!-- pending-docs/ only: one extra required field -->
lifecycle: unpromoted|unimplemented|deprecated|undecided
```

- Write **all new documentation in English**. Existing Korean documents are historical and stay
  as-is until substantively rewritten. The **header** is metadata and is always English, even on a
  Korean document.
- `scripts/doc-index.mjs` is the **single** header parser. Do not write a second one; the
  per-track gate (`scripts/doc-index-track.mjs`) reuses it.
- Do not hand-edit any generated index: workspace `INDEX.md`, `docs/SKELETON.md`,
  `dsh-<track>/docs/INDEX.md`, `pending-docs/INDEX.md`.
- `updated:` records when the **document's content** last changed, not when the file was last
  committed or moved. A git `mv` is not a revision; do not bump `version:` for a move.
- A `kind` or `status` outside the enumerations above is a gate failure, not a warning.

### 6.0b Commands

```bash
# workspace: rules/policy + pending-docs + every track index (one command, all homes)
npm run docs:index                 # regenerate all indexes
npm run docs:check                 # headers + every generated index + all relative links
npm run docs:check:all             # docs:check + per-track CHANGELOG gate
npm run docs:links                 # link gate alone

# inside a subproject: manage that subproject's own docs
cd dsh-<track>
npm run docs:index                 # regenerate only this track's docs/INDEX.md
npm run docs:check                 # fail if this track's index is stale
```

`scripts/doc-index-track.mjs` infers the track from its working directory, so a track
**cannot** rewrite a sibling's index by accident (single-writer rule, §3).

### 6.0c Link integrity is part of the contract

Moving a document is the single most common way this workspace has silently rotted: the file
moves, the link behind it does not, and the reader lands on a 404 in the one place they went for
truth. `scripts/check-doc-links.mjs` resolves every relative link in every tracked `*.md` against
that file's own directory and fails on a missing target. It runs inside `npm run docs:check`.

- A link to a file **outside this repository** (a sibling repo, an absolute path) must be written
  as plain text with the path shown, or as an `https://` URL — never as a relative link that
  cannot resolve.
- A link to an asset that is not committed is not a link: write it as inline code.

### 6.1 Per-plugin history is the home (owner instruction, 2026-11-04)

The owner's words: *"각 플러그인에 작업 히스토리 안쌓아? 매번 부트카드와 에이전트에만 쌓아두는거야?
에이전트 규정에 괜히 각 플러그인 히스토리 파편화하지 말고 각 플러그인 디렉토리에 히스토리와 문서
남기라 그래."*

Rules that follow:

| What | Where it goes | Never goes |
|---|---|---|
| Every change to a plugin (what, why, measured before/after) | `dsh-<track>/CHANGELOG.md` | bootcards |
| Per-version verification evidence | `dsh-<track>/VERIFICATION.md`, or `dsh-<track>/docs/` when long | root `docs/` |
| Operator manual, prerequisites, config | `dsh-<track>/README.md` | root `docs/` |
| Architecture, design, spec, measurement **about one package** | `dsh-<track>/docs/*.md` | root `docs/` |
| A shared doc that spans plugins **and is in active use** (harness policy, failure ledger, style standard) | root `docs/` | a plugin track |
| A shared doc whose lifecycle is **not active** (미승격/미구현/폐기/미정) | `pending-docs/<lifecycle>/` | root `docs/` |
| **Owner's unfinished asks and things they would otherwise forget** | bootcard + `AGENTS.md` only | plugin tracks |

- **Bootcards and `AGENTS.md` are for the owner's memory, not for engineering history.** A bootcard
  records what is *pending* or *half-done*. It is not a changelog and must not be the only place a
  defect, a measurement, or a decision is written down.
- A change is **not complete** until `dsh-<track>/CHANGELOG.md` has an entry with the measured
  before/after. Reporting a change only in a chat message or only in a bootcard is a
  documentation miss, and can be reversed by the next session that does not read the transcript.
- Root `docs/` keeps only what spans plugins **and is in active use**: the harness policy, the
  failure ledger, the style standard, the rules themselves. A per-plugin detail copied into root
  `docs/` is **fragmentation**; a shared but inactive document belongs in `pending-docs/` (§6.2).
  A stage plan that governs one track belongs in that track's `docs/` (§6.1b).

### 6.1a Absorbed tracks leave the active tree (owner instruction, 2026-11-05)

The owner's words: *"통합되고 아카이브로 옮겼어야 할 디렉토리 방치 및 잔재 플러그인 환경 설정 제거하지
못한 점, 맥락을 잊고 예전 버전 설치한 점"*.

A merge has **three** completion conditions, and all three land in the same round:

| # | Condition | Verify with |
| :-: | :--- | :--- |
| 1 | The absorbing package registers the surface | `dsh --profile <p> --dump-config`, row owned by the replacement |
| 2 | The absorbed directory is moved to `archive/` with an `ARCHIVED` banner | the five-bar test in [archive/README.md](../archive/README.md) |
| 3 | The absorbed package is gone from **every** profile: dependency, `dsh.profile.bundles`, **and** the `node_modules` link | `python3 -c` over the profile manifest + `readlink`/`[ -e ]` over `node_modules/@nolit/*` |

- **"Superseded but still in the active tree" is a defect, not a state.** It claims liveness the
  runtime does not have, and it is exactly what produced F-50 and F-51.
- Archive **every** absorbed track in the round, not only the one the owner names (F-50).
- A removal that skips the `node_modules` link leaves a broken symlink that is invisible in the UI
  and misleads the next reader (F-51).
- The chain record for a round goes in [HISTORY.md](../HISTORY.md) (what spans tracks) and each
  affected `dsh-<track>/CHANGELOG.md` (what changed for that package). Both, not either.
- Read [PLUGIN-CONSOLIDATION.md](PLUGIN-CONSOLIDATION.md) §2 **before** touching a vendor surface;
  not reading it is how the merge gets re-litigated (F-52).

### 6.1b Every subproject owns its `/docs` (owner instruction, 2026-11-06)

Every active track carries a `docs/` directory and an index for it, even if it currently holds one
file. The index is generated, never hand-written.

```
dsh-<track>/
├── README.md            operator entry (unchanged role)
├── CHANGELOG.md         history (unchanged role, gated by check-plugin-history.mjs)
└── docs/
    ├── INDEX.md         GENERATED — this track's document index
    ├── <SPEC>.md
    └── <MEASUREMENT>.md
```

- **Adding a document to a track:** create it under `dsh-<track>/docs/` with a skeleton header,
  then run `npm run docs:index` in that track. `npm run docs:check` must pass.
- **The track's `package.json` carries the gate.** Every track has
  `"docs:index": "node ../scripts/doc-index-track.mjs"` and
  `"docs:check": "node ../scripts/doc-index-track.mjs --check"`, so a track can be verified on its
  own without the workspace root.
- **`files` must include `docs/`.** A published track that ships specs, designs, or measurements
  but leaves `docs/` out of `package.json#files` publishes an incomplete package.
- **A submodule is a separate repository.** `dsh-korean-locale` is a git submodule; this workspace
  must not write into it. It keeps and indexes its own documents in its own repo. The workspace
  indexer excludes submodules so `npm run docs:check` never claims ownership of them.
- **A track that is archived keeps its `docs/`** under `archive/dsh-<track>/docs/`; the workspace
  indexer still reads those headers so archived evidence stays tracked, but the archive is not a
  place to file new work.
- The workspace `docs/SKELETON.md` lists every subproject with a link to its index, so an agent
  always has one hop from the rules to the right per-subproject index.

### 6.2 `pending-docs/` — where an undecided shared document goes (owner instruction, 2026-11-06)

The owner's words: *"공용문서는 미승격 및 미구현 및 폐기 미정 서브프로젝트로 생성 관리하게"*.

A shared document that is **not** an active track document and **not** an active rule does not
belong in `docs/`. It goes to `pending-docs/`, which is a real subproject with one folder per
lifecycle state:

| Folder | Meaning | Owner decision pending | May be built on? |
| :--- | :--- | :--- | :--- |
| `pending-docs/unpromoted/` | implemented and measured, but **not promoted** to a live profile | whether to promote | yes, read the caveats |
| `pending-docs/unimplemented/` | designed or measured only — **no code shipped** | whether to start | no, it is a plan |
| `pending-docs/deprecated/` | **superseded**, kept only as evidence | none — retirement is settled | no |
| `pending-docs/undecided/` | **nobody has classified it yet** | classification itself | no |

The `lifecycle:` header field is **mandatory** and must match the folder. A document whose
`lifecycle:` disagrees with its directory is a gate failure, so the folder cannot quietly drift
away from its own metadata.

Rules that follow:

- **A document in `pending-docs/` is not a rule and not a commitment.** It must not be cited as
  authority. Cite `docs/RULES.md`, and cite a pending document only as *evidence* or *proposal*,
  naming its lifecycle (for example "a `unimplemented` design").
- **Moving a document in is free.** Moving one out requires a decision and a one-line entry in
  [HISTORY.md](../HISTORY.md) saying where it went and why. Promotion is an owner decision, not an
  agent's convenience.
- **Every pending document states its exit.** Its body must say what would make it leave the
  bucket: what would promote it, what would implement it, or what already replaced it.
- **Do not delete a deprecated document to tidy up.** Deprecated is a lifecycle, not garbage; the
  evidence is why the rule that replaced it exists. Delete only with owner instruction, and record
  it in [FAILURE-LEDGER.md](FAILURE-LEDGER.md) if it recorded a defect.
- If a document here starts being used as the real answer for a live package, that is the signal
  it must **graduate into `dsh-<track>/docs/`** or **become a rule in `docs/`** — not stay pending.

### 6.2a Ownership decides the home — a parent-harness subject leaves this workspace (owner instruction, 2026-11-06)

The owner's words: *"UTM뿐만 아니라 다른 보류 문서들도 마찬가지다. dsh-plugins 단독 시야로 pending-docs에
묻어버리지 마라 … 상위/타 하네스 이관 대상과 플러그인 로컬 한정 문서로 먼저 분별해라."*

`pending-docs/` is a home for **our own** undecided documents. It is **not** a place to park a
document that belongs to a parent harness, and `deprecated` is not a synonym for "someone else owns
this". Filing another harness's contract here has already caused one near-miss: the promotion-gate
spec was labelled `deprecated` while shipped code cited it as its source of truth, so the next
tidy-up would have deleted the only surviving copy of a live contract.

**Before classifying any shared document, measure ownership against the parent trees — not from
this workspace's view:**

| Question | Measure with |
| :--- | :--- |
| Does a parent harness already cite this document by path or line? | `grep -RIn '<file name>' ~/Workspace/projects/{Core-00-System,Core-02-HUB,project-promotion-manager,release-harness}` |
| Does a parent own the *subject* (invariants, rules, registry, session membership)? | read its `CAPSULE.md` / `AGENTS.md` / `RULES.md` |
| Does shipped code in this workspace cite it as a contract? | `grep -RIn '<file name>' --include='*.mjs' --include='*.js' .` |

**If a parent harness owns the subject, the document moves there and this workspace keeps a pointer
stub.** The stub is a receipt, not a copy:

- The **destination copy is authoritative**; edit it there. Never "fix" a stub's content.
- The stub records the destination path, the **SHA-256 of the destination file**, and its own
  original path. `scripts/check-doc-moves.mjs` fails when the destination is missing, when the
  digest no longer matches (the destination changed without the stub being updated), or when the
  stub records the wrong original path. It runs inside `npm run docs:check`.
- A stub carries **no `lifecycle:`** — it is not a pending document. The indexer lists stubs under
  *"Moved out of dsh-plugins"* with their destination.
- **Do not claim a move before the copy exists.** A stub whose destination is absent is a broken
  promise; the doc-moves gate is what makes that claim checkable. When a destination tree is not
  writable, stage the files and report the step as *outstanding*, never as done.

After the move, the **receiving workspace** owns three follow-ups, and only its own agent can do
them: index the new documents in its own doc tree, link them from its index/registry, and record the
transfer in its own ledger. A mover that stops at `cp` has done half the work.

### 6.2b Host-wide documents live above the project tree (owner instruction, 2026-11-06)

Owner instruction: *"최상위 프로젝트 상위에 /docs 를 두고 다른 에이전트에서도 참조할 수 있게 해봐"*.
Owner correction (same day): *"워크스페이스가 상위아니다 뒤에 프로젝트 디렉토리가 상위 프로젝트다"* —
`~/Workspace/` is only a container; the top-level projects directory is **`~/Workspace/projects/`**,

Some documents govern the whole machine, not one project: which browser to use, which daemon is
resident, which endpoint is fixed. Those cannot live in a project's `docs/`, because an agent
started in a *different* project would never find them and would either re-derive the fact or
contradict it.

```
~/Workspace/                  container only (g0-env/ + projects/)
└── projects/                 <- THE top-level projects directory
    ├── docs/                 <- host-wide policy (this section)
    │   ├── README.md         index + the precedence chain
    │   └── HOST-BROWSER-POLICY.md
    ├── Core-00-System/       <- contract nodes
    ├── project-promotion-manager/   (= Core-01-UTM)
    ├── Core-02-HUB/
    └── dsh-workspace/
        └── dsh-plugins/      <- this workspace
```

`Workspace/` is a container, not the projects root. The top-level projects directory is
**`projects/`**, so that is where a cross-project document goes — beside `Core-00-System/`,
`project-promotion-manager/` and `dsh-workspace/`, not above them.

Precedence:

```
~/.dsh/AGENTS.md        global harness rules  (auto-loaded, wins)
  -> ~/Workspace/projects/docs/  host-wide policy      (cross-project, this section)
     -> <project>/docs/ project rules         (that project only)
```

Rules that follow:

- **The test for this directory:** *would an agent working in a different project need this?* If
  yes, it is host-wide; if no, it belongs in that project's `docs/`.
- **It sits beside the projects, not above their directory.** `~/Workspace/projects/docs/`, next to
  `Core-00-System/` and `dsh-workspace/`. `scripts/check-doc-moves.mjs` already resolves stub
  destinations against `projects/`, so this placement is the one the gates assume.
- **A host policy names its runtime SSOT.** The prose policy is the human-readable layer; if a live
  config file is the real authority, link it explicitly (as `HOST-BROWSER-POLICY.md` links
  `~/.local/share/lpd/AGENTS_GUIDE.md`). If they disagree, the SSOT wins and the policy is corrected.
- **Never fork a host policy into a project.** A project that needs a subset links here. Two copies
  diverge, and the older copy wins in whichever context window loaded it first.
- **Discovery is part of the deliverable.** A shared document nobody can find is not shared. Each
  agent's rules file gets a managed pointer block:
  `<!-- >>> shared-docs pointer (managed) >>> ... <!-- <<< shared-docs pointer (managed) <<< -->`.
  Extend an existing managed block rather than adding a second one, and **never overwrite a
  symlinked** `AGENTS.md` — append to the file it points at instead.
- **A deployed subsystem is not a pending document.** Once a host subsystem is measured as running
  (unit enabled, port listening, smoke passing), its document graduates out of `pending-docs/` into
  `~/Workspace/projects/docs/` with `status: active`. "Implemented but I never decided" is not a lifecycle;
  either it runs or it does not.

### 6.3 Comparing against a new upstream version (owner instruction, 2026-11-04)

The owner's words: *"제발 새로운 버전 나왔다고 하면 문서 좀 확보해서 비교 검증하도록 해라, 지난번엔
아무 문제가 없다고 하더니 마치 처음 보고받은 것 처럼 얘기하면 어쩌냐."*

When a new DSH / provider / library version appears, this is the **minimum** sequence. It is not
optional and it is not satisfied by reading a rendered HTML page:

1. **Acquire the actual artifact for the exact version.**
   `curl -sL https://codeload.github.com/<org>/<repo>/tar.gz/refs/tags/<tag>` for a tag, or the
   installed package directory for the running build. Reading `master` is not reading the
   version you run.
2. **Diff the tagged source against the installed/target version** for every surface the plugin
   touches (types, exports, upgrade-guide entries). Record which files were compared.
3. **Diff the docs of that tag**, not the docs of master. A guide under
   `docs/upgrade-guide/<version>/` may exist only on master — measured 2026-11-04: the
   `dsh-v0.2.2-alpha.3` tag does not contain the `chat-process-activity-context` guide, and the
   tag's `ProcessActivity` union has no `context` member.
4. **Write the comparison into `dsh-<track>/CHANGELOG.md`** as a table of
   *surface → before/after → affected? → evidence file*. "No problem found" without that table is
   not a verification.
5. **Never re-report a previously known fact as new.** §7 requirement 5 already says corrections
   must be explicit; this adds: if a previous session already reported something, the new report
   must reference it (*"still unchanged since <date>"*), not introduce it as a discovery.

## 7. Reporting format

1. Measured facts (with the command that produced them).
2. What was changed.
3. Verification result.
4. What remains / what the user must do.
5. Any correction to a previous statement — plainly, not silently.

## 8. Verify commands

```bash
npm run docs:index                       # regenerate workspace + pending-docs + every track index
npm run docs:check                       # headers + every generated index + every relative link
npm run docs:check:all                   # docs:check + plugin-history gate
npm run docs:links                       # relative-link gate alone
node scripts/check-plugin-history.mjs    # every plugin track owns CHANGELOG (+ compat for adapters)
(cd dsh-<track> && npm run docs:check)   # one subproject's own document index
(cd dsh-korean-locale && npm run verify)
(cd dsh-sidebar-manager && npm test)
(cd dsh-notify && npm test)
(cd dsh-opencode-v2 && npm test)
node scripts/audit-promoted-state.mjs
node scripts/audit-installed-vs-packaged.mjs
node scripts/check-dsh-isolation.mjs      # no unisolated dsh launcher in scripts/tests
node --test scripts/check-dsh-isolation.test.mjs scripts/cleanup-orphan-sessions.test.mjs
node scripts/cleanup-orphan-sessions.mjs  # orphan-session DRY RUN (owner applies)
```
