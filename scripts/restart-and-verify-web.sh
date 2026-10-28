#!/usr/bin/env bash
# Restart the live DSH web service and show the new authenticated URL.
# Run this OUTSIDE the read-only agent sandbox, as the DSH service user.
set -euo pipefail
systemctl --user restart dsh-web.service
sleep 3
systemctl --user status dsh-web.service --no-pager -l | sed -n '1,40p'
echo '--- recent URL ---'
journalctl --user -u dsh-web.service -n 40 --no-pager | grep -E 'dsh web: http|startup|error' || true
