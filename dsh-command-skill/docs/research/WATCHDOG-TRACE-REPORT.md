# Watchdog Self-Reset & /interrupt Path — Traced Verdict

<!-- skeleton:
version: 1.0
kind: measurement
status: measured
updated: 2026-11-02
summary: Code-traced confirmation that the TokenEconomizer watchdog resets its own budget with its own notice, identification of the exact session event that carries the reset, the /interrupt input-declaration variants, and the interrupt-guide registration verdict.
-->

> **Provenance.** Produced 2026-11-02 by the read-only `watchdog-tracer` investigation. It corrected
> two claims of the Lead's first reading, both of which were then verified independently: the
> resetting vector is `agent/inbox/spliced` (not `user/message`), and the regression is commit
> `3254ebf`, which swapped `notice()` for `noticeUser()`. The fix it prompted is in commit
> `ebc4aa5`; see [../INTERRUPT-LIFECYCLE.md](../INTERRUPT-LIFECYCLE.md) for the adopted record.

> Status: measured · 2026-11-02 · Read-only trace (writes only under /tmp/te-wd/)
> Task: task-4 · Owner: watchdog-tracer

## 0. Verdict summary

| # | Question | Verdict |
|---|---|---|
| 1 | Does the watchdog never interrupt because its own injected notice resets its budget? | **CONFIRMED** — but the resetting event is `agent/inbox/spliced`, **not** `user/message` |
| 2 | Does the Lead's `MESSAGE_SOURCE` guard fix it? | **PARTIAL** — closes the `user/message` vector, leaves the `agent/inbox/spliced` vector open (measured: 4 warns / 0 cancels still) |
| 3 | Does `/interrupt <text>` cancel prematurely? | **YES with `input` declared; NO without it** — two genuinely different products |
| 4 | Is `interrupt-guide` registration a defect? | **DESIGN DECISION.** The defect is its body, not its existence |
| 5 | Can the prompt runtime participate? | **Yes for reporting, no for abort authority** |

---

## 1. The self-reset path — CONFIRMED, with a corrected mechanism

### 1.1 The reset is real

`lib/index.js:761-783` (`observeMemory`). `state.watchdog.progress()` runs for the plugin's own
injected messages, restarting the very budget that was about to expire.

Measured in the live corpus (`~/.dsh/sessions/**/session.v*.jsonl.zstd`, 169 files, 88 buckets):

| Quantity | Value |
|---|---|
| Injected watchdog notices (as committed `user/message`, `source.kind=tokeneconomizer`) | **24** |
| Notices containing `action=interrupted` | **0** |
| Turns with ≥1 warning | 18 |
| Turns longer than the 600 s threshold | 9 |
| Of those, interrupted | **0** |
| Max warnings in one turn | 3 |
| Worst progress-free gap while armed, per turn | 305 s – 355 s (never ≥ 600 s) |

Every single armed turn peaked at ~300–355 s of apparent "no progress" and then reset — never
approaching 600 s. That is the fingerprint of a budget being restarted just above the warn point.

### 1.2 The event that carries the reset is `agent/inbox/spliced`, not `user/message`

This corrects the Lead's hypothesis. `agent.inject()` is **synchronous**:

```
lib/index.js:1170        state.agent.inject(userMessage(text))
  -> dsh-agent-loop/lib/index.js:576   inject(input) { this.send(input, 'next-step', false) }
  -> dsh-agent-loop/lib/index.js:564   send() { this.inbox.splice(...) }
  -> dsh-agent-loop/lib/index.js:159   splice() -> this.mutate(...)
  -> dsh-agent-loop/lib/index.js:198   const event = this.session.append('agent/inbox/spliced', splice)
  -> dsh-session/lib/index.js:1544/1589/1601  commit() -> invokeContainedSessionObservers(..., 'session/event', ...)
  -> lib/index.js:783                  state.watchdog.progress()
```

The dispatch is **synchronous inside `inject()`**, i.e. it happens *before* `onWatchdogWarn`
returns. The message does *later* also become a `user/message` at the next `preStep` claim
(`dsh-agent-loop/lib/index.js:865`), so line 778 was a *second* reset vector — but the one that
fires within the same tick is `agent/inbox/spliced`.

Live evidence — `agent/inbox/spliced` is a committed session event (2,862 occurrences), and all
24 watchdog notices appear in it:

```
teMessagesInsertedViaInbox: 27
watchdogNoticesSeen: 24
watchdogNoticesThatAlsoAppearInInboxInserted: 24   <- every notice
source.kind values seen in the inbox among others: 'tokeneconomizer'
```

### 1.3 The Lead's fix is INCOMPLETE

