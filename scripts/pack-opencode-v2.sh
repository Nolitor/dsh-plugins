#!/usr/bin/env bash
# Pack @nolit/dsh-opencode-v2 into artifacts/ with the project's naming rule.
#
# Why a script instead of `npm pack` by hand:
#
#   npm names a tarball `<name without scope>-<version>.tgz`. The project rule is that
#   the ARTIFACT is named `nolit-dsh-opencode-v2-<version>.tgz`, so a pre-release
#   (`0.0.2-rc.3`) lands as `nolit-dsh-opencode-v2-0.0.2-rc.3.tgz` and the sha256 in
#   artifacts/SHA256SUMS.opencode-v2 is written against the final name.
#
# The beta package (@nolit/dsh-opencode-v2-beta) was removed on 2026-11-04: it existed
# to stage the canonical parser, but it collided with the stable package on every
# registered name and its card had no title, so the operator could not tell the two
# apart. Stage 2 and 3 work now happens on top of a stabilised stable release instead.
#
# Run: scripts/pack-opencode-v2.sh
set -euo pipefail
cd "$(dirname "$0")/.."

dir=dsh-opencode-v2
out=$(cd "$dir" && npm pack --pack-destination ../artifacts 2>/dev/null | tail -1)
version=$(node -p "require('./$dir/package.json').version")
final="artifacts/nolit-dsh-opencode-v2-$version.tgz"
[ "artifacts/$out" = "$final" ] || mv -f "artifacts/$out" "$final"

node - "$final" <<'NODE'
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const [artifact] = process.argv.slice(2)
const sums = execSync(`sha256sum ${artifact}`).toString().trim().split('\n')
const ledger = 'artifacts/SHA256SUMS.opencode-v2'
const name = artifact.replace('artifacts/', '')
const kept = fs.readFileSync(ledger, 'utf8').split('\n')
  .filter((line) => line.trim() && !line.includes(name))
fs.writeFileSync(ledger, [...sums, ...kept].join('\n') + '\n')
console.log(sums.join('\n'))
NODE

sha256sum -c artifacts/SHA256SUMS.opencode-v2 2>/dev/null | grep -c OK | xargs -I{} printf '%s artifact hashes verified\n' {}
