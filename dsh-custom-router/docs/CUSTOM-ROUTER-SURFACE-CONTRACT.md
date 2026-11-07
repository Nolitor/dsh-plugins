# Custom Router — Surface Contract (M13–M16) and Provider-Preset Migration

<!-- skeleton:
version: 0.0.1-rc.1
kind: spec
status: draft
updated: 2026-11-07
summary: Normative contract for the four surfaces a provider preset must declare (CLI worker, subagent provider, tool/command, skill invocation), plus the measured baseline, the protocol-lane rule (reuse PiAiAdapter for DSH-supported wires, own adapter otherwise), and the migration that folds @nolit/dsh-subagent-local into the provider plugins and then into the router preset layer.
-->

> Status: **draft, owner decisions recorded 2026-11-07; no code changed by this document.** It names
> only APIs and behaviours that were measured on the running rc.1 host, on the npm tarballs of the
> official Claude/Codex bundles, or on this workspace's packages. It never restates R0: the router
> still owns no routing table and never registers an adapter on another plugin's behalf.

## 1. Owner decisions this contract implements

| # | Decision (2026-11-07) | Consequence for this document |
|---|---|---|
| D1 | **Integration of already-implemented plugin features comes first.** DSH itself only ships the Claude/Codex CLI surface; Antigravity and OpenCode were built to the same spec. | M13–M16 describe surfaces that already exist in the three tracks; nothing new is invented here. |
| D2 | **Same-model precedence is the user's toggle in the DSH plugin settings**, not an automatic ranking. | A preset declares its surfaces and lets the settings switch decide; no precedence engine is specified. |
| D3 | **Outside the usable range, the plugin provides the addition.** | A preset may add surfaces the host does not have; each is declared, gated and disposable. |
| D4 | **A protocol DSH supports is routed through that supported path**, not through a second parser. `llm-pi-ai` stays disabled; its adapter is imported. | §5 defines the two protocol lanes. |
| — | **Retirement on host upgrade is deferred** (owner: not this step). | Recorded in §7 as undecided; no stand-down rule is fixed here. |

Measured reason for D4 (owner statement, confirmed against the package): `llm-pi-ai` pins the model
catalog that existed when the developer published the release, so it cannot serve a model added
afterwards. The provider plugins carry a live catalog; the protocol engine is still worth reusing.

## 2. Measured baseline

### 2.1 The official CLI-subagent spec (npm tarballs, `0.2.2-rc.1`)

Both official bundles declare the **same two rows** and nothing else:

| Row | `@deepseek-ai/dsh-subagent-claude-code` | `@deepseek-ai/dsh-subagent-codex` |
|---|---|---|
| provider row | id `subagent-claude-code`, provider **`claude-code`** | id `subagent-codex`, provider **`codex`** |
| tool row | `@deepseek-ai/dsh-tool-subagent` `{provider: claude-code, toolName: subagent_claude_code, maxDepth: provider-managed}` | same shape, `toolName: subagent_codex` |
| command / skill | none (measured: no `commands.register`, no skill registration) | none |

### 2.2 Our provider tracks today

| Surface | `dsh-antigravity` | `dsh-opencode-v2` | `dsh-subagent-local` |
|---|---|---|---|
| model adapter | `antigravity` (Google SSE wire) | `opencode-http-agent` (OpenAI wire) | — |
| subagent provider | `antigravity` + `tool-subagent-antigravity` | `opencode` + `tool-subagent-opencode` | none |
| CLI tool | `agy_worker` (**async activation**) | `cli_worker` (**sync one-shot**), `opencode` (delegation) | `delegate_local` (**sync one-shot**, 4 backends) |
| command | `/agy` | `/ocode` | none |
| skill | none | none | none |

`@nolit/dsh-subagent-local` is installed in the web profile's dependencies but **absent from
`dsh.profile.bundles`**, so it does not mount today. Its own contract: one tool, configurable name
(`delegate_local`), backends `antigravity|opencode|codex|claude`, args
`task, cwd, backend, model, effort, mode, timeoutMs, collect`, and a result carrying
`ok, backend, executable, model, promptTransport, exitCode, signal, timedOut, truncated, elapsedMs,
promptBytes, usage{input,output,thinking,cacheRead}, summary, diagnostic, errorKind, yieldedProvider,
stderrTail, artifacts`. It yields when the tool name is taken and reports `provider-mounted` when a
configured provider already serves that backend.

