/**
 * HQ (control-tower) generation & promotion.
 *
 * Creates the `{GROUP}-00-{MAIN}` workspace directory when absent, writes the
 * minimal capsule scaffold, then delegates registration to the existing
 * promotion engine (`promotion/apply mode: "existing"`). This keeps every
 * durable mutation on the audited path — no new registry writer is introduced.
 *
 * Per docs/dsh-plugin-runtime-spec.md §2.2 the Host half owns the durable work;
 * this module performs only filesystem scaffolding inside `projectsRoot`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseGroupedName } from './groups.mjs'

const SCAFFOLD_MARKER = '.dsh-hq.json'

/** Build the canonical HQ title for a group. */
export function hqTitle(group, main = 'HQ') {
  const index = '00'
  const sub = String(main ?? 'HQ').trim() === '' ? 'HQ' : String(main).trim()
  return `${group}-${index}-${sub}`
}

/** Validate a proposed HQ without touching the filesystem. */
export function previewHq({ group, main, projectsRoot, existingTitles = [] }) {
  const blockers = []
  const warnings = []
  const groupName = String(group ?? '').trim()
  if (groupName === '') blockers.push({ code: 'GROUP_REQUIRED' })
  if (/[\\/]/.test(groupName)) blockers.push({ code: 'GROUP_INVALID', group: groupName })
  if (groupName.includes('-')) {
    warnings.push({ code: 'GROUP_CONTAINS_HYPHEN', group: groupName, hint: 'parsing will treat the first segment as the group' })
  }
  const title = hqTitle(groupName, main)
  const parsed = parseGroupedName(title)
  if (!parsed.grouped) blockers.push({ code: 'TITLE_NOT_CONVENTIONAL', title })
  if (parsed.grouped && parsed.indexValue !== 0) blockers.push({ code: 'INDEX_NOT_ZERO', title })
  const targetPath = path.join(projectsRoot, title)
  if (fs.existsSync(targetPath)) {
    const stat = fs.statSync(targetPath)
    if (!stat.isDirectory()) blockers.push({ code: 'TARGET_NOT_A_DIRECTORY', path: targetPath })
    else if (fs.readdirSync(targetPath).length > 0 && !fs.existsSync(path.join(targetPath, SCAFFOLD_MARKER))) {
      warnings.push({ code: 'TARGET_NOT_EMPTY', path: targetPath })
    }
  }
  const duplicate = existingTitles.some((value) => String(value).toLowerCase() === title.toLowerCase())
  if (duplicate) blockers.push({ code: 'TITLE_CONFLICT', title })
  return { ok: blockers.length === 0, title, targetPath, group: groupName, blockers, warnings, parsed }
}

/** Idempotently create the directory and its capsule scaffold. */
export function scaffoldHq({ title, targetPath, group, specs = [], modules = [] }) {
  fs.mkdirSync(targetPath, { recursive: true })
  const capsulePath = path.join(targetPath, 'CAPSULE.md')
  const markerPath = path.join(targetPath, SCAFFOLD_MARKER)
  const created = []
  if (!fs.existsSync(capsulePath)) {
    fs.writeFileSync(capsulePath, renderCapsule({ group, title, specs, modules }))
    created.push('CAPSULE.md')
  }
  if (!fs.existsSync(markerPath)) {
    fs.writeFileSync(
      markerPath,
      `${JSON.stringify({ kind: 'hq', group, title, createdAt: new Date().toISOString() }, null, 2)}\n`,
    )
    created.push(SCAFFOLD_MARKER)
  }
  return { created, capsulePath, markerPath }
}

/**
 * Render the resident group capsule. Kept deliberately small: the audit budget
 * is <=400 tokens per group (docs/audit/C-tokens.md).
 */
export function renderCapsule({ group, title, specs = [], modules = [] }) {
  const moduleLines = modules.length === 0 ? '- (none yet)' : modules.map((entry) => `- ${entry}`).join('\n')
  const specLines = specs.length === 0 ? '- (none yet)' : specs.map((entry) => `- ${entry}`).join('\n')
  return `# GROUP ${group} — capsule

Control tower: ${title}
Purpose: shared invariants and the module index for this group. Do not copy into sub-modules.

## Invariants
1. Title is the source of truth; the directory path is derived.
2. Grouping is metadata (groups.json) — never a filesystem parent.
3. Live sessions are never moved; use handoff.
4. Never fork a session across a group boundary.

## Sub-modules
${moduleLines}

## Master specifications
${specLines}

## Tooling
Reference tools by ID from docs/shared/TOOL-REGISTRY.md — never paste schemas.
`
}

/**
 * Full HQ promotion: preview -> scaffold -> promotion/apply(mode: existing).
 *
 * @param {object} input
 * @param {Function} input.previewPromotion - the audited promotion preview
 * @param {Function} input.applyPromotion - the audited promotion apply
 */
export async function promoteHq({ ctx, options, group, main, previewPromotion, applyPromotion, dryRun = false }) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined) throw new Error('workspaceRegistry is unavailable')
  const existingTitles = registry.list().map((workspace) => workspace.title)
  const planned = previewHq({ group, main, projectsRoot: options.projectsRoot, existingTitles })
  if (!planned.ok) {
    return { ok: false, stage: 'preview-hq', blockerCodes: planned.blockers.map((entry) => entry.code), blockers: planned.blockers, warnings: planned.warnings, title: planned.title, targetPath: planned.targetPath }
  }
  const wouldCreate = !fs.existsSync(planned.targetPath)
  if (dryRun) {
    // Report the promotion engine's view only when the path exists; a not-yet
    // created target is expected to be PATH_UNRESOLVABLE until scaffolding runs.
    const preview = wouldCreate
      ? { ok: true, pendingScaffold: true }
      : await previewPromotion(ctx, options, { mode: 'existing', path: planned.targetPath, title: planned.title })
    return {
      ok: true,
      dryRun: true,
      title: planned.title,
      targetPath: planned.targetPath,
      wouldCreate,
      promotionReady: preview.ok !== false,
      warnings: planned.warnings,
    }
  }
  // `mode: "existing"` requires the directory to exist (audited contract), so the
  // scaffold must run first; the preview then validates the real path.
  const scaffold = scaffoldHq({ title: planned.title, targetPath: planned.targetPath, group: planned.group })
  const preview = await previewPromotion(ctx, options, { mode: 'existing', path: planned.targetPath, title: planned.title })
  if (!preview.ok) {
    return {
      ok: false,
      stage: 'promotion-preview',
      blockerCodes: preview.blockerCodes,
      blockers: preview.blockers,
      title: planned.title,
      targetPath: planned.targetPath,
      scaffold,
      warnings: planned.warnings,
    }
  }
  const applied = await applyPromotion(ctx, options, { mode: 'existing', path: planned.targetPath, title: planned.title })
  return {
    ok: applied.ok === true,
    stage: 'applied',
    title: planned.title,
    targetPath: planned.targetPath,
    scaffold,
    workspaceId: applied.workspaceId,
    attachedSessionIds: applied.attachedSessionIds ?? [],
    blockerCodes: applied.blockerCodes ?? [],
    blockers: applied.blockers ?? [],
    warnings: planned.warnings,
  }
}
