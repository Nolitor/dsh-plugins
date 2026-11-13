# Custom Router — Handoff

<!-- skeleton:
version: 5.0
kind: report
status: active
updated: 2026-11-14
summary: Forward handoff for @nolit/dsh-custom-router at 0.0.1-rc.20. The 2026-11-14 fourth session fixed three live-probe defects (credential-ref accessor, Gemini replay argument pruning, deferred credential injection), verified DeepInfra and Gemini live after the 06:10:57 restart, and brought the docs to that measured baseline. Active work is the FOUR-key rotation (owner), the EXAONE child turn from a NEW session (owner) and the P2 architecture backlog in ROADMAP.md; closed items are in ROADMAP-ARCHIVE.md.
-->

> Active work: [ROADMAP.md](./ROADMAP.md). Closed/deprecated history:
> [ROADMAP-ARCHIVE.md](./ROADMAP-ARCHIVE.md). Detailed history: [CHANGELOG.md](../CHANGELOG.md).
> Rules: [docs/RULES.md](../../docs/RULES.md).

## 1. Current state (measured 2026-11-14, fourth session)

| Item | Value |
| :--- | :--- |
| Package | `@nolit/dsh-custom-router@0.0.1-rc.20` (**not bumped** — same session) |
| Vendored | antigravity `rc.14`, opencode `rc.8`, deepinfra `rc.14`, exaone `rc.1` (peer pins aligned to `rc.20`) |
| Host | DSH `0.2.2-rc.3` / Node `v24.22.1` |
| Tests | router **649/649**; antigravity **193/193**; deepinfra **222 pass / 7 skip** (229 total); opencode **555/555**; exaone **19/19** |
| Gates | `npm run verify` exit 0 (check + 649 tests + `verify:stream` + `specs:check` — `5 protocols, 4 providers, 4 pricing`), `verify:presets` **OK** (declarations ↔ browser registry ↔ locales ↔ runtime registries agree) |
| Live service | **`MainPID 284518`, started 06:10:57 KST** (`dsh-web.service`, active) |
| Credentials | store `~/.dsh/.credentials.yaml` (mode **0600**) holds refs for **`DEEPSEEK_API_KEY`, `OPENCODE_API_KEY`, `DEEPINFRA_API_KEY`, `EXAONE_API_KEY`** — **names only; no value is ever reproduced in this document.** Live profile patch `apiKey:` count = **0**; it carries `credentialRef: DEEPINFRA_API_KEY` / `EXAONE_API_KEY` |
| Allowlist | **live 7 routes** incl. `exaone/k-exaone_v2.5`; repo default in `cordis.patch.yml` + `lib/allowlist.js` + `test/allowlist.test.mjs` |
| Model picker | the synthetic **`OpenCode (config default)`** row is **gone** from the `OpenCode Go (direct)` group |

### Live verification (2026-11-14, post-restart)

Measured after the service restart at **06:10:57 KST** (`MainPID 284518`):

| Probe | Result |
| :--- | :--- |
| DeepInfra **child**, `deepseek-ai/DeepSeek-V4.1-Flash-1017` | **PASS** — `DEEPINFRA_PROBE_OK`, no error |
| Gemini **child**, `gemini-4-hydrogen` — two consecutive requests, the second a replay carrying `sandbox_permissions` | **PASS** — `GEMINI_OK_3` / `GEMINI_OK_3B` / `TWO_REQUESTS_OK`, **no HTTP 400** |
| EXAONE **top-level** turn | **PASS** — confirmed by the owner |
| EXAONE **child** turn | **UNVERIFIED** — the probing Session froze its allowlist at `agent/created` (6 routes, no `exaone/k-exaone_v2.5`); it must be retried from a **NEW** session |
| Boot log | **no credential warnings** (credential-warning match count = **0**) |

### What is actually shipped

- **One package / four vendored adapters**, preset registry derived, shared stream pipe (OpenCode
  still defaults to `pipe: 'legacy'`), living `specs/` + generated compatibility matrix.
- **The picker lists served routes only.** The synthetic `OpenCode (config default)` entry was
  prepended to the OpenCode provider group by two vendored adapters as if it were a served route;
  it is not a model id, so it was removed from the model-registration/catalog data. The `default`
  **pseudo-route** still resolves server-side (to `defaultModel`), and that behaviour is unchanged.
