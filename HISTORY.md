# Plugin History — the main chain

<!-- skeleton:
version: 1.3
kind: index
status: active
updated: 2026-11-06
summary: The main plugin-history chain for this workspace — vendor merges, archived tracks, version ladders, live-state debt, the per-subproject document split, the harness-owned document transfer, and the host-wide docs tier.
-->

> **This is the main history chain. Each plugin's own history stays in `dsh-<track>/CHANGELOG.md`.**
> This file records what spans several tracks: a vendor merge, a version-policy change, a track
> being archived, and the live-state debt that was left behind. Per-rule authority:
> [docs/RULES.md](docs/RULES.md) §6.1. Mistakes and their standing rules:
> [docs/FAILURE-LEDGER.md](docs/FAILURE-LEDGER.md).
>
> Read order for a new agent: `AGENTS.md` → `docs/RULES.md` → `docs/FAILURE-LEDGER.md` →
> **this file** → the plugin's own CHANGELOG.

## 1. Structure going forward (owner instruction 2026-11-05)

| Location | Meaning | Installed? | Owns CHANGELOG |
| :--- | :--- | :--- | :--- |
| `dsh-<track>/` | an **active** track | yes, in some profile | yes, required |
| `archive/dsh-<track>/` | an **absorbed** track, kept as history | **no** | yes, kept with an `ARCHIVED` banner |
| `staging/<track>/` | code held for a later stage | **no** | n/a |

Authority: [docs/PLUGIN-CONSOLIDATION.md](docs/PLUGIN-CONSOLIDATION.md) §2.1.

**A track that is merged into a vendor package must be archived in the same round that removes it
from the profile.** "Superseded but still in the active tree" is not a stable state — it is the
state that produced the defects in §3.

## 2. Chronological chain

### 2026-11-06 (3) — host-wide docs tier above the project tree; Lightpanda confirmed deployed

Owner correction: *"LIGHTPANDA-CDP … 이거 이미 구축이 된걸로 아는데? 플레이라이터로 화면 렌더링은 크롬,
헤드리스는 라이트판다가 작업하게 시스템이 구축되었을거야 확인해봐"* — then *"최상위 프로젝트 상위에 /docs 를
두고 다른 에이전트에서도 참조할 수 있게 해봐"*.

**The correction was right.** `LIGHTPANDA-CDP.md` had been filed as `unpromoted`, as if the work were
waiting on a decision. It was not waiting — it was running. Measured 2026-11-06:

| Probe | Result |
|---|---|
| `127.0.0.1:9333` | LISTEN; `/json/version` → `Lightpanda/1.0`, protocol `1.3` |
| `lightpanda.service` | enabled, **`Linger=yes`** → starts at boot, independent of login |
| `lpd status` / `lpd smoke` | `alive: true` / `ok: true` (185 ms) |
| `withPage()` from `~/.local/share/lpd/lib/cdp.mjs` | imported and returned DOM text |
| Chromium | Playwright `chromium-1243`, `chromium-1248`, `chromium_headless_shell` present |

So the owner's description was accurate: **collection runs on Lightpanda, rendering and clicks run
on Chromium.** The split is not a plan; `~/.local/share/lpd/AGENTS_GUIDE.md` already states it as a
rule ("Lightpanda는 렌더링 엔진이 없어 `click()`이 동작하지 않는다"), and the deployment report
records the verdict *"적용 완료 (재측정 완료)"*.

**What was wrong with my filing.** Two separate mistakes: (a) `unpromoted` described a system that was
in fact deployed, and (b) the document is **host-wide** — it governs every CLI agent on the machine,
which no single project's `docs/` can express.

**The fix — a fifth home.** `~/Workspace/docs/`, one level above `projects/`, so any agent in any
project can reach it. `RULES.md` §6.2b now defines the tier, its precedence
(`~/.dsh/AGENTS.md` → `~/Workspace/docs/` → `<project>/docs/`), and the test for what belongs there:
*would an agent working in a different project need this?*

| File | Purpose |
|---|---|
| `~/Workspace/docs/README.md` | index + precedence chain |
| `~/Workspace/docs/HOST-BROWSER-POLICY.md` | the measured system, the Lightpanda/Chromium split, the absolute rules, and a pointer to the runtime SSOT |

