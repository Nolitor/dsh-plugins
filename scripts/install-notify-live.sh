#!/usr/bin/env bash
# dsh-isolation: live-intentional (owner-run install; requires DSH_LIVE_INSTALL=1)
# Install @nolit/dsh-notify into the live DSH web profile.
# Run this OUTSIDE the read-only agent sandbox, as the DSH service user.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="$ROOT/dsh-notify"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
# dsh-isolation: live-intentional — this script exists to write the live profile.
# It refuses to touch the live home unless the owner confirms with DSH_LIVE_INSTALL=1
# (or points DSH_HOME at a non-live tree). See docs/DSH-HOME-ISOLATION.md.
LIVE_HOME="$(cd "$HOME" && pwd -P)/.dsh"
TARGET_HOME="$(cd "$DSH_HOME_DIR" 2>/dev/null && pwd -P || true)"
if [ -n "$TARGET_HOME" ] && [ "$TARGET_HOME" = "$LIVE_HOME" ] && [ "${DSH_LIVE_INSTALL:-0}" != "1" ]; then
  echo "REFUSING: this would write the live DSH home: $TARGET_HOME" >&2
  echo "Review docs/DSH-HOME-ISOLATION.md, then re-run with DSH_LIVE_INSTALL=1." >&2
  exit 3
fi
if [ -n "$TARGET_HOME" ] && [ "$TARGET_HOME" = "$LIVE_HOME" ]; then
  echo "LIVE WRITE: $TARGET_HOME (confirmed with DSH_LIVE_INSTALL=1)" >&2
fi
PROFILE_DIR="$DSH_HOME_DIR/profiles/web"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$DSH_HOME_DIR/quarantine-backups/notify-install-$STAMP"

command -v dsh >/dev/null || { echo "dsh not found in PATH" >&2; exit 1; }
[[ -f "$PROFILE_DIR/package.json" ]] || { echo "missing profile: $PROFILE_DIR" >&2; exit 1; }
[[ -f "$PLUGIN/package.json" ]] || { echo "missing plugin: $PLUGIN" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
cp -a "$PROFILE_DIR/package.json" "$BACKUP_DIR/package.json"
[[ -f "$PROFILE_DIR/pnpm-lock.yaml" ]] && cp -a "$PROFILE_DIR/pnpm-lock.yaml" "$BACKUP_DIR/pnpm-lock.yaml"
[[ -f "$PROFILE_DIR/cordis.patch.yml" ]] && cp -a "$PROFILE_DIR/cordis.patch.yml" "$BACKUP_DIR/cordis.patch.yml"
echo "backup: $BACKUP_DIR"

dsh plugin --profile web add "link:$PLUGIN"

node - "$PROFILE_DIR/package.json" <<'NODE'
const fs = require('fs')
const file = process.argv[2]
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
const name = '@nolit/dsh-notify'
if (!pkg.dependencies?.[name]) throw new Error(`dependency not recorded: ${name}`)
if (!pkg.dsh?.profile?.bundles?.includes(name)) throw new Error(`bundle not selected: ${name}`)
console.log(`profile now includes ${name}`)
NODE

cat <<MSG

Installed and selected. Restart the web service to load the Host row:
  systemctl --user restart dsh-web.service
Then reopen the token URL printed by:
  journalctl --user -u dsh-web.service -n 30 --no-pager

To roll back:
  cp -a "$BACKUP_DIR/package.json" "$PROFILE_DIR/package.json"
  [[ -f "$BACKUP_DIR/pnpm-lock.yaml" ]] && cp -a "$BACKUP_DIR/pnpm-lock.yaml" "$PROFILE_DIR/pnpm-lock.yaml"
  systemctl --user restart dsh-web.service
MSG
