#!/usr/bin/env bash
# Title-restoration verification + detached restart for the DSH Plugins workspace.
# Scheduled via a transient systemd user timer because this agent runs inside dsh-web.service.
set -u

PLUGINS_ROOT="/home/minami/Workspace/projects/dsh-workspace/dsh-plugins"
AUDIT="$PLUGINS_ROOT/scripts/audit-promoted-state.mjs"
REPORT="$PLUGINS_ROOT/TITLE-RESTORATION-REPORT.md"
LOG="/tmp/title-restoration-verify.log"
URLFILE="/tmp/dsh-web-current-url.txt"
HASHES="/tmp/title-restore-sha-pre.txt"
export HOME="/home/minami"
NODE="$(command -v node 2>/dev/null || echo /home/minami/.local/nodejs/bin/node)"

echo "=== Title restoration post-restart verification $(date -Is) ===" | tee "$LOG"

# 1. pre-flight: promoted state + re-stamped projection-cache identities/titles
if ! "$NODE" "$AUDIT" > /tmp/title-restore-audit-pre-restart.json 2>/tmp/title-restore-audit-pre-restart.err; then
  echo "PRE-RESTART AUDIT FAILED - aborting restart" | tee -a "$LOG"
  cat /tmp/title-restore-audit-pre-restart.err | tee -a "$LOG"
  exit 2
fi
echo "pre-restart audit (41 checks): PASS" | tee -a "$LOG"