**Blocked again by the same read-only root**, so the tier is staged, not installed:
`staging/shared-docs/` holds both documents, a pointer block for each agent's rules file, and an
idempotent `install.sh`. It was exercised end-to-end in a `/tmp` sandbox, because an installer that
has never run is not known to work:

- preflight **refuses** on a read-only target with the exact remount command;
- second run is a no-op (idempotent);
- `~/.dsh/AGENTS.md` gets **one** extended managed block, never a duplicate;
- `~/.config/opencode/AGENTS.md` is a **symlink** to the Lightpanda SSOT — the installer reports it
  and refuses to clobber it, because replacing the symlink would silently undo an earlier decision.

**A stub was created and then reverted — deliberately.** An early attempt left a `LIGHTPANDA-CDP.md`
pointer stub naming a destination that did not exist yet. `scripts/check-doc-moves.mjs` failed it
(`stub has no SHA-256 digest`, then `destination does not exist`), which is exactly the defect that
gate was written for: a move that reports success while the destination was never written. The
original document was restored from git and its header corrected instead of pointing at a file that
is not there.

**Measured.** 12 pending documents → 4 real pending + 8 stubs; `check-doc-moves` OK for 7 stubs
against their harness copies; 1,228 relative links resolve; `docs:check:all` green; 10 per-track
gates green.

### 2026-11-06 (2) — seven documents left for the harness that owns them

Owner correction: *"UTM뿐만 아니라 다른 보류 문서들도 마찬가지다. dsh-plugins 단독 시야로 pending-docs에
묻어버리지 마라 … 상위/타 하네스 이관 대상과 플러그인 로컬 한정 문서로 먼저 분별해라."*

That was right, and it exposed a real error in the previous entry. `UTM-PROMOTION-GATE-SPEC.md` had been
filed as **`deprecated`** while `dsh-sidebar-manager/lib/promotion-gate.mjs` cites it as its
**source of truth** — the worst possible label, because a future agent tidying "deprecated" documents
would have deleted the only surviving copy of the contract the code implements. A `dsh-plugins`-only
view could not see that Core-01-UTM's own audit (`docs/audit/C-tokens.md`, `A-lifecycle.md`,
`00-SYNTHESIS.md`) was already citing these documents by line number.

**Method.** Each pending document was measured against the parent trees, not against intuition:
`Core-00-System/CAPSULE.md` invariants, `project-promotion-manager/docs/{rules,audit,contracts}`,
`Core-02-HUB/`, and every `grep` hit that named one of our files.

**Ownership verdict.**

| Document | Evidence it belongs upstream | Destination |
|---|---|---|
| `UTM-PROMOTION-GATE-SPEC.md` | `promotion-gate.mjs` = *source of truth*; `subagent-guard.mjs` cites §3.1-6; Core-01 `C-tokens.md` = *project contract*, cites `:186` as Critical | `Core-01-UTM/docs/contracts/` |
| `UTM-COMPLIANCE.md` | Core-01 `C-tokens.md` = *project contract*; `00-SYNTHESIS.md` cites §2.2 | `Core-01-UTM/docs/contracts/` |
| `ORPHAN-SESSION-CLEANUP.md` | Core-01 `RULES.md` §1.4 owns the no-orphan rule; session/workspace membership is Core-01's subject | `Core-01-UTM/docs/contracts/` |
| `MIGRATION.md` | Core-00 `CAPSULE.md` invariants 1 & 3 | `Core-00-System/docs/` |
| `SESSION-TRANSFER-REPORT.md` | Core-00 `CAPSULE.md` invariants 3 & 4 | `Core-00-System/docs/` |
| `TITLE-RESTORATION-REPORT.md` | Core-00 `CAPSULE.md` invariant 1 | `Core-00-System/docs/` |
| `VERIFICATION-REPORT.md` | Core-00 `CAPSULE.md` invariants 1-4 | `Core-00-System/docs/` |

**Confirmed plugin-local, and left where they are:** `DSH-PARENT-CAPABILITY-MEASUREMENT.md` and
`OPENCODE-ANTIGRAVITY-FEASIBILITY.md` (no upstream citation — both ask a DSH *plugin* question),
`LIGHTPANDA-CDP.md` (host daemon consumed by these plugins), `PLUGIN-INTEGRATION-REPORT.md`
(sidebar+notify rc.3 audit; both plugins since merged, so the work is finished, not pending).

