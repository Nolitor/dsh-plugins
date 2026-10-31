#!/usr/bin/env bash
# Verify that a dsh-web restart actually loaded dsh-opencode-v2@0.0.1.
#
# Read-only: reads systemd state, the source tree and the plugin's load beacon.
# It never restarts anything and never calls a model.
#
# Usage:
#   scripts/verify-opencode-v2-restart.sh          # verdict for the current process
#   scripts/verify-opencode-v2-restart.sh --wait 300
#       record the current pid, then wait up to 300s for it to change; run this in
#       one terminal, restart in another, read the "after" block here.
#
# Exit codes: 0 = serving build matches the source tree, 1 = stale/pending, 2 = undecided.
set -u
cd "$(dirname "$0")/.." || exit 2

PLUGIN_DIR="dsh-opencode-v2"
BEACON=/tmp/opencode-v2-boot.jsonl
UNIT=dsh-web.service
WAIT=0
[ "${1:-}" = "--wait" ] && WAIT="${2:-300}"

say() { printf '%s\n' "$*"; }
pid_of() { systemctl --user show -p MainPID --value "$UNIT" 2>/dev/null; }
start_of() { systemctl --user show -p ExecMainStartTimestamp --value "$UNIT" 2>/dev/null; }
state_of() { systemctl --user show -p ActiveState --value "$UNIT" 2>/dev/null; }
disk_version() { node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).version)' "$PLUGIN_DIR/package.json"; }

# "epoch newest-path" for the shipped source; integer seconds so bash -lt works.
newest_source() {
  find "$PLUGIN_DIR/lib" "$PLUGIN_DIR/package.json" -type f -printf '%Ts %p\n' 2>/dev/null | sort -n | tail -1
}

# Beacon summary for one pid: "<version> events={...} last=<iso>" (empty if none).
beacon_for() {
  [ -f "$BEACON" ] || return 0
  node -e '
    const fs = require("node:fs")
    const pid = Number(process.argv[1])
    let rows = []
    try {
      rows = fs.readFileSync(process.argv[2], "utf8").trim().split("\n")
        .map((line) => { try { return JSON.parse(line) } catch { return null } })
        .filter((row) => row && row.pid === pid)
    } catch {}
    if (rows.length > 0) {
      const last = rows.reduce((a, b) => (a.at > b.at ? a : b))
      const events = {}
      for (const row of rows) events[row.event] = (events[row.event] || 0) + 1
      console.log(last.version + " events=" + JSON.stringify(events) + " last=" + last.at)
    }
  ' "$1" "$BEACON"
}

# Pids other than the serving one (the test suite writes beacons too).
other_beacon_pids() {
  [ -f "$BEACON" ] || { echo "no beacon file"; return 0; }
  node -e '
    const fs = require("node:fs")
    const serving = Number(process.argv[2] || 0)
    let rows = []
    try {
      rows = fs.readFileSync(process.argv[1], "utf8").trim().split("\n")
        .map((line) => { try { return JSON.parse(line) } catch { return null } })
        .filter(Boolean)
    } catch {}
    const seen = new Map()
    for (const row of rows) seen.set(row.pid, row.version)
    const listed = [...seen].filter(([pid]) => pid !== serving).slice(-4).map(([pid, version]) => pid + "=" + version)
    console.log(listed.length ? listed.join(", ") + " (other processes that loaded the plugin: test runs or failed boot attempts, not the serving process)" : "none")
  ' "$BEACON" "${1:-0}"
}

report() {
  local pid state start disk newest start_epoch newest_epoch beacon_line beacon_version
  pid="$(pid_of)"; state="$(state_of)"; start="$(start_of)"
  disk="$(disk_version)"
  newest="$(newest_source)"
  say "time                 : $(date '+%Y-%m-%dT%H:%M:%S%z')"
  say "unit                 : $UNIT ($state)"
  say "serving pid          : ${pid:-none}"
  say "process start        : ${start:-unknown}"
  say "source version       : $disk"
  say "newest source file   : $newest"
  if [ -n "${pid:-}" ] && [ "$pid" != "0" ]; then
    say "beacon(pid=$pid)     : $(beacon_for "$pid")"
  fi
  say "other beacon pids    : $(other_beacon_pids "${pid:-0}")"

  if [ -z "${pid:-}" ] || [ "$pid" = "0" ]; then
    say "verdict              : FAIL - unit is not running"
    return 1
  fi
  beacon_line="$(beacon_for "$pid")"
  beacon_version="${beacon_line%% *}"
  start_epoch="$(date -d "$start" +%s 2>/dev/null || echo 0)"
  newest_epoch="${newest%% *}"
  newest_epoch="${newest_epoch%%.*}"
  if [ -n "$beacon_version" ] && [ "$beacon_version" = "$disk" ]; then
    say "verdict              : PASS - serving pid $pid loaded $disk"
    return 0
  fi
  if [ -n "$beacon_version" ] && [ "$beacon_version" != "$disk" ]; then
    say "verdict              : STALE - pid $pid loaded $beacon_version, source is $disk"
    say "action               : systemctl --user restart $UNIT"
    return 1
  fi
  if [ "${start_epoch:-0}" -lt "${newest_epoch:-0}" ] 2>/dev/null; then
    say "verdict              : PENDING - process predates the source edit and has no beacon yet"
    say "action               : systemctl --user restart $UNIT"
    return 1
  fi
  say "verdict              : UNDECIDED - process is newer than the source but wrote no beacon"
  say "note                 : check whether the plugin row mounted (web boot verdict)"
  return 2
}

RC=0
BASELINE_PID="$(pid_of)"
say "=== before ==="
report || RC=$?

if [ "$WAIT" -gt 0 ]; then
  say ""
  say "=== waiting up to ${WAIT}s for MainPID to leave ${BASELINE_PID:-none} ==="
  waited=0
  while [ "$waited" -lt "$WAIT" ]; do
    sleep 2; waited=$((waited + 2))
    now="$(pid_of)"
    if [ -n "$now" ] && [ "$now" != "0" ] && [ "$now" != "$BASELINE_PID" ]; then
      say "pid changed: ${BASELINE_PID:-none} -> $now after ${waited}s; waiting for its load beacon"
      settle=0
      while [ "$settle" -lt 20 ]; do
        sleep 2; settle=$((settle + 2))
        [ -n "$(beacon_for "$now")" ] && break
      done
      break
    fi
  done
  say ""
  say "=== after ==="
  report || RC=$?
fi

exit "$RC"
