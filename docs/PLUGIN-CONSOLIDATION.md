# Plugin Consolidation Record

<!-- skeleton:
version: 1.2
kind: report
status: active
updated: 2026-11-08
summary: Why the per-surface plugins were folded into one package per vendor, then how Antigravity and DeepInfra were absorbed into @nolit/dsh-custom-router on 2026-11-08, and what a future agent must check before reinstalling any of them.
-->

> **Read this before touching, reinstalling, or "cleaning up" any plugin named here.**
> A superseded package still has working code and passing tests. It looks alive. It is not.

## 1. What changed and why

The owner asked for **one package per vendor** so that a single install carries every surface of
that vendor's account:

| Vendor | Package | Version | Surfaces |
| :--- | :--- | :--- | :--- |
| Antigravity | `@nolit/dsh-antigravity` | `0.0.1-rc.7` | `/agy`, `agy_worker`, `antigravity` model route, `subagent_antigravity`, settings section, usage chip |
| OpenCode | `@nolit/dsh-opencode-v2` | `0.0.1-rc.1` (was `0.0.2-rc.4`; renumbered by the 2026-11-05 rc.1 normalization) | `opencode` tool, `/ocode`, `cli_worker`, `opencode-http-agent` route, `subagent_opencode` provider + tool |
| Local CLI (experimental) | `@nolit/dsh-subagent-local` | `0.0.1-rc.1` | `delegate_local` tool over agy / opencode / codex / claude |

### The forcing reason

Two packages **cannot** both serve one vendor:

1. `ctx.subagents.registerProvider(name, …)` **does not reject a duplicate name.** The second
   registration silently shadows the first, so a delegation goes to whichever mounted last — with
   no error and no log line.
2. A duplicate **tool** or **command** name aborts the entire plugin row on the host.

So "keep both, they work independently" was never an option once a subagent provider was added to
a vendor that already had a CLI plugin.

## 2. Superseded packages

These remain in the repository as history. **Do not reinstall them.**

**All four are now archived** (2026-11-05). "Superseded" and "still sitting in the active tree" are
not compatible states: an absorbed track moves to `archive/` as soon as the replacement serves its
surfaces.

| Superseded | Version at archival | Absorbed into | Moved surface | Location |
| :--- | :--- | :--- | :--- | :--- |
| `@nolit/dsh-antigravity-cli` | `0.0.1-rc.1` | `@nolit/dsh-antigravity` | `/agy`, `agy_worker` | `archive/dsh-antigravity-cli/` |
| `@nolit/dsh-subagent-antigravity` | `0.0.1-rc.1` | `@nolit/dsh-antigravity` | `antigravity` provider + `subagent_antigravity` row | `archive/dsh-subagent-antigravity/` |
| `@nolit/dsh-subagent-opencode` | `0.0.1-rc.1` | `@nolit/dsh-opencode-v2` | `opencode` provider + `subagent_opencode` row | `archive/dsh-subagent-opencode/` |
| `@nolit/dsh-antigravity-directsdk` | `0.0.1-rc.1` | `@nolit/dsh-antigravity` | the `antigravity` provider route (`ctx.llm.registerAdapter`) | `archive/dsh-antigravity-directsdk/` |

The subagent moves were the second half of the same instruction: the owner pointed out that the
subagent surfaces were already merged into `@nolit/dsh-antigravity` and were being served, so they
belonged in `archive/` too. Archiving only `directsdk` was an incomplete read of the rule.

### 2.1 Where superseded code lives now

Owner instruction 2026-11-05: a track that is fully absorbed must leave the active tree instead of
sitting beside the packages that replaced it.

| Location | Meaning |
| :--- | :--- |
| `archive/<track>/` | absorbed and **not installed anywhere**; banner at the top of its README + CHANGELOG; excluded from the doc index and the plugin-history gate |
| `staging/<track>/` | code held for a later stage, never installed (see `staging/README.md`) |
| `dsh-<track>/` | an active track: installed in a profile, tested, and owning its CHANGELOG |

`dsh-antigravity-directsdk` was measured dead before the move: not in the live profile
`package.json`, not in `dsh.profile.bundles`, **0** hits in `dsh --profile web --dump-config`, no
`@nolit` node_modules link, and `dsh-antigravity/lib/*` imports nothing from it.

Each package README and CHANGELOG now carries a `SUPERSEDED` banner naming its replacement. The
source was **not deleted** and its tests still pass — it is superseded, not broken.

> The chronological chain of merges, version ladders and archived tracks is
> [HISTORY.md](../HISTORY.md); this file is the per-package authority it links to.


### 2.2 The Custom Router integration (2026-11-08)

Owner instruction superseded the three-package shape for two vendors:

