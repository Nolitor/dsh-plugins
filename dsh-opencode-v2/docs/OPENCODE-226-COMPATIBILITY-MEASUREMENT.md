# OpenCode 2.2.6 compatibility measurement — 2026-11-07

<!-- skeleton:
version: 1.1
kind: measurement
status: measured
updated: 2026-11-07
summary: Measured OpenCode 2.2.6 compatibility and host installation state without changing live DSH or the OpenCode service; legacy 0.0.55 and stale caches were later cleaned up.
-->

> Scope: read-only measurement of the host OpenCode installations and of an isolated
> OpenCode 2.2.6 runtime. The live DSH profile, live OpenCode service, and live database
> were not modified. The only writes were temporary `/tmp` sandboxes and this track's
> documentation.
>
> Recommendation and unexecuted cleanup steps:
> [OPENCODE-INSTALL-CLEANUP-RUNBOOK.md](OPENCODE-INSTALL-CLEANUP-RUNBOOK.md).

## 1. Question and boundary

The owner reported that two OpenCode installations existed, that only 2.2 should be used,
and that an upgrade to 2.2.5 had happened. The measurement checked those claims against the
host, then tested the current `@nolit/dsh-opencode-v2` plugin against the current registry
release rather than the superseded 2.2.5 claim.

Measured on 2026-11-07 (KST) on `pop-os`, Node `v24.22.1`, DSH `0.2.2-rc.1`.

## 2. Host installation state

| Location | Measured version | Role | On an active execution path? |
|---|---:|---|---|
| `/home/minami/.bun/bin/opencode` → `@opencode/cli/bin/opencode.exe` | **2.2.0** | Interactive-shell `opencode`, both live DSH `opencodePath` rows | **Yes** |
| `/home/minami/.local/state/opencode/service.json` and PID 104336 | **2.2.0** | Running `opencode serve --service` on `127.0.0.1:49374` | **Yes** |
| `/home/minami/.opencode/bin/opencode` | **0.0.55** | Legacy standalone binary; `.bashrc` adds its directory to `PATH` | No for the current interactive shell, because `~/.bun/bin` precedes it |
| Bun global legacy `opencode-linux-x64*` package trees | **1.19.3** | Orphan-looking platform packages beside `@opencode/cli@2.2.0` | No |
| Bun cache entries | **1.18.35, 1.19.3, 2.0.30–2.0.32, 2.2.0** | Install cache only | No |

> Cleanup status: the 0.0.55 tree and stale OpenCode caches described below were removed
> **after** this measurement. See
> [OPENCODE-INSTALL-CLEANUP-LOG-20261107.md](OPENCODE-INSTALL-CLEANUP-LOG-20261107.md).

Additional facts:

- `type -a opencode` in an interactive shell lists
  `~/.bun/bin/opencode` first and `~/.opencode/bin/opencode` second.
- `bash -lc 'command -v opencode'` returned nothing; the login-shell path does not resolve
  OpenCode. The live DSH rows use an absolute path, so they are unaffected by this shell
  difference.
- The live `@opencode/cli` global manifest pins `^2.2.0`; the installed package is `2.2.0`.
- npm's `latest` dist-tag returned **2.2.6** (published `2026-11-06T23:37:20Z`).
  The GitHub `releases/latest` endpoint returned `v1.19.5`, while a `v2.2.6` release object
  exists. Version selection therefore used the npm `latest` tag and the explicit `v2.2.6`
  release object, not GitHub's `latest` endpoint.
- No 2.2.5 binary was installed on the host. The only 2.2.5 binary used here was downloaded
  into `/tmp` for comparison.
- Candidate stale/cache OpenCode trees under `~/.bun` totalled about **4.9 GiB** by `du -sch`.
  This is a cleanup estimate, not a claim that every byte is safely removable.

## 3. 2.2.6 artifact identity

