# DSH Plugin Runtime Specification
<!-- skeleton:
version: 1.1
kind: spec
status: active
updated: 2026-10-31
summary: DSH plugin runtime specification: manifest, bundle patch, services, lifecycle, client factory, and the measured "declared but unexported inject" activation failure.
-->


> Status: active · Last updated: 2026-10-29 · Verified runtime: DSH `0.2.2-alpha.2` · Parent: [DSH Plugins](../) · Scope: Web profile on Pop!_OS

This document records the plugin, module-loader, styling, locale, and distribution contracts verified empirically against the DSH installation running at `/home/minami/.local/nodejs/lib/node_modules/@deepseek-ai/dsh` on 2026-10-24. It is written so that the next plugin or core migration can be implemented without re-discovery.

## Index

| Section | Purpose |
|---|---|
| [Runtime footprint](#1-runtime-footprint) | Versions, paths, service, profile |
| [Cordis and plugin model](#2-cordis-and-plugin-model) | Container rules, manifest v1, profile resolution |
| [Dynamic module loader](#3-dynamic-module-loader) | ESM Host half vs CJS-factory client bundle, HMR |
| [Typography and CSS precedence](#4-typography-and-css-precedence) | Token graph, root/body specificity, code seats |
| [Locale and translation schema](#5-locale-and-translation-schema) | Registration, fallback, spread, new namespaces |
| [Market and distribution](#6-market-and-distribution) | npm 404, link mount, bundle auto-selection |
| [Diagnostic runbook](#7-diagnostic-runbook) | Commands and failure signatures |
| [Empirical evidence](#8-empirical-evidence) | Exact checks used for this document |

---

## 1. Runtime footprint

### 1.1 Running stack

| Component | Value |
|---|---|
| DSH CLI | `0.2.2-alpha.2` |
| Installation anchor | `/home/minami/.local/nodejs/lib/node_modules/@deepseek-ai/dsh` |
| CLI binary | `/home/minami/.local/nodejs/bin/dsh` |
| Node.js | `24.22.1` |
| Cordis | `4.0.6-alpha.1` |
| `@deepseek-ai/*` packages | 330 installed; 319 at `0.2.2-alpha.2` |
| DSH home | `/home/minami/.dsh` (`DSH_HOME`) |
| Active profile | `/home/minami/.dsh/profiles/web` |
| Profile runtime | pnpm `11.28.5`, `nodeLinker: hoisted`, `autoInstallPeers: false` |
| Web service | `dsh-web.service` (user unit), `Restart=always`, `RestartSec=3` |
| Web port | `0.0.0.0:3080` (plain HTTP, `--trusted-host *`) |
| Frontend dist | `.../dsh-web-frontend/dist/assets/index-BNyAYEM7.css`, `index-BXV-oxvX.js` |

### 1.2 Profile composition

`~/.dsh/profiles/web/package.json` composes ordered bundle layers:

```json
{
  "dependencies": {},
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@deepseek-ai/dsh-experimental-auto-review",
        "@deepseek-ai/dsh-experimental-agent-team-profile"
      ]
    }
  }
}
```

A bundle is a normal npm dependency whose `package.json` declares `dsh.bundle.patch`; selecting it adds that patch layer to the profile's Cordis tree. There is no global plugin directory. Discovery is profile-scoped:

```
~/.dsh/profiles/web/
├── package.json          # dependencies + dsh.profile.bundles
├── cordis.patch.yml      # user patch layer, applied last
├── cordis.yml            # root entry list (empty by convention)
├── pnpm-workspace.yaml   # pnpm settings
├── node_modules/         # profile-installed packages (link or registry)
└── .plugin-manager/      # operation logs and run records
```

---

## 2. Cordis and plugin model

### 2.1 Manifest v1

DSH reads public plugin metadata from `package.json#dsh`. `manifestVersion: 1` remains current in `0.2.2-alpha.2`.

| Field | Requirement | Notes |
|---|---|---|
| `dsh.manifestVersion` | optional, value `1` | Format identifier, independent of npm version |
| `dsh.bundle.patch` | required for a bundle | String path or ordered string list, relative to package root |
| `dsh.client.platform` | required for a browser half | `"web"` for this GUI |
| `dsh.client.immediately` | optional boolean | Stage-one prefetch of the client factory |
| `dsh.client.inject` | optional string[] | Package-name dependency edges; also composition order |
| `dsh.client.external` | optional string[] | Exact non-baseline module requests |
| `engines.node` | optional range | Enforced by the launcher; this host runs Node 24.22.1 |
| `engines.dsh` | optional range | Enforced at composition; takes precedence over `peerDependencies` |

Minimal verified shape:

```json
{
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "default": "./lib/index.js" },
    "./client": "./lib/client.js"
  },
  "engines": {
    "node": ">=24",
    "dsh": ">=0.2.2-alpha.2 <0.3.0"
  },
  "dsh": {
    "manifestVersion": 1,
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": ["@deepseek-ai/dsh-client-locale"]
    }
  }
}
```

`engines.dsh` is checked before a profile imports a plugin. A range that does not match the single runtime version yields a refused row (or a skipped bundle) unless an exact entry exists in `~/.dsh/profiles/web/compatibility.json`. A declared `engines.dsh` suppresses the `peerDependencies` check.

### 2.2 Container and row lifecycle

A DSH plugin package is a **bundle**: the package itself is selected in `dsh.profile.bundles`, and its `dsh.bundle.patch` contributes rows. The verified split is:

- **Host half** (`lib/index.js`, ESM): runs in the Host process. It must be importable and export a Cordis plugin (`name`, optionally `apply`, `inject`, `Config`). It must not import browser code.
- **Browser half** (`lib/client.js`, CJS factory): discovered from `package.json#dsh.client`; served by the client module system; never loaded by the Host.

A language pack needs both halves even when the Host half is inert: the client module graph is composed from enabled Loader rows, so a package with no loadable Host row is never scanned and its browser bundle never reaches the page.

Verified Host half:

```js
export const name = 'korean-locale'
export function apply() {}
```

Verified bundle patch:

```yaml
- insert:
    - id: korean-locale
      name: '@nolit/dsh-korean-locale'
```

The patch format is still a top-level YAML array of loader patch entries (`insert`, config overrides, `disabled`, `!!js` expressions). It is applied after every bundle layer; the profile patch is applied last and therefore outranks bundle layers.

### 2.3 Profile resolution rules

- Packages are resolved from the profile's dependency graph; a `link:` dependency points at a local checkout.
- Runtime resolution is computed from the installation and ordered bundle dependency graphs. There is no fallback link creation and no global package discovery.
- A linked checkout uses its own dependencies and peers. Rebuild and restart are required after code changes unless the client HMR watcher is active.
- `autoInstallPeers: false` means a plugin must declare runtime peers it needs, or rely on the platform baseline table for browser modules.

### 2.4 Sandbox and permission boundaries

- Profile plugin Host code runs **in-process**, outside the workspace file sandbox.
- Installation through the Plugins page or `plugin_manager` requires `danger-full-access` or an approval.
- pnpm dependency build scripts are blocked until allowed by package name in `pnpm-workspace.yaml` (`allowBuilds`) or approved through the manager.
- These boundaries apply to installation and tool approvals, not to plugin module execution; a plugin is trusted code once mounted.

---

## 3. Dynamic module loader

### 3.1 Bundle shape

The browser half is a **lazy CJS factory**, not an ES module. It registers itself with the shell's queue facade:

```js
window.__ModuleLoader__.load({
  id: '@scope/plugin-name',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const inject = ['locale']
    function apply(ctx) { /* register effects */ }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
```

Key rules verified in rc.3:

- `id` must equal the package name; `<id>/client` and the bare id resolve to the same exports.
- `factory(require)` executes at first materialization, not when the script arrives. Side effects (including CSS injection) belong in the factory closure or in `apply`.
- `require` resolves against the frozen platform module table plus `dsh.client.external`; there is no arbitrary npm resolution in the browser.
- `apply` and `inject` are Cordis plugin exports. `inject: ['locale']` waits for the locale service.
- **`inject` must be exported, not merely declared.** The loader injects only what
  `module.exports.inject` lists (`fiber.inject`); a `const inject = [...]` that is never assigned to
  `exports.inject` buys nothing. `ctx.<service>` is then `undefined` and the first call throws during
  activation, which the shell reports as `web boot: N entries did not activate` → `<pkg>: failed`.
  Measured 2026-10-30: `@nolit/dsh-opencode-v2@0.6.0` declared `const inject = ['slots']`, called
  `ctx.slots.inject('settings.section', …)` in `apply()`, and exported only `apply` — the entire web
  UI stopped mounting while the Host side stayed healthy. Every `ctx.<service>` touched in `apply`
  must appear in the exported array.
- Do not import browser code from the Host half and do not add a second patch row for `./client`; the browser half is discovered automatically.

### 3.2 Manifest client declaration

```json
"client": {
  "platform": "web",
  "immediately": true,
  "inject": ["@deepseek-ai/dsh-client-locale"]
}
```

- `platform` selects the client environment (`web`).
- `immediately` marks the stage-one prefetch batch; the factory still runs lazily.
- `inject` is a package-name dependency edge for factory arrival and composition order. It is not Cordis service injection; service injection comes from the exported `inject` array.
- `external` is only for exact non-baseline module specifiers.

### 3.3 Serving and HMR

- The Host builds a boot graph from enabled Loader entries and serves client bundles under `/plugins`.
- The graph is injected as `window.__DSH_BOOT__` rows before the shell mounts.
- A new profile dependency with a valid `dsh.bundle` is picked up by the host reconciliation pass and appears in the served boot graph without a restart in the verified setup. A **browser reload** is still needed to load new factories into an existing page.
- Client-plugin changes reload without a manual refresh only while `pnpm run dev:web` (the rebuild watcher) is running. Otherwise rebuild and restart the Host.
- HMR serializes module reloads and file watching; profile package operations run outside that queue.
- Bundle revisions derive from file `mtimeMs`, `ctimeMs`, and size; unchanged artifacts keep revisions across Host restarts.

### 3.4 Module-load failure signatures

| Symptom | Likely cause |
|---|---|
| `declares dsh.client but exports no "./client" bundle` | Missing `exports["./client"]` |
| `dsh.client.client must be an object` / `platform must be a string` | Malformed manifest |
| `module graph cycle` | `dsh.client.inject` cycle or a consumer loaded before its provider |
| `web boot: N entries did not activate` + `<pkg>: failed` | A client entry's `apply()` threw; DSH surfaces no detail. Most common cause: an `inject` array that was declared but never exported, so `ctx.<service>` is `undefined` (measured 2026-10-30, `dsh-opencode-v2@0.6.0`) |
| `<pkg>: pending (waiting for services: a, b)` | The entry declared services that nothing provides — wrong service name, or the provider row is missing |
| Factory runs but service missing | Service not listed in the exported `inject` array |
| Page shows old plugin after edit | Host not restarted, or client HMR watcher not running |

---

## 4. Typography and CSS precedence

### 4.1 Core token graph (rc.3)

Theme `base.css` (injected by `dsh-client-ui-theme`) owns these declarations:

```css
:root {
  --dsh-font-family-text-default: -apple-system, BlinkMacSystemFont, "Segoe UI",
    "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue",
    Helvetica, Arial, sans-serif;
  --dsw-font-family: var(--dsh-font-family-text-default);
  --dsw-font-family-brand: "Montserrat", var(--dsh-font-family-text-default);

  --dsh-font-family-code-default: "SF Mono", "JetBrains Mono", "Fira Code",
    Consolas, "Liberation Mono", Menlo, Courier, "PingFang SC", "Microsoft YaHei";
  --ds-font-family-code: var(--dsh-font-family-code-default);
}

body {
  --dsw-font-family:
    var(--dsh-font-family-text, var(--dsh-font-family-text-default)),
    var(--dsh-font-family-text-default);
  --ds-font-family-code:
    var(--dsh-font-family-code, var(--dsh-font-family-code-default)),
    var(--dsh-font-family-code-default);
}
```

The built application CSS then applies:

```css
body {
  font-family: var(
    --dsw-font-family,
    -apple-system, BlinkMacSystemFont, "Segoe UI", ...
  );
}
```

### 4.2 Role seats

| Role | Seat variable | Default |
|---|---|---|
| Interface/conversation text | `--dsw-font-family` built from `--dsh-font-family-text` | `--dsh-font-family-text-default` |
| Code blocks / inline code | `--ds-font-family-code` built from `--dsh-font-family-code` | `--dsh-font-family-code-default` |
| Sidebar terminal | `--dsh-font-family-terminal` | No core default; terminal reads it when set |
| Brand text | `--dsw-font-family-brand` | Montserrat + default text stack |

`--dsh-font-family-text`, `--dsh-font-family-code`, and `--dsh-font-family-terminal` are written as **inline styles on `body`** by the layout ThemePresenter when the corresponding settings field is non-empty, and removed when empty.

### 4.3 Hydration order and the root+body rule

On every page load the following can re-assert the body seats:

1. The Host boot script injects font sizes and every non-empty `--dsh-font-family-<role>` list into `body.style`.
2. `dsh-client-ui-theme` injects its global token sheets.
3. `dsh-client-ui-layout`'s `ThemePresenter.apply()` writes font sizes, writes/removes user font lists, and rewrites palette tokens on `body`.
4. A profile plugin's `apply()` may inject its own stylesheet.

A body-only plugin declaration can therefore be shadowed by later body writes or inline settings. The verified durable pattern is to bind at **both** the root and `body` with a language-scoped selector:

```css
:root:lang(ko),
html:lang(ko),
html[lang^="ko" i] {
  --dsh-font-family-text: "Pretendard Variable", Pretendard, /* … */ sans-serif;
  --dsw-font-family: var(--dsh-font-family-text), var(--dsh-font-family-text-default);
}

:root:lang(ko) body,
html:lang(ko) body,
html[lang^="ko" i] body {
  --dsh-font-family-text: "Pretendard Variable", Pretendard, /* … */ sans-serif;
  --dsw-font-family: var(--dsh-font-family-text), var(--dsh-font-family-text-default);
  font-family: var(--dsw-font-family);
}
```

Why this works without `!important`:

- `:root:lang(ko)` beats the core `:root` rule on specificity.
- `html:lang(ko) body` beats the core `body` rule on specificity.
- An explicit Settings font is written **inline** on `body`; inline styles outrank selectors, so the user's choice still wins.
- `lang` is maintained by `dsh-client-locale`; changing to `en` or `zh-CN` deactivates the rule and restores the core stack with no JS listener.

### 4.4 Monospace preservation

The code and terminal seats are separate. A typography plugin must:

- never reference `--ds-font-family-code` or `--dsh-font-family-terminal`;
- never target `pre`, `code`, `kbd`, `samp`, or `textarea`;
- allow text inputs and `contenteditable` to consume the text seat.

Verified computed styles on rc.3 with the real built CSS and `base_css_default`, simulating plugin mount → late core token re-apply → `lang=ko`:

| Surface | Computed stack |
|---|---|
| `body` | `"Pretendard Variable", Pretendard, ...` |
| `input[type=text]` | Korean stack |
| `contenteditable` | Korean stack |
| `pre` inside Markdown | `"SF Mono", "JetBrains Mono", "Fira Code", Consolas, ...` |
| Explicit inline user font | `"User Chosen Font", -apple-system, ...` |
| `lang=en` | `-apple-system, BlinkMacSystemFont, "Segoe UI", ...` |

No `@layer` or `@scope` is used by rc.3 core CSS (0 occurrences in `index-*.css` and `vendor-*.css`; one unrelated `@supports`), so specificity behaves as described. If a future core adds cascade layers, revisit this contract.

---

## 5. Locale and translation schema

### 5.1 Runtime API

`@deepseek-ai/dsh-client-locale` exposes:

```js
ctx.locale.getSnapshot()          // { active, locales: [{id,label,fallback}], revision }
ctx.locale.addLanguage({ id, label, fallback })
ctx.locale.register(ns, 'ko', dict)          // external language pack form
ctx.locale.register(ns, { zh, en })          // built-in/shipped package form
ctx.locale.bind(ns)                           // stable translate function
```

Rules verified in rc.3:

- Built-in locales are only `zh` and `en`; there is no built-in `ko` in `0.2.1-rc.3`.
- External ids must be BCP 47-style tags; fallback must already be registered and the chain must terminate at `en`.
- A language pack should stand down if `getSnapshot().locales` already contains its id, and skip a namespace whose `ko` seat is already owned.
- Dictionaries may register after the UI mounts; the framework picks them up without remount.
- Lookup order: requested namespace in the active language chain, then `common` in that chain, then the raw key.
- Unknown/unregistered namespaces display the shipped English text, not the key.

### 5.2 Dictionary shapes and spread behavior

Shipped packages use both forms:

```js
ctx.locale.register(NS, { zh, en })
ctx.locale.register(NS, { zh: zh$1, en: en$1 })
for (const [locale, dict] of dictionaries) ctx.locale.register(LOCALE_NS, locale, dict)
```

Dictionaries are flat `{ "key": "value" }` objects, but rc.3 increasingly composes them with spread:

```js
const en$3 = {
  ...zoomEn,
  title: "PDF",
  pageImage: "PDF page {page}",
  // ...
}
```

Consequences for coverage tooling:

- A raw string/regex extractor undercounts keys unless it expands spread sources.
- Key parity must be computed after evaluating the final object, not from the literal text.
- Unquoted keys are common in compiled bundles; a parser must accept them.
- The `dsh-client-locale` built-in registers `common` and `settings.locale` through `locale.register(...)` (without `ctx.`); scanners must cover both call shapes.

### 5.3 `0.2.2-alpha.2` coverage refresh (verified)

`@nolit/dsh-korean-locale` v0.2.2 carried a `0.2.1-rc.2` snapshot and showed
English fallbacks in the upgraded UI (the sidebar panel picker rendered `More`).
A post-spread AST extraction over the 75-entry served boot graph found **103
missing keys in enabled namespaces** plus 14 missing keys in the optional
plugin-market/voice-input namespaces.

v0.2.3 added **117 Korean strings**, removed **8 retired keys**, and now carries
**68 namespaces / 3,019 keys** with `data/coverage.json.baseVersion =
"0.2.2-alpha.2"`. The re-measured browser boot renders `더 보기` and reports no
console/page errors. Optional bundles that are not part of the current web
profile (Forge, Liveshare, Stats, CUA, Action Cards, Creation/Plugin
Recommendations) remain a documented future-coverage backlog.

### 5.4 Language-pack skeleton

```js
function apply(ctx) {
  if (ctx.locale.getSnapshot().locales.some((l) => l.id.toLowerCase() === 'ko')) return
  ctx.effect(() => ctx.locale.addLanguage({ id: 'ko', label: '한국어', fallback: 'en' }))
  for (const [ns, dict] of Object.entries(dictionaries)) {
    ctx.effect(() => ctx.locale.register(ns, 'ko', dict))
  }
}
```

Wrap every registration in `ctx.effect` so disabling/removing the bundle disposes the seat.

---

## 6. Market and distribution

### 6.1 Market index

`market/index.json` uses format 1:

```json
{
  "format": 1,
  "plugins": [{
    "name": "@nolit/dsh-korean-locale",
    "versions": [{
      "version": "0.2.2",
      "publishTimestamp": 1792756415,
      "source": { "type": "npm" },
      "engines": { "dsh": ">=0.2.2-alpha.2 <0.3.0" }
    }]
  }]
}
```

The rc.3 `parseMarketIndex` accepts it and produces install target `@nolit/dsh-korean-locale@0.2.2`. However:

- `npm view @nolit/dsh-korean-locale` returns **E404** from `registry.npmjs.org`.
- The package is unpublished, private, or requires registry auth.
- `release.manifest.json` declares GitHub publishing only, matching the git-installable reality.

**Pitfall:** a market entry with `"type": "npm"` that is not published will fail the Discover install. Use `link:` for a local checkout, a Git source pinned to a commit, or publish to npm before shipping a `npm` market version.

### 6.2 Local link mount

Verified command:

```sh
dsh plugin --profile web add link:/home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-korean-locale
```

What rc.3 actually does:

1. `dsh plugin` forwards `add` to pnpm in the profile directory under the profile write lock.
2. The plugin manager snapshots `package.json` and `pnpm-lock.yaml`.
3. It reads each new package's manifest and runs `evaluatePluginCompatibility` against `engines.dsh`; an incompatible version is rejected before install.
4. After pnpm succeeds, `reconcile()` appends any newly installed direct dependency that declares `dsh.bundle` to `dsh.profile.bundles` (and drops selections whose dependency disappeared).
5. A package with no `dsh.bundle` is installed as a plain dependency with a warning and is not selected.
6. On a failed or cancelled run, the manifest and lockfile are restored.

Observed result:

```json
{
  "dependencies": {
    "@nolit/dsh-korean-locale": "link:/home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-korean-locale"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@deepseek-ai/dsh-experimental-auto-review",
        "@deepseek-ai/dsh-experimental-agent-team-profile",
        "@nolit/dsh-korean-locale"
      ]
    }
  }
}
```

The bundle is appended at the end, so it outranks earlier bundle layers but is still below `cordis.patch.yml` and home/invocation patches.

### 6.3 Activation and restart

- A profile change is composed at startup and on recomposition.
- With the running Host, a newly added bundle appears in the served boot graph; the browser needs a reload to load the new client factory.
- Without a rebuild watcher, client bundle changes need a Host restart.
- Restart command:

```sh
systemctl --user restart dsh-web.service
```

The unit has `Restart=always`; the GUI returns after `RestartSec=3`. The access token may rotate on restart, so read the new URL from the service logs/status.

### 6.4 Uninstall

```sh
dsh plugin --profile web remove @nolit/dsh-korean-locale
systemctl --user restart dsh-web.service
```

Removal deselects the bundle and unloads its rows under HMR; a stored `locale.preference: ko` remains inactive until the definition is available.

---

## 7. Diagnostic runbook

```sh
# 1. Versions and paths
dsh --version
systemctl --user status dsh-web.service --no-pager
readlink -f /home/minami/.local/bin/dsh

# 2. Profile dependency and bundle selection
node -e 'const p=require(process.env.HOME+"/.dsh/profiles/web/package.json"); console.log(JSON.stringify(p,null,2))'

# 3. Composed tree (look for the row and any skip warning)
dsh --profile web --dump-config | grep -n -A4 -B2 '<plugin-id>'

# 4. Running boot graph (does the client bundle reach the page?)
curl -sS http://127.0.0.1:3080/ | grep -o '<plugin-package>[^"&]*' | sort -u

# 5. Client bundle route (revision comes from the boot graph)
curl -sS -o /dev/null -w '%{http_code}\n' \
  'http://127.0.0.1:3080/plugins/@scope/plugin/client.js'

# 6. Service logs
systemctl --user status dsh-web.service --no-pager
journalctl --user -u dsh-web.service -n 50 --no-pager

# 7. Plugin-manager install logs
find ~/.dsh/profiles/web/.plugin-manager -type f -name 'pnpm.log' -print
```

Failure signatures:

| Observation | Meaning |
|---|---|
| Row missing from `--dump-config` | Bundle not in `dsh.profile.bundles`, or package unreadable |
| `skippedBundles` / compatibility warning | `engines.dsh` mismatch; add exact `compatibility.json` entry only after risk acceptance |
| Row present, package absent from `curl /` boot graph | Client bundle not discovered; check `dsh.client`, `exports["./client"]`, Host row load |
| Boot graph present, UI unchanged | Browser not reloaded, or client factory failed at materialization; check DevTools console |
| `404` on `/plugins/...` | Wrong revision/URL, or plugin not in the active graph |
| Plugin CSS missing | `apply()` not reached (service injection unresolved), or style element removed by disposal |

---

## 8. Empirical evidence

| Check | Result |
|---|---|
| `dsh --version` | `0.2.1-rc.3` |
| Package version scan | 295 × `0.2.1-rc.3`; Cordis `4.0.5`; Node `24.2.0` |
| Served index assets | `index-BNyAYEM7.css`, `index-BXV-oxvX.js` |
| CSS at-rule scan | 0 `@layer`, 0 `@scope`, 1 unrelated `@supports` |
| Theme base CSS | Same `:root`/`body` font composition as `0.2.1-rc.2` |
| `ThemePresenter.apply()` | Same inline `setProperty`/`removeProperty` behavior |
| Built-in locales | `zh`, `en` only; no `ko` |
| `engines.dsh` against rc.3 | `>=0.2.1-rc.2 <0.3.0` satisfies `0.2.1-rc.3` |
| Market index parse | Valid under rc.3 `parseMarketIndex`; npm target |
| npm lookup | `E404` |
| Link install | Dependency + bundle selection written; compatibility preflight passed |
| Restart | `dsh-web.service` active since 2026-10-24 18:38:28 KST; plugin appears in served boot graph |
| Typography computed-style proof | `ok: true` — Korean body/input/editor; SF Mono `pre`; user font wins; `en` restores |

Related assets:

- Plugin source: `/home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-korean-locale`
- Boot card: [plugin-boot-card.md](./plugin-boot-card.md)

---

## 9. `0.2.2-alpha.2` re-measurement (2026-10-29)

| Check | Result |
|---|---|
| `dsh --version` | `0.2.2-alpha.2` |
| `node --version` | `v24.22.1` |
| Cordis | `4.0.6-alpha.1` |
| `@deepseek-ai/*` package scan | 330 packages; 319 at `0.2.2-alpha.2` |
| Isolated boot | real `dsh web` under a workspace-local `DSH_HOME`, no writes to the live profile |
| Served boot graph | 75 entries |
| Nolit entries | `@nolit/dsh-korean-locale`, `@nolit/dsh-sidebar-manager`, `@nolit/dsh-notify` (notify linked only inside the isolated profile) |
| Browser locale | `<html lang="ko">`, Korean UI, no console/page errors |
| Sidebar routes | 5/5 read-only routes returned HTTP 200; negative control 404 |
| Korean coverage | 68 namespaces / 3,019 keys; enabled-surface missing = 0 |
| Plugin tests | Korean verify PASS; sidebar 123/123; notify 19/19 |
| Installed vs workspace tree | `sidebar-manager` link resolves to the same realpath; tree SHA-256 matches |
| UTM drift audit | post-recovery UTM additions detected; local `0.1.2` tarball (`fef72c59…8972c`) re-baselined by `scripts/audit-installed-vs-packaged.mjs` |
| OS notification daemon | `org.freedesktop.Notifications` not activatable → toast/sound fallback only |
