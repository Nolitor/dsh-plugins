# Plugin Consolidation Record

<!-- skeleton:
version: 1.0
kind: report
status: active
updated: 2026-11-05
summary: Why the per-surface plugins were folded into one package per vendor, which packages are superseded, and what a future agent must check before reinstalling any of them.
-->

> **Read this before touching, reinstalling, or "cleaning up" any plugin named here.**
> A superseded package still has working code and passing tests. It looks alive. It is not.

## 1. What changed and why

The owner asked for **one package per vendor** so that a single install carries every surface of
that vendor's account:

| Vendor | Package | Version | Surfaces |
| :--- | :--- | :--- | :--- |
| Antigravity | `@nolit/dsh-antigravity` | `0.0.1-rc.3` | `/agy`, `agy_worker`, `antigravity` model route, `subagent_antigravity`, settings section, usage chip |
| OpenCode | `@nolit/dsh-opencode-v2` | `0.0.2-rc.1` | `opencode` tool, `/ocode`, `cli_worker`, `opencode-http-agent` route, `subagent_opencode` |

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

| Superseded | Version | Absorbed into | Moved surface |
| :--- | :--- | :--- | :--- |
| `@nolit/dsh-antigravity-cli` | 0.1.0 | `@nolit/dsh-antigravity` | `/agy`, `agy_worker` |
| `@nolit/dsh-subagent-antigravity` | 0.1.0 | `@nolit/dsh-antigravity` | `subagent_antigravity` |
| `@nolit/dsh-subagent-opencode` | 0.1.0 | `@nolit/dsh-opencode-v2` | `subagent_opencode` |

Each package README and CHANGELOG now carries a `SUPERSEDED` banner naming its replacement. The
source was **not deleted** and its tests still pass — it is superseded, not broken.

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
| What changed in the replacement? | `dsh-antigravity/CHANGELOG.md`, `dsh-opencode-v2/CHANGELOG.md` |
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
`0.0.1-rc.3` so the number is still explicit.

**If the owner wants the literal `.rc` form, the install step must change too** — it cannot be
satisfied by the package version alone.
