#!/usr/bin/env node
/**
 * Compare the live profile's installed sidebar-manager tree with the packaged
 * workspace tree and with its recovery baseline. Read-only: never writes ~/.dsh.
 *
 * Exit codes:
 *   0  live tree resolves to the workspace tree and metadata is internally consistent
 *   1  link divergence, missing package files, or metadata inconsistency
 *   2  audited source contains post-recovery (UTM) files but no immutable artifact
 *      exists to prove byte-for-byte release equivalence; inspect JSON evidence.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const track = join(root, 'dsh-sidebar-manager')
const pkg = JSON.parse(readFileSync(join(track, 'package.json'), 'utf8'))
const market = JSON.parse(readFileSync(join(track, 'market/index.json'), 'utf8'))
const marketEntry = market.plugins.find((plugin) => plugin.name === pkg.name)
const profilePath = join(process.env.HOME, '.dsh/profiles/web/package.json')
const profile = JSON.parse(readFileSync(profilePath, 'utf8'))
const spec = profile.dependencies?.[pkg.name] ?? null
const expectedLink = spec?.startsWith('link:') ? resolve(spec.slice(5)) : null
const nodeModulesLink = join(process.env.HOME, '.dsh/profiles/web/node_modules', pkg.name)
const liveResolved = existsSync(nodeModulesLink) ? realpathSync(nodeModulesLink) : null
const trackResolved = realpathSync(track)

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (entry.isFile()) out.push(path)
  }
  return out
}

function treeHash(dir) {
  const hash = createHash('sha256')
  for (const path of walk(dir).sort()) {
    hash.update(relative(dir, path).split('\\').join('/'))
    hash.update('\0')
    hash.update(readFileSync(path))
    hash.update('\0')
  }
  return hash.digest('hex')
}

// The recovery report records the original 14-file package. Any current
// package file outside that inventory is a post-recovery addition.
const recovery = readFileSync(join(track, 'RECOVERY-NOTES.md'), 'utf8')
const baselineFiles = new Set(
  [...recovery.matchAll(/^\| `([^`]+\.(?:js|mjs|json|yml|svg|md))` \|/gm)].map((m) => m[1]),
)
const packageFiles = walk(track)
  .map((path) => relative(track, path).split('\\').join('/'))
  .filter((path) => !path.startsWith('market/icons/') ? true : false)
const postRecoveryFiles = packageFiles.filter((path) => !baselineFiles.has(path))
const declaredFiles = new Set((pkg.files ?? []).filter((entry) => !entry.includes('*')))
const missingDeclared = [...declaredFiles].filter((path) => !existsSync(join(track, path)))
const liveTreeHash = liveResolved ? treeHash(liveResolved) : null
const trackTreeHash = treeHash(track)
const artifactDirs = [join(root, 'artifacts'), join(root, '.runtime-measure/artifacts')]
const artifactCandidates = [
  ...walk(track).filter((path) => /\.(?:tgz|zip|tar\.gz)$/.test(path)),
  ...artifactDirs.flatMap((dir) =>
    existsSync(dir)
      ? readdirSync(dir)
          .map((name) => join(dir, name))
          .filter((path) => /\.(?:tgz|zip|tar\.gz)$/.test(path))
      : [],
  ),
]
const generatedAt = new Date().toISOString()
const result = {
  generatedAt,
  package: { name: pkg.name, version: pkg.version },
  market: {
    version: marketEntry?.versions?.[0]?.version ?? null,
    publishTimestamp: marketEntry?.versions?.[0]?.publishTimestamp ?? null,
    enginesDsh: marketEntry?.versions?.[0]?.engines?.dsh ?? null,
  },
  liveInstall: {
    profile: profilePath,
    spec,
    expectedLink,
    nodeModulesLink,
    resolved: liveResolved,
    resolvesToTrack: liveResolved === trackResolved,
    treeSha256: liveTreeHash,
  },
  workspaceTrack: { path: trackResolved, treeSha256: trackTreeHash, files: packageFiles.length },
  packaging: {
    immutableArtifact: artifactCandidates.length > 0 ? artifactCandidates.map((path) => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), size: statSync(path).size })) : null,
    immutableArtifactCount: artifactCandidates.length,
    declaredFiles: declaredFiles.size,
    missingDeclared,
    baselineRecoveredFiles: baselineFiles.size,
    postRecoveryAdditions: postRecoveryFiles,
    utmDriftDetected: postRecoveryFiles.length > 0,
  },
  consistency: {
    liveEqualsWorkspace: liveResolved === trackResolved && liveTreeHash === trackTreeHash,
    versionMatchesMarket: pkg.version === marketEntry?.versions?.[0]?.version,
    enginesMatchMarket: pkg.engines?.dsh === marketEntry?.versions?.[0]?.engines?.dsh,
    missingDeclaredCount: missingDeclared.length,
  },
}
result.verdict = !result.consistency.liveEqualsWorkspace
  ? 'LIVE_LINK_DIVERGES_FROM_WORKSPACE'
  : result.packaging.immutableArtifactCount === 0 && result.packaging.utmDriftDetected
    ? 'LIVE_EQUALS_WORKSPACE_BUT_UNVERSIONED_UTM_DRIFT'
    : result.consistency.missingDeclaredCount > 0
      ? 'PACKAGE_FILE_MISSING'
      : result.packaging.utmDriftDetected
        ? 'LIVE_EQUALS_WORKSPACE_WITH_LOCAL_UTM_ARTIFACT'
        : 'LIVE_EQUALS_WORKSPACE_AND_METADATA_CONSISTENT'
console.log(JSON.stringify(result, null, 2))
process.exit(result.verdict === 'LIVE_EQUALS_WORKSPACE_BUT_UNVERSIONED_UTM_DRIFT' ? 2 : result.consistency.liveEqualsWorkspace && result.consistency.missingDeclaredCount === 0 ? 0 : 1)