> *"커스텀라우터 플러그인 통합으로 인하여 플러그인 중에 안티그래비티, 딥인프라 플러그인 삭제 및
> 관련 서브 프로젝트 해당 플러그인 사용하지 않고 커스텀라우터 플러그인으로 통합되었다고 관련
> 문서 커밋하고, 설정-모델 pi-ai 사용 가능으로 활성화해줘"*

| Vendor | Was | Now |
| :--- | :--- | :--- |
| Antigravity | `@nolit/dsh-antigravity`, profile `link:` dependency, active `dsh-antigravity/` track | `dsh-custom-router/vendor/antigravity/`; mounted by the router; no profile dependency or link |
| DeepInfra | `@nolit/dsh-deepinfra`, profile `link:` dependency, active `dsh-deepinfra/` track | `dsh-custom-router/vendor/deepinfra/`; mounted by the router; no profile dependency or link |

This is **not** an `archive/` move: the code is still active, but its ownership moved into the
Custom Router package. `llm-pi-ai` is enabled again by the same owner instruction and is available
in Settings → Models; its previous "deprecated" wording is superseded. The measured integration
record lives at [dsh-custom-router/docs/PROVIDER-INTEGRATION.md](../dsh-custom-router/docs/PROVIDER-INTEGRATION.md).

## 3. What a future agent must do

### Before installing anything vendor-related

```bash
# 1. Is the package superseded?
grep -l "SUPERSEDED" <package>/README.md

# 2. Is the vendor already covered by a mounted bundle?
dsh --profile web --dump-config | grep -E "@nolit/dsh-(antigravity|opencode-v2)"

# 3. Is the old bundle row still present in the profile?
grep -E "antigravity-cli|subagent-antigravity|subagent-opencode" \
  ~/.dsh/profiles/web/package.json
```

If an old row is present **and** its replacement is mounted, the replacement yields with a warning:

```
antigravity: a subagent provider named "antigravity" is already registered; skipping the merged one
opencode-v2: a subagent provider named "opencode" is already registered; skipping the merged one
```

That warning is the signal to remove the old row, **not** a bug in the replacement.

### Why the guard exists instead of an error

A hard error would abort the plugin row and take the model route down with it — a worse outcome
than one surface yielding. The guard trades a loud failure for a logged, survivable one.

## 4. Surface switches (both packages)

The plugin itself is enabled/disabled from the **DSH Plugins page**. Inside it, each surface has
its own switch:

| Package | Master | Per-surface |
| :--- | :--- | :--- |
| `dsh-antigravity` | `enabled` | `modelServing`, `cliWorker` (+ `workerEnabled`), `subagent`, `usagePill` |
| `dsh-opencode-v2` | bundle row | `workerEnabled`, `subagent` |

Turning a switch off **removes** the registration (no route, no tool, no provider), so the picker
and the tool list do not show a surface that cannot serve.

## 5. History locations

| Question | Where |
| :--- | :--- |
| Why was my package merged away? | its own README/CHANGELOG `SUPERSEDED` banner |
| What changed in the replacement? | `dsh-custom-router/CHANGELOG.md`, `dsh-opencode-v2/CHANGELOG.md` |
| What went wrong and what rule came from it? | `docs/FAILURE-LEDGER.md` |
| Typography contract | `docs/PLUGIN-STYLE-STANDARD.md` (v2.0) |
| Runtime/manifest contract | `docs/dsh-plugin-runtime-spec.md` |
## 6. Version policy

**Version numbers are the Master's, not the agent's.** The global rule (`~/.dsh/AGENTS.md` §6)
is authoritative; this is the practical form for these packages:

| Rule | Detail |
| :--- | :--- |
| Scheme | `0.0.<n>-rc.<k>` — only `rc.<k>` moves once a package exists |
| `rc.<k>` increments | **once per session** in which the package was modified, never per edit and never for a release |
| A new package | starts at `0.0.1-rc.1` unless the Master names a number |
| Never | bump for a refactor, a doc pass, or "it feels finished" |

### Why the separator is `-rc.` and not `.rc`

The owner's scheme is written `0.0.1.rc3`. **pnpm rejects it:**

```
[ERR_PNPM_BAD_PACKAGE_JSON] .../package.json: Invalid version: "0.0.1.rc3"
```

A dot-separated `rc` is not valid semver (`semver.valid('0.0.1.rc3') === null`), so the package
cannot be installed at all. Both `0.0.1-rc3` and `0.0.1-rc.3` install cleanly; this repo uses
the `0.0.1-rc.<k>` form (`0.0.1-rc.4` for the current Antigravity build) so the number is explicit.

**If the owner wants the literal `.rc` form, the install step must change too** — it cannot be
satisfied by the package version alone.
