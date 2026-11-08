#!/usr/bin/env bash
# Verify that the serving dsh-web process loaded the current dsh-antigravity source.
# Read-only: reads systemd state and the plugin's load beacon. Never restarts, never calls a model.
# Exit codes: 0 = PASS, 1 = STALE/PENDING, 2 = UNDECIDED.
set -u
cd "$(dirname "$0")/.." || exit 2

PLUGIN_DIR="dsh-custom-router/vendor/antigravity"
BEACON=/tmp/antigravity-boot.jsonl
UNIT=dsh-web.service

pid="$(systemctl --user show -p MainPID --value "$UNIT" 2>/dev/null)"
state="$(systemctl --user show -p ActiveState --value "$UNIT" 2>/dev/null)"
disk="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).version)' "$PLUGIN_DIR/package.json")"

echo "time     : $(date '+%Y-%m-%dT%H:%M:%S%z')"
echo "unit     : $UNIT ($state)"
echo "pid      : ${pid:-none}"
echo "source   : $disk"

if [ -z "${pid:-}" ] || [ "${pid:-}" = "0" ]; then
  echo "verdict  : FAIL - unit is not running"
  exit 1
fi

line="$(node -e '
const fs = require("node:fs")
const pid = Number(process.argv[1])
const path = process.argv[2]
if (!fs.existsSync(path)) process.exit(0)
const rows = fs.readFileSync(path, "utf8").trim().split("\n")
  .map((line) => { try { return JSON.parse(line) } catch { return null } })
  .filter((row) => row && row.pid === pid)
if (rows.length === 0) process.exit(0)
const last = rows.reduce((a, b) => (a.at > b.at ? a : b))
process.stdout.write(last.version + " at=" + last.at)
' "$pid" "$BEACON")"

echo "beacon   : ${line:-none}"
version="${line%% *}"

if [ -n "${version:-}" ] && [ "${version:-}" = "$disk" ]; then
  echo "verdict  : PASS - serving pid $pid loaded $disk"
  exit 0
fi
if [ -n "${version:-}" ]; then
  echo "verdict  : STALE - pid $pid loaded $version, source is $disk"
  exit 1
fi
echo "verdict  : PENDING - pid $pid wrote no load beacon yet"
exit 1
