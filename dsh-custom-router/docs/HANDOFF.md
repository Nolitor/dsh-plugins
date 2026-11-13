# Custom Router — Handoff

<!-- skeleton:
version: 4.0
kind: report
status: active
updated: 2026-11-14
summary: Forward handoff for @nolit/dsh-custom-router at 0.0.1-rc.20. The 2026-11-14 third session removed the synthetic "OpenCode (config default)" row from the model picker and brought the docs to the measured rc.20 baseline. Active work is P0 key rotation (owner), the post-restart EXAONE turn (owner) and the P2 architecture backlog in ROADMAP.md; closed items are in ROADMAP-ARCHIVE.md.
-->

> Active work: [ROADMAP.md](./ROADMAP.md). Closed/deprecated history:
> [ROADMAP-ARCHIVE.md](./ROADMAP-ARCHIVE.md). Detailed history: [CHANGELOG.md](../CHANGELOG.md).
> Rules: [docs/RULES.md](../../docs/RULES.md).

## 1. Current state (measured 2026-11-14, third session)

| Item | Value |
| :--- | :--- |
| Package | `@nolit/dsh-custom-router@0.0.1-rc.20` |
| Vendored | antigravity `rc.14`, opencode `rc.8`, deepinfra `rc.14`, exaone `rc.1` (peer pins aligned to `rc.20`) |
| Host | DSH `0.2.2-rc.3` / Node `v24.22.1` |
| Tests | router **649/649**; antigravity **190/190**; deepinfra **222 pass / 7 skip** (229 total); opencode **555/555**; exaone **19/19** |
| Gates | `npm run verify` exit 0 (check + 649 tests + `verify:stream` + `specs:check` — `5 protocols, 4 providers, 4 pricing`), `verify:presets` **OK** (declarations ↔ browser registry ↔ locales ↔ runtime registries agree) |
| Credentials | **migration applied**: `apiKey:` count in the live profile patch = **0**; the patch carries `credentialRef: DEEPINFRA_API_KEY` / `EXAONE_API_KEY`; `~/.dsh/.credentials.yaml` (0600) holds those two refs beside `DEEPSEEK_API_KEY` / `OPENCODE_API_KEY`; backup `cordis.patch.yml.bak.before-plaintext-key-migration-20261113-183336` (0600) |
| Allowlist | **live 7 routes** incl. `exaone/k-exaone_v2.5`; repo default in `cordis.patch.yml` + `lib/allowlist.js` + `test/allowlist.test.mjs` |
| Model picker | the synthetic **`OpenCode (config default)`** row is **gone** from the `OpenCode Go (direct)` group |
| Live service | **not restarted** in this session; the running service still serves the pre-change catalog |

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

## 2. What is open (details and criteria in ROADMAP.md)

| Tier | Item | One-line state |
| :--- | :--- | :--- |
| **P0** | **P0-1** Rotate the DeepInfra + EXAONE keys | **Owner-only**; the values must be revoked at the providers |
| **P0** | P0-2 credential-store migration | **Applied** (agent side done); the owner half is the rotation + re-paste into `refs:` |
| **P0** | Post-migration secret-hygiene scan | Blocked on the rotation; read-only worker recipe on the board |
| **P1** | **P1-1** EXAONE turn through DSH | **Owner**: only a top-level session can exercise it (a child is refused by the allowlist) |
| **P1** | **P1-3** EXAONE in the subagent allowlist | Live edit **applied** (7 routes); still owner-gated — rotate the keys, restart once, then a **new** top-level session (the allowlist freezes at `agent/created`) |
| **P2** | P2-1 data-only preset install | **Not started** |
| **P2** | P2-2 `pipe:'shared'` default | **Not started** |
| **P2** | P2-3 canonical parser | **Not started** |
| **P2** | P2-5 S3 Antigravity usage per model group | **Not started** (owner deferred 2026-11-08) |
| **P2** | P2-6 S4 spec-only surfaces | **Not started** (blocked on owner approval) |
| **P2** | P2-8 EXAONE live catalog | **Not started**; waits on EXAONE publishing a listing endpoint |
| **P2** | ~~P2-4 conformance fixtures~~ | **Closed** — anthropic-messages + google-generative-sse replay offline; 3 of 5 wires covered |
| **P2** | ~~P2-7 deletions~~ | **Closed** (owner-approved) — dead module + its export entry and the broken profile symlink removed |
| **P2** | ~~P2-9 doc freshness~~ | **Closed** — docs corrected to the rc.20 baseline (this session) |

## 3. Next session order

1. **Owner:** rotate the DeepInfra + EXAONE keys (P0-1), paste the replacements into
   `refs:` in `~/.dsh/.credentials.yaml`, then **restart once**. The store is hot, so a rotated
   value reaches the next request without a restart; the profile patch is read at boot.