### 2.3 The duplication this contract removes

`delegate_local` overlaps `agy_worker`/`cli_worker` (same synchronous one-shot shape, same CLIs). The
migration in §6 folds that shape into the provider plugins so a profile never needs a second plugin
for the same CLI.

## 3. M13 — CLI worker surface

A preset declares **one of two shapes**, never both under the same tool name:

| Shape | Result contract | Measured precedent |
|---|---|---|
| **async activation** | returns before the work finishes: `{kind:'activation', subagentId, provider, label, status}`; the answer arrives as a completion notice | `agy_worker` |
| **sync one-shot** | blocks until the CLI exits; returns the §2.2 result record with exit facts, bounded output, hashed artifacts, disjoint usage buckets | `delegate_local`, `cli_worker` |

Normative rules:

1. **One tool name per backend.** Registration checks `ctx.tools.get(name)` and **yields** on a
   collision (no throw), matching `dsh-subagent-local` and `dsh-antigravity`.
2. **The result carries the facts, not a narration**: sync shape must expose `exitCode`, `signal`,
   `timedOut`, `truncated`, `elapsedMs`, `promptBytes`, `usage` and `artifacts`; async shape must
   expose `subagentId` and `status`.
3. **Prompt transport is per backend** and recorded in the result (`promptTransport`), because the
   measured CLIs differ (stdin vs argv).
4. **A backend already served by a mounted subagent provider yields** (`provider-mounted`), so the
   same CLI is never run twice for one request.
5. **Config gates are volatile settings fields** (`workerEnabled`, per-backend `enabled`, `path`,
   `model`, `effort`, `mode`, `timeoutMs`), so D2 can be satisfied by the settings toggle alone.

## 4. M14 — Subagent provider surface

Normative rules:

1. The provider registers its own id through `ctx.subagents.registerProvider(...)` and must not claim
   an id it does not own.
2. The tool row is the host's shared `@deepseek-ai/dsh-tool-subagent` with
   `{provider, toolName, maxDepth: 'provider-managed'}` — the exact shape measured in §2.1.
3. `toolName` follows `subagent_<provider>` for provider-owned rows. `subagent` and `subagent_*`
   names are reserved: a different package that wants a delegation tool must pick a distinct name
   (this is why `delegate_local` is not `subagent_local`).
4. Provider identity is the source of truth for the tool's model/effort/session behaviour; the preset
   does not re-derive it.

## 5. M15 — Tool and command surface, and the protocol lanes

1. Tools and commands are owned by the provider plugin that serves the CLI; a router preset only
   **declares** them, it does not register a second copy.
2. Command names are validated by the host against `/^[a-z][a-z0-9_-]*$/u`; the tool/command pair for
   one service shares a prefix (`/agy`↔`agy_worker`, `/ocode`↔`opencode`/`cli_worker`).
3. **Protocol lane A (DSH-supported wire):** `openai-completions`, `openai-responses`,
   `anthropic-messages`. The adapter is `PiAiAdapter` imported from `@deepseek-ai/dsh-llm-pi-ai`
   (exported symbol; constructed with `{profiles, resolveApiKey, auth, prepareHeaders,
   resolveAttachments, resolveImageAccess, onReplayDegrade}`). `llm-pi-ai` itself stays disabled.
4. **Protocol lane B (non-standard wire):** the provider owns an adapter built on the shared stream
   pipe (`@nolit/dsh-custom-router/stream`), e.g. Antigravity's Google SSE, OpenCode's control-plane
   quirks. This is the only place a provider-specific parser is legitimate.
5. Lane A does **not** import a model catalog from `llm-pi-ai`: the live catalog stays with the
   provider plugin (D4).

## 6. M16 — Skill invocation surface

This is the surface that is **measurably absent** today and must not be specified from imagination.

1. A skill is **instructions plus an invocation policy**, not executable code:
   `ctx.skills.register({name, whenToUse, content, invocation: {modelInvocable, userInvocable}, source, provider})`
   (the `skills` service contract, measured on the live host).
2. A CLI-invoking skill therefore names the **already-registered tool** (M13) in its `content`; it
   must not describe tools that do not exist — the interrupt track reproduced a turn-killing bug from
   exactly that mismatch.
