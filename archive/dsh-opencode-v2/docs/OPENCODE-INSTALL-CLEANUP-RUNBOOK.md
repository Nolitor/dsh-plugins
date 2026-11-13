# OpenCode installation cleanup and 2.2.6 upgrade runbook

<!-- skeleton:
version: 1.1
kind: reference
status: draft
updated: 2026-11-07
summary: Approval-gated upgrade runbook for consolidating OpenCode 2.2.6 as the only active installation; legacy and cache cleanup already executed.
-->

> **Partly executed.** Legacy 0.0.55 and stale OpenCode caches were cleaned on 2026-11-07;
> see [OPENCODE-INSTALL-CLEANUP-LOG-20261107.md](OPENCODE-INSTALL-CLEANUP-LOG-20261107.md).
> The 2.2.6 install, live DB migration, service restart, and live-profile verification in
> this document are **still not executed**.
>
> Evidence behind the plan:
> [OPENCODE-226-COMPATIBILITY-MEASUREMENT.md](OPENCODE-226-COMPATIBILITY-MEASUREMENT.md).

## 1. Target state

One active OpenCode executable and one service generation:

```
~/.bun/bin/opencode  ->  @opencode/cli@2.2.6
~/.bun/bin/opencode2 ->  same binary
live DSH opencodePath rows -> /home/minami/.bun/bin/opencode
running opencode service -> reports 2.2.6 from GET /api/info
```

No other OpenCode binary may precede the canonical launcher on `PATH`, and no stale service
state may advertise a different version.

## 2. Measured starting point

| Item | Current state |
|---|---|
| Canonical CLI | `~/.bun/bin/opencode`, `@opencode/cli@2.2.0` |
| Running service | PID 104336, port 49374, version 2.2.0 |
| Live DSH rows | two rows, both `/home/minami/.bun/bin/opencode` |
| Legacy standalone | `~/.opencode/bin/opencode`, version 0.0.55 |
| Legacy path line | `~/.bashrc` line 125 adds `~/.opencode/bin` |
| Stale global platform packages | `opencode-linux-x64*@1.19.3` |
| Stale Bun caches | 1.18.35, 1.19.3, 2.0.30–2.0.32, 2.2.0 |
| `/tmp` measurement artifacts | extracted 2.2.5 and 2.2.6 binaries and database copies |
| Live DB | `~/.local/share/opencode/opencode.db` plus WAL/SHM |

## 3. Mandatory preflight (read-only)

Run these before touching anything. Save the output with the change record.

```bash
date -Is
type -a opencode || true
readlink -f ~/.bun/bin/opencode ~/.bun/bin/opencode2 ~/.opencode/bin/opencode 2>/dev/null
~/.bun/bin/opencode --version
ps -eo pid,ppid,lstart,args | grep -E '[o]pencode (serve|service)|[o]pencode\.exe'
npm view @opencode/cli version
systemctl --user is-active dsh-web.service
grep -n 'opencodePath:' ~/.dsh/profiles/web/cordis.patch.yml
grep -n 'opencode' ~/.bashrc ~/.profile 2>/dev/null || true
sha256sum ~/.bun/install/global/node_modules/@opencode/cli/bin/opencode.exe
```

Stop if any of the following is true:

- the canonical binary or live profile path is not what the table above says;
- a second process is serving the same port;
- the live profile has an unexpected `opencodePath`;
- the 2.2.6 release asset digest does not match the published digest;
- disk space is insufficient for both the old and new installs plus a DB backup.

## 4. Backup gate

Before an upgrade, the owner must approve and the operator must record:

```bash
stamp=$(date +%Y%m%d_%H%M%S)
mkdir -p ~/.dsh/quarantine-backups/opencode-$stamp
cp -a ~/.bun/install/global/package.json \
      ~/.bun/install/global/bun.lock \
      ~/.dsh/quarantine-backups/opencode-$stamp/
cp -a ~/.config/opencode/opencode.jsonc \
      ~/.dsh/quarantine-backups/opencode-$stamp/
```

Back up the database only while the live service is stopped, or use SQLite's backup API.
A raw copy of a live WAL database can be inconsistent. The measured 2.2.6 migration ran
successfully on a stopped copy, not on the live database.

Do not claim the upgrade is reversible until a down-migration has been tested. The 2.2.6
schema migration is forward-only evidence at this point.

## 5. Install 2.2.6

This is the only version-changing step; it requires explicit owner approval.

```bash
~/.bun/bin/bun add -g @opencode/cli@2.2.6 --exact
~/.bun/bin/opencode --version
~/.bun/bin/bun pm ls -g
```

Expected: `opencode v2.2.6`; the global manifest names `@opencode/cli@2.2.6`; no second
`opencode` becomes first on `PATH`.

Do not edit a running plugin's `opencodePath` in place as a substitute for installing the
package. Stop and get approval before any live profile edit or DSH restart.

## 6. Restart and verify the service

An already-running 2.2.0 process keeps serving the old inode after the package is replaced.
The version mismatch remains until an owner-approved restart.

