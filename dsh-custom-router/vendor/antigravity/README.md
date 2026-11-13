# Antigravity Agent for DeepSeek Harness

<!-- skeleton:
version: 1.0
kind: readme
status: active
updated: 2026-11-05
summary: Operator entry for @nolit/dsh-antigravity: the three switchable surfaces (model serving/router over web auth, subagent provider, CLI worker) plus the auxiliary usage chip, and how to verify each mount.
-->


One plugin, three surfaces, one account.

| # | Surface | What it serves | Switch | Default |
| :--- | :--- | :--- | :--- | :--- |
| 1 | **Model serving / router** (web auth) | the `antigravity` provider route — pure HTTP to `cloudcode-pa`, live catalog, quota and plan facts | `modelServing` | on |
| 2 | **Subagent** | the `antigravity` subagent provider + the `subagent_antigravity` row | `subagent` | on |
| 3 | **CLI** | `/agy <task>` + `agy_worker` (managed child session); optional `agy_cli` synchronous batch | `cliWorker`; `workerEnabled` disables `agy_worker` only; `cliBatch` adds the batch tool | on / on / **off** |

Auxiliary, not a surface of its own: the composer usage chip and the settings tab (`usagePill`).

`enabled` is the master switch. The plugin itself can also be disabled from the **DSH Plugins page**, which unmounts every surface at once.

---

## Requirements — read before installing

This plugin is a **client for Google Antigravity**. It does not create, grant, or proxy an
account. All three requirements must be met on the target machine.

### 1. Antigravity CLI (`agy`) must be installed and signed in

| Item | Measured on this host (2026-11-05) |
| :--- | :--- |
| Binary | `/home/minami/.local/bin/agy` |
| Version | **1.5.0** |
| Size | 238,604,688 bytes |
| Install date | 2026-11-05 01:36 |

```bash
which agy && agy --version    # must print a version
agy models                    # must list models, proving the sign-in works
```

The CLI surfaces (`/agy`, `agy_worker`, `subagent_antigravity`) **require this binary**.
The model-serving surface does not spawn it, but it still reads the CLI's credential file (below).

The `/agy` command and `agy_worker` tool also require the shared subagent service
(`@deepseek-ai/dsh-subagent`) and this plugin's `subagent` surface. They do **not** spawn a bare
`agy` process: they start a tracked child session and return its id. When either dependency is
missing the call fails with a message naming it — there is no untracked-process fallback.

### 2. A web-authenticated Antigravity subscription

Authentication is the **consumer OAuth credential written by `agy`**:

```
~/.gemini/antigravity-cli/antigravity-oauth-token     (probed first: jetski-standalone-oauth-token)
{ "token": { "access_token", "refresh_token", "expiry" }, "auth_method": "consumer" }
```

Sign in with `agy` once and the file appears. The plugin **reads it and never writes it**.

```bash
ls -la ~/.gemini/antigravity-cli/antigravity-oauth-token
```

There is **no API-key path**: this is not the Gemini Developer API or Vertex. A `GEMINI_API_KEY`
does not authenticate this plugin.

### 3. Network reachability

The plugin talks to two Google hosts directly:

| Host | Used for |
| :--- | :--- |
| `daily-cloudcode-pa.googleapis.com` | generation (SSE), **and `fetchAvailableModels`** |
| `cloudcode-pa.googleapis.com` | `loadCodeAssist` (and the quota RPC) |
| `oauth2.googleapis.com` | refresh-token grant |

**The catalog host is not interchangeable.** Measured 2026-11-13 with one token, same body:

| Host | `fetchAvailableModels` result |
| :--- | :--- |
| `daily-cloudcode-pa.googleapis.com` | **31 models, 4 Hydrogen** (`gemini-4-hydrogen-{low,medium,high,xhigh}`) |
| `cloudcode-pa.googleapis.com` | 26 models, **no Hydrogen** |

An earlier revision of this table said the catalog came from the control host. That was wrong,
and code written from it (`rpc()` hardcoded `cloudcode-pa`) hid every Hydrogen route from the
settings list even though the account served them. `loadCodeAssist` answers 200 on **both** hosts;
only the catalog differs.

A proxy is supported through `extraHeaders` and the standard `HTTPS_PROXY` handling of the
host's fetch implementation.

---

## Google policy — read this too

**This plugin uses an undocumented consumer endpoint that Google can change or close at any time.**