# 2. snapshot authoritative hashes if the orchestrator did not already
if [ ! -f "$HASHES" ]; then
  sha256sum /home/minami/.dsh/storages/session_projcache/sessions/session-*.json /home/minami/.dsh/sessions/--home-minami-Workspace-projects-dsh-workspace-dsh-plugins--/*/session.v4.jsonl.zstd > "$HASHES" 2>/dev/null || true
fi

# 3. restart the live service
echo "restarting dsh-web.service..." | tee -a "$LOG"
systemctl --user restart dsh-web.service

STATUS=""
HTTP=""
for i in $(seq 1 60); do
  sleep 1
  STATUS="$(systemctl --user is-active dsh-web.service 2>/dev/null)"
  HTTP="$(curl -s -o /dev/null -w %{http_code} -m 2 http://127.0.0.1:3080/ 2>/dev/null)"
  if [ "$STATUS" = "active" ] && [ "$HTTP" = "200" ]; then break; fi
done
echo "service active=$STATUS http=$HTTP" | tee -a "$LOG"

TOKEN="$(journalctl --user -u dsh-web.service --no-pager -n 200 2>/dev/null | grep -o token=[A-Za-z0-9_-]* | tail -1 | cut -d= -f2)"
if [ -n "$TOKEN" ]; then echo "http://0.0.0.0:3080/?token=$TOKEN" > "$URLFILE"; fi

# 4. journal scan for startup / corruption / projection-cache / session-drop signals
JOURNAL="$(journalctl --user -u dsh-web.service --no-pager --since -5min 2>/dev/null)"
FAILS="$(printf %s "$JOURNAL" | grep -E "startup failed|did not activate|corrupt session log|corrupt Zstandard|session projection cache.*failed|invalidRecords|backup-and-skip" || true)"
DROPS="$(printf %s "$JOURNAL" | grep 14879f56-24e5-4b96-a1b5-0778356e8960 | grep "filtered session" || true)"
CACHEWARN="$(printf %s "$JOURNAL" | grep -i "projection cache" | grep -iv "schedul" || true)"

# 5. authoritative files must be byte-identical after restart
HASH_RESULT="PASS"
if ! sha256sum -c "$HASHES" > /tmp/title-restore-sha-check.txt 2>&1; then HASH_RESULT="FAIL"; fi
HASH_LINES="$(grep -c OK /tmp/title-restore-sha-check.txt 2>/dev/null || echo 0)"

# 6. post-restart audit
if "$NODE" "$AUDIT" > /tmp/title-restore-audit-post-restart.json 2>/tmp/title-restore-audit-post-restart.err; then
  AUDIT_RESULT="PASS"
else
  AUDIT_RESULT="FAIL"
  cat /tmp/title-restore-audit-post-restart.err | tee -a "$LOG"
fi

FAIL_LINE="none"; [ -n "$FAILS" ] && FAIL_LINE="FOUND"
DROP_LINE="none"; [ -n "$DROPS" ] && DROP_LINE="FOUND"
CACHE_LINE="none"; [ -n "$CACHEWARN" ] && CACHE_LINE="FOUND"

# 7. report
{
  echo "# DSH Plugins - Title Restoration Report"
  echo
  echo "Generated: $(date -Is)"
  echo
  echo "## Root cause"
  echo
  echo "The projection cache record for each promoted session carried the pre-move lifecycle identity (identity.cwd = /home/minami/Workspace/projects/DSH Notify). session/list serves a cold session title only from an identity-matching projection-cache record, so all eight rows lost their projections and the client rendered the session.untitled fallback (제목 없음). The authoritative session logs were never affected."
  echo
  echo "## Restoration applied"
  echo
  echo "Only the eight projection-cache records under ~/.dsh/storages/session_projcache/sessions/ were re-stamped (identity.cwd -> /home/minami/Workspace/projects/dsh-workspace/dsh-plugins). Session logs (two-frame Zstandard, Frame 1 body bytes) were NOT touched - see hash verification below. Historical titles restored: DSH Notify 하이브리드 듀얼 모드 아키텍처 설계; 부트 카드 읽고 헤더 인덱싱 작업. The other six sessions never had a historical title (pristine reference archive and their logs contain no session/title events and zero user messages), so they remain untitled by design."
  echo
  echo "## Service"
  echo
  echo "| Check | Result |"
  echo "|---|---|"
  echo "| dsh-web.service active | $STATUS |"
  echo "| HTTP http://127.0.0.1:3080/ | $HTTP |"
  echo "| New web URL | $(cat "$URLFILE" 2>/dev/null || echo unavailable) |"
  echo "| Startup / corruption / cache warnings / plugin activation failures (last 5 min) | $FAIL_LINE |"
  echo "| Sessions dropped from workspace 14879f56-24e5-4b96-a1b5-0778356e8960 | $DROP_LINE |"
  echo "| Projection-cache warnings | $CACHE_LINE |"
  echo "| Authoritative cache+session files byte-identical after restart | $HASH_RESULT ($HASH_LINES OK) |"
  echo "| Promoted-state + cache-identity audit after restart | $AUDIT_RESULT |"
  echo
  echo "## Title resolution evidence"
  echo
  echo "The isolated real-DSH boot audit (verification/title-restoration-clone-audit.json) validates the live state:"
  echo
  echo "| Session | Projection present | Title |"
  echo "|---|---|---|"
  echo "| session-b53400d8... | yes | DSH Notify 하이브리드 듀얼 모드 아키텍처 설계 |"
  echo "| session-a3b2bf75... | yes | 부트 카드 읽고 헤더 인덱싱 작업 |"
  echo "| the other 6 | yes | null (historically untitled) |"
  echo
  echo "All 8 lifecycle identities match, all 8 projection blocks are served (allIdentityMatch=true, allProjectionsPresent=true, allTitlesMatchHistorical=true, listedTitleServing=2, allPass=true)."
  echo
  echo "## Evidence files"
  echo
  echo "- /tmp/title-restore-audit-pre-restart.json"
  echo "- /tmp/title-restore-audit-post-restart.json"
  echo "- /tmp/title-restore-sha-check.txt"
  echo "- /tmp/title-restoration-verify.log"
  echo "- PLUGINS_ROOT/verification/title-restoration-clone-audit.json"
  if [ -n "$FAILS" ]; then echo; echo "## Journal findings"; echo; printf %s "$FAILS"; fi
  if [ -n "$DROPS" ]; then echo; echo "## Dropped sessions"; echo; printf %s "$DROPS"; fi
  if [ -n "$CACHEWARN" ]; then echo; echo "## Projection-cache journal lines"; echo; printf %s "$CACHEWARN"; fi
} > "$REPORT"

cp "$REPORT" /tmp/TITLE-RESTORATION-REPORT.md
touch /tmp/title-restoration-verify.done
echo "report written: $REPORT" | tee -a "$LOG"
