# Interrupt Lifecycle — Measured Root Causes

<!-- skeleton:
version: 1.0
kind: measurement
status: measured
updated: 2026-11-02
summary: Measured why the TokenEconomizer watchdog never interrupts and why /interrupt can abort a turn prematurely, with the exact code paths, the reproduced probe, and what the prompt runtime may legitimately do about it.
-->

> Status: measured · 2026-11-02 · Companion: [INTERRUPT-ARCHITECTURE.md](./INTERRUPT-ARCHITECTURE.md)

## 0. Summary

Two independent defects, both measured, neither in the skill:

| # | Defect | Verdict |
|---|---|---|
| 1 | The watchdog resets its own budget with its own warning, so the timeout can never fire | **watchdog** bug — **FIXED 2026-11-02**, 6 tests |
| 2 | `/interrupt` with text cancels the turn *before* it hands over the operator's text — but only in the `input`-declared variant | **command** design; the live variant is currently the inert one |
| 3 | The guide instructs the model to use four tools that do not exist | **skill** defect — open |
| 4 | `interrupt-guide` looks redundant next to `/interrupt` | **not a defect** — a command never reaches the model, so only a skill can teach attribution |

**Answer to "why is the interrupt not working": it is the watchdog, and specifically a regression
introduced on 2026-11-01 by commit `3254ebf`.** The skill and the prompt are not the cause; the
skill's *body* is separately wrong (defect 3).

## 1. The watchdog never interrupts (defect 1)

### Measured

* `journalctl --user -u dsh-web.service` since 2026-11-01: **24** lines matching
  `watchdog ... warning only`, and **0** matching `action=interrupted`.
* Live resolved config already says `watchdogAction: interrupt`,
  `watchdogThresholdMs: 600000`, `watchdogWarnMs: 300000`. The configuration is not the problem.
* Corpus scan for `watchdog:` across real sessions: 254 matches, all advisory.

### Cause — corrected after deeper tracing

> **Correction.** The first reading of this section named `user/message` (line 776-778) as the
> resetting vector. That is a *second, later* vector. The one that actually fires is
> **`agent/inbox/spliced`** at line **783**. The counts below are also corrected: the journal holds
> **30** watchdog lines (**24** injected notices in the corpus), not 254 — the larger figure was a
> broad substring count that included model reasoning text.

The watchdog's warning is delivered by `noticeUser()` -> `state.agent.inject(userMessage(...))`.
`inject()` is **synchronous**: it calls `send(input, 'next-step', false)` -> `inbox.splice()` ->
`session.append('agent/inbox/spliced')`, and the `session/event` is dispatched **inside the same
tick**, before `onWatchdogWarn` even returns. So the reset lands through the splice branch, whose
payload keeps its sources in an array:

```
agent/inbox/spliced  data keys : target, start, inserted
  data.source                 : undefined          <- where the first guard looked
  data.inserted[0].source.kind: tokeneconomizer    <- where it actually is
```

A guard written only against `data.source` therefore misses it. Measured against that shape:
**4 warnings / 0 cancels**. `observeMemory()` then calls `state.watchdog.progress()` for **every**
session event:

```js
if (event.type === 'user/message') {
  ...
  state.watchdog.progress()
  return
}
state.watchdog.progress()   // <-- line 776, every other event
```

The warning path is `onWatchdogWarn` -> `noticeUser` -> `state.agent.inject(userMessage(...))`
(`lib/index.js:1170`). An injected user message becomes a `user/message` session event, which
arrives at line 773 and calls `progress()` again. **The watchdog's own warning restarts its budget**,
so the expiry that would have interrupted never arrives. It warns forever.

### Reproduced

Constructed the real sequence (warn -> inject -> progress) against the shipped `createWatchdog`:

```
warns: 8 | timeouts: 0 | injections: 8
VERDICT: BUG CONFIRMED - the warning notice resets the budget
```

A second probe with steady unrelated progress (100 ms interval) produced `warns: 0, timeouts: 0`:
continuous activity postpones the budget indefinitely, which is correct behaviour for real work and
wrong for a notice the watchdog itself emits.

### Fix — applied 2026-11-02

`isOwnNotice(event)` inspects **both** shapes and returns true only when *every* message in the
event came from this plugin:

```js
data.source?.kind === MESSAGE_SOURCE.kind            // user/message
data.inserted.every(m => m.source?.kind === OWN)     // agent/inbox/spliced
```

The `every()` matters: a splice can carry genuine user input alongside a notice, and swallowing
that would lose the operator's message. Both `progress()` call sites in `observeMemory()` are now
guarded by it.

Verified end-to-end against the real splice shape:

```
PRE-FIX  (no guard):     warns=3  cancels=0
POST-FIX (isOwnNotice):  warns=1  cancels=1
```

The fix restores the interrupt: before it, the watchdog warned forever and never cancelled. Six
regression tests pin the predicate and require both call sites to stay guarded; the static one
fails when the guard is reverted (verified by temporarily reintroducing the defect).

