# Developer statistics — DSH ledger shape, and how tk now exposes it

<!-- skeleton:
version: 1.1
kind: spec
status: active
updated: 2026-11-08
summary: Read-only per-turn/per-step developer statistics for TokenEconomizer: the measured before/after surface, the DSH rc.1 ledger vocabulary it copies, the settings.section seat choice, the derivation rules, and the card's DSH settings-surface rules.
-->

> Scope: `@nolit/dsh-tokeneconomizer` only. Owner ask (2026-11-05, translated): *"the token
> saver too — it added an experimental developer tool with per-turn and per-step context, cache,
> model and tool measurements; it seems related to @mektpoy's work; modify it so it can reference
> the DSH ledger structure."*
> Reference artifacts (installed rc.1): `@deepseek-ai/dsh-session-stats` (`sessionStats`
> projection) and `@deepseek-ai/dsh-experimental-client-ui-stats` (the per-turn/per-step table).
> tk stays self-contained: it copies their **shape**, never their package.

## 1. Measured before (tk `0.2.0`, 2026-11-05)

Commands: `find dsh-tokeneconomizer -type f`, `node -e "…package.json"`, `grep -rn
'conversation\.\|settings\.section\|/api/local' dsh-tokeneconomizer/lib`, and the installed
reference packages under
`~/.local/nodejs/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`.

| Surface | Measured before |
| :--- | :--- |
| Client half | **none.** No `lib/client.js`, no `exports["./client"]`, no `dsh.client` manifest. The bundle row is a host row only. |
| Slots | **zero** slot registrations. `docs/UI-SLOT-ARCHITECTURE.md` §2 says tk owns `conversation.input.activity`; that is **contradicted by the shipped `0.2.0` package** (measured: no client module at all; only `@nolit/dsh-deepinfra` registers that id in this workspace). The root doc is stale for tk and is *not* edited from this track — reported to the Lead. |
| Local routes | none (`grep '/api/local'` → 0 hits). |
| Exposed state | Host-side only: per-session in-memory counters (`tiered`, `requests`, dedup store size, breaker/watchdog internal state) and stderr notices; none reachable from the Web UI. |
| Locale files | `locale/en.json` + `locale/ko.json` carried only `meta.title` (identical Korean text in both; a pre-existing packaging fact). **Corrected on 2026-11-08**: `locale/en.json` now carries `TokenEconomizer (MS tokeneconomizer)` and `locale/ko.json` keeps `토큰절약기(MS tokeneconomizer)` — see §8. |
| Session/projection reads | `ctx.get('sessionQuery')` for prior-session recall; **no** read of the session event ledger for statistics, and no use of `ctx.sessionProjections`. |

### 1.1 Measured reference shape (rc.1)

| Reference | What it provides | Fields copied into tk |
| :--- | :--- | :--- |
| `dsh-session-stats` `sessionStats` projection | whole-log fold over committed events | `turns`, `steps`, `llmMs` (step/start→assistant/message), `toolMs` (call→result by `callId`), `ttftMs`/`ttftSteps`, `decodeMs`/`decodeTokens` |
| `dsh-experimental-client-ui-stats` per-step metrics | per-step context/cache/model/tool columns | `context` = `input + cacheRead + cacheWrite` (disjoint buckets), `cacheHit` = `cacheRead / context`, `cacheRead`, `cacheWrite`, `output`, `ttft`, `model`, `tool` (sum) and `toolWall`, per-call `{name, ms, resultChars, error}`, `wall` |
| `dsh-token-meter` projections | DSH's own ledger vocabulary | `tokenUsage.{uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens}`, `contextPressure.{pressureTokens, projectedTokens, contextWindow}`, `contextBreakdown.{systemTokens, toolsTokens, messageTokens}` |
| `dsh-client-ui-conversation` slots | seats | `settings.section` is a **list** seat (`settings.general.item` children are list; the tab row is built from `slots.entries('settings.section')`); `conversation.view` is also a list seat but requires Node-Definition + target assembler machinery |

## 2. What was added (measured after)