**What dsh-plugins keeps.** A **pointer stub** at each old path, not a deletion. The stubs keep every
existing relative link resolving, carry no `lifecycle:` (a stub is not a pending document), and the
indexer lists them under *"Moved out of dsh-plugins"* with the authoritative path for each. The
indexer now recognises a stub by its `MOVED — this is a pointer stub` marker, so a stub can never be
mistaken for a live pending document.

**Code updated.** `promotion-gate.mjs` and `subagent-guard.mjs` now name the new
`project-promotion-manager/docs/contracts/` path and state that the `dsh-plugins` copy is a stub.
Both still parse; the sidebar suite passes.

**Gap found and closed here.** The copies were first staged only, because `/` was mounted read-only,
yet the stubs already claimed an authority that did not exist.

**New gate: `scripts/check-doc-moves.mjs`** (wired into `npm run docs:check`). For every stub it
resolves the named destination against the projects root, fails if the file is missing, fails if the
digest changed, and fails if the stub records the wrong original path. Two regression tests cover
both failure modes. This is the gate whose absence allowed seven stubs to claim an authority that
did not exist.

**Measured here.** 12 pending documents → 5 real pending + 7 stubs. 1,228 relative links resolve.
`docs:check:all` green; all 10 per-track gates green; 7/7 stub destinations present and matching.
**Indexing, registry, and version-control of the received copies is the receiving workspace's record:
Core-01-UTM `docs/LEDGER.md` §6.10 — not this file.**

### 2026-11-06 — documentation split: one home per subproject, `pending-docs/` for undecided

Owner instruction: *"해당 문서들 모두 각각의 서브 프로젝트에 맞게 서브 프로젝트에 /docs로 넣고 …
공용문서는 미승격 및 미구현 및 폐기 미정 서브프로젝트로 생성 관리하게"*.
Rule: [docs/RULES.md](docs/RULES.md) §6.0–§6.2.

**What moved, and why.** Twenty-five files were sitting in the workspace root or `docs/` while
describing exactly one package. Each moved to the track it is about, or to `pending-docs/` when its
lifecycle is not active:

| Destination | Documents |
| :--- | :--- |
| `dsh-opencode-v2/docs/` | MODEL-SERVING-PLAN, V2-HTTP-API-MEASUREMENT, V2-SURFACE-MEASUREMENT, V2-STAGE-PLAN, CLI-WORKER-PLUGIN-DESIGN |
| `dsh-antigravity/docs/` | ANTIGRAVITY-DIRECTSDK-MEASUREMENT, ANTIGRAVITY-STAGE-PLAN |
| `dsh-deepinfra/docs/` | DEEPINFRA-ADAPTER-BRIEF |
| `dsh-tokeneconomizer/docs/` | TOKEN-ECONOMIZER-SAVING-MEASUREMENT |
| `dsh-sidebar-manager/docs/` | FORGE-VS-SIDEBAR-UTM-MEASUREMENT, FORGE-VS-SIDEBAR-UTM-RUNTIME-MEASUREMENT, UTM-REVIEW-FORGE-VS-SIDEBAR |
| `pending-docs/unpromoted/` | LIGHTPANDA-CDP, ORPHAN-SESSION-CLEANUP |
| `pending-docs/unimplemented/` | DSH-PARENT-CAPABILITY-MEASUREMENT, OPENCODE-ANTIGRAVITY-FEASIBILITY |
| `pending-docs/deprecated/` | UTM-COMPLIANCE, UTM-PROMOTION-GATE-SPEC, PLUGIN-INTEGRATION-REPORT |
| `pending-docs/undecided/` | MIGRATION, SESSION-TRANSFER-REPORT, TITLE-RESTORATION-REPORT, VERIFICATION-REPORT |
| stays in `docs/` | the two cross-track DSH runtime reports (alpha.2, alpha.3) — they judge several tracks at once |

**What changed in the tooling.** `scripts/doc-index.mjs` now writes four kinds of index instead of
one: the workspace index, `pending-docs/INDEX.md`, and one `dsh-<track>/docs/INDEX.md` per track.
Every track gained `docs:index` / `docs:check` scripts backed by `scripts/doc-index-track.mjs`,
which infers the track from its working directory so a track cannot rewrite a sibling's index.
`pending-docs/` requires a `lifecycle:` header field that must agree with its folder.
`scripts/check-doc-links.mjs` is new and runs inside `npm run docs:check`.