### The regression that introduced it

Commit **`3254ebf`** (2026-11-01 09:09 KST, "interrupt by default") swapped the warning path from
`notice()` to `noticeUser()`. `notice()` only logged; `noticeUser()` also injects. That single swap
turned a harmless log line into a self-resetting budget. The journal confirms the timeline:

| Before the regression | After |
|---|---|
| 6 × `action=interrupted` (2026-10-30, 10-31) | 0 × `action=interrupted` since 2026-11-01 |

So "the watchdog never interrupts" is not a design property — it is a **regression with a date**.

## 2. `/interrupt` cancels before it hands over (defect 2)

### Measured

```js
// total_skill/src/command.js:55-73
registry.requestInterrupt(scope, { reason: 'user interrupt' });
agent.cancel({ kind: 'user', reason: 'user interrupt' }, { keepInbox: true });
agent.steer(text);   // only reached when rawInput is non-empty
```

The order is deliberate and documented (`docs/INTERRUPT-SPEC.md` §"왜 이 순서인가"): `cancel` with
`keepInbox: true` keeps the pending queue, and a `steer` after the abort is promoted from
`next-step` to `next-turn`, so the operator's text becomes the first message of the *next* turn
instead of the first step of the dead one.

That is a correct hand-off. The thing the operator experiences as a **premature abort** is that the
in-flight work stops *before* their sentence is read. Nothing is lost, but the turn is gone.

### Which variant is live

The working tree at `total_skill/src/command.js` has an **uncommitted** change removing the
command's `input` declaration, which is the opposite of what the committed version and
`docs/INTERRUPT-SPEC.md` both require. The spec is explicit:

> 커맨드 정의에 `input` 이 없으면 컴포저가 그 줄을 커맨드로 클레임하지 않는다.
> (`dsh-client-ui-commands/lib/client.js:1787-1793`)

Confirmed in the shipped source: `claimOf()` returns `undefined` when `desc.input === void 0`.
With `input` declared, the composer claims the line and the handler runs; without it, `/interrupt x`
is delivered as an ordinary prompt and the profile's `busyEnter: steer` passes it to the running
turn.

So the two variants are genuinely different products:

| `input` declared | What `/interrupt <text>` does |
|---|---|
| yes | claims the line -> handler runs -> **cancels the turn**, then steers text to the next turn |
| no | no claim -> the line is a normal prompt -> `busyEnter: steer` **delivers it to the running turn**, no abort |

**Both are defensible; they cannot both be live.** Today the working tree removes it while the spec
and the committed code require it. That ambiguity is the first thing to resolve.

## 3. The guide promises tools that do not exist (defect 3)

`SKILL_CONTENT` tells the model it has four tools:

```
- interrupt_status / interrupt_request / interrupt_clear / interrupt_yield
```

A search of the plugin, the live profile's `@nolit` tree and this workspace finds those names
**only inside the skill text itself**. The plugin registers no tools at all:

```
export const inject = ['commands', 'skills']   // no 'tools'
```

Commit `407611e` ("폐기 툴/스킬 제거") deleted `src/tool-specs.js` (193 lines) but left the
instructional body pointing at its output. The skill therefore teaches the model to call
capabilities it does not have.

This also answers the standing question *why is /interrupt-guide registered at all*: it is not
redundant with `/interrupt` — a command cannot teach the model anything, because a command never
reaches the model. The defect is not that the skill exists; it is that the skill's body is now
false.

## 4. Can the prompt runtime cooperate instead of being terminated?

Yes for the *reporting* half, no for the *abort* half. The distinction is worth stating precisely.

* **Abort authority must stay deterministic.** `agent.cancel()` is synchronous and reasoned; the
  turn-exit reason is what the operator and the ledger read. Routing that through a model decision
  would make an abort depend on inference, and a model that is the thing stuck cannot be trusted to
  end its own turn.
* **Cooperation belongs at the hand-off.** What the prompt runtime can legitimately do is what the
  command already does: keep the inbox, steer the operator's text into the next turn, and let the
  model read a guide that describes the real mechanism. The guide is the cooperation surface; the
  cancel is the control surface.
* **What it must not do** is what the current watchdog does — let an advisory notice silently
  reset the very budget that is supposed to end the turn. A notice is not progress.

The practical shape of "cooperate": after a watchdog interrupt, inject one message that names the
issuer (`watchdog_timeout`, not `user interrupt`) and points at the guide. The guide then tells the
model how to report and what not to retry. The abort decision itself stays in code.

## 5. Reproducing

```sh
# defect 1: count warnings vs interrupts in the live service
journalctl --user -u dsh-web.service --since '2026-11-01' --no-pager | grep -c 'warning only'
journalctl --user -u dsh-web.service --since '2026-11-01' --no-pager | grep -c 'action=interrupted'

# defect 3: the tools the guide promises exist nowhere
grep -rn 'interrupt_status' ~/.dsh/profiles/web/node_modules/@nolit/ \
  --include='*.js' | grep -v SKILL
```