| Surface | After | Evidence |
| :--- | :--- | :--- |
| Client half | `lib/client.js`, `exports["./client"]`, `dsh.client = { platform: "web", immediately: true, inject: ["@deepseek-ai/dsh-client-ui-settings","@deepseek-ai/dsh-client-locale"] }` | `package.json`, `test/client.test.mjs` |
| Slot | exactly **one** registration: `settings.section`, id `tokeneconomizer-devstats`, order `62`, localized `label` | `test/client.test.mjs` ("one registration only", no `conversation.input.*`) |
| Host route | one read-only `POST /api/local/tokeneconomizer/devstats` on `ctx.connection.fetch.register`, mounted through deferred `ctx.inject(['connection'], …)` so a host without the seam (headless) still mounts the row | `lib/devstats-server.js`, `test/devstats-server.test.mjs` |
| Data | per-turn and per-step rows: context/prompt tokens, input, cache read/write, cache hit, output, reasoning, provider/model, tool calls (`name`, `ms`, `resultChars`, `error`), `llmMs`, `ttftMs`, `decodeMs`, `wallMs`; plus tk's own ledger counters (dedup hits/saved chars, tier rewrites/shadowed tokens, loop-breaker trips, watchdog warnings/interrupts, notices, tool calls/errors, mode, pinned/recall flags) and, when composed, the DSH projections cut | `lib/devstats.js`, `test/devstats.test.mjs` |
| Locale | English default; Korean only while `ctx.locale.getSnapshot().active` starts with `ko`; inline tables and `locale/*.json` are asserted equal | `test/client.test.mjs` |
| Privacy | payload carries counts and names only — no prompt text, no tool arguments, no tool output | `test/devstats-server.test.mjs` ("never carries …") |

## 3. Placement decision — `settings.section`, not `conversation.view`

rc.1 supports both seats. The Statistics table itself lives in `conversation.view` as a tab
(`id: "stats"`, order 40). Reproducing that seat in tk would require:

1. a set of `ConversationNodeDefinition`s (`ctx.uiConversation.events.register`) for
   `step/start`, `assistant/message`, `tool/call`, `tool/result`, `turn/end`;
2. a target builder (`ctx.uiConversation.views.register`) and a `ConversationViewDefinition`;
3. a second tab competing with rc.1's own Statistics tab for the same purpose.

`settings.section` is a **list** seat (additive, no collision), it is where this workspace already
places plugin panels, and it needs neither machinery. It also keeps the composer untouched: tk
registers **nothing** in `conversation.input.*`, so the single-slot collision documented in
`docs/UI-SLOT-ARCHITECTURE.md` cannot be reintroduced by this change. The cost is that the card is
not session-scoped by the host, so it carries its own session selector (newest first), fed by the
same host route.

## 4. Derivation rules (the part that must stay stable)

All rules are implemented once in `lib/devstats.js` and pinned by `test/devstats.test.mjs`.

| Rule | Why |
| :--- | :--- |
| Prompt tokens = `inputTokens + cacheReadTokens + cacheWriteTokens`; `inputTokens` is **uncached** input | the buckets are disjoint in DSH usage; adding input to itself would double-count cache hits |
| `reasoningTokens` is a **subset** of `outputTokens`, never added | mirrors `TokenUsageProjection` documentation ("reasoning tokens are already included in outputTokens") |
| A step is counted on `step/end`, not `assistant/message` | the loop appends exactly one `step/end` per entered step in a `finally`, so failed/cancelled/max-token steps still count — the same authority the `sessionStats` projection uses |
| `llmMs` = `step/start` → `assistant/message`; `ttftMs` = `step/start` → first content span (`*-chunks.time0`); `decodeMs` = first token → message | same spans as the reference fold; a plain `chunk` in the stream is a block boundary/usage record, not a token |
| tool time pairs `tool/call` → `tool/result` by `callId`; one unpaired call is counted as `callsOpen` and adds no time | a missing result must not invent a duration |
| route: `request/context` (fallback `request/header.header.config`, then `assistant/message.message.source`) | a log window that starts after the request still names the provider/model |
| a turn whose `turn/end` did not land still reports wall time to the last observed event, with `running: true` | a live session must not show a wall time of "—" forever, and must not pretend the boundary is known |
| totals cover the whole log; rows are capped (`MAX_TURNS`, `MAX_STEPS_PER_TURN`, `MAX_CALLS_PER_STEP`) and `truncated` says so | the UI cannot be allowed to render an unbounded log |

## 5. Measured end-to-end evidence (real session log)

Session `022a9249-ff60-4b4f-8523-32a04a21fa72` (subagent, rc.1, decompressed from
`~/.dsh/sessions/…/session.v4.jsonl.zstd`, 315 non-header events), folded by
`deriveSessionDevStats` on 2026-11-05:

