<!-- skeleton:
version: 1.0
kind: measurement
status: active
updated: 2026-11-04
summary: Per-upstream-version comparison record for @nolit/dsh-opencode-v2 — the surfaces this plugin actually touches, the exact source artifact each column was read from (release tag, not master), and the verdict per surface. Applied to 0.2.2-alpha.3. Future versions append a row; "no problem" without this table is not a verification.
-->

# Upstream compatibility record — @nolit/dsh-opencode-v2

> Rule this file implements: [docs/RULES.md §6.2](../../docs/RULES.md) — acquire the **exact tag**,
> diff it, never read master, never read rendered HTML. Owner instruction 2026-11-04.

## Why this file exists

Twice in one session the plugin's compatibility with an upstream release was reported without a
record of what was compared. The second time, an upgrade guide under
`docs/upgrade-guide/v0.2.2-alpha.3/` was cited on master that **does not exist at the
`dsh-v0.2.2-alpha.3` tag** — so the guide described a future release while the installed build did
not have the change. That is exactly the failure this table prevents.

A verdict row here is only valid with the source artifact named. If the artifact is not named, the
verdict is a guess and must not be written.

## Surfaces this plugin depends on

Measured by grepping the plugin, not by memory:

| Surface | Used by | Where it is defined upstream |
|---|---|---|
| `LlmAdapter` (`stream`, `resolveModel`, `providerInfo`, `providerRetryPolicy`, `imageRequestPricing`) | `lib/http.js`, `lib/provider.js` | `@deepseek-ai/dsh-llm` types |
| `StreamChunk`, `FinishReasonMap` (`stop`, `tool-calls`, `max-tokens`, `aborted`, `error`) | `lib/http.js` | `@deepseek-ai/dsh-llm` types |
| `TokenUsage` (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens`, `totalTokens`) | `lib/http.js` `usageFromOpenAi` | `@deepseek-ai/dsh-llm` types |
| `GenerateOptions` (`tools`, `stop`, `maxTokens`, `system`, `messages`, `signal`, `purpose`) | `lib/http.js`, `lib/request-guards.js` | `@deepseek-ai/dsh-llm` types |
| `defineTool` / tool schema | `lib/index.js` | `@deepseek-ai/dsh-tools` |
| `Schema` (schemastery) | every `Config` | `@deepseek-ai/schemastery` |
| `ctx.slots` + `conversation.input.activity` (`InputActivityOwnerProps`) | `lib/client.js` | `@deepseek-ai/dsh-client-ui-conversation` |
| `ctx.slots` + `settings.section` (`SettingsSectionOwnerProps`) | `lib/client.js` | `@deepseek-ai/dsh-client-ui-settings` |
| `ctx.effect`, `ctx.locale` | `lib/client.js` | cordis / `dsh-client-locale` |
| `ProcessActivity` | **not used** (verified: 0 references) | `@deepseek-ai/dsh-client-ui-chat` |

## Comparison table

Each row names the artifact it was read from. `tag` = extracted from
`codeload.github.com/deepseek-ai/deepseek-harness/tar.gz/refs/tags/<tag>`;
`installed` = the running `~/.local/nodejs/.../@deepseek-ai/dsh` tree.

### 0.2.2-alpha.3 — compared 2026-11-04

| Surface | Source artifact | Value at that artifact | This plugin expects | Verdict |
|---|---|---|---|---|
| `FinishReasonMap` | installed `dsh-llm/lib/types/types.d.ts` | `stop, tool-calls, max-tokens, aborted, error` | exactly these five | **match** — `finishFromOpenAi` emits only these |
| `TokenUsage` | installed `dsh-llm` types | disjoint counts; `reasoningTokens?`, `totalTokens?` optional | disjoint, optional reasoning | **match** — `usageFromOpenAi` produces only these keys |
| `GenerateOptions.purpose` | installed `types.d.ts:579` | `purpose?: Purpose` present | must not be sent to the wire | **match** — the adapter never reads or forwards it |
| `GenerateOptions` field set | installed `types.d.ts` | 14 fields incl. `toolHistory`, `purpose` | reads `tools/stop/maxTokens/system/messages/signal` | **match** — unknown fields are ignored |
| `InputActivityOwnerProps` | tag `dsh-v0.2.2-alpha.3` `packages/client/ui-conversation/src/client/contract/slots.ts` | `onActiveChange: (active: boolean) => void` | occupant reports expansion | **was NOT matched** → fixed in `0.0.2-rc.1` (slot-contract tests) |
| `SettingsSectionOwnerProps` | installed `dsh-client-ui-settings` types | `close: () => void` | section does not navigate | **match** — unused, deliberately |
| `ProcessActivity` | tag `…/ui-chat/src/client/contract/process-groups.ts` | 13 members, **no `context`** | not used | **not applicable** |
| `docs/upgrade-guide/v0.2.2-alpha.3/` | tag tree | **directory absent at the tag** | — | see note |
| `docs/upgrade-guide/v0.2.2-alpha.3/` | master (`0.2.2-rc.1`) | `chat-process-activity-context`, `subagent-names` | — | **future release, not installed** |

**Note on the guide:** on 2026-11-04 the owner asked whether the plugin was built for
`docs/upgrade-guide/v0.2.2-alpha.3/chat-process-activity-context`. Reading the guide from master
suggests a required migration. Extracting the `dsh-v0.2.2-alpha.3` tag shows the guide **does not
exist there** and the tag's `ProcessActivity` union has no `context` member. The change ships in
`0.2.2-rc.1`. **Verdict: no action for the installed host**; the check did uncover the
`InputActivityOwnerProps` gap above, which was a real defect in this plugin.

## How to add a row for a new version

1. `curl -sL https://codeload.github.com/deepseek-ai/deepseek-harness/tar.gz/refs/tags/<tag> -o h.tgz && tar -xzf h.tgz`
2. For every surface in the table above, read the **tag** file and record its line/files.
3. Compare against what this plugin asserts in `test/`. A surface with no test is a surface with no
   verdict — write the test first.
4. Append the row set under a new `### <version> — compared <date>` heading. Do not edit old rows;
   they are the record of what was true then.
5. If a verdict is "was NOT matched", the same commit must contain the fix and its regression test,
   and the plugin `CHANGELOG.md` must get the entry.
