# Lightpanda CDP Browser — Deployment Record

<!-- skeleton:
version: 1.0
kind: reference
status: active
updated: 2026-11-06
lifecycle: unpromoted
summary: Durable record of the shared Lightpanda CDP browser daemon (127.0.0.1:9333) — what runs where, measured baselines, guarantees, known limits, agent integration paths, and how to reproduce the deployment.
-->

> **Lifecycle: `unpromoted`** — deployed and running on this host, but not adopted as a policy by
> `dsh-plugins`. Measured 2026-11-06: `lightpanda.service` enabled + `Linger=yes`, `127.0.0.1:9333`
> listening, `lpd smoke` → `ok: true`. The build record is
> [artifacts/lightpanda-deployment-report.ko.md](../../artifacts/lightpanda-deployment-report.ko.md).
> A host-wide policy version is staged in `staging/shared-docs/` pending a writable `/`.

> **Scope:** host-level shared browser for every CLI agent on this machine
> (Antigravity, OpenCode, Hermes, DSH). Lives outside this repository; this file is the
> durable in-repo record so the setup is not lost with the home directory.
>
> **Canonical rules file (SSOT):** `~/.local/share/lpd/AGENTS_GUIDE.md`

## 1. Why

Interactive browser automation was duplicated in two forms: a Windows-only Playwright E2E
harness, and 23 ad-hoc scripts that each launched Chromium from a hard-coded absolute path
into a `bun` cache that no longer has a `bun` binary to maintain it. Every agent that needed
to read a page paid a full Chromium launch (~113–119 ms, ~365 MB PSS, 11 processes).

Lightpanda replaces that cost for **read-only** work. Interactive work keeps Chromium.

## 2. What runs where

| Component | Path / value |
|---|---|
| Binary | `~/.local/bin/lightpanda` (1.0.2, x86_64, sha256 `ae7d01d2…3f37e19e`) |
| Service | `~/.config/systemd/user/lightpanda.service` — `enabled`, `WantedBy=default.target` |
| Endpoint | `ws://127.0.0.1:9333` (HTTP equivalent `http://127.0.0.1:9333`) |
| Wrapper module | `~/.local/share/lpd/lib/cdp.mjs` |
| CLI | `~/.local/bin/lpd`, `~/.local/bin/lpd-ctrl` |
| Runtime deps | `~/.local/share/lpd/node_modules/playwright-core@1.64.1` |
| Shell env | `LIGHTPANDA_CDP_URL`, `LPD_CDP_URL` in `~/.bashrc` and `~/.profile` |

Port 9333 was chosen after measuring every listening socket on the host; 9222 (the documented
and Docker default) is deliberately avoided to prevent collisions with other tooling.

## 3. Measured baseline

Same workload for both engines: a local 5,000-node DOM page with inline JS, served over
`127.0.0.1`. Memory is PSS summed over the process tree.

| Metric | Chromium (fresh launch) | Lightpanda (resident CDP) |
|---|---|---|
| Startup | 113–119 ms | **8–16 ms** |
| Total (startup + load) | 306–329 ms | **28–108 ms** |
| Teardown | 135–155 ms | 10–12 ms |
| Memory (PSS) | 363–365 MB / 11 proc | **51–52 MB / 1 proc** |
| 20-page sequential crawl | 1519–1573 ms (76 ms/page) | **376–385 ms (19 ms/page)** |
| Crawl memory | 487–508 MB | **52–53 MB** |

Lightpanda does no layout or paint, so part of this gap is work Chromium does and Lightpanda
skips. The comparison is valid for DOM parsing and JavaScript execution, not for rendering.

## 4. Guarantees (measured)

| Property | Result |
|---|---|
| Daemon after client `browser.close()` | survives, same PID |
| Daemon after client `SIGKILL` | survives, new clients connect normally |
| Daemon after `kill -9` | systemd restarts it within ~4 s |
| Concurrent clients | up to 16 (`--cdp-max-connections 16`) |
| Client isolation | new browser context per client; cookies and storage do not leak |

An earlier assumption that `browser.close()` terminates a CDP-attached browser was **wrong** —
verified against Playwright 1.64.1 source and by the survival tests above. Clients therefore do
not need daemon-lifecycle handling, only context cleanup.

## 5. Known limits (1.0.2)

| Capability | Status |
|---|---|
| `locator.click()` | **fails** (timeout); `force`, `dispatchEvent` and `element.click()` never fire handlers |
| `file://` URLs | **unsupported** (`UnsupportedProtocol`) — use HTTP(S) or `page.setContent()` |
| `boundingBox()` | synthetic 5×5 — coordinate automation and visibility cannot be trusted |
| `screenshot()` | returns bytes, but not a rendered page — no visual regression |
| Queries (`locator.count`, `getByRole`, `getByText`, `innerText`, `fill`, cookies) | work |
| `connectOverCDP` over Playwright | works |

**Rule of use:** data collection goes to Lightpanda; anything that clicks or verifies pixels
goes to Chromium.

## 6. Agent integration

All agents reach the daemon through one of three paths; none of them inspect the environment first.

```bash
lpd status                                  # daemon state
lpd text   <url> 'main'                     # text
lpd extract <url> '{title: document.title}'  # structured
lpd smoke                                   # self-test incl. daemon survival
```

```js
import { withPage } from '/home/minami/.local/share/lpd/lib/cdp.mjs'
const data = await withPage(async (page) => {
  await page.goto('https://example.com')
  return { title: await page.title() }
})
```

```js
await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:9333/' })
```

Rule distribution: the canonical guide is symlinked into `~/AGENTS_BROWSER_RULE.md`,
`~/.config/opencode/AGENTS.md`, `~/.antigravity/BROWSER_RULE.md`, `~/.hermes/BROWSER_RULE.md`
and `~/.dsh/BROWSER_RULE.md`, and a short pointer block is injected into the existing
instruction files `~/.dsh/AGENTS.md`, `~/.antigravity/rules.md` and `~/.hermes/SOUL.md`.

## 7. Reproduce

```bash
# binary
curl -fL -o /tmp/lightpanda \
  https://github.com/lightpanda-io/browser/releases/download/1.0.2/lightpanda-x86_64-linux
sha256sum /tmp/lightpanda   # ae7d01d261efb9e480e18ce3424533332883863bcf70b12a4321b5733f37e19e
install -Dm755 /tmp/lightpanda ~/.local/bin/lightpanda

# service (unit is in ~/.config/systemd/user/lightpanda.service)
systemctl --user daemon-reload
systemctl --user enable --now lightpanda.service

# dependencies and verification
cd ~/.local/share/lpd && npm install playwright-core@1.64.1
lpd smoke
```

## 8. Deliberately not changed

- `dsh-sidebar-manager/prototype-harness/e2e/run-e2e.mjs` — still Chromium; it needs clicks,
  rendering and Windows-specific port introspection. Lightpanda cannot run it.
- The 23 scripts in `.runtime-measure/` — untouched. Migration to `lpd` / `withPage()` is a
  separate, later step.

## 9. Evidence

- [lightpanda-migration-report.ko.md](../../artifacts/lightpanda-migration-report.ko.md) — phase-1 read-only audit
  (its §4.5 conclusion is superseded; see the banner in that file)
- [lightpanda-deployment-report.ko.md](../../artifacts/lightpanda-deployment-report.ko.md) — build, smoke,
  comparison measurements and the correction record
