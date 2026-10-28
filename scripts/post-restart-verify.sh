#!/usr/bin/env bash
# Post-restart verification for the DSH Plugins physical promotion.
# Scheduled via a transient systemd user timer so the restart does not
# interrupt the agent turn that orchestrates it.
set -u

PLUGINS_ROOT="/home/minami/Workspace/projects/dsh-workspace/dsh-plugins"
AUDIT="$PLUGINS_ROOT/scripts/audit-promoted-state.mjs"
REPORT="$PLUGINS_ROOT/VERIFICATION-REPORT.md"
LOG="/tmp/post-restart-verify.log"
URLFILE="/tmp/dsh-web-current-url.txt"
export HOME="/home/minami"
NODE="$(command -v node 2>/dev/null || echo /home/minami/.local/nodejs/bin/node)"

echo "=== DSH Plugins promotion post-restart verification $(date -Is) ===" | tee "$LOG"

if ! "$NODE" "$AUDIT" > /tmp/dsh-plugins-audit-pre-restart.json 2>/tmp/dsh-plugins-audit-pre-restart.err; then
  echo "PRE-RESTART AUDIT FAILED - aborting restart" | tee -a "$LOG"
  cat /tmp/dsh-plugins-audit-pre-restart.err | tee -a "$LOG"
  exit 2
fi
echo "pre-restart offline audit: PASS" | tee -a "$LOG"

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

JOURNAL="$(journalctl --user -u dsh-web.service --no-pager --since -3min 2>/dev/null)"
FAILS="$(printf %s "$JOURNAL" | grep -E "startup failed|did not activate|corrupt session log|corrupt Zstandard" || true)"
PROMOTION_DROPS="$(printf %s "$JOURNAL" | grep 14879f56-24e5-4b96-a1b5-0778356e8960 | grep "filtered session" || true)"

if "$NODE" "$AUDIT" > /tmp/dsh-plugins-audit-post-restart.json 2>/tmp/dsh-plugins-audit-post-restart.err; then
  AUDIT_RESULT="PASS"
else
  AUDIT_RESULT="FAIL"
  cat /tmp/dsh-plugins-audit-post-restart.err | tee -a "$LOG"
fi

FAIL_LINE="none"
if [ -n "$FAILS" ]; then FAIL_LINE="FOUND"; fi
DROP_LINE="none"
if [ -n "$PROMOTION_DROPS" ]; then DROP_LINE="FOUND"; fi

{
  echo "# DSH Plugins - Promotion Verification Report"
  echo
  echo "Generated: $(date -Is)"
  echo
  echo "## Service"
  echo
  echo "| Check | Result |"
  echo "|---|---|"
  echo "| dsh-web.service active | $STATUS |"
  echo "| HTTP http://127.0.0.1:3080/ | $HTTP |"
  echo "| New web URL | $(cat "$URLFILE" 2>/dev/null || echo unavailable) |"
  echo "| Startup failures / corrupt logs / plugin activation failures (last 3 min) | $FAIL_LINE |"
  echo "| Sessions dropped from workspace 14879f56-24e5-4b96-a1b5-0778356e8960 | $DROP_LINE |"
  echo "| Promoted-state audit after restart | $AUDIT_RESULT |"
  echo
  echo "## Promotion invariants (audited)"
  echo
  echo "- Workspace 14879f56-24e5-4b96-a1b5-0778356e8960 is titled DSH Plugins at /home/minami/Workspace/projects/dsh-workspace/dsh-plugins with its 8 sessions preserved in order."
  echo "- All eight session logs are two-frame Zstandard artifacts whose Frame 1 is exactly the rewritten header line with the new cwd; generationLogPath(root, cwd, id, v4, zstd) matches the physical file."
  echo "- Plugin tracks present: dsh-korean-locale (linked into the web profile), dsh-notify, dsh-sidebar-manager, docs/."
  echo "- Korean locale profile dependency and node_modules link resolve from the new canonical path."
  echo
  echo "## Evidence files"
  echo
  echo "- /tmp/dsh-plugins-audit-pre-restart.json"
  echo "- /tmp/dsh-plugins-audit-post-restart.json"
  echo "- /tmp/post-restart-verify.log"
  echo "- journalctl --user -u dsh-web.service"
  if [ -n "$FAILS" ]; then echo; echo "## Journal findings"; echo; echo ; printf %s "$FAILS"; fi
  if [ -n "$PROMOTION_DROPS" ]; then echo; echo "## Dropped sessions"; echo; printf %s "$PROMOTION_DROPS"; fi
} > "$REPORT"

cp "$REPORT" /tmp/VERIFICATION-REPORT.md
touch /tmp/post-restart-verify.done
echo "verification report written: $REPORT" | tee -a "$LOG"
