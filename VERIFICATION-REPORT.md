# DSH Plugins - Promotion Verification Report

Generated: 2026-10-24T19:09:53+09:00

## Service

| Check | Result |
|---|---|
| dsh-web.service active | active |
| HTTP http://127.0.0.1:3080/ | 200 |
| New web URL | http://0.0.0.0:3080/?token=oiSz95hvJtNM9FuKlXF9Y5Ol3QBuqGqdqMxIWNDq1tc |
| Startup failures / corrupt logs / plugin activation failures (last 3 min) | none |
| Sessions dropped from workspace 14879f56-24e5-4b96-a1b5-0778356e8960 | none |
| Promoted-state audit after restart | PASS |

## Promotion invariants (audited)

- Workspace 14879f56-24e5-4b96-a1b5-0778356e8960 is titled DSH Plugins at /home/minami/Workspace/projects/dsh-workspace/dsh-plugins with its 8 sessions preserved in order.
- All eight session logs are two-frame Zstandard artifacts whose Frame 1 is exactly the rewritten header line with the new cwd; generationLogPath(root, cwd, id, v4, zstd) matches the physical file.
- Plugin tracks present: dsh-korean-locale (linked into the web profile), dsh-notify, dsh-sidebar-manager, docs/.
- Korean locale profile dependency and node_modules link resolve from the new canonical path.

## Evidence files

- /tmp/dsh-plugins-audit-pre-restart.json
- /tmp/dsh-plugins-audit-post-restart.json
- /tmp/post-restart-verify.log
- journalctl --user -u dsh-web.service
