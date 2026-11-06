#!/usr/bin/env bash
# Publish one @nolit DSH plugin to npm, with the gates this workspace learned the hard way.
#
# Why a script instead of `npm publish` by hand
# ---------------------------------------------
# 1. Every package here is a PRERELEASE (`0.0.1-rc.N`). npm refuses a bare
#    `npm publish` for those -- measured 2026-11-06: it exits with
#    "You must specify a tag using --tag when publishing a prerelease version".
#    It also never assigns the `latest` dist-tag to a prerelease, so a consumer
#    running `npm i @nolit/dsh-notify-web` would get E404 even after publishing.
#    This script therefore always passes an explicit --tag.
#
# 2. All three packages are SCOPED (@nolit/...). A scoped package publishes
#    restricted unless publishConfig.access is "public". The market entry says
#    `"source": { "type": "npm" }`, and a restricted package cannot be installed
#    by the market, so publishing restricted is a silent failure. This script
#    passes --access public and refuses to run if publishConfig disagrees.
#
# 3. The tarball is what consumers get, not the source tree. `dsh-sidebar-manager`
#    shipped a tarball missing two imported modules and crashed with
#    ERR_MODULE_NOT_FOUND while every source-tree test was green. This script
#    runs scripts/check-npm-publishable.mjs first and refuses to publish on failure.
#
# Usage
#   scripts/publish-npm.sh <track> [--tag <name>] [--dry-run] [--yes]
#
#   <track>      dsh-notify | dsh-korean-locale | dsh-sidebar-manager
#   --tag        dist-tag to publish under (default: rc)
#   --dry-run    everything except the actual upload (default behaviour if npm is not logged in)
#   --yes        skip the interactive confirmation
#
# Exit: 0 published (or dry-run clean), 1 a gate failed, 2 usage/auth problem.
set -euo pipefail
cd "$(dirname "$0")/.."

TRACK=""
TAG="rc"
DRY_RUN=0
ASSUME_YES=0

while [ $# -gt 0 ]; do
  case "$1" in
    --tag)     TAG="${2:?--tag needs a value}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --yes|-y)  ASSUME_YES=1; shift ;;
    -h|--help) sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)        echo "unknown option: $1" >&2; exit 2 ;;
    *)         TRACK="$1"; shift ;;
  esac
done

if [ -z "$TRACK" ]; then
  echo "usage: scripts/publish-npm.sh <track> [--tag <name>] [--dry-run] [--yes]" >&2
  echo "tracks with a market entry:" >&2
  for d in dsh-*/; do
    d=${d%/}
    [ -f "$d/market/index.json" ] && [ -f "$d/package.json" ] && echo "  $d" >&2
  done
  exit 2
fi

[ -d "$TRACK" ] || { echo "no such track: $TRACK" >&2; exit 2; }
[ -f "$TRACK/package.json" ] || { echo "$TRACK has no package.json" >&2; exit 2; }

# --- identity guard (single-writer rule): never publish the wrong directory ---
EXPECTED="$(node -p "require('./$TRACK/package.json').name")"
case "$EXPECTED" in
  @nolit/*) ;;
  *) echo "refusing: $TRACK/package.json name is '$EXPECTED', expected an @nolit scope" >&2; exit 2 ;;
esac

VERSION="$(node -p "require('./$TRACK/package.json').version")"

echo "track:   $TRACK"
echo "package: $EXPECTED@$VERSION"
echo "tag:     $TAG"
echo

# --- gate 1: the package must be publishable at all -------------------------
echo "[1/4] packaging gate (scripts/check-npm-publishable.mjs)"
if ! node scripts/check-npm-publishable.mjs "$TRACK"; then
  echo
  echo "REFUSING TO PUBLISH: the packaging gate failed. Fix the defects above first." >&2
  echo "A tarball that fails these checks installs broken for every consumer." >&2
  exit 1
fi
echo

# --- gate 2: scoped packages must be public ---------------------------------
echo "[2/4] access"
ACCESS="$(node -p "require('./$TRACK/package.json').publishConfig?.access ?? ''")"
if [ "$ACCESS" != "public" ]; then
  echo "REFUSING TO PUBLISH: $EXPECTED is scoped but publishConfig.access is '${ACCESS:-absent}'." >&2
  echo "A restricted scoped package cannot be resolved by the market install." >&2
  echo "Add to $TRACK/package.json:" >&2
  echo '  "publishConfig": { "access": "public" }' >&2
  exit 1
fi
echo "  ok: publishConfig.access = public"
echo

# --- gate 3: prerelease needs an explicit tag -------------------------------
echo "[3/4] dist-tag"
case "$VERSION" in
  *-*)
    if [ -z "$TAG" ]; then
      echo "REFUSING TO PUBLISH: $VERSION is a prerelease and needs --tag" >&2
      exit 1
    fi
    echo "  ok: prerelease $VERSION publishes under dist-tag '$TAG'"
    echo "  note: it will NOT become 'latest'; consumers must ask for @$TAG or the exact version"
    ;;
  *)
    echo "  ok: stable version, dist-tag '$TAG'"
    ;;
esac
echo

# --- gate 4: auth ------------------------------------------------------------
echo "[4/4] registry auth"
WHO="$(npm whoami 2>/dev/null || true)"
if [ -z "$WHO" ]; then
  echo "  not logged in to npm."
  if [ "$DRY_RUN" -eq 0 ]; then
    echo "  falling back to --dry-run (nothing will be uploaded)." >&2
    echo "  To publish for real: npm login   (then re-run this script)" >&2
    DRY_RUN=1
  fi
else
  echo "  logged in as: $WHO"
fi
echo

# --- confirm ----------------------------------------------------------------
if [ "$DRY_RUN" -eq 1 ]; then
  echo "DRY RUN -- nothing will be uploaded."
else
  echo "This will PUBLISH $EXPECTED@$VERSION to the public npm registry, under dist-tag '$TAG'."
  echo "That upload is permanent: a published version can be deprecated but never overwritten."
  if [ "$ASSUME_YES" -ne 1 ]; then
    printf 'Type the exact version (%s) to continue: ' "$VERSION"
    read -r REPLY
    [ "$REPLY" = "$VERSION" ] || { echo "aborted."; exit 1; }
  fi
fi
echo

# --- publish ----------------------------------------------------------------
ARGS=(publish --access public --tag "$TAG")
[ "$DRY_RUN" -eq 1 ] && ARGS+=(--dry-run)

echo "running: (cd $TRACK && npm ${ARGS[*]})"
echo
(cd "$TRACK" && npm "${ARGS[@]}")

echo
if [ "$DRY_RUN" -eq 1 ]; then
  echo "dry run finished clean. Re-run without --dry-run to publish."
else
  echo "published $EXPECTED@$VERSION (dist-tag: $TAG)"
  echo
  echo "Verify the registry actually serves it:"
  echo "  npm view $EXPECTED@$VERSION version"
  echo "  npm view $EXPECTED dist-tags"
  echo
  echo "Then confirm the market entry resolves:"
  echo "  node scripts/check-npm-publishable.mjs $TRACK"
fi
