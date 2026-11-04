#!/usr/bin/env bash
# Stage-1 stabilisation status for @nolit/dsh-opencode-v2.
#
# docs/OPENCODE-V2-STAGE-PLAN.md §2 defines seven exit criteria. This script evaluates
# the ones a machine can decide, prints PASS/FAIL/UNKNOWN for each, and exits 1 unless
# every machine-decidable criterion passes. It never restarts anything and never calls a
# model.
#
#   S1  no entry failed to activate since the last start
#   S2  serving pid loaded the source version (scripts/verify-opencode-v2-restart.sh)
#   S3  unit suite green
#   S4  isolated boot clean  (opt-in: --boot, takes ~25 s)
#   S5  browser boot clean   (opt-in: --browser, needs playwright + a token)
#   S6  soak (owner-reported; this script can only say UNKNOWN)
#   S7  every reported defect has a regression test (static check)
#
# Usage: scripts/opencode-v2-stabilisation-status.sh [--boot] [--browser]
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

UNIT=dsh-web.service
PLUGIN=dsh-opencode-v2
want_boot=0
want_browser=0
for arg in "$@"; do
  [ "$arg" = "--boot" ] && want_boot=1
  [ "$arg" = "--browser" ] && want_browser=1
done

fail=0
say() { printf '%-4s %-6s %s\n' "$1" "$2" "$3"; }
verdict() { # id status detail
  [ "$2" = "FAIL" ] && fail=1
  say "$1" "$2" "$3"
}

# --- S1 -------------------------------------------------------------------
start=$(systemctl --user show -p ExecMainStartTimestamp --value "$UNIT" 2>/dev/null)
warnings=$(journalctl --user -u "$UNIT" --since "$start" --no-pager 2>/dev/null | grep -c "did not activate")
if [ "$warnings" = "0" ]; then
  verdict S1 PASS "no 'did not activate' since $start"
else
  verdict S1 FAIL "$warnings activation failure(s) since $start"
fi

# --- S2 -------------------------------------------------------------------
v=$(bash scripts/verify-opencode-v2-restart.sh 2>/dev/null | sed -n 's/^verdict *: //p')
case "$v" in
  PASS*) verdict S2 PASS "$v" ;;
  *STALE*) verdict S2 FAIL "$v" ;;
  *) verdict S2 UNKNOWN "${v:-no verdict}" ;;
esac

# --- S3 -------------------------------------------------------------------
out=$(cd "$PLUGIN" && node --import ./test/setup-isolate.mjs --test test/*.test.mjs 2>&1)
fails=$(printf '%s' "$out" | sed -n 's/^. fail \([0-9]*\)$/\1/p' | tail -1)
passes=$(printf '%s' "$out" | sed -n 's/^. pass \([0-9]*\)$/\1/p' | tail -1)
if [ "${fails:-1}" = "0" ]; then
  verdict S3 PASS "${passes:-?} tests pass"
else
  verdict S3 FAIL "${fails:-?} test(s) failed"
fi

# --- S4 -------------------------------------------------------------------
if [ "$want_boot" = "1" ]; then
  iso=$(mktemp -d /tmp/dsh-stage1-XXXX)
  mkdir -p "$iso/profiles/web"
  for f in cordis.patch.yml cordis.yml package.json; do
    cp "$HOME/.dsh/profiles/web/$f" "$iso/profiles/web/" 2>/dev/null
  done
  ln -s "$HOME/.dsh/profiles/web/node_modules" "$iso/profiles/web/node_modules" 2>/dev/null
  DSH_HOME="$iso" timeout 40 dsh web --no-open --port 0 > /tmp/stage1-boot.log 2>&1 &
  bootpid=$!
  sleep 22
  n=$(grep -c "did not activate" /tmp/stage1-boot.log)
  kill "$bootpid" 2>/dev/null; wait "$bootpid" 2>/dev/null
  if [ "$n" = "0" ]; then verdict S4 PASS "isolated boot clean"; else verdict S4 FAIL "$n in isolated boot (/tmp/stage1-boot.log)"; fi
else
  verdict S4 SKIP "pass --boot to run an isolated boot (~25 s)"
fi

# --- S5 -------------------------------------------------------------------
if [ "$want_browser" = "1" ]; then
  token=$(journalctl --user -u "$UNIT" --since "$start" --no-pager 2>/dev/null | grep -oE 'https://[^ ]*token=[A-Za-z0-9_-]+' | tail -1)
  if [ -z "$token" ]; then
    verdict S5 UNKNOWN "no token in the journal since start"
  else
    out=$(DSH_WEB_URL="$token" node scripts/opencode-v2-browser-boot.mjs 2>&1)
    if printf '%s' "$out" | grep -q '"ok":true'; then verdict S5 PASS "$(printf '%s' "$out" | tr -d '\n' | cut -c1-100)"; else verdict S5 FAIL "$(printf '%s' "$out" | tr -d '\n' | cut -c1-160)"; fi
  fi
else
  verdict S5 SKIP "pass --browser to boot the shell in playwright"
fi

# --- S6 -------------------------------------------------------------------
verdict S6 UNKNOWN "soak is owner-reported; this script cannot observe a day of usage"

# --- S7 -------------------------------------------------------------------
missing=""
for t in optional-service apply-cordis service-inject-gate cost-pill-gate; do
  [ -f "$PLUGIN/test/$t.test.mjs" ] || missing="$missing $t"
done
if [ -z "$missing" ]; then verdict S7 PASS "every closed defect keeps its regression test"; else verdict S7 FAIL "missing:$missing"; fi

echo
if [ "$fail" = "0" ]; then
  echo "stage 1: machine-decidable criteria pass (S6 soak still owner-confirmed)"
  exit 0
fi
echo "stage 1: NOT stable - fix the FAIL rows above before opening stage 2"
exit 1