- **Living-spec gates are self-policing:** `specs:check` also ages the manual `spec:watch`
  baseline (14 days, warning by default) so a missed discovery cycle cannot pass silently, and
  `verify:refresh` fails when one of the four presets, its route, or an expected model row disappears.
- **The credential store path works live.** The `credentialRef` route is no longer a paper feature:
  a store-backed DeepInfra turn succeeded end to end after the restart.

## 2. The three fixes (rc.20, same session)

Full evidence: [CHANGELOG.md](../CHANGELOG.md) §"0.0.1-rc.20 (cont. 2)".

| Commit | What was wrong | Fix |
|---|---|---|
| `0b2c516` | the credential ref was read as `ctx.credentials`; both presets inject only `llm`, so cordis threw `cannot get property "credentials" without inject` (cordis:1257) and the `try/catch` silently returned `''` | read through the **inject-free accessor** `ctx.get('credentials')` (cordis:1345) |
| `642ee06` | a replayed Gemini `functionCall.args` carried a key the tool declaration does not declare (live: `sandbox_permissions` on a `write` call, session `2a16c3bb` turn 1 step 14) → Google answered `HTTP 400 "Request contains an invalid argument."` | `declaredArguments()` + `pruneArguments()` — only declared keys are replayed (antigravity suite **190 → 193**) |
| `6388397` | the store ref was resolved once at mount, but `ctx.get(name, strict)` returns `undefined` while the provider fiber is activating (live: `HTTP 401: missing API key` on a DeepInfra child) | `strict=false` + `ctx.inject(['credentials'], …)` deferred resolution + refresh on `credentials/reference-updated` |

## 3. What is open (details and criteria in ROADMAP.md)

