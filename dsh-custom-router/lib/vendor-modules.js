/**
 * Vendor module loader for the bridges and for mounting.
 *
 * The router's own package cannot resolve the vendor packages (measured: bare
 * specifiers fail from the router's path). Two different owners are involved,
 * and they resolve through **different roots**:
 *
 *   - `@nolit/*` (the three vendor plugins) live in the DSH **profile**, which
 *     is where `dsh plugin add` links them.
 *   - `@deepseek-ai/dsh-tool-subagent` is NOT a vendor package: it ships inside
 *     the DSH **installation**, and it is not present in any profile's
 *     `node_modules` (measured 2026-11-07).
 *
 * Resolution therefore walks an ordered chain of anchors and takes the first
 * hit. The chain is data, so a caller (a test, the isolated E2E harness) can
 * pass its own `anchors` and never touch the filesystem.
 *
 * MEASURED HAZARD — why the install anchor is passed in rather than inferred:
 * DSH patches `Module._resolveFilename` during boot (`dsh-app-boot`
 * profile-resolution-bootstrap) to route `@deepseek-ai/*` to the install tree.
 * The same `createRequire(<profile>/package.json).resolve()` call therefore
 * FAILS before a boot and SUCCEEDS after one, in the same process. A resolver
 * that trusted the profile for `@deepseek-ai/*` would work only by accident and
 * only after the first boot, so the install anchor is an explicit, ordered
 * fallback instead.
 *
 * @module @nolit/dsh-custom-router/vendor-modules
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Default file loader; injectable so tests never touch the filesystem. */
const defaultImport = (url) => import(url)

/** The package that ships the host's shared delegation tool. */
export const INSTALL_PACKAGE = '@deepseek-ai/dsh'

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
 * Resolve one package specifier through an arbitrary anchor `package.json`.
 * @param {string} anchor - absolute path to a `package.json`.
 * @param {string} specifier - package or subpath export.
 * @returns {string} an absolute file path.
 */
export function resolveFromAnchor(anchor, specifier) {
  const require = createRequire(anchor)
  return require.resolve(specifier)
}

/**
 * Derive the DSH installation's `package.json` from the running Node binary.
 *
 * `process.execPath` is `<prefix>/bin/node` for a prefix install, and DSH's
 * global packages land in `<prefix>/lib/node_modules`. This is a *fallback*
 * only: the measured primary is `profileContext.installAnchor`, which the host
 * computes itself.
 * @param {string} [execPath] - Node binary path (defaults to `process.execPath`).
 * @returns {string} a candidate anchor path (not checked for existence here).
 */
export function installAnchorFromExecPath(execPath = process.execPath) {
  return join(dirname(execPath), '..', 'lib', 'node_modules', INSTALL_PACKAGE, 'package.json')
}

/**
 * Build the ordered resolution chain for one specifier.
 *
 * Order is deliberate: the profile first (the `@nolit` links and any package the
 * operator installed there), then the install anchor (the host's own packages),
 * then any extra anchors, and finally a path derived from the running Node.
 * @param {object} options - `{ profileDir?, installAnchor?, anchors? }`.
 * @returns {Array<{label: string, anchor: string}>} ordered anchors.
 */
export function resolutionChain({ profileDir, installAnchor, anchors = [] } = {}) {
  const chain = []
  if (typeof profileDir === 'string' && profileDir !== '') {
    chain.push({ label: 'profile', anchor: join(profileDir, 'package.json') })
  }
  if (typeof installAnchor === 'string' && installAnchor !== '') {
    chain.push({ label: 'installAnchor', anchor: installAnchor })
  }
  for (const [index, anchor] of anchors.entries()) {
    if (typeof anchor === 'string' && anchor !== '') chain.push({ label: `anchor${index + 1}`, anchor })
  }
  // Last resort: derive from the runtime, so a caller that passed nothing at
  // all still has a chance of resolving a host package.
  chain.push({ label: 'execPath', anchor: installAnchorFromExecPath() })
  return chain
}

/**
 * Resolve one specifier through an ordered chain of anchors.
 *
 * Returns the first successful resolution together with the anchor label that
 * produced it, and every attempt when it fails — the failure text is the
 * measurement, so it is preserved rather than collapsed into one message.
 * @param {object} options - `{ profileDir?, installAnchor?, anchors?, specifier, resolve? }`.
 * @returns {{ok: true, path: string, label: string, anchor: string} | {ok: false, attempts: Array<{label: string, anchor: string, error: string}>}} the verdict.
 */
export function resolveThroughChain({ profileDir, installAnchor, anchors = [], specifier, resolve = resolveFromAnchor } = {}) {
  const attempts = []
  // A `file:` URL or an absolute path is already a location: no anchor needed.
  if (typeof specifier === 'string' && (/^file:/.test(specifier) || specifier.startsWith('/'))) {
    return { ok: true, path: specifier, label: 'literal', anchor: '(none)' }
  }
  for (const { label, anchor } of resolutionChain({ profileDir, installAnchor, anchors })) {
    try {
      return { ok: true, path: resolve(anchor, specifier), label, anchor }
    } catch (error) {
      attempts.push({ label, anchor, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { ok: false, attempts }
}

/**
 * Load the vendor modules the bridges need.
 * @param {object} options - `{ profileDir, installAnchor?, anchors?, importModule?, resolvePackage? }`.
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