Current source (already applied and live):

```js
// lib/index.js:778
if (source !== MESSAGE_SOURCE.kind) state.watchdog.progress()
return
...
// lib/index.js:783
if (event.data?.source?.kind !== MESSAGE_SOURCE.kind) state.watchdog.progress()
```

Line 783 guards on `event.data.source`. But `agent/inbox/spliced` carries the source **inside the
inserted array**, not on `data`:

```
agent/inbox/spliced data KEYS : target, start, inserted
  data.source                 : undefined          <- where the guard looks
  data.inserted[0].source.kind: tokeneconomizer    <- where the source actually is
```

So the guard evaluates `undefined !== 'tokeneconomizer'` -> **true** -> `progress()` still runs.

Measured against the post-fix source (isolated process, 400 ms threshold / 200 ms warn,
`watchdogAction: interrupt`):

| Delivery of the injected notice | Injected warnings | Cancels |
|---|---|---|
| `user/message` (guarded by line 778) | 0 | 1 (fires correctly) |
| **`agent/inbox/spliced` (real harness shape)** | **4** | **0** |
| no delivery (control) | 2 | 1 |

**The live symptom survives the fix.** Suggested correction (not applied — read-only task):

```js
function isOwnNotice(event) {
  if (event.data?.source?.kind === MESSAGE_SOURCE.kind) return true
  const inserted = event.data?.inserted
  return Array.isArray(inserted) && inserted.some(m => m?.source?.kind === MESSAGE_SOURCE.kind)
}
```
then gate both line 778 and line 783 on `!isOwnNotice(event)`. Note `agent/inbox/spliced` is also
used for genuine user input, so the check must inspect the inserted messages, not merely the type.

### 1.4 Pre-fix reproduction (A/B, isolated processes)

| Build | Warnings | Cancels |
|---|---|---|
| stock (`noticeUser` -> inject) | 4 | **0** |
| `/tmp/te-wd/variant` with warn routed to `notice()` (stderr only) | 1 | **1** |

Changing only the notice destination flips 0 -> 1 interrupt. That is the causal proof.

---

## 2. Which events reset progress (`:773` vs `:776`)

`observeMemory` early-returns *without* progress for several types. Counts are from the live corpus.

**No `progress()` (early return):**

| Event | Line | Effect |
|---|---|---|
| `tool/call` | 734 | `suspend()` — turn budget held, tool budget starts |
| `tool/result` | 738 | `resume()` — resets `lastProgressAt` |
| `system/message` | 741 | prefix check only |
| `assistant/message` | 749 | counter only |
| `turn/start` | 753 | `arm()` — resets |
| `turn/end` | 757 | `disarm()` |

**`progress()` via `:773` (`user/message`), by source kind:**

| source.kind | Count | Is a reset correct? |
|---|---|---|
| `user` | 1,062 | yes |
| `time-context` | 424 | **no** — harness-emitted |
| `agent-instructions` | 219 | **no** |
| `runtime-context` | 195 | **no** |
| `subagent-settled` | 115 | **no** |
| `agent-message` | 73 | **no** |
| `skill-catalog` | 61 | **no** |
| `user-approval` | 54 | debatable |
| `model-selection` | 33 | **no** |
| **`tokeneconomizer`** | **27** | **no — the defect** |
| `compact-checkpoint` | 21 | **no** |
| `tool-jobs` | 20 | **no** |
| `skill-invocation`, `plan-mode`, `schedule`, `repeat-tool-reminder` | 3/2/2/1 | **no** |

**`progress()` via `:776` (catch-all)** — 40+ types, top: `step/start` 14,756, `step/end` 14,753,
`session-log-deepseek/delivery-accepted` 12,214, `job/registered` 8,606, `job/settled` 8,595,
`tool/ptc-dispatch` 3,577, **`agent/inbox/spliced` 2,862**, `compaction/prune` 859,
`workspace/changes` 449, `request/header` 353, `approval/asked|decided` 179 each.

**Consequence:** the watchdog can only expire during a step that emits *literally nothing*. In
practice `step/start`, `job/settled`, `session-log-deepseek/delivery-accepted` and
`agent/inbox/spliced` fire constantly, so the 600 s budget is unreachable. The plugin's own notice
is the worst offender because it is emitted *because* the budget is expiring.

### `watchdogProgress: 'any'` vs `'committed'`

It changes only **assistant stream frames** (`config.watchdogProgress !== 'any'` gates the
`agent/assistant-stream` listener at `lib/index.js:459-463`). Measured:

| Script | `any` | `committed` |
|---|---|---|
| stream frames flowing | 0 warns / 0 cancel | 2 warns / 1 cancel |
| idle, notice delivered | 4 warns / 0 cancel | 4 warns / 0 cancel |