**Two defects this round fixed rather than introduced.** The link gate found 17 broken relative
links that predated the split (mainly `../../docs/RULES.md` in one-level-deep tracks and two image
references to files that were never committed); all 17 are repaired. Eight publishable
`package.json#files` arrays did not include `docs/`, so a published track would have shipped
without the documents that justify it; all eight now include `docs/`.

**What the gate measured.** Before: 88 indexed workspace docs, no per-track indexes, no link gate.
After: 27 workspace docs, 12 pending docs, 10 per-track indexes, 1,221 relative links resolving,
`npm run docs:check` green.


### 2026-11-05 — vendor consolidation (one package per vendor)

| Vendor | Package | Surfaces |
| :--- | :--- | :--- |
| Antigravity | `@nolit/dsh-antigravity` | `antigravity` model route, `/agy`, `agy_worker`, `antigravity` subagent provider + `subagent_antigravity`, settings section, usage chip |
| OpenCode | `@nolit/dsh-opencode-v2` | `opencode` tool, `/ocode`, `cli_worker`, `opencode-http-agent` route, `opencode` subagent provider + `subagent_opencode` |
| Local CLI (new, experimental) | `@nolit/dsh-subagent-local` | `delegate_local` over agy / opencode / codex / claude |

Why one package per vendor: a duplicate `ctx.subagents.registerProvider` name silently shadows the
other provider, and a duplicate tool/command name aborts the whole plugin row. Two packages cannot
both serve one vendor.

### 2026-11-05 — DSH `0.2.2-rc.1` migration (all tracks)

Version ladder normalized to `0.0.1-rc.N`; `engines.node` raised to `>=24.9`; Korean pack
regenerated against rc.1 (69 ns / 3,088 keys → **74 ns / 3,843 keys**); English became the default
with Korean only when the active locale is `ko`; per-provider chips moved to
`conversation.input.right`; TokenEconomizer gained per-turn/per-step developer statistics.

Per-track detail: each `dsh-<track>/CHANGELOG.md` `0.0.1-rc.N` entry, plus
[docs/DSH-RC1-PLUGIN-DELTA.md](docs/DSH-RC1-PLUGIN-DELTA.md) for the release-level delta.

### 2026-11-05 — four tracks archived

| Track | Absorbed into | Was still in the active tree until |
| :--- | :--- | :--- |
| `dsh-antigravity-directsdk` | `@nolit/dsh-antigravity` | archived in the first round |
| `dsh-antigravity-cli` | `@nolit/dsh-antigravity` | **second round, only after the owner objected** |
| `dsh-subagent-antigravity` | `@nolit/dsh-antigravity` | **second round, only after the owner objected** |
| `dsh-subagent-opencode` | `@nolit/dsh-opencode-v2` | **second round, only after the owner objected** |

## 3. Debt this chain recorded and why it is written here

The 2026-11-05 session produced three failures of the same family — **an absorbed thing was left
where it was** — plus one process failure. They are recorded here because they span tracks, and in
the per-track CHANGELOG where a specific package was involved.