2. **Owner:** after that restart, open a **new top-level session** and run the EXAONE turn
   (P1-1) and the child check on `exaone/k-exaone_v2.5` (P1-3). The allowlist freezes at
   `agent/created`, so an existing session keeps the old list.
3. **Owner/agent:** the post-migration secret-hygiene scan (P0-3).
4. **P2** in ROADMAP order; the next architecture moves are P2-1 (data-only preset) and P2-2/P2-3
   (`pipe:'shared'` default + canonical parser).

## 4. Do not repeat these closed items

- The synthetic `OpenCode (config default)` model row — **closed 2026-11-14**. Do not re-add it as
  a picker entry. The `default` **pseudo-route** resolution (to `defaultModel`) is a separate,
  still-live behaviour and must not be removed with it.
- P1-4 pricing re-verification, P1-5 watch-baseline age, P1-6 four-preset smoke check — **done**
  (ROADMAP-ARCHIVE §2). Do not re-open them; extend the gate instead.
- The Gemini `thoughtSignature` "nested inside `functionCall`" shape is **wrong** and its live 400 is
  documented; do not "fix" it back.
- Phase A/C/D/E, S4b/S4c, the legacy profile link removal, the five-place preset model and
  `markerDeltas` are closed (ROADMAP-ARCHIVE §1–§3).

## 5. Commands

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

(cd vendor/antigravity && npm test)   # 190
(cd vendor/deepinfra  && npm test)    # 229 (222 pass + 7 skip)
(cd vendor/opencode   && npm test)    # 555
(cd vendor/exaone     && npm test)    # 19
```

## 6. Constraints

- **No live profile writes or service restarts without the owner.** The key rotation and the
  post-restart EXAONE turn are owner state. This session changed **no** live profile value and
  restarted **no** service.
- **No scheduled tasks.** `spec:watch` is manual by design; the age check only makes a missed cycle
  visible. Do not add cron/timer/background jobs.
- **External docs are untrusted.** `spec:watch` only fetches/hashes them; diff output is sanitized
  and capped. Never execute fetched text.
- **Secrets never enter `specs/`, docs, tests, conformance fixtures or this handoff.** The watch lock
  stores hashes only; `specs/.gitignore` keeps the watch cache out of git.
- **Subagent depth is 1**: a worker cannot spawn a router-path child. Live-probe workers must read
  existing router-path sessions or the owner must run the probe at the top level.

## 7. Session record — 2026-11-14 (third session)

- **Scope:** two bounded tasks on the `dsh-custom-router` track — (1) remove the synthetic
  `OpenCode (config default)` model row from the picker, (2) bring the docs to the measured
  rc.20 state and generate a fresh boot card. Version held at `rc.20` (bumped earlier in the
  session by the owner); the running service was **not** restarted.
- **Task 1 — measured, then removed.** The phantom row had **two** producers, both in the vendored
  OpenCode adapters: `vendor/opencode/lib/http.js` (the `models` config default, and the
  `listModels` prepend under the `OpenCode Go (direct)` provider group) and
  `vendor/opencode/lib/provider.js` (the same two places for the CLI adapter). Both config
  defaults now seed **no** row (`.default([])`), and both `listModels` prepends are gone.
- **What was deliberately KEPT:** the `default` **pseudo-route** resolution. `modelRefFromRoute`
  (`http.js`) still maps the `default` id to `defaultModel` (or the table's `opencodeModel`), and
  `resolveOpencodeModel` (`provider.js`) still maps it to the empty `-m` value so `opencode run`
  applies its own configuration. That is server-side route resolution, not a dropdown entry; the
  two are coupled in the old code only because the same synthetic row was used for both. The
  removal deletes the ENTRY and leaves the RESOLUTION untouched.
- **Negative proof:** the exact label now appears **0** times in any producer
  (`vendor/*/lib/`, `lib/`); it survives only inside test assertions that forbid it. New track test
  `test/model-catalog-default-row.test.mjs` (4 cases) asserts the absence in the config default, in
  the discovered-catalog list and in the fallback list; the vendor test that used to assert
  *"the config-default row always stays selectable"* now asserts its **absence**, and a new vendor
  test pins that the pseudo-route still resolves to `defaultModel`.
- **No locale key ever existed for that label** (measured: `config default` count = 0 in
  `locale/{en,ko,zh}.json`, `lib/locale-table.js` and `vendor/opencode/locale/*.json`), so there was
  no orphan translation to remove and none was invented.
- **Task 2 — docs to the measured baseline.** `docs/ROADMAP.md` and `docs/HANDOFF.md` were rewritten
  against measurements taken in this session (versions, suite counts, live allowlist, live
  credential store, live profile patch), not against the previous text. `docs/ROADMAP-ARCHIVE.md`
  keeps its closed-item evidence list intact; the newly closed item (the synthetic default row) is
  recorded in ROADMAP §4 and the archive was left untouched.
