# DSH Plugins — Detailed Rules

<!-- skeleton:
version: 1.4
kind: rule
status: active
updated: 2026-11-02
summary: Detailed project rules (tier 2): measurement, live-state gates, single-writer, plugin replacement (browser-boot mount), docs/skeleton contract, reporting — with the failure ledger as required reading.
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

Every plugin surface states its own `font-size: 14px; line-height: 22px` root. DSH defines no
font-size token and sets none on `body`, so an omitted size inherits the browser's 16px and the
surface renders larger than the rest of the UI (measured: the sidebar panel and the notify
settings section both computed 16px before this rule). Full standard, including the token
pitfalls (`--dsw-alias-bg-layer-4` is unset at runtime; `--dsw-alias-brand-primary` is near-white
in dark mode): [PLUGIN-STYLE-STANDARD.md](PLUGIN-STYLE-STANDARD.md).

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
- **Plugin-track docs are not indexed.** `scripts/doc-index.mjs` skips every `dsh-*` directory, so
  `dsh-<track>/README.md` and `VERIFICATION.md` never appear in `INDEX.md` or `docs/SKELETON.md`.
  That is fine: **a plugin's own history belongs in its own directory.**

### 6.1 Per-plugin history is the home (owner instruction, 2026-11-04)

The owner's words: *"각 플러그인에 작업 히스토리 안쌓아? 매번 부트카드와 에이전트에만 쌓아두는거야?
에이전트 규정에 괜히 각 플러그인 히스토리 파편화하지 말고 각 플러그인 디렉토리에 히스토리와 문서
남기라 그래."*

Rules that follow:

| What | Where it goes | Never goes |
|---|---|---|
| Every change to a plugin (what, why, measured before/after) | `dsh-<track>/CHANGELOG.md` | bootcards |
| Per-version verification evidence | `dsh-<track>/VERIFICATION.md` (archive when large) | root `docs/` |
| Operator manual, prerequisites, config | `dsh-<track>/README.md` | root `docs/` |
| Measurements that outlive one plugin (cross-plugin contract, harness policy) | root `docs/` | a plugin track |
| **Owner's unfinished asks and things they would otherwise forget** | bootcard + `AGENTS.md` only | plugin tracks |

- **Bootcards and `AGENTS.md` are for the owner's memory, not for engineering history.** A bootcard
  records what is *pending* or *half-done*. It is not a changelog and must not be the only place a
  defect, a measurement, or a decision is written down.
- A change is **not complete** until `dsh-<track>/CHANGELOG.md` has an entry with the measured
  before/after. Reporting a change only in a chat message or only in a bootcard is a
  documentation miss, and can be reversed by the next session that does not read the transcript.
- Root `docs/` keeps only what spans plugins: the stage plans that govern several tracks, the
  harness policy, the failure ledger. A per-plugin detail copied into root `docs/` is
  **fragmentation** and is the mistake this rule exists to prevent.

### 6.2 Comparing against a new upstream version (owner instruction, 2026-11-04)

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
npm run docs:check                       # skeleton headers + generated indexes
node scripts/check-plugin-history.mjs    # every plugin track owns CHANGELOG (+ compat for adapters)
(cd dsh-korean-locale && npm run verify)
(cd dsh-sidebar-manager && npm test)
(cd dsh-notify && npm test)
(cd dsh-opencode-v2 && npm test)
node scripts/audit-promoted-state.mjs
node scripts/audit-installed-vs-packaged.mjs
```
