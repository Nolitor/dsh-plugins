#!/usr/bin/env bash
# Detached restart + verification for the 3-session transfer (기본 작업공간 -> DSH Plugins).
# The agent runs inside dsh-web.service, so the restart is scheduled externally.
set -u

PLUGINS_ROOT="/home/minami/Workspace/projects/dsh-workspace/dsh-plugins"
AUDIT="$PLUGINS_ROOT/scripts/audit-promoted-state.mjs"
REPORT="$PLUGINS_ROOT/SESSION-TRANSFER-REPORT.md"
LOG="/tmp/session-transfer-verify.log"
URLFILE="/tmp/dsh-web-current-url.txt"
HASHES="/tmp/session-transfer-sha-pre.txt"
export HOME="/home/minami"
NODE="$(command -v node 2>/dev/null || echo /home/minami/.local/nodejs/bin/node)"

echo "=== Session transfer post-restart verification $(date -Is) ===" | tee "$LOG"

if ! "$NODE" "$AUDIT" > /tmp/session-transfer-audit-pre-restart.json 2>/tmp/session-transfer-audit-pre-restart.err; then
  echo "PRE-RESTART AUDIT FAILED - aborting restart" | tee -a "$LOG"
  cat /tmp/session-transfer-audit-pre-restart.err | tee -a "$LOG"
  exit 2
fi
echo "pre-restart audit (47 checks): PASS" | tee -a "$LOG"

sha256sum /home/minami/.dsh/storages/session_projcache/sessions/session-ebc6d16e-e21f-42a9-a181-817815451b45.json /home/minami/.dsh/storages/session_projcache/sessions/session-281956f8-db78-4718-ad65-1f405053248d.json /home/minami/.dsh/storages/session_projcache/sessions/session-9bde4597-b4ea-4b2e-a7a1-a92a676e726d.json /home/minami/.dsh/sessions/--home-minami-Workspace-projects-dsh-workspace-dsh-plugins--/session-ebc6d16e-e21f-42a9-a181-817815451b45/session.v4.jsonl.zstd /home/minami/.dsh/sessions/--home-minami-Workspace-projects-dsh-workspace-dsh-plugins--/session-281956f8-db78-4718-ad65-1f405053248d/session.v4.jsonl.zstd /home/minami/.dsh/sessions/--home-minami-Workspace-projects-dsh-workspace-dsh-plugins--/session-9bde4597-b4ea-4b2e-a7a1-a92a676e726d/session.v4.jsonl.zstd > "$HASHES"

echo "restarting dsh-web.service..." | tee -a "$LOG"
systemctl --user restart dsh-web.service

STATUS=""; HTTP=""
for i in $(seq 1 60); do
  sleep 1
  STATUS="$(systemctl --user is-active dsh-web.service 2>/dev/null)"
  HTTP="$(curl -s -o /dev/null -w %{http_code} -m 2 http://127.0.0.1:3080/ 2>/dev/null)"
  if [ "$STATUS" = "active" ] && [ "$HTTP" = "200" ]; then break; fi
done
echo "service active=$STATUS http=$HTTP" | tee -a "$LOG"

TOKEN="$(journalctl --user -u dsh-web.service --no-pager -n 200 2>/dev/null | grep -o token=[A-Za-z0-9_-]* | tail -1 | cut -d= -f2)"
if [ -n "$TOKEN" ]; then echo "http://0.0.0.0:3080/?token=$TOKEN" > "$URLFILE"; fi

JOURNAL="$(journalctl --user -u dsh-web.service --no-pager --since -5min 2>/dev/null)"
FAILS="$(printf %s "$JOURNAL" | grep -E "startup failed|did not activate|corrupt session log|corrupt Zstandard|session projection cache.*failed|backup-and-skip" || true)"
DROPS="$(printf %s "$JOURNAL" | grep -E "14879f56-24e5-4b96-a1b5-0778356e8960|3f7ba34a-7549-4400-9bc5-3b8179415f25" | grep "filtered session" || true)"
CACHEWARN="$(printf %s "$JOURNAL" | grep -i "projection cache" | grep -iv "schedul" || true)"

HASH_RESULT="PASS"
if ! sha256sum -c "$HASHES" > /tmp/session-transfer-sha-check.txt 2>&1; then HASH_RESULT="FAIL"; fi
HASH_LINES="$(grep -c OK /tmp/session-transfer-sha-check.txt 2>/dev/null || echo 0)"

