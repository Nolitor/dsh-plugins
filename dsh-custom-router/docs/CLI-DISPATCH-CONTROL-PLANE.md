# CLI Dispatch Control Plane — Admission Gate and Process Reclamation

<!-- skeleton:
version: 0.0.1-rc.9
kind: spec
status: active
updated: 2026-11-08
summary: The router's two duties over external CLI workers (AGY, OpenCode v2): refuse dispatch from a restricted preset/sandbox before any argv exists, and reclaim a dispatched process when its session is torn down or the router unloads.
-->

> Status: **implemented and measured**. Baseline DSH `0.2.2-rc.1`, 2026-11-08.
> Code: [`lib/dispatch-gate.js`](../lib/dispatch-gate.js). Tests:
> [`test/dispatch-gate.test.mjs`](../test/dispatch-gate.test.mjs) plus the two provider
> suites. Live check: `npm run verify:dispatch` (10/10).

## 1. Why the router owns this

The router is the only owner of the preset mounts, so it is the only component that knows
every CLI surface it dispatched. Two consequences drive the design:

- **One gate, not two.** Putting the rule in each vendor package would mean two
  implementations that can drift, and a vendor mounted standalone would silently have no
  gate at all.
- **The vendors still assert it.** A direct `ctx.subagents` caller never passes a tool, so
  each provider repeats the check in `start()` with the *same* message. That is defence in
  depth, not a second policy.

The seam already existed: `ctx.provide('customRouter')`. This adds a `cliDispatch` face to
it — `{ registry, gate, track, reclaim }`.

## 2. Measured facts this design rests on

| Fact | Measurement (2026-11-08) |
| :--- | :--- |
| Sandbox governs file effects, not process creation | Under `read-only`, `dsh --version` and nested `bwrap` spawn fine; only **writes** are denied (`denied: true`, `Read-only file system`) |
| A child plugin cannot see a parent-provided service with `ctx.get()` | Returns `MISS`; the deferred `ctx.inject([...])` form returns the service |
| Providers hold the parent **Agent**, lifecycle edges deliver a **Session** | `request.parent` is an Agent; `agent/disposed`/`session/disposed` payloads carry a Session |
| The settings schema materialises `[]` for an absent array field | `new Config({})` → `{ restrictedPresets: [], restrictedModes: [] }` |
| `tools/pre-execute` is the shipped policy seam | Same seam Auto-review and workspace-changes use; decision vocabulary is `{kind:'allow'\|'deny'\|'cancel'\|'ask'}` |

Each of those facts is pinned by a regression test, because each one was a place the first
draft was wrong.

## 3. Admission

A `tools/pre-execute` listener, registered with `prepend`, installed **before** the preset rows
mount so a vendor registering its tool during its own `apply()` is already covered.

```text
tool call ──▶ tools/pre-execute ──▶ is it a CLI worker tool? ──no──▶ next()
                                        │yes
                                        ▼
                          resolve preset + sandbox mode for the session
                                        │
                    minimal preset or read-only/workspace-write?
                                        │yes                    │no
                                        ▼                       ▼
                       {kind:'deny', reason: …}            next()
                       (no argv is ever built)
```

- **Gated tools** are derived from the preset declarations (`surfaces.tools`,
  `surfaces.cli`, `surfaces.batch`) plus the shipped names, so a renamed surface is gated
  without editing the module.
- **`subagent_*` tools are excluded.** They start an in-process child whose own sandbox is
  inherited and enforced, so they are already inside the boundary. The gate exists for
  surfaces that reach an **external** binary.
- **The denial is an ordinary tool error.** `{kind:'deny'}` is what the host already renders
  for a policy refusal, so the model sees a normal failure and the audit log records it.
- **`auto: true` cannot override it.** The decision lands before the tool body, so no argv —
  and therefore no `--auto` — is ever constructed. This is structural, not a flag check.

### Fail-closed details

- An agentless call consults the deployment default mode.
- An unknown mode is **not** treated as full access by the mode rule, but the preset rule
  still fires independently.
- Empty restriction lists fall back to the shipped defaults: an empty list cannot mean
  "restrict nothing" for a field the operator never set. Turning the gate off requires
  `cliDispatchGate.enabled: false`, which logs a warning at load.

## 4. Reclamation

`CliWorkerRegistry` files one record per dispatched handle under its **Session**.
`sessionOf()` is the single normalization point, so a worker tracked through its Agent is
reclaimable through its Session.

Three lifecycle edges release a record, all bound through `ctx.effect`-scoped listeners:

| Edge | When it fires |
| :--- | :--- |
| `agent/disposed` | One session's agent goes away |
| `session/disposed` | The Session store tears the session down |
| router disposer | The router row unloads or reloads |

Termination uses the subprocess seam's own `terminate()` verb — the same one the abort signal
drives. This module never invents a signalling scheme; it only decides **when** to call it.

Reclamation is idempotent and never blocks the remaining records: a `terminate()` that throws
is logged and the next record proceeds. A handle that settles on its own drops its record, so
a long session does not accumulate one dead entry per call.

## 5. Configuration

```yaml
- id: dsh-custom-router
  config:
    cliDispatchGate:
      enabled: true                 # absent means ON
      restrictedPresets: [minimal]  # empty means the shipped default
      restrictedModes: [read-only, workspace-write]
```

