/**
 * Contract advisory + selective role-based policies (soft lint).
 *
 * Design stance (planner directive):
 *   - NO global quarantine, NO tool disabling, NO filesystem write blocking.
 *   - Roles/policies are metadata; violations surface as advisory observations.
 *
 * Two selective policies are supported, opt-in per member via
 * `policy: { access: "read-only" | "self-contained" }`:
 *
 *   read-only      The node is a canonical reference. Other workspaces may read
 *                  and route it, but should not mutate it from their own context.
 *                  (e.g. Core-01-UTM consuming Core-00-System contracts.)
 *   self-contained The node owns durable state (audit trail, release baseline)
 *                  that must only be mutated from within its own context.
 *                  (e.g. Core-99-UROH.)
 *
 * A violation yields `severity: "policy"` with explicit context so a caller can
 * show a soft rejection. Nothing here mutates state.
 */
import fs from 'node:fs'
import path from 'node:path'

export const ADVISORY_LEVELS = ['info', 'notice', 'policy']

/** Artifact patterns that suggest implementation code inside a contract node. */
export const IMPLEMENTATION_ARTIFACTS = [
  { code: 'node_modules', test: (name) => name === 'node_modules' },
  { code: 'package.json', test: (name) => name === 'package.json' },
  { code: 'lockfile', test: (name) => /^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/.test(name) },
  { code: 'python-package', test: (name) => /^(pyproject\.toml|requirements\.txt|setup\.py|Pipfile)$/.test(name) },
  { code: 'build-output', test: (name) => ['dist', 'build', 'target', 'bin', 'obj'].includes(name) },
  { code: 'container', test: (name) => /^(Dockerfile|docker-compose\.ya?ml|Containerfile)$/.test(name) },
  { code: 'source-file', test: (name) => /\.(py|mjs|cjs|js|ts|tsx|jsx|rs|go|java|rb|php)$/.test(name) && !/\.d\.ts$/.test(name) },
  { code: 'venv', test: (name) => /^(\.venv|venv|\.venv_.*)$/.test(name) },
]

function listTopLevel(targetPath) {
  try {
    if (!fs.existsSync(targetPath)) return []
    return fs.readdirSync(targetPath, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      directory: entry.isDirectory(),
    }))
  } catch {
    return []
  }
}

/**
 * Observe a single workspace for advisory signals.
 *
 * @param {object} input
 * @param {{id:string,path:string,title:string,role?:string,policy?:object}} input.workspace
 * @param {boolean} [input.enforcePolicy] - include policy observations
 * @returns {{workspaceId:string, role:string, policy:object|undefined, observations:Array}}
 */
export function observeWorkspace({ workspace, enforcePolicy = true }) {
  const observations = []
  const role = workspace.role ?? 'implementation'
  const policy = workspace.policy

  // Advisory 1: implementation artifacts inside a contract node.
  if (role === 'contract') {
    const entries = listTopLevel(workspace.path)
    const hits = []
    for (const entry of entries) {
      const artifact = IMPLEMENTATION_ARTIFACTS.find((rule) => rule.test(entry.name))
      if (artifact !== undefined) hits.push(`${entry.name} (${artifact.code})`)
    }
    if (hits.length > 0) {
      observations.push({
        level: 'notice',
        code: 'ARTIFACTS_IN_CONTRACT_NODE',
        workspaceId: workspace.id,
        title: workspace.title,
        detail: `implementation artifacts observed in contract node: ${hits.join(', ')}`,
        hint: 'advisory only — nothing was moved, blocked, or quarantined',
      })
    }
  }

  // Advisory 2: declared policies are published so the UI can badge them.
  if (enforcePolicy && policy?.access !== undefined) {
    observations.push({
      level: 'info',
      code: `POLICY_${policy.access.toUpperCase().replace(/-/g, '_')}`,
      workspaceId: workspace.id,
      title: workspace.title,
      detail: policy.reason ?? describePolicy(policy.access),
    })
  }

  return { workspaceId: workspace.id, role, policy, observations }
}

function describePolicy(access) {
  if (access === 'read-only') return 'canonical reference: consume and route, do not mutate from another context'
  if (access === 'self-contained') return 'state must be mutated only from within this workspace'
  return 'no policy'
}

/**
 * Evaluate a proposed mutation against selective policies **advisory only**.
 *
 * @param {object} input
 * @param {{id:string,title:string,policy?:object}} input.target - workspace being mutated
 * @param {string} input.originWorkspaceId - workspace whose context performs the change
 * @param {string} input.action - e.g. "write", "rename", "delete", "promote"
 * @returns {{allowed:boolean, softRejection:object|undefined, observations:Array}}
 */
export function evaluateMutation({ target, originWorkspaceId, action = 'write' }) {
  const access = target?.policy?.access
  if (access === undefined) return { allowed: true, softRejection: undefined, observations: [] }

  const ownContext = String(originWorkspaceId ?? '') === String(target.id ?? '')
  if (access === 'read-only' && !ownContext) {
    return {
      allowed: false,
      softRejection: {
        level: 'policy',
        code: 'POLICY_READ_ONLY',
        action,
        targetWorkspaceId: target.id,
        targetTitle: target.title,
        originWorkspaceId,
        detail: `${target.title} is declared read-only; ${action} from another workspace context is discouraged`,
        hint: 'perform the change inside the target workspace, or update its policy metadata',
      },
      observations: [],
    }
  }
  if (access === 'self-contained' && !ownContext) {
    return {
      allowed: false,
      softRejection: {
        level: 'policy',
        code: 'POLICY_SELF_CONTAINED',
        action,
        targetWorkspaceId: target.id,
        targetTitle: target.title,
        originWorkspaceId,
        detail: `${target.title} is self-contained; ${action} must originate inside it`,
        hint: 'run the reconciliation from the UROH workspace itself',
      },
      observations: [],
    }
  }
  return { allowed: true, softRejection: undefined, observations: [] }
}

/**
 * Build the full advisory report for the workspace set.
 * Never mutates and never blocks.
 */
export function buildAdvisoryReport({ workspaces = [], document }) {
  const members = document?.members ?? {}
  const enriched = workspaces.map((workspace) => {
    const member = members[String(workspace.id)] ?? {}
    return { ...workspace, role: member.role, policy: member.policy }
  })
  const observations = []
  for (const workspace of enriched) {
    const result = observeWorkspace({ workspace })
    observations.push(...result.observations)
  }
  const byLevel = {}
  for (const observation of observations) byLevel[observation.level] = (byLevel[observation.level] ?? 0) + 1
  return {
    ok: true,
    advisory: true,
    blocking: false,
    workspaces: enriched.map((workspace) => ({
      id: workspace.id,
      title: workspace.title,
      role: workspace.role ?? 'implementation',
      policy: workspace.policy?.access,
    })),
    observations,
    counts: byLevel,
  }
}
