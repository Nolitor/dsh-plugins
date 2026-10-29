# DSH Plugins - Title Restoration Report
<!-- skeleton:
version: 1.0
kind: report
status: historical
updated: 2026-10-24
summary: Root cause and fix for workspace/session title loss during the Windows-to-Linux migration.
-->


Generated: 2026-10-24T19:22:38+09:00

## Root cause

The projection cache record for each promoted session carried the pre-move lifecycle identity (identity.cwd = /home/minami/Workspace/projects/DSH Notify). session/list serves a cold session title only from an identity-matching projection-cache record, so all eight rows lost their projections and the client rendered the session.untitled fallback (제목 없음). The authoritative session logs were never affected.

## Restoration applied

Only the eight projection-cache records under ~/.dsh/storages/session_projcache/sessions/ were re-stamped (identity.cwd -> /home/minami/Workspace/projects/dsh-workspace/dsh-plugins). Session logs (two-frame Zstandard, Frame 1 body bytes) were NOT touched - see hash verification below. Historical titles restored: DSH Notify 하이브리드 듀얼 모드 아키텍처 설계; 부트 카드 읽고 헤더 인덱싱 작업. The other six sessions never had a historical title (pristine reference archive and their logs contain no session/title events and zero user messages), so they remain untitled by design.

## Service

| Check | Result |
|---|---|
| dsh-web.service active | active |
| HTTP http://127.0.0.1:3080/ | 200 |
| New web URL | http://0.0.0.0:3080/?token=1nGvFsH33VnTZFtShpBWAtsZhIy7ulKW0EfeGAhGeKo |
| Startup / corruption / cache warnings / plugin activation failures (last 5 min) | none |
| Sessions dropped from workspace 14879f56-24e5-4b96-a1b5-0778356e8960 | none |
| Projection-cache warnings | none |
| Authoritative cache+session files byte-identical after restart | PASS (16 OK) |
| Promoted-state + cache-identity audit after restart | PASS |

## Title resolution evidence

The isolated real-DSH boot audit (verification/title-restoration-clone-audit.json) validates the live state:

| Session | Projection present | Title |
|---|---|---|
| session-b53400d8... | yes | DSH Notify 하이브리드 듀얼 모드 아키텍처 설계 |
| session-a3b2bf75... | yes | 부트 카드 읽고 헤더 인덱싱 작업 |
| the other 6 | yes | null (historically untitled) |

All 8 lifecycle identities match, all 8 projection blocks are served (allIdentityMatch=true, allProjectionsPresent=true, allTitlesMatchHistorical=true, listedTitleServing=2, allPass=true).

## Evidence files

- /tmp/title-restore-audit-pre-restart.json
- /tmp/title-restore-audit-post-restart.json
- /tmp/title-restore-sha-check.txt
- /tmp/title-restoration-verify.log
- PLUGINS_ROOT/verification/title-restoration-clone-audit.json
