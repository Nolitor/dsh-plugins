# Changelog — @nolit/dsh-tokeneconomizer

<!-- skeleton:
version: 1.1
kind: report
status: active
updated: 2026-11-05
summary: Engineering history for @nolit/dsh-tokeneconomizer. Seeded from git history on 2026-11-04 when the owner made per-plugin history mandatory (docs/RULES.md 6.1); entries after that date follow the same rule — what changed, why, and the measured before/after.
-->

> History lives here (owner instruction 2026-11-04). Boot cards and `AGENTS.md` are narrowed to
> the owner's unfinished asks; they are not a changelog. See [docs/RULES.md](../docs/RULES.md) §6.1.

Current version: `0.0.1-rc.1`

## test harness — integration test owns a throwaway DSH_HOME — 2026-11-05

**Owner task (2026-11-05): CLI/test DSH_HOME isolation.** The TokenEconomizer engine spawns
`dsh --profile headless` for side calls, so a test that lets it inherit the process environment can
persist a session into the live home under `cwd = /tmp/te-*` — one of the sources of the sidebar
orphan flood. The engine's own patch already re-roots session persistence per side call; this
change closes the harness half.

| Surface | Before | After |
| :--- | :--- | :--- |
| `test/integration.test.mjs` env | `{ ...process.env, TOKENECONOMIZER_HOME: home }`; `DSH_HOME` unset → default live home | temp `DSH_HOME` + `TOKENECONOMIZER_HOME` per run, explicit `DSH_HOME` in the engine spawn env, both env vars restored and the temp home removed in `t.after` |
| `test/tiering-mount.test.mjs` | applied the plugin with the default state root: the session export on `agent/created` tried to write the live `~/.tokeneconomizer/dsh-sessions/` — **2 tests failed** with `EROFS` in the sandbox (a live write outside it) | each test gets a per-test temp `stateHome` and removes it in `t.after`; **2 failed → 0 failed** |
| Repo guard | `scripts/check-dsh-isolation.mjs` reported `engine-spawn-without-DSH_HOME` at the integration test | guard reports **0 violations** |
| Live state after the suite | — | `~/.dsh/sessions` count unchanged (**120**), no new files written under `~/.tokeneconomizer` by the tests |
| Tests | 129 pass / 2 fail / 1 skipped | **131 pass / 0 fail / 1 skipped** |

No plugin code changed. Policy and the guard: [docs/DSH-HOME-ISOLATION.md](../docs/DSH-HOME-ISOLATION.md).

## Seeded history (from git, before this file existed)

The commits below predate this file. They are the record of what shipped, quoted from the
repository history rather than rewritten:

- `e709ec3` umbrella model-API plugin and DSH-native tiering fix
- `64c9c2a` feat(watchdog): tool-call budget, interrupt recorded before cancel
- `d1547b9` feat(tokeneconomizer): raise `tierMinChars` to 3700 from the measured floor
- `ebc4aa5` feat(command-skill): contract authority, watchdog self-reset fix
- `5fba56a` feat(tokeneconomizer): external settings file + six-turn hot window
- `41c6c6f` docs: alpha.3 plugin verification + typography standard

## Entries after 2026-11-04

Add newest first. Each entry: what changed, why, and the measured before/after. A change with no
entry here is not complete.

### 2026-11-05 — developer statistics (per-turn / per-step) + `0.0.1-rc.1` normalization

**Why.** Owner ask: the TokenEconomizer track should expose the experimental "Developer tools —
Statistics for per-turn and per-step context, cache, model, and tool measurements" data
(rc.1, @mektpoy) and reference the DSH ledger structure. Owner decision the same day: every
`@nolit` track is normalized to `0.0.1-rc.N`, and rc.1 requires Node `>=24.9`.

**What changed** (files):

- `lib/devstats.js` — new pure fold of the committed session event ledger into per-turn /
  per-step rows, plus `ledgerOf()` for this plugin's own counters. Copies the
  `@deepseek-ai/dsh-session-stats` + `@deepseek-ai/dsh-experimental-client-ui-stats` shape
  (`context = input + cacheRead + cacheWrite`, `reasoning ⊂ output`, `step/end` is the counted
  event, `llmMs` / `toolMs` / `ttftMs` / `decodeMs` / `decodeTokens`, `tool/call`→`tool/result`
  pairing by call id).
- `lib/devstats-server.js` — one read-only route `POST /api/local/tokeneconomizer/devstats`
  registered through deferred `ctx.inject(['connection'], …)`; answers a session list plus the
  selected session's turns/steps, the tk ledger counters, and the DSH projection cut
  (`tokenUsage`, `contextPressure`, `contextBreakdown`, `sessionStats` when composed).
