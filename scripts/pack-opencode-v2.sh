#!/usr/bin/env bash
# Pack both OpenCode packages into artifacts/ with the project's naming rule.
#
# Why a script instead of `npm pack` by hand:
#
#   npm names a tarball `<name without scope>-<version>.tgz`. The beta package is
#   `@nolit/dsh-opencode-v2-beta` at version `0.0.2-beta.1`, so npm produces
#   `nolit-dsh-opencode-v2-beta-0.0.2-beta.1.tgz` — the word "beta" twice
#   (2026-11-04, owner: "뭔 베타를 두번이나").
#
#   The project rule is that the PACKAGE keeps the `-beta` in its name (that is
#   its identity: it is what the mutual-exclusion claim and the peer dependency
#   reference) while the ARTIFACT is named `nolit-dsh-opencode-v2-<version>.tgz`.
#   So the pack is renamed after the fact, and the sha256 in
#   artifacts/SHA256SUMS.opencode-v2 is written against the final name.
#
# Run: scripts/pack-opencode-v2.sh
set -euo pipefail
cd "$(dirname "$0")/.."

pack() {
  local dir="$1"
  local out
  out=$(cd "$dir" && npm pack --pack-destination ../artifacts 2>/dev/null | tail -1)
  local final="artifacts/nolit-dsh-opencode-v2-$(node -p "require('./$dir/package.json').version").tgz"
  if [ "artifacts/$out" != "$final" ]; then
    mv -f "artifacts/$out" "$final"
  fi
  printf '%s\n' "$final"
}

stable=$(pack dsh-opencode-v2)
beta=$(pack dsh-opencode-v2-beta)

node - "$stable" "$beta" <<'NODE'
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const [stable, beta] = process.argv.slice(2)
const sums = execSync(`sha256sum ${stable} ${beta}`).toString().trim().split('\n')
const ledger = 'artifacts/SHA256SUMS.opencode-v2'
const kept = fs.readFileSync(ledger, 'utf8').split('\n')
  .filter((line) => line.trim() && !line.includes(stable.replace('artifacts/', '')) && !line.includes(beta.replace('artifacts/', '')))
fs.writeFileSync(ledger, [...sums, ...kept].join('\n') + '\n')
console.log(sums.join('\n'))
NODE

sha256sum -c artifacts/SHA256SUMS.opencode-v2 2>/dev/null | grep -c OK | xargs -I{} printf '%s artifact hashes verified\n' {}