if "$NODE" "$AUDIT" > /tmp/session-transfer-audit-post-restart.json 2>/tmp/session-transfer-audit-post-restart.err; then
  AUDIT_RESULT="PASS"
else
  AUDIT_RESULT="FAIL"
  cat /tmp/session-transfer-audit-post-restart.err | tee -a "$LOG"
fi

FAIL_LINE="none"; [ -n "$FAILS" ] && FAIL_LINE="FOUND"
DROP_LINE="none"; [ -n "$DROPS" ] && DROP_LINE="FOUND"
CACHE_LINE="none"; [ -n "$CACHEWARN" ] && CACHE_LINE="FOUND"

{
  echo "# DSH Plugins - Session Transfer Report"
  echo
  echo "Generated: $(date -Is)"
  echo
  echo "## Transferred sessions (기본 작업공간 -> DSH Plugins)"
  echo
  echo "| Session ID | Title | Events |"
  echo "|---|---|---|"
  echo "| session-ebc6d16e-e21f-42a9-a181-817815451b45 | Fix Korean font persistence issue | 1448 |"
  echo "| session-281956f8-db78-4718-ad65-1f405053248d | DSH 한글 로컬라이징 검토 | 3407 |"
  echo "| session-9bde4597-b4ea-4b2e-a7a1-a92a676e726d | 현재 프로젝트(기본 작업공간 | 3249 |"
  echo
  echo "## Changes"
  echo
  echo "- Session directories moved to ~/.dsh/sessions/--home-minami-Workspace-projects-dsh-workspace-dsh-plugins--/ and re-encoded as compliant two-frame Zstandard logs (Frame 1 header cwd only; body byte-identical)."
  echo "- The three session_projcache records had identity.cwd re-stamped to the DSH Plugins path (titles resolve again)."
  echo "- workspace.json: 기본 작업공간 15 -> 12 sessions; DSH Plugins 8 -> 11 sessions (3 appended)."
  echo "- No session log was left in the old project directory; no other default-workspace session was touched."
  echo
  echo "## Service"
  echo
  echo "| Check | Result |"
  echo "|---|---|"
  echo "| dsh-web.service active | $STATUS |"
  echo "| HTTP http://127.0.0.1:3080/ | $HTTP |"
  echo "| New web URL | $(cat "$URLFILE" 2>/dev/null || echo unavailable) |"
  echo "| Startup / corruption / cache warnings / plugin activation failures (last 5 min) | $FAIL_LINE |"
  echo "| Sessions dropped from the two workspaces | $DROP_LINE |"
  echo "| Projection-cache warnings | $CACHE_LINE |"
  echo "| Authoritative session logs + cache records byte-identical after restart | $HASH_RESULT ($HASH_LINES OK) |"
  echo "| Promoted-state audit (47 checks) after restart | $AUDIT_RESULT |"
  echo
  echo "## Isolated boot verification (pre-restart, same state)"
  echo
  echo "| Check | Result |"
  echo "|---|---|"
  echo "| Workspace title / path | DSH Plugins |"
  echo "| DSH Plugins session count | 11 |"
  echo "| 기본 작업공간 session count | 12 |"
  echo "| 3 sessions in DSH Plugins, absent from default | yes |"
  echo "| All headers on the new cwd (no assertStoredIdentity drops) | yes |"
  echo "| All projection blocks served | yes |"
  echo "| Historical titles resolved | 5 titled (2 DSH Notify + 3 transferred) |"
  echo "| Transferred logs replay through production persistence | 1448 / 3407 / 3249 events |"
  echo
  echo "Evidence: verification/session-transfer-clone-audit.json"
  echo
  echo "## Evidence files"
  echo
  echo "- /tmp/session-transfer-audit-pre-restart.json"
  echo "- /tmp/session-transfer-audit-post-restart.json"
  echo "- /tmp/session-transfer-sha-check.txt"
  echo "- /tmp/session-transfer-verify.log"
  echo "- PLUGINS_ROOT/verification/session-transfer-clone-audit.json"
  if [ -n "$FAILS" ]; then echo; echo "## Journal findings"; echo; printf %s "$FAILS"; fi
  if [ -n "$DROPS" ]; then echo; echo "## Dropped sessions"; echo; printf %s "$DROPS"; fi
  if [ -n "$CACHEWARN" ]; then echo; echo "## Projection-cache journal lines"; echo; printf %s "$CACHEWARN"; fi
} > "$REPORT"

cp "$REPORT" /tmp/SESSION-TRANSFER-REPORT.md
touch /tmp/session-transfer-verify.done
echo "report written: $REPORT" | tee -a "$LOG"
