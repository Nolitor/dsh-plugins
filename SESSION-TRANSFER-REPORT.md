# DSH Plugins - Session Transfer Report

Generated: 2026-10-24T19:37:38+09:00

## Transferred sessions (기본 작업공간 -> DSH Plugins)

| Session ID | Title | Events |
|---|---|---|
| session-ebc6d16e-e21f-42a9-a181-817815451b45 | Fix Korean font persistence issue | 1448 |
| session-281956f8-db78-4718-ad65-1f405053248d | DSH 한글 로컬라이징 검토 | 3407 |
| session-9bde4597-b4ea-4b2e-a7a1-a92a676e726d | 현재 프로젝트(기본 작업공간 | 3249 |

## Changes

- Session directories moved to ~/.dsh/sessions/--home-minami-Workspace-projects-dsh-workspace-dsh-plugins--/ and re-encoded as compliant two-frame Zstandard logs (Frame 1 header cwd only; body byte-identical).
- The three session_projcache records had identity.cwd re-stamped to the DSH Plugins path (titles resolve again).
- workspace.json: 기본 작업공간 15 -> 12 sessions; DSH Plugins 8 -> 11 sessions (3 appended).
- No session log was left in the old project directory; no other default-workspace session was touched.

## Service

| Check | Result |
|---|---|
| dsh-web.service active | active |
| HTTP http://127.0.0.1:3080/ | 200 |
| New web URL | http://0.0.0.0:3080/?token=N7OyFhlm93-USNDMmaLPEqZqGQMGe-u2QTCEXXXX2Cs |
| Startup / corruption / cache warnings / plugin activation failures (last 5 min) | none |
| Sessions dropped from the two workspaces | none |
| Projection-cache warnings | none |
| Authoritative session logs + cache records byte-identical after restart | PASS (6 OK) |
| Promoted-state audit (47 checks) after restart | PASS |

## Isolated boot verification (pre-restart, same state)

| Check | Result |
|---|---|
| Workspace title / path | DSH Plugins |
| DSH Plugins session count | 11 |
| 기본 작업공간 session count | 12 |
| 3 sessions in DSH Plugins, absent from default | yes |
| All headers on the new cwd (no assertStoredIdentity drops) | yes |
| All projection blocks served | yes |
| Historical titles resolved | 5 titled (2 DSH Notify + 3 transferred) |
| Transferred logs replay through production persistence | 1448 / 3407 / 3249 events |

Evidence: verification/session-transfer-clone-audit.json

## Evidence files

- /tmp/session-transfer-audit-pre-restart.json
- /tmp/session-transfer-audit-post-restart.json
- /tmp/session-transfer-sha-check.txt
- /tmp/session-transfer-verify.log
- PLUGINS_ROOT/verification/session-transfer-clone-audit.json