| Item | Measured |
|---|---|
| Release asset | `opencode-linux-x64.tar.gz` from GitHub release `v2.2.6` |
| Asset size | `121793402` bytes |
| Asset SHA-256 | `08bb21d6326ce740d91cce7ebe88a6536933f6e1e30353b91a06b01f25da306c` |
| Expected digest | `sha256:08bb21d6326ce740d91cce7ebe88a6536933f6e1e30353b91a06b01f25da306c` |
| Extracted binary | `258824368` bytes, SHA-256 `50503d24577fa4117a7c95ee85b2cd679606a87eacf20ca54ed5db5c9e1cf895` |
| `--version` | `opencode v2.2.6` |

The extracted binary lived only under `/tmp/opencode-226-measure/`.

## 4. Control-plane compatibility

Method: copy the live `~/.config/opencode/opencode.jsonc`, `auth.json`, and the SQLite
database plus WAL/SHM into a throwaway `HOME`; start `opencode serve --hostname 127.0.0.1
--port 0`; authenticate with the banner password; query the same endpoints the plugin uses.

| Surface | 2.2.6 result | Plugin expectation | Verdict |
|---|---|---|---|
| SQLite opening/migration on the copied live DB | Server started; copied 145 MiB DB opened | Plugin stores no OpenCode schema assumptions | Pass on copy |
| `GET /api/info` | `version: "2.2.6"`, capabilities present | `probeServer()` requires `version` | Match |
| `GET /api/model` | 53 routes; same mapped route ids, context, output caps, and variants as the live 2.2.0 catalog | `modelsFromApiPayload()` reads `{data:[…]}` | Match |
| `GET /api/provider/opencode-go` | `integrationID: "opencode"`, OpenAI-compatible `settings.baseURL`, org header | `resolveBackend()` reads `settings.baseURL` and `headers` | Match |
| `GET /api/credential` | 3 entries, one active OAuth entry under `opencode` | Adapter prefers active OAuth, then key | Match |

Catalog comparison: **53 → 53 routes**, **0 added**, **0 removed**, and **0 changed** in the
fields the plugin maps.

## 5. CLI and parser compatibility

A real prompt was sent on stdin to `opencode run --format json --thinking --auto
--standalone -m opencode/beam-free` in an isolated HOME containing the copied live DB and
credentials.

| Version | Exit | Event types | Assembled text | `JsonRunParser` usage |
|---|---:|---|---|---|
| 2.2.0 | 0 | `step_start`, `reasoning`, `text` | `OK` | tokens remain 0 because no `step_finish` arrived |
| 2.2.5 | 0 | `step_start`, `reasoning`, `text`, `step_finish` | `OK` | input 29, output 7 in the representative run |
| 2.2.6 | 0 | `step_start`, `reasoning`, `text`, `step_finish` | `OK` | input 29, output 5 in the representative run |

The real 2.2.6 stdout was fed through the plugin's own parsers:

- `JsonRunParser`: text `OK`, reasoning captured separately, session id captured, no errors.
- `parseRunStream()` (subagent provider): text `OK`, no errors.
- `parseWorkerOutput('opencode', …)`: summary `OK`, usage `{inputTokens: 29, outputTokens: 5}`.

Argument contract:

- Every flag the plugin currently emits is accepted by 2.2.6: `run`, `-m`, `--format json`,
  `--thinking`, `--auto`, `--standalone`, and optional `--agent`.
- 2.2.6 adds `--archived` and `--worktree/-w`; the plugin does not emit either one, so their
  presence is not a break.
- A deliberately invalid `--agent` produced a structured JSON `error` event and exit 1, which
  the existing parser treats as a surfaced error rather than a successful silent run.

## 6. Real DSH mount with 2.2.6

An isolated `DSH_HOME` was copied from the live profile, with both plugin `opencodePath`
values replaced by the 2.2.6 measurement binary and live `$HOME/.dsh` paths rewritten into
the sandbox.

| Gate | Result |
|---|---|
| `dsh --profile web --dump-config` | exit 0; both `dsh-opencode-v2` rows composed with the 2.2.6 path |
| Real web boot on an ephemeral port | served `http://127.0.0.1:36519` |
| Activation warnings | 0 |
| Plugin load beacon | `{"version":"0.0.1-rc.1","event":"load"}` for the booted process |
| Browser probe | `ok:true`, shell rendered, `@nolit/dsh-opencode-v2` entry present, 80 entries, 0 page errors, 0 console errors |
| Plugin unit suite | **453/453 pass** (current source, independent of the live service) |

