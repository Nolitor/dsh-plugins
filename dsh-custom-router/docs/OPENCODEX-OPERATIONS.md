# OpenCodex Bridge — Operations Runbook

<!-- skeleton:
version: 0.0.1-rc.1
kind: reference
status: active
updated: 2026-11-07
summary: Operator steps for the OpenCodex bridge: wiring the shared package into a profile, enabling a scoped key, verifying the mirror, and the exact symptoms of the two failure modes seen in practice.
-->

> Companion to [OPENCODEX-BRIDGE.md](./OPENCODEX-BRIDGE.md) (contract) — this file is the
> runbook. Everything here is read-only or reversible except the two explicitly marked writes.

## 1. What must exist before the bridge does anything

| Requirement | Check |
| :--- | :--- |
| OpenCodex running | `ocx status` → proxy running |
| Management token readable | `test -r ~/.opencodex/admin-api-token` |
| Bridge resolvable by linked plugins | `node scripts/link-custom-router.mjs` |
| Vendor plugins mounted | profile `package.json` lists them under `dsh.profile.bundles` |

## 2. Wiring the shared package

A linked plugin is loaded from its real path, and DSH routes a bare import through the
profile's `node_modules` only for names declared in that plugin's `peerDependencies`.
All three vendor plugins declare `@nolit/dsh-custom-router` as a peer, but the package must
also be resolvable:

```bash
cd /home/minami/Workspace/projects/dsh-workspace/dsh-plugins
node scripts/link-custom-router.mjs
```

This writes only the workspace-root `node_modules/@nolit/dsh-custom-router` (gitignored).
A profile that resolves through its own `node_modules` needs the same link there; do that
with explicit approval because it edits live profile state.

## 3. Enabling authorization (the only write that changes behavior)

The catalog mirror works with no key. Authorization needs a **non-loopback bind**, which is
a topology decision, not a plugin setting:

1. Confirm the operator accepts that a non-loopback bind requires a data-plane credential.
2. Issue one DSH client key in the dashboard or `POST /api/keys`.
3. Export `OPENCODEX_BRIDGE_KEY_ID=<id>` for the DSH service.
4. Make every configured provider's checklist explicit. A provider left on "all models"
   makes the bridge skip the scope write by design.

Until step 1 is done, treat the bridge as **catalog projection only**. Do not describe it as
a model allow-list.

## 4. Verifying the mirror

```bash
# what the catalog advertises now
ocx models selected opencode-go --json
ocx models selected deepinfra --json
ocx models selected google-antigravity --json

# the shared key's scope (metadata only, never the secret)
ocx access key list --json | jq '.keys[] | {id, allowedModels}'
```

Expected: the three selections match the DSH checklists, and `allowedModels` is the union
across providers — never a single provider.

## 5. Failure modes

### `provider-unrestricted:<name>`

The bridge skipped the key write because that provider has no allowlist. Save that provider's
checklist explicitly, then save any other provider to trigger a re-union.

### Vendor save returns 502

The DSH write succeeded and the mirror failed. The DSH checklist is authoritative; fix the
OpenCodex side (running? token readable? endpoint reachable?) and save again. Nothing is
half-written: the mirror is two idempotent PUT/PATCH calls.

### `did not activate` after a restart

The shared package was not resolvable from the plugin's real path. Run
`node scripts/link-custom-router.mjs` and re-check the isolated boot before restarting the
live service.

## 6. Rollback

The bridge only ever calls OpenCodex management endpoints. To detach it:

```bash
unset OPENCODEX_BRIDGE_KEY_ID      # stops scope writes first
```

Catalog allowlists persist in OpenCodex config; clear one with
`ocx models selected <provider> --clear`. No vendor code change is required to stop mirroring
beyond removing the peer link, and no DSH restart is needed for the unset to take effect on the
next save.