- `lib/client.js` — new browser half. One additive `settings.section` registration
  (`id: tokeneconomizer-devstats`, order 62); session selector + totals + turn/step table with
  tool calls (name, ms, result chars, error). **No** composer seat, **no** `conversation.view`
  tab. English default, Korean only while the active locale is `ko`.
- `lib/index.js` — per-session statistics counters (dedup hits/saved chars, tier shadow tokens,
  loop-breaker trips, watchdog warns/interrupts, tool calls/errors, notices, pinned/recall flags),
  bumped at the existing hook sites; deferred route mount; `readProjectionSnapshot()` reads the
  harness projection registry but registers nothing.
- `package.json` — version `0.0.1-rc.1` (owner decision), `engines.node: >=24.9` (rc.1 floor),
  `exports["./client"]`, `dsh.client { platform: web, immediately: true, inject: [ui-settings,
  client-locale] }`; `scripts.check` now covers the three new modules.
- `locale/en.json`, `locale/ko.json` — `devstats` tables (65 keys each) mirrored from the inline
  browser tables.
- `docs/DEV-STATISTICS.md` — measured before/after, reference comparison, placement decision,
  derivation rules, evidence.
- `test/devstats.test.mjs`, `test/devstats-server.test.mjs`, `test/client.test.mjs` — new; and
  `test/package.test.mjs` pins the version/Node floor/client manifest.

**Measured before → after**

| Fact | Before (`0.2.0`) | After (`0.0.1-rc.1`) |
| :--- | :--- | :--- |
| Client surface | none (`lib/client.js` absent, no `./client` export, no `dsh.client`) | one `settings.section` card (`tokeneconomizer-devstats`) |
| Slot registrations | 0 | 1, in a list seat; 0 in `conversation.input.*` / `conversation.view` |
| Local routes | 0 | 1, read-only (`POST /api/local/tokeneconomizer/devstats`) |
| Data exposed to the UI | none (stderr notices only) | per-turn/per-step context, cache read/write, cache hit, input/output/reasoning, provider/model, tool name/ms/result chars, wall/llm/ttft/decode time + tk ledger counters + optional DSH projections |
| `engines.node` | `^22.19.0 \|\| >=24.0.0` | `>=24.9` |
| Version | `0.2.0` | `0.0.1-rc.1` |

Real-log evidence (session `022a9249…`, rc.1, 315 non-header events, folded 2026-11-05):
1 turn / 57 steps / context 3,358,079 / cache hit 97.87% (read 3,286,604, write 0) / input 71,475 /
output 18,751 / reasoning 5,833 / llmMs 413,105 / toolMs 55,396 / ttftMs 328,504 / decodeMs 84,601 /
56 tool calls with 12 errors / 114,403 result chars / wallMs 469,965.

**Verification**

- `TOKENECONOMIZER_HOME=<workspace scratch> npm test` → **132 tests, 131 pass, 0 fail, 1 skipped**
  (the skip is the pre-existing opt-in engine fixture, `TE_DSH_TEST_HOME` not set). Before this
  change the same suite ran 99 tests.
  - Note: without a writable `TOKENECONOMIZER_HOME`, one pre-existing test
    (`tiering-mount.test.mjs`, "the newest turns are left untouched") fails with
    `EROFS … /home/minami/.tokeneconomizer/…` because this session's sandbox cannot write the
    default state root. That is an environment limitation, not a regression; the suite is green
    with a writable root.
- `npm run check` → `node --check` passes for `lib/index.js`, `lib/bridge.js`, `lib/dedup.js`,
  `lib/prefix.js`, `lib/repokey.js`, `lib/tiering.js`, `lib/watchdog.js`, `lib/devstats.js`,
  `lib/devstats-server.js`, `lib/client.js`, `bin/te-dsh.mjs`, `scripts/bootstrap.mjs`.
- Isolated `DSH_HOME` browser boot (minimal profile: `dsh-base` + `dsh-web-app` +
  `@nolit/dsh-tokeneconomizer`, thrown-away tree, cleaned up afterwards): the tk client entry
  reported active, the Settings card rendered
  (`TokenEconomizer · Developer statistics`, session selector, session totals, DSH projections
  `as of seq 2`, tk ledger), the route answered `200 {ok:true, sessions:1, projections:true}`
  from the page, and **0 page errors / 0 console errors**. English rendered by default; the
  Korean dictionary needs the owner's `@nolit/dsh-korean-locale` pack (not composed in the
  minimal boot), so Korean rendering is asserted by the locale unit test and the inline/JSON
  table equality rather than by that boot.
- The live 3080 service was **not** touched: this change is **applied pending restart**; the
  owner restarts to see the card in the live profile.