This is real-mount evidence; `--dump-config` alone was not treated as proof.

## 7. Data-plane result and limits

The adapter class was pointed at the isolated 2.2.6 control plane:

- `listModels()` returned 33 routes after the configured allow-list filter.
- `resolveModel('opencode-http-agent', 'opencode/beam-free')` returned the expected context,
  output reservation, and five reasoning variants.
- A real streaming generation attempt reached the OpenCode data plane but the backend
  returned **HTTP 429 `FreeUsageLimitError`**: “Free usage limit reached.” The adapter mapped it
  to `OPENCODE_BACKEND_HTTP`, as designed.

Therefore **successful end-to-end adapter generation against 2.2.6 is not claimed**. The
control plane, CLI/parser path, mount, and browser boot are measured; a successful
DSH-adapter SSE generation is not.

Other unmeasured items:

- `opencode session export <id>` against 2.2.6 was not completed because the isolated CLI
  attempted to use managed-service port `49374`, already owned by the live 2.2.0 service.
- Tool use, background shells/jobs, SIGTERM cancellation, `--archived`, and `--worktree` were
  not exercised.
- No upstream 2.2.6 test suite was run; this is a targeted compatibility measurement.

## 8. What changes between 2.2.0 and 2.2.6

The full delta, not just the run-lifecycle delta, is recorded in
[OPENCODE-220-TO-226-DELTA.md](OPENCODE-220-TO-226-DELTA.md): 835 commits, +3,078 files,
five DB migrations, background-job persistence, schedules, artifacts, MCP pooling, image
generation, and Claude Agent. This section keeps only the 2.2.5→2.2.6 step.

### 2.2.5 → 2.2.6

Read from the exact GitHub release objects and tag-to-tag source files, not from master.

Release-note deltas relevant to this plugin:

- Noninteractive `opencode run` was reworked for argument handling, cancellation, and
  shutdown; SIGTERM is documented to cancel the session and background jobs and exit 143.
- A run now waits for background shell/subagent/image jobs it started before exiting.
- `/api/*` cross-site navigation/request restrictions and sandboxed file/media responses
  were added.
- `run --archived` and `run --worktree/-w` were added.
- Other 2.2.6 changes concern MCP pooling, GUI plugin theming/slots, desktop UI, provider
  warming, and policy actions; none is on this plugin's current code path.

Implications:

- **Compatibility:** no measured break. The existing CLI event contract and control-plane
  endpoints remained usable.
- **Reliability:** 2.2.6 contains run-lifecycle fixes that are relevant to delegated and
  worker CLI runs, but a 2.2.5 failure was not reproduced in this session, so “fixes our
  observed bug” is not claimed.
- **Efficiency:** no measured throughput or token improvement. `--archived` could reduce
  session-list noise for scripted workers, but the plugin does not emit it yet. MCP pooling
  does not apply because the adapter uses the local server as a catalog/credential control
  plane and calls the model endpoint directly.
- **Operational risk:** `opencode run` may now stay alive while background jobs remain alive;
  the plugin's existing worker/subagent/CLI timeouts are the containment mechanism. Their
  interaction with this new wait behavior was not exercised.

## 9. Current verdict

| Claim | Verdict |
|---|---|
| Two or more OpenCode generations are present | **Confirmed** |
| Only 2.2 is used by the live DSH paths | **Confirmed for the live rows**, but the legacy 0.0.55 directory is still on `PATH` behind Bun |
| The host was upgraded to 2.2.5 | **False** — active install and service are 2.2.0 |
| npm `latest` is 2.2.6 | **Confirmed** |
| `@nolit/dsh-opencode-v2` mounts and parses against 2.2.6 | **Confirmed in isolation** |
| 2.2.6 is safe to make the only live install | **Not yet** — needs owner-approved install/restart, live-DB backup, and a real adapter generation after quota is available |

No live upgrade, removal, or service restart was performed.