- It is **not** a supported Google API. The endpoints were measured by inspecting the traffic of
  the official CLI; they carry no compatibility promise.
- Google's Antigravity terms and the Gemini Code Assist terms govern this usage. **Authentication
  or usage can be suspended, rate-limited, or terminated by Google**, and the plugin cannot prevent
  that.
- The plugin sends the CLI's own `antigravity/cli/` User-Agent because the API rejects requests
  without it (measured: HTTP 403 `You do not have a valid license of this product`). This is the
  client identity Google ships, **not** a bypass.
- Quota is per account and per model. `fetchAvailableModels` reports `remainingFraction`; the
  settings section shows it. Exhausting quota returns HTTP 429.
- **Do not** use this to circumvent a paid tier, share one account across people, or automate
  against the terms. If Google disables the account, every surface in this plugin stops at once.

If that risk is not acceptable, use a supported route (Gemini API key, Vertex, or another
provider) instead.

---

## Installation

```bash
# 1. Confirm the requirements above.
agy --version && agy models

# 2. Link the package into the profile.
dsh plugin --profile web add link:/path/to/dsh-antigravity

# 3. Verify the mount (a real boot, not just --dump-config).
dsh --profile web --no-open --port 18099
#   the log must NOT contain "skipping profile bundle" or "did not activate"
```

`--dump-config` is **not** proof of a mount: it prints the composed tree and says nothing about
whether the package resolves or the plugin activates.

---

## Usage

### `/agy` — the user-run CLI worker

```
/agy <task>                     start a managed child session for the task
/agy models                     list the models the account serves
```

The command prints the child session id immediately; the answer (or failure) arrives later as a
**completion notice**, not in the command reply. The child is listed in the parent session's
subagent panel (`서브에이전트 N개`), not as a separate top-level sidebar session. The child sees only
the task text, never this conversation. The model, effort and mode come from this plugin's settings; there are no per-call
`--model`/`--effort` flags on the activation path.

`/agy models` is a read-only listing (`agy models`) that starts no session and is unaffected.

### `agy_worker` — the model-facing tool

The agent calls it for self-contained jobs that should run in a tracked child session. It returns:

```json
{ "kind": "activation", "subagentId": "<child session id>", "provider": "antigravity", "label": "<first line of the task>", "status": "started" }
```

and the final answer or failure arrives as a completion notice. The tool does not wait for the
result, so the model should start the work and continue elsewhere; the notice carries the outcome.

Errors surface as the tool call's error text when the dependency is missing (no subagent service,
no registered `antigravity` provider, no calling agent, empty task). Once a child has started, a
failure is delivered in the completion notice instead of the tool result.

### `antigravity` — the model route

Appears in the model picker once `modelServing` is on. One entry per base model, with a reasoning
level selector:

| Picker id | Efforts |
| :--- | :--- |
| `gemini-4-hydrogen` | low, medium, high, **xhigh** |
| `gemini-4-argon` | low, medium, high |
| `gemini-3.8-flash` | low, medium, high |
| `gemini-3.5-flash-lite` | low, medium, high (three aliased ids; see below) |
| `claude-sonnet-5-5` | low, medium, high |
| `claude-opus-5-5` | low, medium, high |
| `gpt-oss-120b` | medium (no image support) |

This table is **measured per account**, not fixed: the picker shows whatever
`fetchAvailableModels` returns, grouped by base model. Levels come from the id suffix, so a family
that serves a fourth level (`xhigh`) advertises four. **Every model with a low level defaults to
low.** `gpt-oss-120b` is the exception because the account serves only `-medium`; requesting a
level it does not serve returns 404, so an unserved level folds onto the nearest served one.

Effort is encoded in the model id suffix, because `thinkingConfig.thinkingLevel` is ignored by the
server (measured). The Gemini 3.5 Flash Lite family is the one exception: Google serves it as three
unrelated ids whose display names are identical, so the plugin aliases them back to one base:

| Picker effort | Raw id sent |
| :--- | :--- |
| low | `gemini-2.5-flash-lite` |
| medium | `gemini-2.5-flash` |
| high | `gemini-2.5-flash-thinking` |

The mapping must **round-trip** (F-40): `modelForEffort()` resolves a chosen level back to a wire
id, and it may fold a level only when the catalog does not carry that exact id. Folding
unconditionally (`xhigh → high`) is a control that is accepted but not honoured, which is the
failure F-40 records.