It sits with the mount-time fields (`strict`, `packages`) rather than the `.volatile()` ones:
the gate is installed during `apply()`, so a volatile write would not reinstall it. Turning it
off is a deliberate profile edit, not a dashboard toggle that silently widens running sessions.

## 6. Verification

`npm run verify:dispatch` runs 10 checks against real processes:

- four restricted combinations (`minimal` × full access, `minimal` × workspace-write,
  `standard` × workspace-write, `standard` × read-only) — each denies all four CLI tools
  with **bodyRuns = 0**;
- the control case (`standard` × full access) allows all four;
- a real long-lived child is killed by `agent/disposed`, by `session/disposed`, and by router
  unload;
- a sibling session's worker survives its neighbour's teardown;
- a settled worker leaves no record.

## 7. Known limits

- Network egress and credential reads remain outside the file sandbox (measured); the gate
  governs **who may dispatch**, not what the child can reach once it runs.
- The gate does not stop an operator from mounting a vendor **without** the router; that
  composition keeps signal-only cancellation and has no admission rule.
- A worker that daemonises itself out of the process group is a subprocess-seam concern, not
  one this registry can observe.

## 8. Provider-slot migration — Step 1 (2026-11-08)

Owner-approved scope: the peer alignments and the OpenCode CLI toggle. M9 (readiness probe) stays
deferred and is **not** implemented here.

### 8.1 What Step 1 changed

| Item | Before | After |
| :--- | :--- | :--- |
| `dsh-opencode-v2` peer on this package | `0.0.1-rc.2` | `0.0.1-rc.9` |
| `vendor/antigravity` peer on this package | `0.0.1-rc.2` | `0.0.1-rc.9` |
| OpenCode CLI surface | mounted | mounted (**the `cli: false` switch was applied and withdrawn the same day** — see §8.5) |
| `surfaces.cli` declaration | `toolName` only | `default: false` + `gates: ['opencode']` |

The declaration follows the VENDOR, not the gate: `dsh-opencode-v2/lib/index.js` gates the
`opencode` tool, `/ocode` and `cli_worker` with one switch (`cliOn`). Naming only `toolName` would
have forced `verify-presets.mjs` to loosen; `gates` keeps it strict.

### 8.2 Measured effect (real mount, isolated `DSH_HOME`)

| Registry | Before | After |
| :--- | :--- | :--- |
| tools | `working_directory, agy_worker, subagent_antigravity, opencode, cli_worker, subagent_opencode` | `working_directory, agy_worker, subagent_antigravity, subagent_opencode` |
| commands | `agy, …, ocode, permission` | `agy, export, feedback, interrupt, permission` |
| providers | `…, opencode-http-agent` | **unchanged** — model serving survives |

`opencode-http-agent` staying mounted is the point of the step: the CLI surface can be withdrawn
without taking the route this session's model arrives on.

### 8.3 Latent defect recorded, not fixed

`dsh-opencode-v2` registers its surfaces once at load and installs **no**
`app-boot/config-reload` reconciliation (measured 2026-11-08; contrast `vendor/antigravity`, which
has `syncAll`). A `cli` flip in the profile therefore takes effect on the next
`dsh-web.service` restart. Same class as ledger F-46 — volatile config is live data, not an
install trigger. Fixing it is a code change outside the approved scope.

### 8.4 What Step 2 and Step 3 still need

- **Step 2** (isolate legacy spawn paths): already satisfied in this profile — `dsh-opencode-v2`
  is a profile *dependency* only, absent from `dsh.profile.bundles`, so the router slot is the sole
  mount path. The remaining work is a regression guard, not a removal.
- **Step 3** (full slot migration): needs the M9 readiness probe to decide activation from
  capability instead of a manual boolean. Deferred by owner decision.

### 8.5 Correction — Step 1 was withdrawn the same day

The `cli: false` switch described above was reverted within the hour. Two measured facts made the
original step wrong:

1. **The surface was never disabled at the source.** `dsh-opencode-v2` declares
   `cli: Schema.boolean().default(true)`, and its own `cordis.patch.yml` carries no `cli` key. A
   booted profile built from the pre-change backup shows `subagent_opencode`, `cli_worker`,
   `opencode` and `/ocode` all mounted. The migration was already complete; the router had been
   mounting these surfaces since the vendoring work.
2. **One switch withdraws three surfaces.** `cliOn` guards the `opencode` delegation tool, the
   `/ocode` command and the `cli_worker` batch together. There is no supported way to keep
   `/ocode` while dropping only the batch, which is why "CLI toggle" was never a surgical step.

**Consequence for Step 1's successor.** A future step that withdraws a surface must either
(a) split the vendor switch per surface first, or (b) accept removing all three and say so in the
report. Removing all three silently is what produced the owner-visible "`/ocode` is not loading"
defect.

**Verified after the withdrawal** (real mount, isolated `DSH_HOME`):

```
tools     working_directory, agy_worker, subagent_antigravity, opencode, cli_worker, subagent_opencode
commands  agy, export, feedback, interrupt, ocode, permission
providers deepseek-account, antigravity, deepinfra, deepinfra-anthropic, opencode-http-agent
```

`verify-presets` reports OK against the live profile. The running `dsh-web.service` process still
reflects the pre-withdrawal config until it restarts, because this vendor has no
`app-boot/config-reload` reconcile (§8.3).