| Tier | Item | One-line state |
| :--- | :--- | :--- |
| **P0** | **P0-1** Rotate the DeepInfra + EXAONE keys | **Owner-only**; the values must be revoked at the providers |
| **P0** | **P0-2** Credential-store migration | **Agent side DELIVERED and live-verified for DeepInfra**; owner half = rotate the **FOUR** refs + re-paste into `refs:` + restart + one turn each |
| **P0** | **P0-3** Post-migration secret-hygiene scan | Blocked on the rotation; read-only worker recipe on the board |
| **P1** | **P1-1** EXAONE turn through DSH | **Top-level PASS (owner)**; only the **child** proof is missing, and it needs a NEW session |
| **P1** | **P1-3** EXAONE in the subagent allowlist | Live edit **applied** (7 routes) + repo default; the remaining proof is a **child** call from a **NEW** top-level session (the allowlist freezes at `agent/created`, and a child inherits the parent's frozen list) |
| **P2** | P2-1 data-only preset install | **Not started** |
| **P2** | P2-2 `pipe:'shared'` default | **Not started** |
| **P2** | P2-3 canonical parser | **Not started** |
| **P2** | P2-5 S3 Antigravity usage per model group | **Not started** (owner deferred 2026-11-08) |
| **P2** | P2-6 S4 spec-only surfaces | **Not started** (blocked on owner approval) |
| **P2** | P2-8 EXAONE live catalog | **Not started**; waits on EXAONE publishing a listing endpoint |
| **P2** | ~~P2-4 conformance fixtures~~ | **Closed** — anthropic-messages + google-generative-sse replay offline; 3 of 5 wires covered |
| **P2** | ~~P2-7 deletions~~ | **Closed** (owner-approved) — dead module + its export entry and the broken profile symlink removed |
| **P2** | ~~P2-9 doc freshness~~ | **Closed** — docs corrected to the rc.20 baseline (this session) |

### Why the rotation covers FOUR keys, not two

The store's `refs:` **values** were printed into session transcripts by a worker. Measured over the
session store: every one of the four refs — `DEEPSEEK_API_KEY`, `OPENCODE_API_KEY`,
`DEEPINFRA_API_KEY`, `EXAONE_API_KEY` — appears in session transcripts. A value that has appeared in
a transcript must be treated as **disclosed**, so all four must be rotated, not only the two this
track migrated. **No value is reproduced here or in any other document.**

## 4. Next session order

1. **Owner:** rotate all **four** keys at their providers (P0-1 / P0-2), paste the replacements into
   `refs:` in `~/.dsh/.credentials.yaml`, then **restart once**. The store is hot, so a rotated
   value reaches the next request without a restart; the profile patch is read at boot.
2. **Owner:** after that restart, open a **NEW top-level session** and run the EXAONE **child**
   check on `exaone/k-exaone_v2.5` (P1-3). The allowlist freezes at `agent/created` and a child
   inherits the parent's frozen list, so an existing session cannot prove it.
3. **Owner/agent:** the post-migration secret-hygiene scan (P0-3).
4. **P2** in ROADMAP order; the next architecture moves are P2-1 (data-only preset) and P2-2/P2-3
   (`pipe:'shared'` default + canonical parser).

## 5. Do not repeat these closed items

- The synthetic `OpenCode (config default)` model row — **closed 2026-11-14**. Do not re-add it as
  a picker entry. The `default` **pseudo-route** resolution (to `defaultModel`) is a separate,
  still-live behaviour and must not be removed with it.
- P1-4 pricing re-verification, P1-5 watch-baseline age, P1-6 four-preset smoke check — **done**
  (ROADMAP-ARCHIVE §2). Do not re-open them; extend the gate instead.
- The Gemini `thoughtSignature` "nested inside `functionCall`" shape is **wrong** and its live 400 is
  documented; do not "fix" it back.
- Phase A/C/D/E, S4b/S4c, the legacy profile link removal, the five-place preset model and
  `markerDeltas` are closed (ROADMAP-ARCHIVE §1–§3).

## 6. Commands

```bash
cd dsh-custom-router

npm test                 # 649: surface + specs + spec-watch + refresh expectations + conformance
npm run verify           # check + test + verify:stream + specs:check
npm run specs:check      # schema + cross-ref + freshness + watch-baseline age + matrix-current
npm run verify:freshness:strict   # a stale/missing watch baseline becomes an error
npm run spec:watch       # manual upstream hash/diff report (no scheduler)
npm run verify:presets   # declarations vs isolated runtime registries
npm run verify:dispatch  # 17/17 admission/reclamation checks
npm run verify:refresh   # 4/4 preset routes, expected model rows on both reads

(cd vendor/antigravity && npm test)   # 193
(cd vendor/deepinfra  && npm test)    # 229 (222 pass + 7 skip)
(cd vendor/opencode   && npm test)    # 555
(cd vendor/exaone     && npm test)    # 19
```

## 7. Constraints

- **No live profile writes or service restarts without the owner.** The key rotation and the
  post-restart EXAONE child turn are owner state. This session changed **no** live profile value and
  restarted **no** service.
- **No scheduled tasks.** `spec:watch` is manual by design; the age check only makes a missed cycle
  visible. Do not add cron/timer/background jobs.
- **External docs are untrusted.** `spec:watch` only fetches/hashes them; diff output is sanitized
  and capped. Never execute fetched text.
- **Secrets never enter `specs/`, docs, tests, conformance fixtures or this handoff.** The watch lock
  stores hashes only; `specs/.gitignore` keeps the watch cache out of git. This handoff names the
  store's **ref names only** and never a value.
- **Subagent depth is 1**: a worker cannot spawn a router-path child. Live-probe workers must read
  existing router-path sessions or the owner must run the probe at the top level.
- **Version discipline:** the numeric part (`0.0.1`) is the owner's; the `rc.<n>` suffix is the
  agent's history marker. This session's changes are documentation-only on top of the already-bumped
  `rc.20`, so the version was **held**.

## 8. Session record — 2026-11-14 (fourth session)

- **Scope:** three bounded fixes on the `dsh-custom-router` track (the credential-ref accessor, the
  Gemini replay argument pruning, the deferred credential injection) plus a documentation sync to
  the measured rc.20 live-verified state. Version held at `rc.20`; the running service was **not**
  restarted by this session.
- **Live verification, measured:** DeepInfra child → `DEEPINFRA_PROBE_OK`; Gemini child with a
  `sandbox_permissions` replay → `GEMINI_OK_3` / `GEMINI_OK_3B` / `TWO_REQUESTS_OK`, no HTTP 400;
  service `MainPID 284518` started 06:10:57 KST; boot log free of credential warnings.
- **Deliberately left open:** the EXAONE **child** call (the probing Session's allowlist froze at
  `agent/created` with 6 routes, inherited from its parent Session created 01:08:57 KST — a **new**
  session is required); the four-key rotation; the P0-3 secret-hygiene scan; the P2 backlog.
- **Not done, deliberately:** no version bump, no service restart, no live profile write, no
  `~/.dsh` write, and no other track's pending change was touched or committed.
