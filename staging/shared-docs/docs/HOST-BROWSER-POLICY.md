# Host Browser Policy — Lightpanda (headless) + Chromium (render)

<!-- skeleton:
version: 1.0
kind: policy
status: active
updated: 2026-11-06
summary: Host-wide browser rule for every CLI agent: Lightpanda on 127.0.0.1:9333 for text/data collection, Chromium only for click and render verification.
-->

> **Owner: host (shared)** — this document is not owned by any single project. It moved out of
> `dsh-plugins/pending-docs/` on 2026-11-06 because it governs every CLI agent on this machine.
> Canonical rules file (SSOT): `/home/minami/.local/share/lpd/AGENTS_GUIDE.md`.
> This file is the **shared, in-repo policy**; that file is the **runtime SSOT**. If they disagree,
> the SSOT wins and this file must be corrected.

## 1. The system, as built (measured 2026-11-06)

This is not a proposal. It is deployed and running.

| Component | Measured state |
|---|---|
| Lightpanda binary | `/home/minami/.local/bin/lightpanda` v1.0.2 (76 MB) |
| Resident CDP daemon | `127.0.0.1:9333` **LISTEN**, `/json/version` → `Lightpanda/1.0`, protocol `1.3` |
| systemd unit | `lightpanda.service` (`systemd --user`) — `enabled`, `Linger=yes` → starts at boot, independent of login session |
| `lpd` CLI | `~/.local/bin/lpd` — `lpd status` → alive; `lpd smoke` → `ok: true` |
| Node wrapper | `~/.local/share/lpd/lib/cdp.mjs` — `withPage()` verified working |
| Chromium (rendering) | Playwright `chromium-1243`, `chromium-1248`, `chromium_headless_shell` |

## 2. The split — why two browsers

Lightpanda has **no rendering engine**. It parses the DOM and is fast and light; it cannot paint, and
`click()` does not work (measured on 1.0.2). Chromium renders and interacts. So the machine runs both,
each doing what it is good at.

| Task | Use | Never |
|---|---|---|
| Text / HTML extraction, link parsing | **Lightpanda** (`lpd text`, `lpd fetch`) | new `chromium.launch()` |
| JSON / API response collection | **Lightpanda** (`lpd extract`) | new `chromium.launch()` |
| Multi-page crawling | **Lightpanda** | new `chromium.launch()` |
| **UI click, form interaction, E2E render verification** | **Chromium launch** — the only exception | Lightpanda |

Measured advantage (deployment report, 2026-11-02): Lightpanda is **4–9× faster** and **7–9× lighter**
than a fresh Chromium launch for DOM/text collection.

## 3. Absolute rules

1. **Do not probe the environment.** No port scan, no `pgrep`, no `which chromium`, no
   `npx playwright install`. The daemon is always up and the address is fixed at `127.0.0.1:9333`.
2. **Do not launch Chromium for data collection.** A second browser process is the failure this
   policy exists to prevent.
3. **Chromium is allowed for exactly one thing**: click / form / render verification.
4. **If `lpd` fails, run `lpd-ctrl start` once.** Do not retry in a loop, and do not fall back to
   launching Chromium.
5. **Sidebar E2E (`run-e2e.mjs`, 55 checks) is NOT a Lightpanda workload** — it needs clicks and a
   real render.

## 4. How to use it

```bash
# CLI — fastest
lpd status
lpd text   https://example.com 'article'
lpd extract https://example.com '{h1: document.querySelector("h1")?.innerText}'
lpd smoke
```

```js
// Node module — guaranteed page release (preferred inside plugins)
import { withPage } from '/home/minami/.local/share/lpd/lib/cdp.mjs'

const data = await withPage(async (page) => {
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded' })
  return await page.textContent('h1')
})
```

## 5. Where the authority lives

| Layer | File | Role |
|---|---|---|
| Runtime SSOT | `/home/minami/.local/share/lpd/AGENTS_GUIDE.md` | the rule every agent links to |
| Shared policy | this file (`projects/docs/HOST-BROWSER-POLICY.md`) | human-readable, in-repo, cross-project |
| Deployment record | `/home/minami/.local/share/lpd/README.md` | how it was built and reproduced |
| Measured report | `dsh-plugins/artifacts/lightpanda-deployment-report.ko.md` | the numbers and the verdict |

## 6. Exit condition

This is a **live host policy**, not a pending document. It leaves `docs/` only if the host browser
architecture itself is replaced, and then it is superseded by the replacement's policy — never
silently deleted.
