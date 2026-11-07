# OpenCodex Bridge — Ownership, Contract, and Failure Modes

<!-- skeleton:
version: 0.0.1-rc.1
kind: spec
status: active
updated: 2026-11-07
summary: The single owner contract for mirroring DSH model selections into a local OpenCodex instance, including the catalog-vs-authorization split, the shared client-key scope rule, configuration, and the failure modes this design refuses to hide.
-->

> Status: **implemented as a workspace shared library**, not a mounted DSH surface.
> Runtime entry point: `lib/vendor-bridge.js`. Measured on 2026-11-07 against
> OpenCodex `2.97.0` and DSH `0.2.2-rc.1`. No DSH service was restarted and the live
> profile was not edited while producing this document.

## 1. Why this is one module and not three

Before this track owned it, `dsh-opencode-v2`, `dsh-antigravity` and `dsh-deepinfra`
each carried a private `lib/opencodex-models.js`. Three copies of the same management
client produced a real defect: the DSH client key was scoped per provider, so **the last
plugin to save overwrote the other two providers' scope**. A user saving DeepInfra after
OpenCode would silently revoke their OpenCode models.

The bridge therefore lives here once. Vendor plugins keep only a one-function seam.

| Concern | Owner |
| :--- | :--- |
| Server URL, shared key id, management token | `lib/config.js` (this package) |
| HTTP calls to OpenCodex | `lib/opencodex-client.js` |
| DSH id → OpenCodex id projection | `lib/selection-projector.js` |
| Shared-key scope union | `lib/scope-aggregator.js` |
| Ordering and failure policy | `lib/selection-sync.js` |
| Vendor-facing API | `lib/vendor-bridge.js` |
| Model checklist UI, DSH `settings.update` | the vendor plugin |

## 2. Two different powers, never conflated

Measured on OpenCodex `2.97.0` source:

| Mechanism | What it actually does | What it does NOT do |
| :--- | :--- | :--- |
| `provider.selectedModels` | narrows what `/v1/models` and the Codex catalog advertise | does not gate the data plane |
| `config.disabledModels` | hides rows from the published catalog | does not gate the data plane |
| `config.apiKeys[].allowedModels` | refuses a resolved destination with HTTP 403 | inert on loopback admission and on the environment token |

Direct measurement: an unselected **and** blocklisted model still answered HTTP 200 on
`/v1/chat/completions`. That is why the bridge writes the allowlist for the catalog **and**
the key scope for authorization, and why it never describes the first as enforcement.

Loopback bind is the decisive constraint: `resolveApiAuth` returns `kind: "loopback"`
before reading any header, so a scoped key presented to `127.0.0.1` is not evaluated.
**Scope enforcement requires a non-loopback bind.** This module does not change the bind.

## 3. The shared-scope rule

A union can only be computed from complete information. If any configured provider has no
stored allowlist, OpenCodex serves **every** model for that provider, which a union cannot
express. Writing a scope in that state would silently deny that provider.

Therefore `scopeFromProjection()` returns `allowedModels: null` and a reason, and the bridge
**skips the key write** rather than guessing:

| Projection state | `reason` | Key write |
| :--- | :--- | :--- |
| every provider has a non-empty allowlist | `complete` | performed |
| any provider is unrestricted | `provider-unrestricted:<names>` | skipped |
| no scoped provider is configured | `no-configured-provider` | skipped |
| no shared key id | `no-shared-key` | skipped |

The reason is returned to the caller, so a skipped scope is visible and testable, never
mistaken for success.

## 4. Configuration

The bridge reads the environment once per process; vendor plugins expose no bridge settings.

| Variable | Default | Meaning |
| :--- | :--- | :--- |
| `OPENCODEX_BRIDGE_URL` | `http://127.0.0.1:10100/api/selected-models` | management endpoint |
| `OPENCODEX_BRIDGE_KEY_ID` | empty | existing DSH client key id; empty disables scope writes |
| `OPENCODEX_ADMIN_AUTH_TOKEN` | file fallback | management credential |
| `OPENCODEX_HOME` | `~/.opencodex` | directory holding `admin-api-token` |

The management token is read from the owner-only file, never stored in a DSH profile and
never written into a vendor namespace. **No upstream provider credential is accepted,
logged, or forwarded by this module.**

## 5. Ordering and failure policy

One `apply()` performs, in order:

1. `GET /api/selected-models` — the catalog actually served, used to reject invented ids;
2. `PUT /api/selected-models` — the provider allowlist;
3. `GET /api/selected-models` — re-read, because step 2 changed the projection;
4. `PATCH /api/keys` — the shared scope, only when section 3 says it is safe.

A failed step throws. Vendor plugins translate that into a non-2xx settings response, so the
operator sees the mirror failed instead of believing it succeeded. No retry is attempted:
these are idempotent management writes and a retry loop would mask a configuration error.

## 6. Adding a fourth service

1. Add the provider name to `SCOPABLE_PROVIDERS` in `lib/scope-aggregator.js`.
2. Add its id projection to `projectSelection()` in `lib/selection-projector.js`.
3. Have the vendor plugin call `applySelection({ provider, enabled, activePlan })`.
4. Add a projection test and a scope-union test.
5. Do **not** add a vendor-local URL, token, or key id.

## 7. Verification

| Command | Covers |
| :--- | :--- |
| `npm test` in this track | projection, scope union, ordering, skip reasons |
| `npm test` in each vendor | the mounted settings route writes DSH first, then mirrors |
| `node ../scripts/link-custom-router.mjs` | makes the shared package resolvable for linked plugins |

Measured on 2026-11-07: this track 14/14; `dsh-opencode-v2` 453/453;
`dsh-deepinfra` 158 pass + 7 skip; `dsh-antigravity` 118/118; isolated real DSH boot with
the bridge linked produced **0** `did not activate` warnings.
