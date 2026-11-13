# Credential-store migration — DeepInfra & EXAONE keys

<!-- skeleton:
version: 2.0
kind: spec
status: active
updated: 2026-11-14
summary: How the two plaintext provider keys move out of the profile patch and into the DSH credential store. Explains the measured seam (dsh-credentials-local resolve contract), the precedence the adapters now implement (explicit key -> store ref -> environment), the automatic mount-time migration (rc.20), and the exact owner steps with redacted placeholders.
-->

> Rules: [docs/RULES.md](../../docs/RULES.md) · Roadmap: [ROADMAP.md](./ROADMAP.md) P0-1/P0-2 ·
> Architecture: [CUSTOM-ROUTER-ARCHITECTURE.md](./CUSTOM-ROUTER-ARCHITECTURE.md) §credential flow.

## 1. Why

On 2026-11-14 the DeepInfra and EXAONE key values were disclosed in a session transcript, and both
still sat as **plaintext `apiKey:` lines** in the live profile
(`~/.dsh/profiles/web/cordis.patch.yml`). Policy D5 says a secret belongs in the DSH credential
store, referenced by name — the profile may carry the **reference**, never the value. The owner's
instruction is the same: DSH manages the key; we only supply the value once.

## 2. The measured seam (2026-11-14)

| Fact | Evidence |
| :--- | :--- |
| Store file | `~/.dsh/.credentials.yaml`, top-level `version:` / `records:` / `refs:` |
| Record refs already present | `DEEPSEEK_API_KEY`, `OPENCODE_API_KEY` (names only; no value was read or copied) |
| Read API | `ctx.credentials.resolve(ref)` — `@deepseek-ai/dsh-credentials-local/lib/index.js:492` returns `{ value, source: 'file' \| 'env' \| ... }` or `undefined` |
| Ref grammar | `/^[A-Za-z_][A-Za-z0-9_]*$/` — i.e. an environment-variable-shaped name (`dsh-credentials/lib/index.js:14`) |
| Resolution order in the provider | stored value → inherited env → `.env` fallback, all inside `resolve()` |
| Why not the settings UI alone | a settings write lands in the plugin's own cordis config, not in `refs:` (measured and recorded in `CUSTOM-ROUTER-PRESET-SURFACE.md` §1.2) |

## 3. What the code now does

Both vendored presets gained a `credentialRef` config field (defaults `DEEPINFRA_API_KEY` /
`EXAONE_API_KEY`) and resolve it through the host service at mount and again on every
`credentials/reference-updated` event, so a rotated value reaches the next request **without a plugin
restart**.

Precedence, implemented as one pure rule (`keyPrecedence`) and pinned by tests:

1. an explicitly configured `apiKey` (profile patch / settings UI) — kept as a fallback;
2. the DSH credential store value behind `credentialRef`;
3. the environment variable (`DEEPINFRA_API_KEY` / `EXAONE_API_KEY`, including the `.env` layer).

A blank value never wins at any level. An unresolvable ref logs a warning naming the **ref**, never a
value, and falls through.

## 4. Owner steps (once)

> **SUPERSEDED BY THE AUTOMATIC MIGRATION (rc.20, 2026-11-14).** The router now performs steps
> 1–2 itself, at mount, when its own live config still carries a plaintext key: it backs the patch
> up (0600), writes the value into the store, **confirms** the ref resolves back to the same value,
> and only then replaces the plaintext line with the reference
> (`lib/credential-migration.js`, `lib/index.js` → `migratePlaintextKeysAtMount`). The steps below
> remain the MANUAL procedure for a host that does not mount the router, and for a key that must be
> moved without a restart.

1. **Register each ref once** in the DSH credential store. Either edit
   `$DSH_HOME/.credentials.yaml` (add under `refs:`) or use the settings surface that writes that
   store; the shape is a name → value map:

   ```yaml
   refs:
     DEEPINFRA_API_KEY: <paste the replacement DeepInfra key>
     EXAONE_API_KEY: <paste the replacement EXAONE key>
   ```

   The old values were disclosed in a transcript: rotate them at the provider first (ROADMAP P0-1) and
   register only the replacements.

2. **Replace the profile patch lines** in `~/.dsh/profiles/web/cordis.patch.yml`. Before (two places,
   lines ~140 and ~164 today):

   ```yaml
   apiKey: <redacted plaintext value>
   ```

   After — delete the `apiKey` line entirely and let the default ref apply, or pin the ref explicitly:

   ```yaml
   credentialRef: DEEPINFRA_API_KEY
   ...
   credentialRef: EXAONE_API_KEY
   ```

3. **Restart** `dsh-web.service` (the profile patch is read at boot).

4. **Verify**, in this order:

   ```bash
   cd dsh-custom-router
   npm run verify:presets          # declarations still agree with runtime registries
   npm run verify:refresh          # 4/4 preset routes still answer
   # then one live turn per provider, and confirm the workspace has no plaintext key:
   grep -n "apiKey:" ~/.dsh/profiles/web/cordis.patch.yml   # must print nothing for these two rows
   ```

## 4.1 The one-shot script (rc.20)

`scripts/migrate-plaintext-keys.mjs` performs the same migration without mounting the router:

```bash
node scripts/migrate-plaintext-keys.mjs --dry-run   # plan only (the default)
node scripts/migrate-plaintext-keys.mjs --apply     # back up → store → confirm → remove
```

Its store write uses the **atomic YAML path** — a `yaml` Document `setIn(['refs', ref])` committed
with `writeFileAtomic` (random-suffix sibling + rename, mode 0600) under the document's own writer
lock — because the service's write method is not reachable from a standalone script. The edit is
surgical: `version:`, `records:` and every other entry keep their bytes, and the credential
provider watches the file, so the change takes effect **without a restart**.

The script is idempotent: with the plaintext lines gone it reports `nothing to migrate` and writes
nothing.

## 4.2 The mount-time hook (rc.20)

`migratePlaintextKeysAtMount()` runs in the router's `apply()`, before the vendor rows mount. Its
trigger is the router's **live** `vendorConfig` — the config the running service actually uses — so
a plaintext key that still serves traffic is the thing that starts the migration. The hook is a
no-op in the steady state.

| Order | Step | Failure behaviour |
|---|---|---|
| 1 | backup the patch (0600, timestamped) | abort; nothing else touched |
| 2 | write the value into the store (`ctx.credentials.set`) | abort; the plaintext line survives |
| 3 | **confirm** the ref resolves to the same value | abort; the plaintext line survives |
| 4 | replace the plaintext line with `credentialRef:` | — |

The order is the safety property: there is no env fallback on the live service, so a plaintext key
is never deleted before its store entry is confirmed. The edit is line-oriented, never a YAML
load/dump, so the patch's comments and order survive; the diff after a run shows only the intended
lines.

## 5. Hygiene rules that outlive this migration

- Never print, copy, hash, or diff a key value — including in tests, fixtures, docs, task notes, or a
  session transcript. Report `file:line` and a redacted shape instead.
- `specs/`, `test/conformance/`, and the docs never carry a value; the watch lock stores hashes only.
- `specs/.watch-cache/` stays git-ignored.
- If a ref is missing at runtime, the warning names the ref and the env fallback still applies — a
  missing ref is a configuration bug to report, not a reason to re-add a plaintext key.
