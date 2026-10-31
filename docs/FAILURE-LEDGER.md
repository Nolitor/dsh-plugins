# Failure Ledger — Mistakes Made Here, and the Rule That Prevents a Repeat

<!-- skeleton:
version: 1.2
kind: rule
status: active
updated: 2026-11-01
summary: Every defect and wrong turn this workspace actually made, with the standing rule that keeps it from happening again. Read before changing a plugin, a doc, or a live service.
-->

> Status: active · Applies to: this workspace · Companion: [RULES.md](./RULES.md), [DSH-HARNESS-POLICY.md](./DSH-HARNESS-POLICY.md)

This file exists because the same classes of mistake kept costing a session. Each entry is something
that **actually happened here**, not a hypothetical. The rule column is the standing instruction; if a
change cannot satisfy it, say so before acting, not after.

## 1. Code and activation

| # | What happened | Rule now |
|---|---|---|
| F-1 | `0.6.0`'s `lib/client.js` declared `const inject = ['slots']`, used `ctx.slots` in `apply()`, and exported only `apply`. The entry landed in `failed`, the **whole web shell** stopped mounting, and DSH logged nothing. | **Export the service list.** The loader injects only `module.exports.inject`. Every plugin keeps a contract test that evaluates the served module and asserts every `ctx.<service>` it uses is in the exported `inject`. |
| F-2 | The same failure was called "verified" because a clone boot plus 200s on every route passed. | **A browser boot is the only mount proof for a browser half.** `--dump-config`, a 200 on the bundle and `node --check` all pass with an unloadable client module. |
| F-3 | A client-half failure was invisible because the shell prints bare `failed`. | **Silence is not evidence.** When a verdict carries no detail, read the boot checker (`BZ()` in `assets/index-*.js`) and judge the module statically instead of re-running the boot. |
| F-4 | Same-file patches: a fuzzy multi-line edit merged two table rows into one (runtime-spec §3.4, then the policy changelog). The table rendered wrong and the pipe check was what caught it. | **After any table edit, count pipes per row** (escaped `\|` excluded). Insert rows with a single-line anchor, never by replacing a block that ends in a table row. |
| F-5 | A plan section was inserted at the wrong number because §5.2.6 already existed; the reference written into the policy pointed at the wrong section. | **Check the target section number before writing a cross-reference**, then grep the reference back. |

## 2. Measurement

| # | What happened | Rule now |
|---|---|---|
| F-6 | The revoked `opencode-go` credential was declared **alive** after a `generate/text` returned 200. That request went through the local OpenCode server, which authenticates with the `opencode` OAuth — the key itself was never exercised. Calling the backend with the key returned 401. | **Probe the artifact, not the account path.** A dead credential and a working account produce the same 200 through the server. Send the credential itself (or read its status) before judging it. |
| F-7 | `GET {baseURL}/models` and `opencode models` were briefly treated as an entitlement oracle; both list unusable routes. | **A catalog is not an entitlement.** `opencode models` returns the static 49 including the 12 the backend refuses. |
| F-8 | The entitlement design sent **one real completion per route** (49/press) on an account whose quota counts requests. Found only when the owner asked about the daily limit. | **Ask what the quota counts before designing a probe.** Prefer zero-request signals (provider id, plan) and free evidence from real traffic. |
| F-9 | A curl probe returned `403 error code: 1010` (Cloudflare) and was nearly read as a credential verdict. | **An edge/WAF status is not an application verdict.** Re-probe with the client the product actually uses before concluding anything. |
| F-10 | `cp -a` of a profile broke every plugin link (`node_modules/@scope/*` are **relative** symlinks); the isolated boot then reported "cannot resolve" for all bundles. | **Rebuild links as absolute paths** in any profile copy, and label a run invalid-and-discarded when the copy itself is broken. |
| F-17 | A dropped upstream SSE body (`TypeError: terminated`) was reported as `{kind:'error', code:'OPENCODE_BACKEND'}`, so a step that had already produced usable work was discarded — 3 of the last 6 sessions ended that way, and the owner read it as "the turn keeps dying". | **A transport cut is not a request verdict.** Classify the error (`isTransientStreamError`): retry only while nothing has been emitted, otherwise preserve the partial output and close it with a legal `finish` reason. Never invent a finish kind — read the harness's `FinishReasonMap` first. |
| F-18 | 0.7.3-0.7.5 held a tag split *inside an opener* but released a `[tool call …` marker that arrived without its closing `]`, so the notation and its JSON payload were emitted as assistant text and printed on screen. `sanitizeProtocolText` could not catch it because it is per-fragment and its `CALL_MARKER` also requires the closing `]` — the net only ever caught strings that were already intact. The split test in `inline-tags.test.mjs` split **after** `]`, so 229/229 stayed green while the screen was dirty. | **A partial marker is held, never released.** Any prefix that can still become a marker must be buffered (bounded by `maxHold`) until the shape is decided; only then convert it or strip its syntax. A sanitiser that runs per fragment cannot be the last line of defence for a stream — test the exact delta boundaries recorded from the live stream, not a single-delta blob. |

## 3. Live state

| # | What happened | Rule now |
|---|---|---|
| F-11 | A boot-rewritten `profiles/<name>/cordis.yml` was initially blamed on a probe. DSH rewrites that file to a constant on every boot. | **Name the writer before accusing a probe.** Compare content hashes; mtime-only churn on a file DSH owns is expected. |
| F-12 | Raw `GET /api/credential` output was printed once, including `oc_sk_…` key values. | **Credentials: names, ids and lengths only.** Mask every value in tool output, evidence files and docs. |
| F-13 | A credential was almost deleted based on a stale boot-card claim; the deletion then happened only after re-measuring the key itself. | **A deletion is a decision, not a cleanup.** Re-measure the artifact, protect the account-critical entries (`opencode` OAuth / master keys), delete only the named dead one, and verify serving afterwards. |
| F-14 | Settings were written to the live profile while verifying a UI feature (plan toggle). The write was valid but unannounced at the time. | **Announce every live write with its blast radius** in the same reply, or probe in an isolated profile. |

## 4. Reporting

| # | What happened | Rule now |
|---|---|---|
| F-15 | A wrong conclusion (F-6) was already committed to a boot card before it was retracted. | **Correct in the same artifact** with a table of what each measurement path proves; never leave a stale conclusion standing because it is "just a card". |
| F-16 | Numbers were quoted without their unit/derivation ("49 requests" needed the qualifier *per press*, at concurrency 6, one per route). | **A derived number carries its unit and shape**, or it is not reviewable. |

## 5. Using this file

- Before changing a plugin: read §1. Before measuring: §2. Before touching `~/.dsh`: §3.
- When a new mistake is made, add it here **with the rule**, not with a narrative. The rule is the
  artifact; the incident is only the reason for it.
