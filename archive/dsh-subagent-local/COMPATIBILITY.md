# Compatibility — local delegation vs. the rc.1 delegation surfaces and `subagent_oar`

<!-- skeleton:
version: 1.0
kind: report
status: measured
updated: 2026-11-05
summary: Measured compatibility of @nolit/dsh-subagent-local with the rc.1 official delegation packages and @tianyicui's subagent_oar, with exact package/version evidence and an explicit UNVERIFIED label where a combined mount could not be exercised.
-->

> Status: active · Measured 2026-11-05 (KST) on the installed rc.1 runtime · Scope: registration
> names, provider/tool contracts, version/peer compatibility, and the `subagent_oar` verdict.
> Every claim below is marked **measured** (command/artifact named) or **UNVERIFIED** (not
> exercised here). Release notes are external data; contracts were re-read from the published
> tarballs and the installed tree.

## 1. Measured environment

| Item | Measured value | Source |
| :--- | :--- | :--- |
| `dsh --version` | `0.2.2-rc.1` | command |
| Node | `v24.22.1` (rc.1 minimum is `>=24.9`) | `node --version` |
| Cordis | `4.1.0` | installed `@deepseek-ai/cordis/package.json` |
| Installed delegation packages | `@deepseek-ai/dsh-subagent@0.2.2-rc.1`, `dsh-tool-subagent@0.2.2-rc.1`, `dsh-subagent-spawn-in-process@0.2.2-rc.1`, `dsh-subagent-fork-in-process@0.2.2-rc.1` | `ls .../dsh/node_modules/@deepseek-ai` |
| **Not installed** in the rc.1 tree | `dsh-subagent-codex`, `dsh-subagent-claude-code`, `dsh-experimental-tool-subagent-oar`, `dsh-experimental-subagent-oar` — all four paths measured absent | `ls -d` on each path |
| Live `web` profile mounts | subagent providers `antigravity` (`@nolit/dsh-antigravity`) and `opencode` (merged by `@nolit/dsh-opencode-v2`); tool names measured from an isolated composition: `subagent`, `subagent_fork`, `subagent_opencode`, `subagent_antigravity` | isolated `--dump-config` |
| Local CLIs | `agy` 1.5.0 at `/home/minami/.local/bin/agy`; `opencode`, `codex`, `claude`, `oar` — **missing** from PATH | `command -v` |

**Correction to `docs/DSH-RC1-PLUGIN-DELTA.md` §2.1.** That document says the base tree "ships
`@deepseek-ai/dsh-subagent-codex` and `@deepseek-ai/dsh-subagent-claude-code` providers"; measured
2026-11-05, **they are not installed** in the rc.1 installation (only the four packages listed
above are). They are published on npm, but they are not part of the installed base. Treat this row
as a measured correction, not a disagreement about intent.

## 2. What `subagent_oar` actually is (evidence)

The rc.1 release note line — "Add the experimental `subagent_oar` tool plugin to delegate
independent tasks to local Codex or Claude CLIs. by @tianyicui" — resolves to **two npm packages**,
not one:

| Package | Role | Published dist-tags (measured via `npm view` 2026-11-05) |
| :--- | :--- | :--- |
| `@deepseek-ai/dsh-experimental-tool-subagent-oar` | the `subagent_oar` **tool** | `latest=0.2.2-alpha.2`, `alpha=0.2.2-alpha.3`, `next=0.2.2-rc.1` |
| `@deepseek-ai/dsh-experimental-subagent-oar` | the **provider** (`ctx.subagents`) that runs OAR runtimes | same three tags |

