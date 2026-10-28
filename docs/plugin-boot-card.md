# DSH Plugin Boot Card

> Status: active · Last updated: 2026-10-29 · Runtime: DSH `0.2.2-alpha.2` (Cordis 4.0.6-alpha.1, Node 24.22.1) · Companion: [dsh-plugin-runtime-spec.md](./dsh-plugin-runtime-spec.md)

A one-page cheat sheet for building, linking, and debugging a DSH web plugin without re-discovering the runtime.

## 1. Minimal layout

```
my-plugin/
├── package.json
├── cordis.patch.yml
├── lib/
│   ├── index.js          # Host half (ESM, inert allowed)
│   └── client.js         # Browser half (CJS factory, committed)
├── styles/
│   └── plugin.css        # optional
└── README.md
```

## 2. `package.json`

```json
{
  "name": "@scope/my-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "default": "./lib/index.js" },
    "./client": "./lib/client.js"
  },
  "files": ["lib/index.js", "lib/client.js", "cordis.patch.yml", "styles/*.css"],
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
  },
  "scripts": {
    "build": "node scripts/build.mjs",
    "verify": "node scripts/verify.mjs",
    "test": "node scripts/verify.mjs"
  }
}
```

`inject` inside `dsh.client` names package rows; the exported `inject` array names Cordis services. They are different mechanisms.

## 3. `cordis.patch.yml`

```yaml
- insert:
    - id: my-plugin
      name: '@scope/my-plugin'
```

One row for the whole package. The browser half is discovered from `package.json#dsh.client`; never add a second row for `./client`.

## 4. Host half (`lib/index.js`)

```js
export const name = 'my-plugin'

/** Inert is valid: the row exists so the client module graph scans the package. */
export function apply() {}
```

If the plugin provides services or settings, implement them here. Never import `lib/client.js` or browser APIs from the Host.

## 5. Browser half (`lib/client.js`)

```js
window.__ModuleLoader__.load({
  id: '@scope/my-plugin',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    /** Cordis services this client plugin waits for. */
    const inject = ['locale']

    /** @param ctx - client root context. */
    function apply(ctx) {
      ctx.effect(() => {
        if (typeof document === 'undefined' || !document.head) return () => {}
        document.querySelector('style[data-plugin-css="@scope/my-plugin/plugin.css"]')?.remove()
        const style = document.createElement('style')
        style.dataset.plugin = '@scope/my-plugin'
        style.dataset.pluginCss = '@scope/my-plugin/plugin.css'
        style.textContent = '/* generated CSS */'
        document.head.appendChild(style)
        return () => style.remove()
      }, 'my-plugin: css')
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
```

Rules:

- The factory runs lazily at first materialization; register everything through `ctx.effect` so disposal unloads it.
- `require` resolves only against the platform baseline + `dsh.client.external`; no arbitrary npm imports.
- Commit the built `lib/client.js`; a marketplace/link install should not require a build step.

## 6. Build and verify

```sh
node scripts/build.mjs      # source/data + CSS -> lib/client.js
node scripts/verify.mjs     # metadata + generated artifact + apply contract
npm test                    # same contract, CI-friendly
```

Minimum checks the build should enforce:

- `engines.dsh` covers the running core.
- Every packaged file exists.
- The generated bundle contains the expected selector and `data-plugin-css` tag.
- A fake locale/effect context can call `apply()` and dispose it.
- Plugin CSS references only text-seat variables and never code/terminal seats.

## 7. Link and activate

```sh
# From the plugin checkout
dsh plugin --profile web add link:"$(pwd)"

# Confirm dependency + bundle selection
node -e 'const p=require(process.env.HOME+"/.dsh/profiles/web/package.json"); console.log(JSON.stringify(p,null,2))'

# Confirm the composed row
dsh --profile web --dump-config | grep -n -A4 -B2 'my-plugin'

# Confirm the running Host has the client row
curl -sS http://127.0.0.1:3080/ | grep -o 'my-plugin[^"&]*' | sort -u

# Restart the Web service
systemctl --user restart dsh-web.service
```

`dsh plugin add` runs pnpm, preflights `engines.dsh`, and then appends any new dependency that declares `dsh.bundle` to `dsh.profile.bundles`. A package without `dsh.bundle` is installed as a plain dependency and gets a warning; it is not activated.

### Restarting without killing the current agent turn

If the command runs inside the DSH process being restarted, schedule the restart through a transient user timer:

```sh
systemd-run --user --on-active=30 --unit=dsh-web-restart-once \
  systemctl --user restart dsh-web.service
```

The unit has `Restart=always`; it returns after `RestartSec=3`. The browser token may rotate; read the new URL from the service status/log.

## 8. Typography computed-style harness

This reproduces hydration order against the real `0.2.2-alpha.2` CSS: plugin stylesheet first, late core token re-apply, then `lang=ko`.

### 8.1 Generate the fixture