| # | What happened (measured) | What should have happened | Recorded in |
| :--- | :--- | :--- | :--- |
| H-1 | Only `dsh-antigravity-directsdk` was archived. `dsh-antigravity-cli`, `dsh-subagent-antigravity` and `dsh-subagent-opencode` stayed in the active tree **after** their surfaces were being served by the merged packages. The owner had to say "이미 서브에이전트는 안티그래비티에 통합되어 서비스 되고 있는데 … 서브에이전트도 아카이브에 들어가야 하는거 잖아". | Apply the archive rule to **every** absorbed track in the same round, not only the one the owner named. | [docs/FAILURE-LEDGER.md](docs/FAILURE-LEDGER.md) F-50 |
| H-2 | The live profile kept two **broken** `node_modules/@nolit` symlinks (`dsh-subagent-antigravity`, `dsh-subagent-opencode`) after the packages were removed from `package.json`. Measured: absent from `dependencies`, from `dsh.profile.bundles`, from `pnpm-lock.yaml`, from `.modules.yaml`, from `cordis.yml`, and 0 rows in `--dump-config` — they were pure residue. Removed 2026-11-05 with a manifest at `~/.dsh/quarantine-backups/broken-links-20261105_151848.txt`; afterwards all 9 remaining `@nolit` links resolve. | Removing a package from the profile is **three** actions: drop the dependency, drop the bundle row, remove the link. Verify with `readlink` + `[ -e ]` and report broken links in the same reply. | [docs/FAILURE-LEDGER.md](docs/FAILURE-LEDGER.md) F-51 |
| H-3 | Context was lost about an earlier merge: the session re-derived what was already decided and I had to be told the merge had happened. The measurement existed in `docs/PLUGIN-CONSOLIDATION.md` but was not read before acting. | Read `docs/PLUGIN-CONSOLIDATION.md` §2 **before** touching anything vendor-related; it is the record of what is absorbed. | [docs/FAILURE-LEDGER.md](docs/FAILURE-LEDGER.md) F-52 |
| H-4 | A live API key was printed into teammate session logs while inspecting the live profile patch during isolated-boot setup (tool results, 9 logs, plus the derived search index). | Mask credential values **before** any `cat`/`grep`/`sed` on a profile patch. | [docs/FAILURE-LEDGER.md](docs/FAILURE-LEDGER.md) F-49 |

## 4. Open items handed to the next session (owner: "하지 못한 처리하지 못한 건 다음에 처리하자")

| # | Item | Measured state | Next action |
| :--- | :--- | :--- | :--- |
| P-1 | **Restart** the live service to apply everything | `dsh-web.service` running; host modules changed on disk since boot | `systemctl --user restart dsh-web.service`, then verify the checklist in §5 |
| P-2 | Orphan session cleanup | dry run finds **2** removable (`/tmp/te-ms`, `/tmp/te-side-test`); 22 unregistered logs are **linked children** and must stay | re-run `node scripts/cleanup-orphan-sessions.mjs`, then `--apply --approve <digest>` (digest at handoff: `b6f3d0e929260f35`) |
| P-3 | Leaked DeepInfra key | in 9 session logs + `~/.dsh/session-search.db`(+`-wal`) + 3 quarantine patch copies; **not** in the repo, not in any commit, not in a prompt body | owner decision on rotation; if rotating is impractical, purge the logs + the derived index (it rebuilds) |
| P-4 | `dsh-subrouter` and `dsh-command-skill` are active tracks that no profile installs | `installed=False`, `bundled=False` for both on the `web` profile | decide: install, or archive with the same bar as §1 |
| P-5 | Bootcard claims `Runtime: DSH 0.2.2-alpha.3` | measured live version is `0.2.2-rc.1` | regenerate the bootcard (`npm run bootcard -- "…"`) |
| P-6 | `total_skill` (`@nolit/dsh-skill-interrupt`) still reports `0.1.0` | separate repository, not part of the `0.0.1-rc.N` normalization | owner decision; it is outside this workspace's single-writer scope |
| P-7 | Old-version artifacts in `artifacts/` | 40+ `.tgz` including `0.9.0`, `0.8.0`, `0.7.x` | keep as release history or prune; not blocking |

## 5. Restart verification checklist (for P-1)

1. Plugins page lists `로컬 CLI 위임 (실험적)` in addition to the existing tracks.
2. Antigravity turn stores its answer in the transcript (rc.6 fix).
3. Chips: Antigravity usage, DeepInfra cost, OpenCode cost — all left of the model selector, and
   absent on a foreign provider.
4. `/agy` and `/ocode` return a child session id immediately; the answer arrives as a completion
   notice; no new top-level "그룹 없음" row appears.
5. No `did not activate` / `Invalid effect` in the boot log.

## 6. Related

- [docs/PLUGIN-CONSOLIDATION.md](docs/PLUGIN-CONSOLIDATION.md) — which packages are absorbed, archived, staged.
- [docs/FAILURE-LEDGER.md](docs/FAILURE-LEDGER.md) — every mistake and its standing rule.
- [docs/DSH-RC1-PLUGIN-DELTA.md](docs/DSH-RC1-PLUGIN-DELTA.md) — the rc.1 plugin-facing delta.
- [archive/README.md](archive/README.md) — the four archived tracks and the measured bar for archiving.
