/**
 * Harness diet conventions (audit C).
 *
 * Enforces the resident-context budget without any runtime token gate:
 *
 *   group capsule   <= 400 tokens
 *   sub AGENTS.md   <= 600 tokens
 *   BOOT_CARD.md    <= 300 tokens
 *   tool registry   <= 120 tokens (header)
 *   resident total  <= 1500 tokens per sub-module
 *
 * Token estimate: bytes/4 for ASCII, bytes/2.2 for CJK (audit C, finding T4).
 * Also checks the "no cross-group fork" convention from a group's metadata.
 */
import fs from 'node:fs'
import path from 'node:path'

export const DIET_BUDGETS = {
  groupCapsule: 400,
  subAgents: 600,
  bootCard: 300,
  toolRegistry: 120,
  residentTotal: 1500,
}

const CJK = /[\u3000-\u9fff\uac00-\ud7af]/

/** Estimate tokens from a UTF-8 buffer, CJK-aware. */
export function estimateTokens(text) {
  if (typeof text !== 'string' || text === '') return 0
  const bytes = Buffer.byteLength(text, 'utf8')
  return Math.ceil(CJK.test(text) ? bytes / 2.2 : bytes / 4)
}

function readIfPresent(file) {
  try {
    if (!fs.existsSync(file)) return undefined
    return fs.readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * @param {object} input
 * @param {string} input.subDir - the sub-module directory
 * @param {string} [input.groupCapsulePath]
 * @param {string} [input.toolRegistryPath]
 */
export function auditResidentBudget({ subDir, groupCapsulePath, toolRegistryPath }) {
  const pieces = []
  const capsule = groupCapsulePath === undefined ? undefined : readIfPresent(groupCapsulePath)
  if (capsule !== undefined) pieces.push({ name: 'group capsule', budget: DIET_BUDGETS.groupCapsule, tokens: estimateTokens(capsule), path: groupCapsulePath })
  const registry = toolRegistryPath === undefined ? undefined : readIfPresent(toolRegistryPath)
  if (registry !== undefined) pieces.push({ name: 'tool registry', budget: DIET_BUDGETS.toolRegistry, tokens: estimateTokens(registry), path: toolRegistryPath })
  const agents = readIfPresent(path.join(subDir, 'AGENTS.md'))
  if (agents !== undefined) pieces.push({ name: 'sub AGENTS.md', budget: DIET_BUDGETS.subAgents, tokens: estimateTokens(agents), path: path.join(subDir, 'AGENTS.md') })
  const boot = readIfPresent(path.join(subDir, 'BOOT_CARD.md'))
  if (boot !== undefined) pieces.push({ name: 'BOOT_CARD.md', budget: DIET_BUDGETS.bootCard, tokens: estimateTokens(boot), path: path.join(subDir, 'BOOT_CARD.md') })

  const violations = pieces
    .filter((piece) => piece.tokens > piece.budget)
    .map((piece) => ({ code: 'BUDGET_EXCEEDED', name: piece.name, tokens: piece.tokens, budget: piece.budget, path: piece.path }))
  const resident = pieces.reduce((sum, piece) => sum + piece.tokens, 0)
  if (resident > DIET_BUDGETS.residentTotal) {
    violations.push({ code: 'RESIDENT_TOTAL_EXCEEDED', tokens: resident, budget: DIET_BUDGETS.residentTotal })
  }
  return { ok: violations.length === 0, resident, pieces, violations, budgets: DIET_BUDGETS }
}

/** Detect a copied parent document (anti-pattern AP1). */
export function detectDuplicatedCapsule(subDir, groupCapsulePath) {
  const capsule = readIfPresent(groupCapsulePath)
  const agents = readIfPresent(path.join(subDir, 'AGENTS.md'))
  if (capsule === undefined || agents === undefined) return { duplicated: false }
  // Compare the capsule's section headings against the sub file.
  const headings = capsule
    .split('\n')
    .filter((line) => /^##\s+/.test(line))
    .map((line) => line.trim())
  const copied = headings.filter((heading) => agents.includes(heading))
  return { duplicated: copied.length > 0, headings: copied }
}

/**
 * The "no cross-group fork" rule: a session may only be forked inside the group
 * that owns it. Returns a blocker when source and target groups differ.
 */
export function checkCrossGroupFork({ sourceGroupId, targetGroupId }) {
  if (sourceGroupId === undefined || targetGroupId === undefined) {
    return { ok: true, reason: 'ungrouped' }
  }
  if (sourceGroupId === targetGroupId) return { ok: true, reason: 'same-group' }
  return {
    ok: false,
    code: 'CROSS_GROUP_FORK',
    reason: 'forking across a group boundary re-bills the parent transcript',
    sourceGroupId,
    targetGroupId,
  }
}