So **`committed` does not fix this bug** — the notice reset is independent of the setting. It
only makes a long *thinking* turn interruptible. Live config is `any`, which is the safer setting
for real work but leaves the notice defect untouched.

---

## 3. The `/interrupt` path

### 3.1 What is live right now

- Both packages are `link:` (`~/.dsh/profiles/web/package.json`), so the **working tree is live**.
- `total_skill/src/command.js` mtime `2026-11-01T13:10:19+09:00`; service started
  `2026-11-02T07:52:34 KST`. The uncommitted tree **is** what is running.
- Working tree **removes** `input`; committed `261b664` **declares** it
  (`input: { hint: '[메시지]' }`).

### 3.2 What `input` actually does (DSH source)

`dsh-client-ui-commands/lib/client.js`:

```js
// :1787 claimOf  (Space / persisted chip restore)
if (desc === void 0 || desc.input === void 0) return void 0;   // :1791  no input -> no claim

// :1810 matchEnter (Enter)
if (desc.input !== void 0) {                                    // :1847
  return { claim: this.leadingClaim(desc, session, token.slice(1)) };
}
if (!bare) return void 0;                                       // :1851  <-- key line
...
this.runDetached(desc, session, canonical);                     // bare only
```

Two independent gates, both decided by `desc.input`:

| `input` declared | `/interrupt <text>` | `/interrupt` bare |
|---|---|---|
| **yes** (committed `261b664`) | returns a **claim** -> composer runs the handler -> `cancel()` then `steer()` | same |
| **no** (working tree, live) | **`:1851` returns `undefined`** -> no source claims -> ordinary prompt -> `busyEnter: steer` sends it *into the running turn*, no abort | `:1851` passes (`bare`=`true`) -> `runDetached` -> handler runs |

`matchEnter` is polled in registration order by `dsh-client-ui-input-trigger/lib/client.js:1280-1290`
(`adjudicate`); first non-`undefined` wins; `undefined` falls through to the default sink
(`dsh-client-ui-conversation/lib/client.js:5404` -> `send(attempt)` -> `default-sink`), and
`busyEnter: steer` is resolved at `:16357-16360` and configured in the live profile
(`ui-conversation: busyEnter: steer`).

### 3.3 Live proof of both variants

Three `/interrupt` executions exist in the corpus:

```
2026-11-01T03:22:07Z  args=" 뭐가 그리 오래걸리냐?"  -> agent/inbox/spliced next-turn + "중단했습니다"
2026-11-01T03:27:46Z  args=" 뭐하냐?"              -> agent/inbox/spliced next-turn + "중단했습니다"
2026-11-01T20:40:02Z  args="" (bare)              -> command/done "현재 턴을 중단했습니다."
```

The first two ran **before** the uncommitted edit (13:10 KST) with `input` present: the claim
fired, the handler ran, the turn was cancelled, and the text was promoted to `next-turn`. The
third is bare and takes the `runDetached` path.

### 3.4 Verdict on `/interrupt`

**With `input` (committed): yes, it cancels the running turn before reading the operator's
sentence.** Order in `src/command.js:56-73` is `cancel(keepInbox)` -> `steer(text)`; the steer is
promoted to `next-turn` because the signal is already aborted
(`dsh-agent-loop/lib/index.js:564-566`, `wakingAfterAbort`). Nothing is lost, but the turn dies.

**Without `input` (live now): no abort at all.** `/interrupt <text>` is inert as a command — it
becomes a normal prompt delivered mid-turn by `busyEnter: steer`. The operator sees the text
appear in the running turn and concludes "the command does nothing".

Both are defensible; **they must not both be live**. The working tree currently ships the
inert-for-text variant while `docs/INTERRUPT-SPEC.md` and `test/command.test.js` now assert the
opposite. This is an unresolved product decision, not a bug in either the watchdog or the skill.

---

## 4. `interrupt-guide` registration — design decision, not a defect

**The name split is deliberate and documented.** `src/command.js:4-16` explains that both layers
parse `/<name>` and the ordering between the command registry and the skill user-invocation
scanner is not contractual, so one name in both layers would make the winner an accident of mount
order. Measured: the published catalog never silently resolves a collision in a way that breaks
anything — one catalog (2026-11-01T02:01) carried **both** `interrupt` and `interrupt-guide`;
every later catalog carries only `interrupt-guide`.

**Why the skill exists at all** (the "unnecessary registration" question): a **command never
reaches the model**. `/interrupt` is resolved in the client and executed host-side; its handler
output is a `command/done` record. So a command is structurally incapable of teaching the model
anything. `interrupt-guide` is the only surface by which the model can learn *which issuer*
stopped it and how to report it. Registration is therefore **correct by design**.

