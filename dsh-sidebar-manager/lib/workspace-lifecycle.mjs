/**
 * Workspace lifecycle registry for governance targeting.
 *
 * Promotion Gate (G1–G6) and capsule/context checks must only run against
 * ACTIVE, DSH-managed workspaces and genuine new promotions. Legacy assets that
 * are awaiting migration or teardown must be excluded by name so they are never
 * mistaken for compliance targets.
 *
 * `minamiv21` is recorded here explicitly:
 *   - a prior, unfinished autonomous-agent exploration;
 *   - its Autonomous Agent OS role is fully superseded by DSH;
 *   - it is retained only as a reference repository for residual Linux
 *     configuration, environment blueprints, and historical data;
 *   - it will be decommissioned and archived once those configurations are
 *     migrated into the DSH-centric environment.
 *
 * It is NOT a git-compliance or capsule-compliance target. Auditing it would
 * produce false failures (missing AGENTS.md / promotion-capsule.json / skeleton)
 * that say nothing about DSH health.
 */
export const WORKSPACE_STATUS = {
  ACTIVE: 'active',
  DEPRECATED: 'deprecated',
  AWAITING_DECOMMISSION: 'awaiting-decommission',
}

/** Known non-active trees, matched by path segment or registered title. */
export const DEPRECATED_WORKSPACES = [
  {
    id: 'minamiv21',
    match: ['minamiv21'],
    status: WORKSPACE_STATUS.AWAITING_DECOMMISSION,
    reason: 'superseded autonomous-agent exploration; DSH replaced the Agent OS role',
    retainedFor: 'residual Linux configuration, environment blueprints, historical data',
    governance: 'excluded from promotion gate / capsule audits',
    successor: 'DSH (DeepSeek Harness)',
    decommissionWhen: 'remaining configurations are migrated into the DSH environment',
  },
]

function normalize(value) {
  return typeof value === 'string' ? value.replace(/\\/g, '/').toLowerCase() : ''
}

/**
 * Resolve the governance status of a workspace path or title.
 * @returns {{status:string, excluded:boolean, record?:object}}
 */
export function lifecycleStatus({ path: workspacePath, title } = {}) {
  const haystacks = [normalize(workspacePath), normalize(title)]
  for (const record of DEPRECATED_WORKSPACES) {
    for (const needle of record.match) {
      const target = needle.toLowerCase()
      if (haystacks.some((value) => value !== '' && (value === target || value.split('/').includes(target) || value.includes(`/${target}`)))) {
        return { status: record.status, excluded: true, record }
      }
    }
  }
  return { status: WORKSPACE_STATUS.ACTIVE, excluded: false }
}

/** Guard used by the gate route: refuse to audit a deprecated tree. */
export function assertGovernanceTarget({ path: workspacePath, title }) {
  const resolved = lifecycleStatus({ path: workspacePath, title })
  if (resolved.excluded) {
    return {
      ok: false,
      code: 'TARGET_DEPRECATED',
      status: resolved.status,
      detail: `${resolved.record.id} is ${resolved.status}: ${resolved.record.reason}`,
      record: resolved.record,
    }
  }
  return { ok: true, status: resolved.status }
}

/** The list of governance-eligible targets: active DSH workspaces only. */
export function activeGovernanceTargets(workspaces = []) {
  return workspaces.filter((workspace) => !lifecycleStatus({ path: workspace.path, title: workspace.title }).excluded)
}