```bash
# After approval only:
systemctl --user restart dsh-web.service
sleep 2
systemctl --user is-active dsh-web.service
url=$(~/.bun/bin/opencode service status)
password=$(~/.bun/bin/opencode service get password)
curl -fsS -u "opencode:$password" "$url/api/info"
curl -fsS -u "opencode:$password" "$url/api/model" >/tmp/oc226-model.json
curl -fsS -u "opencode:$password" "$url/api/provider/opencode-go"
```

Pass conditions:

- `/api/info` reports `version: "2.2.6"`;
- the service pid is the new process, not PID 104336;
- `/api/model` returns the catalog and `modelsFromApiPayload()` maps it;
- the DSH log has no `did not activate` lines;
- the browser boot probe reports `ok:true`, no page errors, and no console errors.

The measured isolated boot used:

```bash
node scripts/opencode-v2-browser-boot.mjs
```

with `DSH_WEB_URL` set to the boot URL. A `200` on a bundle or a `--dump-config` success is
not mount evidence.

## 7. Remove the legacy standalone install

Current legacy pieces:

- `~/.opencode/bin/opencode` (0.0.55);
- `~/.opencode/node_modules/@opencode-ai/plugin@1.18.35` and its lockfile;
- the `~/.bashrc` line that prepends `~/.opencode/bin`.

Safe order, after explicit approval:

1. Remove or comment the `~/.opencode/bin` `PATH` line.
2. Start a fresh shell and confirm `type -a opencode` shows only the Bun launcher.
3. Confirm no active config, systemd unit, or script names `~/.opencode/bin/opencode`.
4. Archive the directory with `mv`, record the archive path, then remove it only when the
   owner confirms disposal. Do not `rm -rf` a directory merely to empty it; preserve the
   user's ability to inspect it.
5. Re-run `type -a opencode` and `opencode --version` in a fresh interactive shell.

The legacy directory must not be deleted while it is still the only fallback for a login
shell that does not source `.bashrc`. The measured login shell did not resolve `opencode`
at all; the canonical launcher must therefore be reachable by an explicit absolute path in
the DSH rows.

## 8. Remove stale caches and orphan packages

Do not run `bun pm cache rm`: it clears a shared multi-gigabyte cache used by unrelated
packages. Remove only exact paths that are both (a) verified as OpenCode-owned and (b)
unreferenced by the global manifest and active processes.

Preflight:

```bash
~/.bun/bin/bun pm ls -g
node -e 'const fs=require("fs");const p=process.env.HOME+"/.bun/install/global/package.json";console.log(JSON.stringify(JSON.parse(fs.readFileSync(p,"utf8")),null,2))'
ps -eo pid,args | grep -E '[o]pencode'
find ~/.bun/install/cache -maxdepth 1 -name '*opencode*' -printf '%f\n' | sort
```

Expected orphan group from the measurement: cache entries for 1.18.35, 1.19.3, 2.0.30–2.0.32,
2.2.0, plus global `opencode-linux-x64*@1.19.3` trees. The global manifest directly depends
only on `@opencode/cli`, `kordoc`, and `pnpm`; that is evidence for inspection, not permission
to delete.

Cleanup rules:

- keep the 2.2.6 cache until the live service has booted and served successfully;
- consider keeping one rollback binary outside the package manager until the soak passes;
- remove exact directories only after a second path/reference audit;
- record every removed path, byte count, and hash in the change record;
- never remove `~/.local/share/opencode` (sessions/config/credentials), only installation
  and cache trees;
- do not flush the whole Bun cache for this cleanup.

## 9. Verification matrix

| Gate | Command | Pass condition |
|---|---|---|
| One executable | `type -a opencode` | only canonical Bun launchers appear |
| Version | `opencode --version` | `opencode v2.2.6` |
| Service version | `/api/info` | `"version":"2.2.6"` |
| Catalog | `/api/model` + `modelsFromApiPayload()` | non-empty, expected 53-route shape |
| Provider | `/api/provider/opencode-go` | OpenAI-compatible baseURL and headers |
| Credential | `/api/credential` | one active OAuth/key entry usable by the adapter |
| Plugin route | isolated browser boot | `ok:true`, plugin entry present |
| Unit suite | `npm test --prefix dsh-opencode-v2` | 453/453 or better |
| Real generation | adapter stream or `opencode run` | requires quota; do not treat 429 as a compatibility pass |
| Docs gate | `npm run docs:check` at repo root | headers, indexes, links pass |

## 10. Rollback and stop conditions

Stop and report, without improvising, if any of these occurs:

- the extracted/installed 2.2.6 digest does not match the release asset;
- the DB copy migration fails;
- the service reports a version other than 2.2.6 after restart;
- the browser boot reports `did not activate`, page errors, or a missing plugin entry;
- a real request fails with a schema/contract error rather than an entitlement error;
- a stale service still owns port 49374;
- the owner has not approved the install, restart, or removal step.

Rollback needs a named artifact and database strategy. A package reinstall can restore the
binary; it does not automatically reverse a SQLite schema migration. That is why the DB
backup and the service stop are mandatory gates.
