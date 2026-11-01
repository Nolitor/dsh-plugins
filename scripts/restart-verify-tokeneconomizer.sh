#!/usr/bin/env bash
# Restart window for activating @nolit/dsh-tokeneconomizer 0.2.0, bounded to 120 seconds.
#
# What it does, in order, and why each step is here:
#   1. records the pre-restart state (service start time, session-search.db, journal cursor)
#   2. restarts the Web service — the running process holds the pre-0.2.0 module in memory
#   3. polls the GUI until it answers, within the remaining budget
#   4. checks the four things a restart can prove: the unit is active, the GUI serves, no plugin
#      row failed to activate, and the FTS index file exists (which only happens when the profile
#      patch row was applied)
#
# It cannot prove recall works — that needs a real turn. It reports what it cannot prove instead
# of implying it checked.
#
# Usage: scripts/restart-verify-tokeneconomizer.sh [--dry-run]
set -u

SERVICE=dsh-web.service
URL=https://nolitor/
DB="$HOME/.dsh/session-search.db"
LOG=/tmp/te-restart-verify.log
BUDGET=120
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

START=$(date +%s)
now() { date +%s; }
elapsed() { echo $(( $(now) - START )); }

say() { printf '%s\n' "$*" | tee -a "$LOG"; }
: >"$LOG"

say "=== TokenEconomizer 0.2.0 restart window · $(date -Is) · budget ${BUDGET}s ==="

# 1. pre-restart facts
PID_BEFORE=$(systemctl --user show -p MainPID --value "$SERVICE" 2>/dev/null || echo 0)
SINCE=$(systemctl --user show -p ActiveEnterTimestamp --value "$SERVICE" 2>/dev/null || echo '?')
DB_BEFORE=$([ -f "$DB" ] && stat -c %s "$DB" || echo 'absent')
say "pre: pid=$PID_BEFORE started=$SINCE search-db=$DB_BEFORE"

if [ "$DRY" = 1 ]; then
  say "dry-run: nothing restarted"
  exit 0
fi

# 2. restart
say "restart: systemctl --user restart $SERVICE"
if ! systemctl --user restart "$SERVICE"; then
  say "FAILED: restart command returned non-zero"
  exit 2
fi

# 3. wait for the GUI, bounded by the budget
CODE=000
while [ "$(elapsed)" -lt 90 ]; do
  CODE=$(curl -k -s -o /dev/null -w '%{http_code}' --max-time 3 "$URL" 2>/dev/null || echo 000)
  [ "$CODE" = "200" ] && break
  sleep 2
done
say "poll: http=$CODE after $(elapsed)s"

# 4. post-restart checks
ACTIVE=$(systemctl --user is-active "$SERVICE" 2>/dev/null || echo inactive)
PID_AFTER=$(systemctl --user show -p MainPID --value "$SERVICE" 2>/dev/null || echo 0)
DB_AFTER=$([ -f "$DB" ] && stat -c %s "$DB" || echo 'absent')

# A row that could not activate, a load error, or an unknown config key is fatal for this plugin.
BAD=$(journalctl --user -u "$SERVICE" --since "@$START" --no-pager 2>/dev/null \
  | grep -Ei 'did not activate|failed to (load|activate)|unknown setting|tokeneconomizer.*(error|throw)|must be (below|positive)' \
  | head -5)
BAD_COUNT=$(printf '%s' "$BAD" | grep -c . || true)

TE_LINES=$(journalctl --user -u "$SERVICE" --since "@$START" --no-pager 2>/dev/null \
  | grep -ci 'tokeneconomizer' || true)

say "post: active=$ACTIVE pid=$PID_AFTER search-db=$DB_AFTER errors=$BAD_COUNT te-lines=$TE_LINES"
[ -n "$BAD" ] && say "$BAD"

# 5. verdict
FAIL=0
[ "$ACTIVE" = "active" ] || { say "FAIL: unit not active"; FAIL=1; }
[ "$CODE" = "200" ] || { say "FAIL: GUI did not answer 200"; FAIL=1; }
[ "$BAD_COUNT" = "0" ] || { say "FAIL: activation errors in the journal"; FAIL=1; }
[ "$PID_AFTER" != "0" ] && [ "$PID_AFTER" != "$PID_BEFORE" ] || { say "FAIL: PID did not change"; FAIL=1; }
DB_NOTE="created"
[ "$DB_AFTER" = "absent" ] && { DB_NOTE="absent — the profile patch row did not take effect"; FAIL=1; }
[ "$DB_AFTER" != "absent" ] && [ "$DB_AFTER" = "$DB_BEFORE" ] && DB_NOTE="unchanged size ($DB_AFTER) — index built earlier"

cat <<EOF | tee -a "$LOG"

{
  "verdict": "$([ "$FAIL" = 0 ] && echo PASS || echo FAIL)",
  "elapsed_s": $(elapsed),
  "budget_s": $BUDGET,
  "unit": { "name": "$SERVICE", "active": "$ACTIVE", "pid_before": $PID_BEFORE, "pid_after": $PID_AFTER },
  "gui": { "url": "$URL", "http": $CODE },
  "activation_errors": $BAD_COUNT,
  "log_lines_mentioning_plugin": $TE_LINES,
  "fts_index": { "path": "$DB", "before": "$DB_BEFORE", "after": "$DB_AFTER", "note": "$DB_NOTE" },
  "not_proven_by_this_script": [
    "prior-session recall returns hits (needs a real turn)",
    "the watchdog warns instead of cancelling (needs a long reasoning turn)",
    "mode=observe injects nothing (needs a turn with mode switched)"
  ]
}
EOF

say "=== done in $(elapsed)s (budget ${BUDGET}s) ==="
exit "$FAIL"
