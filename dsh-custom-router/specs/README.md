# `specs/` — Living provider & protocol registry

<!-- skeleton:
version: 1.0
kind: spec
status: active
updated: 2026-11-13
summary: Machine-readable protocols, providers and pricing for the Custom Router, plus the freshness rules and generated compatibility matrix that keep the preset layer honest.
-->

This directory is the **slow/fast split** of the router's update loop:

- `protocols/` — the stable, versioned mapping between a wire family and the
  canonical DSH stream contract. These change rarely, and a change is a
  `revision` bump, not a new document.
- `providers/` — volatile vendor facts: endpoint, model ids, capabilities,
  documentation URL, last verification. These change with every vendor release.
- `pricing/` — the most volatile layer: plan/flat/free/pay-per-token facts and
  their source. **No rates live in source code**; the vendor adapters read a
  live catalog or this file.
- `docs/COMPATIBILITY-MATRIX.md` — generated from these files. Never edited by
  hand.

## File names

| Directory | File | One per |
|---|---|---|
| `protocols/` | `<wire>.json` | wire protocol (`openai-completions`, `openai-responses`, `anthropic-messages`, `google-generative-sse`, `google-generative-ai`) |
| `providers/` | `<preset-id>.json` | router preset (`antigravity`, `opencode`, `deepinfra`, `exaone`) |
| `pricing/` | `<preset-id>.json` | preset pricing/plan source |

## `protocols/<wire>.json`

```json
{
  "id": "openai-completions",
  "revision": 1,
  "verifiedAt": "2026-11-13",
  "ttlDays": 90,
  "docs": "https://platform.openai.com/docs/api-reference/chat",
  "streaming": "sse",
  "canonical": {
    "text": "choices[].delta.content",
    "reasoning": "choices[].delta.reasoning_content",
    "toolCalls": "choices[].delta.tool_calls[] (fragmented by index)",
    "usage": "usage on the final chunk (stream_options.include_usage)",
    "finish": "choices[].finish_reason"
  },
  "capabilities": {
    "tools": true,
    "reasoning": true,
    "usage": true,
    "cache": true,
    "structuredOutput": true,
    "vision": true
  },
  "adapters": ["vendor/deepinfra/lib/adapter.js", "vendor/exaone/lib/adapter.js", "vendor/opencode/lib/http.js"],
  "notes": "Canonical mapping notes, quirks, and what is NOT normalized."
}
```

Rules:
- `id` must be one of `WIRE_PROTOCOLS` (`lib/preset-schema.js`).
- `adapters` lists the files that implement this wire **today**; `[]` means
  declared but not served by a router adapter.
- `capabilities` are protocol-level defaults; a provider overrides them.
- `canonical` names the fields the shared `lib/stream` pipe consumes. A change
  here requires a `revision` bump and a conformance fixture update.

## `providers/<preset>.json`

```json
{
  "id": "exaone",
  "preset": "exaone",
  "status": "active",
  "protocol": "openai-completions",
  "docs": "https://docs.exaone.ai/en/docs/k-exaone-2.5",
  "verifiedAt": "2026-11-13",
  "ttlDays": 90,
  "endpoint": "https://api.exaone.ai/v1",
  "models": ["k-exaone_v2.5"],
  "capabilities": {
    "tools": true,
    "reasoning": ["low", "high", "max"],
    "usage": true,
    "cache": false,
    "structuredOutput": true,
    "vision": false
  },
  "pricing": "exaone",
  "notes": "Owner: currently free after application (may change); Korean/humanities-oriented."
}
```

Rules:
- `preset` must exist in `lib/presets.js`.
- `protocol` must exist in `protocols/`.
- `pricing` must name a file in `pricing/`.
- `capabilities.reasoning` is `false` or a non-empty array of effort ids.
- `status` is `active`, `preview`, `deprecated` or `disabled`.
- `ttlDays` defaults to **90** for provider facts.

## `pricing/<preset>.json`

```json
{
  "provider": "exaone",
  "kind": "free",
  "source": "owner",
  "verifiedAt": "2026-11-13",
  "ttlDays": 30,
  "notes": "Currently free after application; may change."
}
```

`kind` is one of:
- `subscription` — a plan covers usage (Antigravity windows).
- `flat` — a fixed plan / allowance (OpenCode Go/Zen).
- `free` — currently free after application (EXAONE).
- `pay-per-token` — catalog rates bill tokens (DeepInfra).
- `live-catalog` — the price comes from a provider catalog at request time;
  `source` names the endpoint, and `ttlDays` is the maximum age of the last
  verification (promotions/discounts change without warning).
