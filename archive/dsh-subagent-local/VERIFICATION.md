# Verification — @nolit/dsh-subagent-local 0.0.1-rc.1

<!-- skeleton:
version: 1.0
kind: measurement
status: measured
updated: 2026-11-05
summary: Measured verification for the experimental local-delegation plugin: unit suite, syntax checks, isolated DSH_HOME composition, real rc.1 boot, and browser checks.
-->

> Measured 2026-11-05 (KST) on the installed DSH `0.2.2-rc.1` / Node `v24.22.1` / Cordis `4.1.0`.
> The live `~/.dsh` profile was **read only**; the boot proof used an isolated `DSH_HOME` under the
> package's temporary directory, which was deleted after the run.

## 1. Unit suite

```sh
cd dsh-subagent-local && npm test
```

```text
ℹ tests 52
ℹ pass 52
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```

Coverage groups:

| File | What it proves |
| :--- | :--- |
| `test/backends.test.mjs` | prompt never rides in argv for stdin backends; agy argv/effort rules and 131,071-byte cap; opencode/codex/claude argv shapes; all four stdout parsers; degradation to raw text. |
| `test/worker.test.mjs` | backend resolution (explicit miss, auto order, disabled backend); stdin vs argv delivery at the spawn spec; deadline → `timedOut`; lossy reader → `truncated`; relative cwd refused before spawn; spawn failure becomes a diagnostic; artifact collection/limits; artifactDir writes and path-escape rejection. |
| `test/plugin.test.mjs` | schema defaults/validation; reserved-name yield; already-mounted-name yield; rc.1 tool shape (`output.schema` + `output.render` + `when`); `apply()` returns nothing (effect contract regression); disabled result; provider-yield; one real delegated call through a fake subprocess; locale parity and `ko`-only selection; package/bundle/icon/locale consistency; no provider or command registration. |

## 2. Syntax checks

```sh
for f in lib/*.js test/*.mjs; do node --check "$f" && echo "OK $f"; done
```

All nine files: `OK` (six `lib/` modules, three `test/` files).

## 3. Package artifact

```sh
npm_config_cache=./.tmp-npm-cache npm pack --dry-run
```

```text
npm notice name: @nolit/dsh-subagent-local
npm notice version: 0.0.1-rc.1
npm notice filename: nolit-dsh-subagent-local-0.0.1-rc.1.tgz
npm notice package size: 26.8 kB
npm notice unpacked size: 88.8 kB
npm notice shasum: dad83b73b557036a6d3387cd4a4d8b62559ea7cf
npm notice total files: 13
```

Contents: `COMPATIBILITY.md`, `CHANGELOG.md`, `README.md`, `VERIFICATION.md`, `cordis.patch.yml`,
`icon.svg`, six `lib/*.js`, `locale/{en,ko}.json`, `package.json`. `test/` is intentionally not
published (`files`).

## 4. Isolated composition (`--dump-config`)

The isolated `DSH_HOME` was built without touching the live profile:

1. copied `profiles/web/{package.json,cordis.patch.yml,pnpm-workspace.yaml}`;
2. created a real `profiles/web/node_modules` whose entries are **absolute** links to the live
   profile's entries (the live relative `link:` symlinks are not copied, per FAILURE-LEDGER F-10),
   plus `@nolit/dsh-subagent-local → <package root>`;
3. added the package as a `link:` dependency and appended it to `dsh.profile.bundles`;
4. redirected `session-query-sqlite.path` into the isolated home and disabled the
   `tokeneconomizer-dsh` row.

```sh
DSH_HOME=<isolated> dsh --profile web --dump-config
```

Measured: exit code 0, 322 composed rows, **no** `skipped`/compatibility warning, and our row is
present:

```text
- id: dsh-subagent-local
  name: '@nolit/dsh-subagent-local'
  config:
    enabled: true
    toolName: delegate_local
    backend: auto
    ...
```

Measured tool rows in the same composition (collision check): `subagent`, `subagent_fork`,
`subagent_opencode`, `subagent_antigravity`, and `delegate_local`. No provider name is claimed by
this package.

## 5. Real rc.1 boot

```sh
DSH_HOME=<isolated> dsh --profile web --host 127.0.0.1 --port 0 --no-open
```

Boot log (first boot of the initial implementation):

```text
dsh: warning: 1 entry did not activate
dsh-subagent-local (@nolit/dsh-subagent-local): TypeError: Invalid effect
```

Cause and fix: `apply()` returned a state object; a Cordis plugin's `apply` runs as an effect and a
resolved non-function value is rejected. Fixed by making `apply()` return nothing and exposing
`mount()` for the state. See `CHANGELOG.md` §"Defect found and fixed".

Boot log after the fix (re-run from a clean temporary tree with the final code):

```text
dsh web: http://127.0.0.1:43031/?token=…
```

- **no** `did not activate` line, no `skipping profile bundle`, no `cannot resolve`;
- the printed URL served the shell normally.

## 6. Browser check

Playwright (`playwright-core@1.64.1`, Chromium `chromium-1248`) against the isolated boot URL:

| Check | Measured |
| :--- | :--- |
| Page title | `DeepSeek Harness` |
| `pageerror` events | **0** |
| console errors | **0** |
| Boot graph entries | 80 |
| Browser checks run | twice: after the fix and again on the final build; identical results |
| `<html lang>` | `ko` (the profile's locale preference) |
| Plugin manager | card **“로컬 CLI 위임 (실험적)”** present with the Korean locale description and `delegate_local` in the text |
| Activation-failure text on the page | absent |

Screenshot retained only in the temporary directory and deleted with it; the numbers above are the
evidence.

## 7. Cleanup

The isolated tree (`dsh-subagent-local/.tmp-verify-delegate/`), the temporary npm cache, and the
tarball-inspection scratch directory were deleted after the run. No write under `~/.dsh`; the live
`web` service was not restarted.