**The actual defect is the skill's body**, and it is real: `SKILL_CONTENT`
(`src/command.js:104-109`) instructs the model to use `interrupt_status`, `interrupt_request`,
`interrupt_clear`, `interrupt_yield`. Measured:

- `export const inject = ['commands', 'skills']` — **no `'tools'`**, so the plugin cannot register tools.
- `407611e` deleted `src/tool-specs.js` (193 lines) and `.dsh/skills/interrupt/SKILL.md`.
- Those four names exist **only inside the skill text itself** (grep of the plugin + the whole
  installed `@deepseek-ai` tree finds no such tools).

So the guide teaches four capabilities the model does not have. **Keep the registration; fix the
body** (delete §"도구" or register the tools).

---

## 5. Can the prompt runtime legitimately participate?

**Yes for reporting, no for abort authority.** The distinction is load-bearing:

- **Abort authority must stay deterministic and in code.** `agent.cancel()` is synchronous and
  carries a `reason` that becomes the turn-exit reason
  (`lib/index.js:984`; `interrupt-bridge.js:62` records `watchdog_timeout` first). Routing that
  through inference would make an abort depend on the very model that is stuck — and a model
  cannot reliably end its own stalled turn.
- **Cooperation belongs at the hand-off**, which already exists: `keepInbox: true` + `steer`
  promotes the operator's text to the next turn. That is the correct cooperation surface.
- **The failure mode to avoid** is exactly the one measured here: an *advisory* notice silently
  resetting the budget that is meant to end the turn. **A notice is not progress.**

The practical design: after a real watchdog interrupt, inject **one** message naming the issuer
(`watchdog_timeout`) and pointing at the guide, then let the guide govern reporting. The abort
decision itself stays in code. Note this must be a *terminal* injection — it must not re-arm the
budget (see §1.3).

---

## 6. Corrections to prior figures (measure or be measured)

| Claim carried into this task | Measured | Note |
|---|---|---|
| "254 firings, all warning only" | **24** injected notices; 30 matching journal lines (16 + 7 + 1 + 6 older-format) | 254 is not reproducible in any session root (169 current + 117 quarantine = 0 in quarantine). Likely a broader substring count: 1,788 raw lines contain "watchdog" anywhere (including model text). Quote **24 (corpus) / 30 (journal)** instead. |
| "the interrupt action never fired" | **FALSE for the whole history** — 6 `action=interrupted` lines in the journal: 2026-10-30T04:02:59, 04:16:47, 2026-10-31T20:18:52, 20:37:52, 20:49:14, 21:53:33 (KST) | The regression is real but recent: the last interrupt predates commit `3254ebf` (2026-11-01 09:09 KST), which replaced `notice()` with `noticeUser()`. Before that the notice never entered the session, so the timeout *did* fire. |
| "notice becomes user/message and resets via :776" | Reset via `agent/inbox/spliced` at `:783`; `user/message` at `:778` is a second vector | Both must be guarded. |

Regression window: **`3254ebf` (2026-11-01 09:09 KST) introduced `noticeUser()` for the watchdog.**
That single change converted a working interrupt into a permanent warning.

---

## 7. Gaps / not measured

- The **exact** provenance of the `ms of N ms` warning wording (16 of 24 notices) is **not** in
  any git object, dangling commit, or working tree I could find. It brackets the interval between
  an uncommitted variant and `3254ebf`. I could not recover that intermediate build.
- I did **not** run the live 600 s watchdog (would need a 10-minute idle turn on the real service).
  All timing evidence is corpus-derived plus sub-second probes.
- `interrupt_*` tool absence was established by grep of the plugin and the installed
  `@deepseek-ai` tree, not by enumerating a live `request/header` tool array.
- The `254` figure's origin is unresolved; §6 gives the reproducible numbers.
- The proposed §1.3 fix is **not applied** — this task is read-only.

---

## 8. Artifacts

Scripts (all under `/tmp/te-wd/`):
`scan-precise.mjs`, `analyze-perturn.mjs`, `analyze-suspension.mjs`, `analyze-branches.mjs`,
`verify-inbox-live.mjs`, `shape-inbox.mjs`, `reconcile-254.mjs`, `probe-reentrant.mjs`,
`probe-ab.mjs`, `run-one.mjs`, `probe-postfix.mjs`, `analyze-interrupt-runs.mjs`,
`analyze-skill-collision.mjs`; variant build at `/tmp/te-wd/variant/`.

No writes to `~/.dsh` or any repository.