```
turns 1 · steps 57 · context 3,358,079 · cacheHit 97.87% (read 3,286,604 / write 0)
input 71,475 · output 18,751 · reasoning 5,833 · llmMs 413,105 · toolMs 55,396
ttftMs 328,504 · decodeMs 84,601 · toolCalls 56 · toolErrors 12 · resultChars 114,403
wallMs 469,965 · route opencode-http-agent / opencode-go/iceman-contributor-free
```

These are the numbers the settings card renders for that session. The same fold runs on every
session the process observed; the host route caches per session and re-folds only when the log
grows (invalidated by the last `seq` + event count).

## 6. Operational notes

- **Read-only by construction.** The route answers one request body (`{ sessionId? }`), writes no
  file, appends no session event and mutates no settings. `test/devstats-server.test.mjs` asserts
  the live state is byte-identical before and after a request.
- **Optional composition.** No projection registry → `dshProjections: null`; no `connection`
  service → route not registered; the card then shows its error state with a retry, never a crash.
  Registration is deferred (`ctx.inject(['connection'], …)`) exactly because `apply()` runs before
  the connection row activates in the web profile.
- **No session-projection registration.** Per the rc.1 delta, projection registration is async and
  owned by the harness packages; tk only **reads** the registry snapshot (`tokenUsage`,
  `contextPressure`, `contextBreakdown`, `sessionStats` when present). Nothing is registered, so
  there is no handle to retain and no key conflict.
- **The 3080 service is not restarted by this change.** it is *applied pending restart*; the owner
  restarts.

## 7. Card surface rules (2026-11-08)

The card added on 2026-11-05 rendered but did not follow the DSH settings surface rules. The rules
now in force, each pinned by a case in `test/client.test.mjs`:

| Rule | Value | Why |
| :--- | :--- | :--- |
| Read-width | `.tkdsSection { max-width: 720px; margin: 0 auto; padding: 0 }` | a settings seat is a narrow column; the earlier `980px` cap never applied, so the card filled the pane edge to edge |
| Heading levels | section title `h2`, card titles `h3` | the seat's own title is the `h2`; the cards are one step below it. Size comes from `calc(var(--dsh-content-font-size,14px) + 4px)`, so it follows the host's content-font token |
| Stylesheet ownership | `<style data-plugin-css="@nolit/dsh-tokeneconomizer">` | the host reads that attribute to own the tag; a reload replaces the rules instead of stacking a second copy. The earlier `id="tk-devstats-style"` was invisible to the host |
| Table frame | `.tkdsScroll { max-height: 280px; overflow: auto }`, `position: sticky` on the header cells, `scope="col"` on all nine headers | the per-turn table is dense and unbounded in height; a sticky header keeps the columns readable inside a frame that scrolls |
| Focus | `:focus-visible` outline from `--dsw-focus-ring-width` / `--dsw-focus-ring-color` on the select and the buttons | the earlier card had no focus rule of its own |
| Motion | transitions removed under `prefers-reduced-motion: reduce` | the transitions are decorative |
| Pointer | hover rules wrapped in `@media (hover: hover)`; disabled controls use `cursor: not-allowed` | hover styling is not a touch interaction |
| Density | a `max-width: 640px` pass: `220px` table frame, tighter card padding, a `96px` minimum grid track | a narrow pane needs a shorter frame and denser cards |
| Session identity | the option label is the working directory plus the **full** session id; the option's `title` spells out the whole directory | an 8-character uuid prefix identifies nothing, and two sessions in one directory looked identical |

The display title is read per language from `locale/<language>.json`, so each file carries its own
language's title: `locale/en.json` → `TokenEconomizer (MS tokeneconomizer)`, `locale/ko.json` →
`토큰절약기(MS tokeneconomizer)`.

No data path changed: the same route, the same fold, the same numbers.

## 8. Related

- [../CHANGELOG.md](../CHANGELOG.md) — entry with the measured before/after.
- [../../docs/UI-SLOT-ARCHITECTURE.md](../../docs/UI-SLOT-ARCHITECTURE.md) — slot tiers (tk section
  claims no composer seat).
- [../../docs/PLUGIN-STYLE-STANDARD.md](../../docs/PLUGIN-STYLE-STANDARD.md) — the typography tokens
  the card consumes.
- [../../docs/DSH-RC1-PLUGIN-DELTA.md](../../docs/DSH-RC1-PLUGIN-DELTA.md) — rc.1 plugin deltas
  (Node floor, async projection registration, client manifest).