```sh
cat > /tmp/make-typography-fixture.mjs <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs'
const dsh = '/home/minami/.local/nodejs/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const theme = readFileSync(`${dsh}/dsh-client-ui-theme/lib/client.js`, 'utf8')
const css = readFileSync(`${dsh}/dsh-web-frontend/dist/assets/index-BNyAYEM7.css`, 'utf8')
const pluginCss = readFileSync(process.argv[2] ?? 'styles/typography.css', 'utf8')
const core = JSON.parse(theme.match(/var base_css_default = (".*?");\n/u)[1])
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<style id="core">${core}</style><style id="app">${css}</style><style id="plugin">${pluginCss}</style>
</head><body>
<div id="text">안녕하세요</div><input id="input" type="text" value="검색" />
<div id="editor" contenteditable="true">입력</div>
<div class="_markdown_1ypvv_5"><pre id="pre"><code>const x = 1</code></pre></div>
<pre id="result">pending</pre>
<script>
(() => {
  const late = document.createElement('style'); late.textContent = document.getElementById('core').textContent
  document.head.appendChild(late)
  document.body.style.removeProperty('--dsh-font-family-text')
  document.documentElement.lang = 'ko'
  const f = (id) => getComputedStyle(document.getElementById(id)).fontFamily
  const read = () => ({ body: getComputedStyle(document.body).fontFamily, input: f('input'), editor: f('editor'), pre: f('pre') })
  const ko = read(); const errors = []
  const check = (ok, msg) => { if (!ok) errors.push(msg) }
  check(ko.body.includes('Pretendard Variable'), 'body')
  check(ko.input.includes('Pretendard Variable'), 'input')
  check(ko.editor.includes('Pretendard Variable'), 'editor')
  check(!ko.pre.includes('Pretendard Variable'), 'pre stays monospace')
  document.body.style.setProperty('--dsh-font-family-text', '"User Chosen Font"')
  check(read().body.includes('User Chosen Font'), 'explicit font wins')
  document.body.style.removeProperty('--dsh-font-family-text')
  document.documentElement.lang = 'en'
  check(!read().body.includes('Pretendard Variable'), 'en restores')
  document.getElementById('result').textContent = JSON.stringify({ ok: errors.length === 0, errors, ko })
})()
</script></body></html>`
writeFileSync('/tmp/typography-fixture.html', html)
EOF

node /tmp/make-typography-fixture.mjs styles/typography.css
```

### 8.2 Run headless Chromium

```sh
CHROME="$HOME/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell"
"$CHROME" --headless --no-sandbox --disable-gpu \
  --user-data-dir=/tmp/dsh-typography-profile \
  --virtual-time-budget=3000 --dump-dom file:///tmp/typography-fixture.html \
  > /tmp/typography-result.html 2>/tmp/typography-result.err

node -e '
const fs=require("fs");const h=fs.readFileSync("/tmp/typography-result.html","utf8");
const m=h.match(/<pre id="result">([\s\S]*?)<\/pre>/);
if(!m){console.log("RESULT NOT FOUND");process.exit(1)}
const d=JSON.parse(m[1].replace(/&quot;/g,"\"").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">"));
console.log(JSON.stringify({ok:d.ok,errors:d.errors,body:d.ko.body.slice(0,80)},null,2));
process.exit(d.ok?0:1)
'
```

If the CSS bundle hash changes after a core upgrade, update `index-*.css` in the generator (or glob it). This harness is intentionally a simulation: it does not install the plugin or alter the profile.

## 9. Diagnostic runbook

```sh
# Service and versions
dsh --version
systemctl --user status dsh-web.service --no-pager

# Profile state
node -e 'const p=require(process.env.HOME+"/.dsh/profiles/web/package.json"); console.log(JSON.stringify(p,null,2))'

# Composed tree: row present? skipped? disabled?
dsh --profile web --dump-config | grep -n -A6 -B2 'my-plugin'

# Live boot graph: client row actually served?
curl -sS http://127.0.0.1:3080/ | grep -o 'my-plugin[^"&]*' | sort -u

# Install diagnostics
find ~/.dsh/profiles/web/.plugin-manager -name pnpm.log -print
journalctl --user -u dsh-web.service -n 50 --no-pager
```

| Symptom | Check |
|---|---|
| Row missing in `--dump-config` | `dsh.profile.bundles`; package readable; patch exists |
| Compatibility warning / skipped bundle | `engines.dsh`; `compatibility.json` exact grant |
| Row present, no boot-graph entry | `dsh.client`, `exports["./client"]`, Host row imports |
| Boot graph present, old UI | Browser reload; Host restart; client factory error in console |
| CSS missing | `apply()` reached? style tag present? effect disposed? |
| Font reverts after refresh | root **and** body seats bound; code/terminal seats untouched; no `!important` |

## 10. Do not

- Do not add a second patch row for `./client`.
- Do not import browser code from the Host half.
- Do not assume a global plugin directory; install into the profile (`link:` or registry/Git).
- Do not use `!important` to beat core styles; bind root + body with a language-scoped selector.
- Do not target `pre`, `code`, `kbd`, `samp`, or `textarea` from a text-font plugin.
- Do not publish `"source": { "type": "npm" }` in a market index before the package actually resolves on the configured registry.