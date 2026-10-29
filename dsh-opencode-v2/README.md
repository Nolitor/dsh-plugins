# @nolit/dsh-opencode-v2

OpenCode inside DeepSeek Harness, aligned with the **OpenCode v2.2.0** CLI surface.

`dsh-opencode-v2` is a **managed wrapper**. It wraps
[`@quonaro/dsh-plugin-opencode@0.1.2`](https://www.npmjs.com/package/@quonaro/dsh-plugin-opencode)
as an ordinary npm **dependency** and **never modifies it** — no patching
`node_modules`, no forking files, no private hashed imports. Everything the v2
surface needs is re-implemented here on top of `ctx.subprocess`.

> Measurement of record: [`../OPENCODE-V2-SURFACE-MEASUREMENT.md`](../OPENCODE-V2-SURFACE-MEASUREMENT.md)

## 1. Measured OpenCode v2.2.0 facts this plugin is built on

| Fact (measured) | Consequence in this plugin |
|---|---|
| `opencode models` lists **45 models** — 30 `opencode-go/*`, 15 `opencode/*` | the default route is `opencode/…`; no route is ever assumed to resolve |
| `run --format json` emits no whole-run `step_finish`: a tool-free run emits only `step_start`, `reasoning`, `text`; a tool-using run emits a **per-step** `step_finish` | `run` never carries a whole-run usage total; char/4 heuristics are never emitted, and `session export` is the only authoritative source |
| `part.text` is a **cumulative snapshot** per part id, not a delta | the parser diffs snapshots into deltas |
| `--thinking` is required for `reasoning` events | streaming reasoning is opt-in via `thinking: true` (default on) |
| `reasoning` events exist with a `…_reasoning-N` part id | streamed as `reasoning-delta` on their **own block index** (text stays 0) |
| `--attach` and `--pure` were **removed** (exit 1, "Unrecognized flag", usage on stdout) | never emitted; stripped from `extraArgs`; old config keys accepted but inert |
| `--title` and `-f/--file` exist | exposed as tool params `title` / `files` |
| `opencode session export <sid>` → `info.tokens` is authoritative | token/cost accounting is fetched after the run |
| a stale `opencode serve --service` on port **49374** breaks every command | documented as a pre-probe check (see §4) |

### Token mapping (`info.tokens` → host `TokenUsage`)

The host contract (`@deepseek-ai/dsh-llm` `types.d.ts`, `TokenUsage`) is **disjoint**:
`inputTokens` is uncached input only, and cache hits are reported separately.

| host field | OpenCode source |
|---|---|
| `inputTokens` | `tokens.input` (already uncached-only) |
| `outputTokens` | `tokens.output` |
| `reasoningTokens` | `tokens.reasoning` |
| `cacheReadTokens` | `tokens.cache.read` |
| `cacheWriteTokens` | `tokens.cache.write` |
| `totalTokens` | `input + output + reasoning + read + write` |

If the export fails, usage is **omitted** (provider) or left at `0` (tool) rather
than invented.

## 2. What it provides

Both halves are plain hand-written ESM — there is **no build step**.

**`lib/index.js` → `@nolit/dsh-opencode-v2`** (row id `dsh-opencode-v2`)
- the **`opencode` tool** — delegates a task to `opencode run`, bounded capture,
  then over-fetches `session export` to fill real token counts;
- the **`/opencode` command** — registered when a `commands` service is composed.

Parameters: `prompt` (required), `cwd`, `model`, `agent`, `session`,
`continueLast`, `auto`, **`thinking`**, **`title`**, **`files`**, `timeoutMs`.

**`lib/provider.js` → `@nolit/dsh-opencode-v2/provider`** (row id `dsh-opencode-v2-provider`)
- the **`opencode-agent` LLM route** — flattens the transcript into one run and
  **true-streams** it: `text-delta` on block index `0`, `reasoning-delta` on
  block index `1`, `block-end` for each, then `usage`, then `finish`.

Errors never crash the host: a timeout finishes with
`{kind:'error', failure:{code:'OPENCODE_TIMEOUT'}}`, a non-zero exit with
`OPENCODE_EXIT` plus the stderr tail, and an unresolvable executable with
`OPENCODE_SPAWN`.

> `dsh-tools` declares tool output schemas with `additionalProperties: false`, so
> the `opencode` tool returns **exactly** the upstream key set
> (`ok`, `exitCode`, `signal`, `timedOut`, `truncated`, `sessionId`,
> `inputTokens`, `outputTokens`, `stdout`, `stderr`). Extra detail such as the
> `usage:` line is rendered as text only.

## 3. Bundle layer

`cordis.patch.yml` is **this package's own** patch file — not upstream's. It
inserts two rows whose `id`s equal the exported plugin names (the loader derives
the settings namespace from the id):

| row id | name |
|---|---|
| `dsh-opencode-v2` | `@nolit/dsh-opencode-v2` |
| `dsh-opencode-v2-provider` | `@nolit/dsh-opencode-v2/provider` |

There are deliberately **no `attach` / `pure` keys**.

## 4. Verify without touching `~/.dsh`

```bash
cd dsh-opencode-v2
npm test            # node --test: fake subprocess seam, no network, no ~/.dsh
npm run check       # node --check on every lib file
```

The suite fakes `ctx.subprocess`, so it never spawns `opencode`, opens a socket,
or reads `~/.dsh`. `test/bundle.test.mjs` also parses `cordis.patch.yml` with
`js-yaml` and proves every row id/name/config key agrees with `package.json` and
the module Config schemas.

**Isolated profile boot** (boot-card rule 3 — no live state touched):

```bash
export DSH_HOME=/tmp/dshhome-ocv2
mkdir -p "$DSH_HOME/profiles"
cp -a ~/.dsh/profiles/web "$DSH_HOME/profiles/web"
# register the bundle instead of hand-editing the live profile
dsh --profile web --dump-config > /tmp/ocv2-dump.yml   # no duplicate-id / unknown-plugin errors
```

**Live token probe** (needs real credentials, so it uses the real `HOME`):

```bash
# A stale service from another HOME squats port 49374 and breaks every command:
pgrep -af 'opencode serve --service'      # expect nothing, or kill it
opencode run --format json --thinking -m opencode/deepseek-v4.1-flash-free -- 'say hi'
opencode session export <ses_…>           # -> info.tokens.{input,output,reasoning,cache}
```

## 5. Install

Installing into the live profile requires a shell with a writable `~/.dsh` and a
real `dsh plugin add` — it is **not** done by this package, and it is not done
from a sandbox:

```bash
dsh plugin --profile web add /home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-opencode-v2
dsh web   # restart the service
```

> **Both `@quonaro/dsh-plugin-opencode` rows must be disabled or removed first.**
> Leaving them mounted makes the profile fail to boot with
> `tool "opencode" is already registered` — this plugin also registers a tool named
> `opencode`, and two live rows cannot share it.

`engines.dsh` is pinned to `>=0.2.2-alpha.2 <0.3.0` (boot-card rule 4).

## 6. Files

```
dsh-opencode-v2/
├── package.json          # exports ., ./provider, ./cordis.patch.yml, ./package.json
├── cordis.patch.yml      # our bundle layer (two insert rows)
├── README.md
├── lib/
│   ├── index.js          # `opencode` tool + /opencode command
│   ├── provider.js       # `opencode-agent` LLM route (true streaming)
│   └── shared.js         # argv, ndjson parser, usage mapping/fetch
└── test/
    ├── shared.test.mjs   # argv / parser / usage
    ├── providers.test.mjs# tool + provider halves
    ├── bundle.test.mjs   # package.json <-> cordis.patch.yml contract
    └── helpers/dsh-tools-stub.mjs
```