Exact artifacts inspected (downloaded with `npm pack`, extracted; repository paths are from each
tarball's `package.json`):

| Artifact | Version | `sha256` of the `.tgz` |
| :--- | :--- | :--- |
| `@deepseek-ai/dsh-experimental-tool-subagent-oar` | `0.2.2-rc.1` (`next`) | `2eebbc92e9f0a71167123b7135e18e1a6e7b2a784b96e0ef9390171da5144112` |
| `@deepseek-ai/dsh-experimental-subagent-oar` | `0.2.2-rc.1` (`next`) | `61ed012c8a529465fc1cbdef98173143a96c0fabf814ab6f672ccc0da65644fd` |
| `@deepseek-ai/dsh-experimental-tool-subagent-oar` | `0.2.2-alpha.2` (`latest`) | `b6c606737521ef1b6586bcebc7b8ea80d482681191d7034bcc2e08db783b0b73` |
| `@deepseek-ai/dsh-experimental-subagent-oar` | `0.2.2-alpha.2` (`latest`) | `d81d24e2e8d891aec5b285bbbfc9c1b6fee1a0e473036df551bdc8d0767f1fb4` |

Measured contracts (read from the rc.1 `lib/index.js` and `README.md` of those tarballs):

- Tool package: `export const name = "experimental-tool-subagent-oar"`; `inject = ['tools',
  'subagents']`; registers **one tool**, default name **`subagent_oar`** (`toolName` configurable);
  required config `providers` = map of model-visible runtime alias → registered provider name;
  parameters `runtime` (enum of aliases), `description`, `prompt`, optional `cwd`; the call starts a
  `ctx.subagents.startActivation` and returns `{ kind: "activation", subagentId }` — **the answer
  arrives later as a completion notice**, not in the tool result.
- Provider package: registers **one provider per row**, default `providerName: "oar"` (configurable),
  required `runtime` id from OAR's default registry. Measured ids in the rc.1 bundle/README:
  `antigravity`, `claude`, `codex`, `grok`, `kimi`, `opencode`, `pi`. Only `codex` and `claude` have
  native end-to-end coverage per its own README; the rest are "unverified". The provider embeds the
  OAR library, so **no separate OAR CLI install is required**, but the native Codex/Claude CLI must
  be installed and authenticated.
- Neither OAR package declares `dsh.bundle.patch` (measured: the `dsh` field is absent; the provider
  only declares `icon`), so `dsh plugin add` will not auto-select them as bundles. They are plain
  dependencies plus manually authored profile rows, exactly as their READMEs instruct.

### 2.1 Version/peer compatibility of OAR with the rc.1 runtime

| OAR version | Cordis peer | DSH peers | Verdict against installed rc.1 |
| :--- | :--- | :--- | :--- |
| `0.2.2-alpha.2` (npm `latest`) | `~4.0.6-alpha.1` | `@deepseek-ai/dsh-subagent` / `dsh-tools` = `0.2.2-alpha.2` | **peer-incompatible**: installed Cordis is 4.1.0, DSH packages are 0.2.2-rc.1. Only usable with a peer override. |
| `0.2.2-rc.1` (npm `next`) | `~4.1.0` | `@deepseek-ai/dsh-subagent` / `dsh-tools` / `dsh-llm` / `dsh-session` / `dsh-subprocess` = `0.2.2-rc.1` | **peer-compatible** on paper with the installed runtime (all peers match exactly). |

Consequence: anyone testing `subagent_oar` on this rc.1 runtime must install
`@deepseek-ai/dsh-experimental-{tool-,}subagent-oar@0.2.2-rc.1`, not the `latest` tag.

## 3. Delegation surface matrix (measured names)

| Surface | Kind | Registers on `ctx.tools` | Registers on `ctx.subagents` | Registers a command | Evidence |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `@deepseek-ai/dsh-subagent-codex@0.2.2-rc.1` | bundle (patch) | `subagent_codex` (via `dsh-tool-subagent`) | `codex` | — | rc.1 tarball patch: provider row + tool row |
| `@deepseek-ai/dsh-subagent-claude-code@0.2.2-rc.1` | bundle (patch) | `subagent_claude_code` (via `dsh-tool-subagent`) | `claude-code` | — | rc.1 tarball patch |
| `@deepseek-ai/dsh-experimental-tool-subagent-oar@0.2.2-rc.1` | plain package (no bundle) | `subagent_oar` (default, configurable) | — (reads the registry) | — | rc.1 `lib/index.js` |
| `@deepseek-ai/dsh-experimental-subagent-oar@0.2.2-rc.1` | plain package (no bundle) | — | `oar` (default, configurable per row) | — | rc.1 `lib/index.js` + README |
| `@nolit/dsh-antigravity` (workspace track) | bundle | `agy_worker` + `subagent_antigravity` row | `antigravity` | `/agy` | workspace patch + isolated composition |
| `@nolit/dsh-opencode-v2` (workspace track) | bundle | `opencode` tool + `subagent_opencode` row | `opencode` | `/opencode`, `/ocode` | workspace patch + isolated composition |
| `@nolit/dsh-subagent-antigravity` / `-opencode` (superseded tracks) | bundle | `subagent_antigravity` / `subagent_opencode` | `antigravity` / `opencode` | — | workspace sources |
| **`@nolit/dsh-subagent-local` (this package)** | bundle | **`delegate_local`** | **none** | **none** | this package |

## 4. Collision risk for this package

The hard rule (`docs/RULES.md` §4): two plugins registering the same tool or provider route is a
hard mount failure. This package claims **one tool name** and nothing else.

| Name space | Claimed by this package | Collision with the matrix above |
| :--- | :--- | :--- |
| Tool `delegate_local` | yes (default) | **none** — no measured surface uses this name |
| Tools `subagent`, `subagent_oar`, `subagent_codex`, `subagent_claude_code`, `subagent_antigravity`, `subagent_opencode` | **never** (reserved; registration yields) | deliberately avoided |
| Providers (`ctx.subagents`) | **none** | **none** — the provider namespace is left entirely to the official/OAR packages |
| Commands | **none** | **none** — `/agy`, `/opencode`, `/ocode` stay owned by existing tracks |
| HTTP routes / client half | none | **none** |

Defense in depth, all tested in `test/plugin.test.mjs`:

1. Before registering, the plugin reads `ctx.tools.get(toolName)`; if a definition already exists it
   logs a warning and **mounts without registering** (a yield, not an activation failure).
2. The six delegation tool names above are reserved and always yield even when nothing is mounted
   yet, so a future install cannot be silently blocked by a name grab.
3. `toolName` is configurable if a profile needs a different unique name.
4. `yieldToProviders` maps a backend to an already-mounted provider (e.g. `{ codex: oar-codex }`);
   the tool then reports that provider instead of spawning a second CLI for the same backend.

## 5. Verdict on `subagent_oar` compatibility

| Question | Verdict | Basis |
| :--- | :--- | :--- |
| Can both be **installed in one profile** without a registration collision? | **COMPATIBLE (measured at the name/contract level)** | `subagent_oar` tool name ≠ `delegate_local`; OAR registers providers (`oar`, `oar-codex`, …, operator-named) and this package registers no provider. |
| Is the OAR artifact compatible with the installed rc.1 runtime? | **YES for `0.2.2-rc.1` (`next`); NO for `latest` `0.2.2-alpha.2`** | Peer ranges measured in §2.1. |
| Has a **combined mount** of OAR + this package been exercised end-to-end? | **UNVERIFIED** | OAR packages are not installed in the rc.1 base tree; this host has **no** `codex`/`claude` binaries, and installing OAR requires its dependency closure plus native CLIs. No combined boot was run. |
| Do the two features overlap functionally? | **Yes, for Codex/Claude** | OAR delegates Codex/Claude through async activations with native CLI auth; this package runs the raw CLI synchronously and returns text + exit/usage/artifacts. OAR is the integrated choice; this package is the fallback/diagnostic choice and also covers `agy`/`opencode`. |
| Recommended coexistence policy | **Prefer OAR for Codex/Claude when it is mounted** | Set `yieldToProviders: { codex: <oar-codex provider>, claude: <oar-claude provider> }` so `delegate_local` reports the mounted provider instead of duplicating the native process. |

**Explicit UNVERIFIED labels:** combined OAR + `dsh-subagent-local` mount, combined behaviour with
native Codex/Claude CLIs, and the exact runtime ids of non-Codex/Claude OAR runtimes beyond the
README list. None of these are claimed as tested here.

## 6. Backend adapter verification status

| Backend | Prompt transport | Locally executed? | Evidence |
| :--- | :--- | :--- | :--- |
| `antigravity` (`agy`) | argv beside `-p` (measured; stdin ignored) | **yes** — `agy` 1.5.0 resolves on PATH; argv/effort rules unit-tested; the workspace's `dsh-antigravity-cli`/`dsh-antigravity` tracks measured the same surface | `command -v agy`; `dsh-antigravity-cli/lib/backends.js`; this package's `test/backends.test.mjs` |
| `opencode` | stdin | **UNVERIFIED-LOCALLY** — binary absent; argv/parser mirror the workspace's verified OpenCode provider (`opencode run --format json`, NDJSON `part.text` snapshots) | `dsh-subagent-opencode/lib/index.js`; `docs/cli-worker-standard.md` |
| `codex` | stdin (trailing `-`) | **UNVERIFIED-LOCALLY** — binary absent; argv follows the published `codex exec` surface (`--json`, `--model`, `--sandbox`, `-c model_reasoning_effort=`) | published CLI contract; no local execution |
| `claude` | stdin | **UNVERIFIED-LOCALLY** — binary absent; argv follows the published `claude -p --output-format json` surface | published CLI contract; no local execution |

The tool description and the canonical result do not distinguish verified from unverified backends;
the operator does. `delegate_local` fails with a measured resolution error listing every candidate,
its path and its failure reason, so a missing CLI is never silently substituted.

## 7. Follow-ups

1. If OAR is installed: install the `0.2.2-rc.1` artifacts (dist-tag `next`), add the provider/tool
   rows manually, and re-run a combined isolated boot — that would upgrade the §5 verdict from
   "compatible by contract" to "compatible by mount".
2. Verify the `opencode`/`codex`/`claude` adapters on a host where those CLIs exist; only the `agy`
   path has a local binary.
3. Keep this package out of the live profile until the owner approves: the tracked verification is
   an isolated `DSH_HOME` boot.