- `none` — no billing relationship.

`ttlDays` defaults to **30** for pricing.

## Freshness rules

- `npm run specs:check` validates every file, cross-references, and freshness.
- `npm run verify:freshness` runs the freshness half (for CI/ops).
- A file is **stale** when `today - verifiedAt > ttlDays`. Stale pricing is a
  failure; stale provider facts are a failure; stale protocols are a failure
  only when an adapter serves them.
- `--warn` downgrades failures to warnings (report-only), `--now YYYY-MM-DD`
  fixes the clock (tests), `--json` prints machine-readable results.
- On a real upstream change: update the file, bump `revision` for protocols,
  refresh `verifiedAt`, regenerate the matrix, and record the delta in
  `CHANGELOG.md` (and the provider's `SPEC-LEDGER` note when one exists).
- **The manual watch baseline has its own age check.** `specs/upstream.lock.json`
  is compared against `--watch-max-age` (**14 days** by default) on every
  `specs:check` run. A stale or missing baseline is a **warning** by default and,
  with `--strict-watch` (`npm run verify:freshness:strict`), an **error**. The
  documented manual cadence is at least **weekly** — DeepInfra pricing is on a
  7-day `ttlDays`, so a missed weekly cycle is caught before the pricing gate
  goes hard-stale. No scheduler is registered for this; the age check only makes
  a missed cycle visible.

**Manual cadence (runbook).** Once a week, and before any release that touches a
provider or pricing file:

1. `npm run spec:watch` — fetch, hash and diff the registered upstreams; read the
   `NEW` / `CHANGED` rows and their capped diffs;
2. if a change is real, update the matching `protocols/` or `providers/` file,
   refresh `verifiedAt`, and regenerate the matrix;
3. if the bodies are the intended baseline, `npm run spec:watch -- --update`,
   then `npm run verify`.
   Who: the operator (owner) runs it — the repository must not schedule it.

## Commands

```bash
npm run specs:build             # regenerate docs/COMPATIBILITY-MATRIX.md
npm run specs:check             # validate + freshness + watch-baseline age + matrix-current
npm run verify:freshness        # freshness + watch-baseline age (report-only on staleness)
npm run verify:freshness:strict # the same, with a stale/missing watch baseline as an error

node scripts/verify-specs.mjs --watch-max-age 21  # override the 14-day baseline age limit
node scripts/verify-specs.mjs --strict-watch      # same as verify:freshness:strict

npm run spec:watch              # manual: fetch + hash + diff report
npm run spec:watch -- --update  # accept the current bodies as the baseline
```

## Manual upstream watch

`specs/watch.json` registers the official documentation, changelog and pricing
URLs to watch (the OpenAI platform blocks non-browser clients, so its entry
uses the official OpenAPI mirror). `npm run spec:watch`:

1. fetches each URL, sending `If-None-Match` / `If-Modified-Since` when the lock
   has an ETag or Last-Modified;
2. normalizes the body (HTML → text, CRLF, trailing spaces, blank-line runs) and
   hashes it with SHA-256;
3. compares it with `specs/upstream.lock.json`;
4. prints `NEW` / `CHANGED` / `ERROR` entries, with a sanitized line diff for a
   changed body when the previous normalized body is in `specs/.watch-cache/`.

It is **manual only**: no cron, timer, background job or scheduler is
registered. `specs/.watch-cache/` is git-ignored; the lock is committed so a
change is relative to a known baseline. Because nothing schedules it, the lock
age is checked by `specs:check` (see the cadence runbook above): a baseline older
than `--watch-max-age` days is reported so a missed discovery cycle cannot pass
silently.

Flags: `--update`, `--json`, `--fail-on-change`, `--only a,b`,
`--timeout <ms>`, `--root <dir>`, `--now <iso>` (tests).

Exit codes: `0` clean or changes reported, `1` changes with
`--fail-on-change`, `2` config/network/write failure. A 403/404 for an entry
marked `optional: true` is a warning; any other fetch failure is an error.

## Ownership

- **Protocol changes** are a contract change: update `protocols/`, the shared
  stream hooks/fixtures, and the conformance tests together.
- **Provider/price changes** are data: update `providers/` and `pricing/`.
- **Never** copy a rate or a model id into `lib/` code; read it from these
  files, the live catalog, or the preset declaration.