3. **Measured trap:** `skills.register({name, description, content})` is accepted, but the first
   `skills.get()` validates the definition and **throws** unless `source` and `provider` are strings
   (`dsh-skill/lib/index.js:486-487`). A preset must therefore always supply both.
4. Skill names are kebab-case; a duplicate in one layer is first-wins and logs a warning.
5. Filesystem skills are **not** mounted in the web bundle (`skill-filesystem` and `tool-skill` are
   `disabled: true`), so a runtime skill registered by the plugin is the only portable form today.

## 7. Provider preset declaration (implemented as `lib/presets.js`, S4)

```yaml
preset: <service-id>            # one preset = one provider
protocol: <lane-a id> | <lane-b id>
adapter: pi-ai | shared-pipe    # lane A import vs lane B own adapter
surfaces:
  cli:    {shape: async|sync, toolName, commandName, gates: [enabled, workerEnabled]}
  subagent: {providerId, toolRow: '@deepseek-ai/dsh-tool-subagent'}
  tools:  [..]
  commands: [..]
  skill:  {name, invocation: {modelInvocable, userInvocable}}
catalog: live | cached(ttl)
usage:   {record: UsageReading, plan: PlanVerdict | unavailable}
```

Not decided in this step: retirement on host upgrade, the mounted surface (M10), and the skill
taxonomy for non-CLI providers.

**Data model (2026-11-07):** every preset fills the common model in
[`lib/preset-schema.js`](../lib/preset-schema.js): `kind` (`package` vs JSON `declaration`), `auth`
(`api-key` / `web-auth` / `local-socket` / `none` with ordered sources) and `endpoint`
(`http` / `local-http` / `daemon`, protocol, route, transport, base URL). Catalog and pricing
synchronize in three layers — upstream pi-ai snapshot → API/web-auth probe → preset/local override —
merged field by field with provenance (`lib/catalog.js`); routing resolves a model id by
`modelPrefixes` (`lib/routing.js`), the probe executor normalizes OpenAI/Anthropic listings and refuses
vendor-owned RPCs (`lib/probe.js`) with a handler/discovery connection, usage binds to cost + billing +
quota readings (`lib/usage.js`); the antigravity probe is a bridge over the vendor's own
TokenProvider/resolveEndpoint/parseCatalog exports (`lib/bridges/antigravity.js`), the opencode daemon
bridge (`lib/bridges/opencode.js`) and the standard deepinfra bridge (`lib/bridges/deepinfra.js`),
with vendorConfig slots per provider; vendor modules resolve through the profile
(`lib/vendor-modules.js`) and `apply()` provides a `customRouter` seam; cost is computed by
`lib/cost.js`. See
[PRESET-SCHEMA §2.3](./PRESET-SCHEMA-AND-EXTENSION.md#23-common-preset-data-model-2026-11-07--delivery-auth-endpoint).

**Switch unification (2026-11-07):** both provider tracks now expose the same three-surface switch
names — master `enabled`, `modelServing`, `subagent`, and the CLI pair `cli`/`cliWorker` plus
`workerEnabled`. `dsh-opencode-v2` gained `enabled`, `cli` (index row) and `modelServing` (the `…-http`
row); `dsh-antigravity` already had them. A preset's `switches` array names the module (`index` or
`http`) each switch lives in.

**Plugin body (2026-11-07):** `lib/index.js` (exported as `@nolit/dsh-custom-router/plugin`) is the
preset application path. `planApplications()` validates the declarations and resolves which presets
are active; `apply()` mounts each active preset's **own package plugin** as a child (`ctx.plugin`) and
returns a disposer that unmounts exactly those children. The body never calls
`ctx.llm.registerAdapter` (R0), never holds a route table, and mounts nothing unless a preset is
explicitly enabled (`presets: { <id>: true }`). 9 tests cover the plan, strict rejection, mount
isolation and disposal.
**Drift gate (owner decision 2b, 2026-11-07):** `npm run verify:presets` boots an isolated `DSH_HOME`,
reads the live registries (`llm.listProviders`, `tools.definitions`, `commands.list`) and each vendor's
`Config.dict`, then diffs them against this file. A phantom command or a switch that does not exist
fails the gate. Negative-tested by adding `/worker` to a preset: the gate exited 1 and named the drift.

