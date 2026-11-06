#!/usr/bin/env node
/**
 * Generate a timestamped DSH Plugins boot card and point the lightweight
 * AGENTS.md index at only the newest card.
 *
 * Run: node scripts/new-bootcard.mjs [note]
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'))
const run = (cmd, args) => {
  try { return execFileSync(cmd, args, { encoding: 'utf8' }).trim() } catch { return 'unknown' }
}
const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
const stamp = `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}T${pad(kst.getUTCHours())}${pad(kst.getUTCMinutes())}+0900`
const id = `${stamp}`
const note = process.argv.slice(2).join(' ').trim()

// Artifact file names carry the package version, so the path is derived from
// package.json instead of being pinned here (a pinned version silently prints
// "missing" after every bump).
const plugins = [
  ['Korean locale', 'dsh-korean-locale/package.json', 'nolit-dsh-korean-locale'],
  ['Sidebar Manager', 'dsh-sidebar-manager/package.json', 'nolit-dsh-sidebar-manager'],
  ['Notify Web', 'dsh-notify/package.json', 'nolit-dsh-notify-web'],
  ['OpenCode v2', 'dsh-opencode-v2/package.json', 'nolit-dsh-opencode-v2'],
]
const lines = []
for (const [label, pkgPath, artifactName] of plugins) {
  if (!existsSync(join(root, pkgPath))) continue
  const pkg = readJson(pkgPath)
  const artifactPath = join(root, `artifacts/${artifactName}-${pkg.version}.tgz`)
  const hash = existsSync(artifactPath) ? createHash('sha256').update(readFileSync(artifactPath)).digest('hex') : 'missing'
  lines.push(`| ${label} | \`${pkg.name}@${pkg.version}\` | \`${pkg.engines?.dsh ?? 'n/a'}\` | \`${hash}\` |`)
}

const card = `# DSH Plugins — Boot Card ${stamp}

<!-- skeleton:
version: 1.0
kind: boot
status: active
updated: ${stamp.slice(0, 10)}
summary: Dated session card (tier 5). State, active task, and handoff for ${stamp}. Older cards are historical.
-->

> Status: active · Generated: ${stamp} (KST) · Runtime: DSH \`${run('dsh', ['--version'])}\` · Node \`${run('node', ['--version'])}\`
> Previous cards: [INDEX.md](./INDEX.md) · Rules: [../docs/RULES.md](../docs/RULES.md) · Doc index: [../docs/SKELETON.md](../docs/SKELETON.md) · Pending docs: [../pending-docs/INDEX.md](../pending-docs/INDEX.md)

## 0. Read this first

This is the **only boot card an agent should read by default**. Older timestamped cards are
historical evidence; open them only when investigating a version/policy delta.

${note ? `Latest session note: ${note}\n\n` : ''}## 1. Non-negotiable rules

1. **Measure first.** Read actual state; do not trust memory, report text, or a plan.
2. **Sidebar Manager drift gate.** The live plugin may include UTM modifications that differ from
   the packaged release. Before any change/version-up: run \`node scripts/audit-installed-vs-packaged.mjs\`,
   record tree SHA-256, test the current behavior in an isolated \`DSH_HOME\`, then version-up.
3. **Isolate live state.** Use a workspace-local \`DSH_HOME\` for experiments. Do not write
   \`~/.dsh\`, the live profile, sessions, or the running 3080 service without explicit approval.
4. **Version gate.** Plugin \`engines.dsh\` must include the running DSH prerelease exactly:
   \`>=0.2.2-alpha.2 <0.3.0\` for the current generation.
5. **Release artifacts are immutable.** Update \`artifacts/SHA256SUMS.*\` whenever a package
   changes; never claim a release without a matching hash.
6. **UTM is advisory.** Do not introduce hard write-blocks based on UTM role/policy. Use
   observation, warning, soft rejection, and audit records only.
7. **Notification delivery is deduped.** If Chrome OS notification succeeds, do not also show
   the in-app toast; use toast/title/sound only as fallback.
8. **Locale parity.** Korean dictionaries must match both \`en\` and \`zh\` key sets and
   placeholders before release.
9. **Single writer.** Write only inside your assigned \`dsh-<track>/\`. Never write a sibling
   track via a bare relative path; assert \`package.json.name\` before replacing a manifest.
10. **Plugin replacement is 4 steps, never one.** disable incumbent row -> remove incumbent
   package -> add new package -> verify by **real mount**. A passing \`--dump-config\` does NOT
   prove a plugin mounts; two plugins registering the same tool/route is a hard mount failure.

## 2. Runtime snapshot

| Component | Value |
|---|---|
| DSH CLI | \`${run('dsh', ['--version'])}\` |
| Node | \`${run('node', ['--version'])}\` |
| Cordis | \`${(() => { try { return JSON.parse(readFileSync(`${process.env.HOME}/.local/nodejs/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/package.json`, 'utf8')).version } catch { return 'from installed DSH' } })()}\` |
| Live profile | \`~/.dsh/profiles/web\` (read-only from this sandbox) |
| Active bundles | base, web-app, auto-review, agent-team-profile, Korean locale, Sidebar Manager |

## 3. Managed plugins and artifacts

| Plugin | Version | \`engines.dsh\` | Artifact SHA-256 |
|---|---|---|---|
${lines.join('\n')}

## 4. Current policies and known deltas

- DSH 0.2.2-alpha.2 changed **manifest/engine enforcement** to include prereleases for the
  declared window; all three plugins pin \`>=0.2.2-alpha.2 <0.3.0\`.
- Korean pack refreshed to **68 namespaces / 3,019 keys**, en/zh key and placeholder parity 0.
- Notify v0.1.6: auto permission request once per page; OS notification success suppresses
  toast; denied/insecure/error falls back to toast + tab title + sound.
- Sidebar Manager is functionally healthy on alpha.2. Its installed tree can carry UTM changes;
  always baseline-measure before a version-up (current measured version 0.1.2, 126/126 tests). Forge/Worktree coupling
  needs advisory preflight (no hard block): \`.agents/worktrees\` observation, cwd/handoff audit,
  worktree identity/lifecycle mapping.

## 5. Key documents

- [Runtime spec](../docs/dsh-plugin-runtime-spec.md)
- [Plugin boot card baseline](../docs/plugin-boot-card.md)
- [DSH harness policy + version changelog](../docs/DSH-HARNESS-POLICY.md)
- [Forge vs Sidebar/UTM comparison](../dsh-sidebar-manager/docs/FORGE-VS-SIDEBAR-UTM-MEASUREMENT.md)
- [UTM review](../dsh-sidebar-manager/docs/UTM-REVIEW-FORGE-VS-SIDEBAR.md)
- [Runtime measurement](../dsh-sidebar-manager/docs/FORGE-VS-SIDEBAR-UTM-RUNTIME-MEASUREMENT.md)
- [Latest runtime report](../docs/DSH-0.2.2-ALPHA.2-RUNTIME-REPORT.md)
- [Per-subproject document indexes](../docs/SKELETON.md#subprojects)
- [Pending documents (미승격·미구현·폐기·미정)](../pending-docs/INDEX.md)

## 6. Verification commands

\`\`\`bash
(cd dsh-korean-locale && npm run verify)
(cd dsh-sidebar-manager && npm test)
(cd dsh-notify && npm test)
node scripts/audit-promoted-state.mjs
node scripts/audit-installed-vs-packaged.mjs
\`\`\`
`
writeFileSync(join(root, 'bootcards', `${id}.md`), card)
if (!existsSync(join(root, 'bootcards', 'INDEX.md'))) {
  writeFileSync(join(root, 'bootcards', 'INDEX.md'), '# Boot Card Index\n\nNewest first. Agents read only the card referenced by AGENTS.md unless comparing historical deltas.\n\n')
}
const indexPath = join(root, 'bootcards', 'INDEX.md')
let index = readFileSync(indexPath, 'utf8')
if (!index.includes(`(${id}.md)`)) {
  index = index.replace('\n', `\n- [${id}](${id}.md)\n`)
  writeFileSync(indexPath, index)
}
const agentsPath = join(root, 'AGENTS.md')
let agents = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : '# DSH Plugins — Agent Boot Index\n\n<!-- LATEST_BOOT_CARD:START -->\n<!-- LATEST_BOOT_CARD:END -->\n'
const block = `<!-- LATEST_BOOT_CARD:START -->\nLatest boot card: [bootcards/${id}.md](bootcards/${id}.md)\nGenerated: ${stamp} (KST)\nRead only this latest card by default; older cards are historical evidence.\n<!-- LATEST_BOOT_CARD:END -->`
agents = agents.replace(/<!-- LATEST_BOOT_CARD:START -->[\s\S]*?<!-- LATEST_BOOT_CARD:END -->/, block)
writeFileSync(agentsPath, agents)
console.log(JSON.stringify({ id, card: `bootcards/${id}.md`, latest: `bootcards/${id}.md` }, null, 2))