Sending an image to a model without image support is refused with `UNSUPPORTED_OPTION` rather than
silently dropping the image.

The settings tab groups models by usage family and shows the account's **weekly + 5-hour** limits
from `retrieveUserQuotaSummary`; it hides effort entirely. See
[dsh-antigravity/docs/ANTIGRAVITY-STAGE-PLAN.md](./docs/ANTIGRAVITY-STAGE-PLAN.md) for the stage-1 gate.

### `subagent_antigravity` — delegation

A `ctx.subagents` provider that runs one isolated `agy` process per delegation.

---

## Configuration

Every value resolves **config → environment → built-in default**.

| Value | Config | Env | Default |
| :--- | :--- | :--- | :--- |
| client id | `clientId` | `ANTIGRAVITY_CLIENT_ID` | agy-extracted |
| client secret | `clientSecret` | `ANTIGRAVITY_CLIENT_SECRET` | agy-extracted |
| refresh token | `refreshToken` | `ANTIGRAVITY_REFRESH_TOKEN` | token file |
| token file | `tokenFile` | `ANTIGRAVITY_TOKEN_FILE` | probe list |
| generation URL | `baseUrl` | `ANTIGRAVITY_BASE_URL` | daily host |
| User-Agent | `userAgent` | `ANTIGRAVITY_USER_AGENT` | measured agy string |

### Switches

Grouped by the surface they own. `enabled` is the master: off removes all three surfaces (the
settings panel stays mounted so it can be turned back on).

| Surface | Switch | Off removes |
| :--- | :--- | :--- |
| master | `enabled` | every surface below |
| 1 model serving | `modelServing` | the `antigravity` provider route |
| 2 subagent | `subagent` | the subagent provider (the CLI worker then reports a missing-provider error instead of spawning) |
| 3 CLI | `cliWorker` | `/agy` and `agy_worker` |
| 3 CLI | `workerEnabled` | `agy_worker` only (keeps `/agy`) |
| 3 CLI (optional) | `cliBatch` | the synchronous `agy_cli` batch tool (off by default; the tracked child stays) |
| 3 CLI (yield) | `batchYieldToProvider` | makes `agy_cli` report `provider-mounted` instead of spawning when that subagent provider is mounted (empty by default) |
| auxiliary | `usagePill` | the composer usage chip |

The **settings tab contains grouped model selection only**: the live account catalog is grouped by
usage family (Gemini Models / Claude and GPT models / Gemini 4 Argon), then by base model, so the
reasoning suffixes are hidden and one checkbox owns every effort variant. Save selection persists
the full variant set. The plugin's own switches are profile config (the table above), not duplicated
in the tab; the whole plugin is enabled/disabled from the **DSH Plugins page**. The tab stays mounted
while the plugin is mounted so the model list remains reachable. The usage chip renders nothing
when off, leaving no empty node in the composer.

Config switches are live: the host announces `app-boot/config-reload` after a profile/settings
write, the plugin re-evaluates every gate, and the adapter / tool / command / provider is disposed
or re-registered without a restart. Model filtering (`enabledModels`) also invalidates the catalog
cache, so the picker reflects a saved selection immediately.

---

## Localisation

English is the default; Korean follows the host locale. `locale/en.json` and `locale/ko.json` are
the source of truth and `npm run build` bakes them into the browser bundle. A test fails if the two
drift.

## Styling

Every size is a live DSH token — `var(--dsh-content-font-size,14px)` and the derived secondaries —
so the surface follows the user's font-size setting. The section never sets `font-family` (it
inherits) and never targets a bare element selector. See
[`docs/PLUGIN-STYLE-STANDARD.md`](../docs/PLUGIN-STYLE-STANDARD.md) v2.0.

## Development

```bash
npm run build    # regenerate the locale table and the browser bundle
npm run check    # syntax check every module
npm test         # 90 tests, no network
```

## Measured protocol notes

- Generation must use **`daily-cloudcode-pa.googleapis.com`**; the same body and token return 200
  there and 429 on `cloudcode-pa.googleapis.com`.
- Only the top-level `model` field is required; omitting it returns 404.
- The base id (`gemini-3.8-flash`) is **not** served — only the suffixed ids are.
- SSE frames are **CRLF**-terminated.
- `thoughtsTokenCount` becomes `reasoningTokens`, never added to `outputTokens`.