**Implementation status (2026-11-07):** the shape above is now data in
[`lib/presets.js`](../lib/presets.js) (exported as `@nolit/dsh-custom-router/presets`) with
`validatePreset` / `validatePresets`. It registers nothing; the three declarations are
`antigravity`, `opencode` and `deepinfra`. The validator enforces the lane rule, the host
`dsh-tool-subagent` row, the `subagent_<provider>` name, CLI/batch name separation, the skill
invocation flags, and cross-preset tool/command uniqueness. 80/80 tests pass.

## 8. Migration plan — subagent-local into the provider plugins

Owner decision 1(a): move the functionality into the provider plugins, then discard the package.

| Step | Work | Gate |
|---|---|---|
| S1 | Port the **sync one-shot worker** (`worker.js`, artifacts, prompt transport, per-backend config) behind the existing `cli_worker`/`agy_worker` contracts | both tracks' unit suites green; no tool-name change |
| S2 | Add the **`provider-mounted` yield** and per-backend settings gates to both tracks | measured in an isolated `DSH_HOME` boot |
| S3 | Remove `@nolit/dsh-subagent-local` from the web profile's dependencies and archive the track | `--dump-config` unchanged minus that package; no orphan process |
| S4 | Declare each surface in the router preset layer (M13–M16), still registering nothing itself | a preset-only profile boots without the vendor packages |

**Status 2026-11-07 (S3 + S4 landed, drift gate green):** the track is gone from the live profile
(`dependencies`, `bundles`, `node_modules` link; `--dump-config` has zero hits) and lives at
`archive/dsh-subagent-local/` with its `ARCHIVED` banner. The preset declarations and validator
exist in `lib/presets.js`; a preset-only isolated profile (vendor bundles removed,
`@nolit/dsh-custom-router` still linked) boots with `deepseek-account` as the only provider.

**Status 2026-11-07 (S1 + S2 landed):** `dsh-antigravity` ships `agy_cli` — the synchronous one-shot
batch shape, off by default behind `cliBatch`, carrying exit facts, disjoint usage, the `argv` prompt
transport and hashed artifacts. `dsh-opencode-v2`'s `cli_worker` gained `effort` and `mode` (codex
`--sandbox` / `-c model_reasoning_effort=`, claude `--permission-mode`) plus `elapsedMs`,
`promptBytes` and `promptTransport`.

S2 adds the two gates: per-backend settings (`workerDisabledBackends`, `workerBackendPaths`,
`workerBackendModels`, `workerBackendEfforts`, `workerBackendModes`) and the **`provider-mounted`
yield** (`yieldToProviders` on the worker, `batchYieldToProvider` on the batch tool). Both are
**opt-in**: the sync shape stays available while a provider is mounted, which is what keeps the
existing `cli_worker`/`agy_cli` contract intact. Measured: 151/151 (antigravity) and 459/459
(opencode-v2) tests.

## 9. Verification of this document

- Official spec: `npm view … dist.tarball` + `npm pack` of `dsh-subagent-claude-code` /
  `dsh-subagent-codex@0.2.2-rc.1`, reading `cordis.patch.yml` and `lib/index.js`.
- Our tracks: `grep` over `lib/*.js` for `registerAdapter`, `registerProvider`, `tools.register`,
  `commands.register`, `skills.register`.
- Protocol lanes: `PROTOCOLS` and the exported `supportedProtocols`/`PiAiAdapter` in the installed
  `dsh-llm-pi-ai` package.
- Skill contract: live `cordis inspect` Service `skills`; the validation trap is reproduced in
  `projects/total_skill/src/command.js`.

## 10. References

- [CUSTOM-ROUTER-ARCHITECTURE.md](./CUSTOM-ROUTER-ARCHITECTURE.md) — M1–M12 and §2.2 surface table
- [SHARED-STREAM-PIPE-SPEC.md](./SHARED-STREAM-PIPE-SPEC.md) — lane B pipe and hooks
- [CUSTOM-ROUTER-PRESET-SURFACE.md](./CUSTOM-ROUTER-PRESET-SURFACE.md) — the preset surface (M10)
- [PLAN-AND-USAGE-SPEC.md](./PLAN-AND-USAGE-SPEC.md) — usage/plan record referenced by §7
- [README-OWNERSHIP.md](./README-OWNERSHIP.md) — R0 and package ownership
- `dsh-subagent-local/COMPATIBILITY.md` — the measured official-spec note this document re-verified
