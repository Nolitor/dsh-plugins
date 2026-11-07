#!/usr/bin/env node
/**
 * Ensure the workspace-owned shared bridge resolves for every vendor plugin.
 *
 * Why this exists: a linked plugin is loaded from its REAL path, and DSH routes a
 * bare import through the profile's node_modules only for names declared in that
 * plugin's `peerDependencies`. A peer declaration alone therefore does not make
 * `@nolit/dsh-custom-router` resolvable during isolated tests or a real mount.
 *
 * The link lives in the workspace root (gitignored `node_modules/`), so no live
 * profile is written by this script. Run it after cloning or after a `pnpm`
 * install that prunes the root `node_modules`.
 */
import { existsSync, mkdirSync, symlinkSync, lstatSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'dsh-custom-router')
const link = join(root, 'node_modules', '@nolit', 'dsh-custom-router')

if (!existsSync(target)) {
  console.error(`error: ${target} is missing`)
  process.exit(2)
}
mkdirSync(dirname(link), { recursive: true })
try {
  if (lstatSync(link)) unlinkSync(link)
} catch {
  // no previous link
}
symlinkSync('../../dsh-custom-router', link, 'dir')
console.log(`linked ${link} -> ../../dsh-custom-router`)
