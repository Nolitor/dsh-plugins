#!/usr/bin/env bash
# Install or verify @nolit/dsh-korean-locale in the live DSH web profile.
# dsh-isolation: live-intentional (owner-run install; requires DSH_LIVE_INSTALL=1)
# Run this OUTSIDE the read-only agent sandbox, as the DSH service user.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="$ROOT/dsh-korean-locale"
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
PROFILE_PKG="$PROFILE_DIR/package.json"
NAME='@nolit/dsh-korean-locale'
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$DSH_HOME_DIR/quarantine-backups/korean-locale-install-$STAMP"

command -v dsh >/dev/null || { echo "dsh not found in PATH" >&2; exit 1; }
[[ -f "$PROFILE_PKG" ]] || { echo "missing profile: $PROFILE_PKG" >&2; exit 1; }
[[ -f "$PLUGIN/package.json" ]] || { echo "missing plugin: $PLUGIN" >&2; exit 1; }

if node - "$PROFILE_PKG" "$NAME" "$PLUGIN" <<'NODE'
const fs = require('fs')
const [file, name, plugin] = process.argv.slice(2)
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
const spec = pkg.dependencies?.[name]
const selected = pkg.dsh?.profile?.bundles?.includes(name)
const linked = typeof spec === 'string' && spec === `link:${plugin}`
if (linked && selected) {
  console.log(`${name} is already linked and selected`)
  process.exit(0)
}
process.exit(1)
NODE
then
  echo "no profile mutation needed; restart only if the running Host predates the current bundle"
  exit 0
fi

mkdir -p "$BACKUP_DIR"
cp -a "$PROFILE_PKG" "$BACKUP_DIR/package.json"
[[ -f "$PROFILE_DIR/pnpm-lock.yaml" ]] && cp -a "$PROFILE_DIR/pnpm-lock.yaml" "$BACKUP_DIR/pnpm-lock.yaml"
[[ -f "$PROFILE_DIR/cordis.patch.yml" ]] && cp -a "$PROFILE_DIR/cordis.patch.yml" "$BACKUP_DIR/cordis.patch.yml"
echo "backup: $BACKUP_DIR"

dsh plugin --profile web add "link:$PLUGIN"

node - "$PROFILE_PKG" "$NAME" <<'NODE'
const fs = require('fs')
const [file, name] = process.argv.slice(2)
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
if (!pkg.dependencies?.[name]) throw new Error(`dependency not recorded: ${name}`)
if (!pkg.dsh?.profile?.bundles?.includes(name)) throw new Error(`bundle not selected: ${name}`)
console.log(`profile now includes ${name}`)
NODE

cat <<MSG

Installed and selected. Restart the web service:
  systemctl --user restart dsh-web.service
Then choose Settings -> General -> Language -> 한국어.

Rollback:
  cp -a "$BACKUP_DIR/package.json" "$PROFILE_PKG"
  [[ -f "$BACKUP_DIR/pnpm-lock.yaml" ]] && cp -a "$BACKUP_DIR/pnpm-lock.yaml" "$PROFILE_DIR/pnpm-lock.yaml"
  systemctl --user restart dsh-web.service
MSG
