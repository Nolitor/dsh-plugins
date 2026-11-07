/**
 * Vendor module loader for the bridges and for mounting.
 *
 * The router's own package cannot resolve the vendor packages (measured: bare
 * specifiers fail from the router's path, but resolve from the DSH profile,
 * where the `@nolit` links live). This module therefore resolves every vendor
 * entry **through the profile's `package.json`** and imports the file URL.
 *
 * It also resolves the preset packages for `ctx.plugin` mounting, so `apply()`
 * never depends on the router's own `node_modules`.
 *
 * @module @nolit/dsh-custom-router/vendor-modules
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Default file loader; injectable so tests never touch the filesystem. */
const defaultImport = (url) => import(url)

/**
 * Resolve one package specifier through the profile.
 * @param {string} profileDir - profile directory containing `package.json`.
 * @param {string} specifier - package or subpath export.
 * @returns {string} an absolute file path.
 */
export function resolveFromProfile(profileDir, specifier) {
  const require = createRequire(join(profileDir, 'package.json'))
  return require.resolve(specifier)
}

/**
 * Load the vendor modules the bridges need.
 * @param {object} options - `{ profileDir, importModule?, resolvePackage? }`.
 * @returns {Promise<{modules: object, errors: {vendor: string, message: string}[], packageUrls: Record<string, string>}>} loaded modules.
 */
export async function loadVendorModules({ profileDir, importModule = defaultImport, resolvePackage = resolveFromProfile } = {}) {
  if (typeof profileDir !== 'string' || profileDir === '') {
    throw new TypeError('loadVendorModules requires profileDir (the DSH profile holding the @nolit links)')
  }
  const modules = {}
  const errors = []
  const packageUrls = {}
  const load = async (specifier) => importModule(pathToFileURL(resolvePackage(profileDir, specifier)).href)

  try {
    modules.antigravity = {
      auth: await load('@nolit/dsh-antigravity/auth'),
      settings: await load('@nolit/dsh-antigravity/settings'),
      catalog: await load('@nolit/dsh-antigravity/catalog'),
    }
    packageUrls.antigravity = pathToFileURL(resolvePackage(profileDir, '@nolit/dsh-antigravity')).href
  } catch (error) {
    errors.push({ vendor: 'antigravity', message: error instanceof Error ? error.message : String(error) })
  }

  try {
    const pkgFile = resolvePackage(profileDir, '@nolit/dsh-opencode-v2/package.json')
    modules.opencode = {
      http: await load('@nolit/dsh-opencode-v2/http'),
      // `modelsFromApiPayload` lives in `lib/shared.js`, which the package does not
      // export; a file URL bypasses the export map (bridge-only, no vendor edit).
      shared: await importModule(pathToFileURL(join(dirname(pkgFile), 'lib', 'shared.js')).href),
    }
    packageUrls.opencode = pathToFileURL(resolvePackage(profileDir, '@nolit/dsh-opencode-v2')).href
  } catch (error) {
    errors.push({ vendor: 'opencode', message: error instanceof Error ? error.message : String(error) })
  }

  try {
    packageUrls.deepinfra = pathToFileURL(resolvePackage(profileDir, '@nolit/dsh-deepinfra')).href
  } catch (error) {
    errors.push({ vendor: 'deepinfra', message: error instanceof Error ? error.message : String(error) })
  }

  return { modules, errors, packageUrls }
}
