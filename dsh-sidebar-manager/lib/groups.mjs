/**
 * Virtual project grouping registry (Phase 2).
 *
 * Group membership is METADATA. It never influences a filesystem path, and it is
 * never stored in `workspace.json` (whose whole-file rollback is a known hazard)
 * or in `cordis.patch.yml` (a deployment artifact). It lives in its own atomic
 * file so a corrupt group file degrades to "everything ungrouped".
 *
 * Identity rule (from the audit): a workspace's `id` CHANGES on folder rename and
 * on archive/restore, because those paths recreate the record. Therefore lookup is
 * `id` first, then an optional `(path, title)` fingerprint, and every finalizer
 * that creates a new id MUST call `repointWorkspace`.
 *
 * Schema v2:
 * {
 *   "unit": { "name": "sidebar-groups", "version": 2 },
 *   "groups": [{ "groupId": "core", "label": "Core", "order": -1,
 *                "kind": "system", "pinTop": true, "color": "#7c3aed" },
 *              { "groupId": "utm-impl", "label": "UTM", "order": 0,
 *                "kind": "project",
 *                "upstream": { "contractGroupId": "core", "contractSpec": "UTM-CONTRACT" } }],
 *   "members": {
 *     "<workspaceId>": { "groupId": "core", "order": 0,
 *                        "role": "contract",
 *                        "policy": { "access": "read-only" },
 *                        "fingerprint": { "path": "/abs/path", "title": "Core-00-System" } }
 *   }
 * }
 *
 * v3 adds, all optional and additive:
 *   - member.role        "contract" | "implementation"
 *   - member.policy      { access: "read-only" | "self-contained", reason?: string }
 *   - group.upstream     { contractGroupId, contractSpec }  (downstream -> upstream only)
 *
 * `kind: "system"` marks harness engine cores (UTM, UROH): they are pinned to the
 * top by the ordering action and locked in the manager UI. Kinds are additive —
 * a v1 document (no `kind`) reads as `project`.
 */
import fs from 'node:fs'
import path from 'node:path'

export const GROUPS_UNIT = { name: 'sidebar-groups', version: 3 }

/**
 * Member roles are DESCRIPTIVE. They never restrict file creation or disable tools.
 * `contract` marks a canonical specification node; `implementation` marks a
 * concrete subsystem or adapter.
 */
export const MEMBER_ROLES = ['contract', 'implementation']

/**
 * Selectable, per-workspace policy hints. Absent === no policy (freely editable).
 *
 *   read-only      the workspace may be referenced but not mutated by other
 *                  workspaces' workflows (e.g. Core-01-UTM consuming Core specs)
 *   self-contained its state (audit trails, release baselines) may only be
 *                  mutated from within the workspace itself (e.g. Core-99-UROH)
 *
 * These are ADVISORY declarations: a violation is reported with context, never
 * a global block or quarantine.
 */
export const MEMBER_POLICIES = ['read-only', 'self-contained']

/** Group kinds: `system` cores pin to the top and are locked; `project` is a normal group. */
export const GROUP_KINDS = ['system', 'project']

function groupsFile(options) {
  return path.join(options.stateDir, 'groups.json')
}

function emptyDocument() {
  return { unit: { ...GROUPS_UNIT }, groups: [], members: {} }
}

function normalizePath(value) {
  return typeof value === 'string' ? path.resolve(value).replace(/\\/g, '/').toLowerCase() : ''
}

function fingerprintOf({ path: workspacePath, title } = {}) {
  return { path: normalizePath(workspacePath), title: typeof title === 'string' ? title : '' }
}

function sameFingerprint(left, right) {
  if (left === undefined || right === undefined) return false
  return left.path === right.path && left.title === right.title
}

/** Structural validation; returns a list of problem strings (empty === valid). */
export function validateDocument(document) {
  const problems = []
  if (document === null || typeof document !== 'object') return ['document-not-an-object']
  if (document.unit?.name !== GROUPS_UNIT.name) problems.push('unit-name-mismatch')
  if (document.unit?.version !== GROUPS_UNIT.version) problems.push('unit-version-mismatch')
  if (!Array.isArray(document.groups)) problems.push('groups-not-an-array')
  else {
    const ids = new Set()
    for (const group of document.groups) {
      if (typeof group?.groupId !== 'string' || group.groupId === '') problems.push('group-id-invalid')
      else if (ids.has(group.groupId)) problems.push(`group-id-duplicate:${group.groupId}`)
      else ids.add(group.groupId)
      if (typeof group?.label !== 'string' || group.label.trim() === '') problems.push('group-label-invalid')
      if (group?.order !== undefined && !Number.isInteger(group.order)) problems.push('group-order-invalid')
      if (group?.kind !== undefined && !GROUP_KINDS.includes(group.kind)) problems.push(`group-kind-invalid:${group.groupId}`)
      if (group?.color !== undefined && (typeof group.color !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(group.color))) {
        problems.push(`group-color-invalid:${group.groupId}`)
      }
      if (group?.pinTop !== undefined && typeof group.pinTop !== 'boolean') problems.push(`group-pin-invalid:${group.groupId}`)
    }
    const labels = document.groups.map((group) => String(group?.label ?? '').trim().toLowerCase()).filter((label) => label !== '')
    if (new Set(labels).size !== labels.length) problems.push('group-label-duplicate')
  }
  if (document.members === null || typeof document.members !== 'object' || Array.isArray(document.members)) {
    problems.push('members-not-an-object')
  } else if (Array.isArray(document.groups)) {
    const known = new Set(document.groups.map((group) => group.groupId))
    for (const [id, member] of Object.entries(document.members)) {
      if (id === '') problems.push('member-id-blank')
      if (typeof member?.groupId !== 'string' || !known.has(member.groupId)) problems.push(`member-group-unknown:${id}`)
      if (member?.order !== undefined && !Number.isInteger(member.order)) problems.push(`member-order-invalid:${id}`)
      if (member?.role !== undefined && !MEMBER_ROLES.includes(member.role)) problems.push(`member-role-invalid:${id}`)
      if (member?.policy !== undefined) {
        if (typeof member.policy !== 'object' || member.policy === null) problems.push(`member-policy-invalid:${id}`)
        else {
          const access = member.policy.access
          if (access !== undefined && !MEMBER_POLICIES.includes(access)) problems.push(`member-policy-access-invalid:${id}`)
          if (member.policy.reason !== undefined && typeof member.policy.reason !== 'string') {
            problems.push(`member-policy-reason-invalid:${id}`)
          }
        }
      }
    }
    // group.upstream: one-way link to a contract group.
    for (const group of document.groups) {
      if (group?.upstream === undefined) continue
      if (typeof group.upstream !== 'object' || group.upstream === null) {
        problems.push(`group-upstream-invalid:${group.groupId}`)
        continue
      }
      const target = document.groups.find((candidate) => candidate.groupId === group.upstream.contractGroupId)
      if (target === undefined) problems.push(`group-upstream-unknown:${group.groupId}`)
      else if (target.kind !== 'system') problems.push(`group-upstream-not-system:${group.groupId}`)
      if (group.upstream.contractSpec !== undefined && typeof group.upstream.contractSpec !== 'string') {
        problems.push(`group-upstream-spec-invalid:${group.groupId}`)
      }
      if (group.upstream.contractGroupId === group.groupId) problems.push(`group-upstream-self:${group.groupId}`)
    }
  }
  return problems
}

/**
 * Migrate an older in-memory document to the current unit version.
 * v1 -> v2: additive only (groups gain `kind: "project"`); never drops data.
 */
export function migrateDocument(document) {
  if (document === null || typeof document !== 'object') return document
  const version = document.unit?.version ?? 1
  if (version >= GROUPS_UNIT.version) return document
  const next = JSON.parse(JSON.stringify(document))
  next.unit = { ...GROUPS_UNIT }
  next.groups = (next.groups ?? []).map((group) => ({
    kind: group.kind ?? 'project',
    ...group,
  }))
  // v2 -> v3: roles/policies stay absent (absent means "no policy"), so a v1/v2
  // document keeps behaving exactly as before. Purely additive.
  return next
}

/** Read without side effects; a missing/corrupt file yields an empty document + diagnostics. */
export function readGroups(options) {
  const file = groupsFile(options)
  if (!fs.existsSync(file)) return { document: emptyDocument(), problems: [], status: 'absent' }
  try {
    const document = migrateDocument(JSON.parse(fs.readFileSync(file, 'utf8')))
    const problems = validateDocument(document)
    if (problems.length > 0) return { document: emptyDocument(), problems, status: 'invalid' }
    return { document, problems: [], status: 'ok' }
  } catch (error) {
    return {
      document: emptyDocument(),
      problems: [`parse-failed:${error instanceof Error ? error.message : String(error)}`],
      status: 'corrupt',
    }
  }
}

/** Atomic write (temp + rename on the same directory). */
export function writeGroups(options, document) {
  const problems = validateDocument(document)
  if (problems.length > 0) {
    const error = new Error(`refusing to write an invalid groups document: ${problems.join(', ')}`)
    error.code = 'GROUPS_INVALID'
    error.problems = problems
    throw error
  }
  fs.mkdirSync(options.stateDir, { recursive: true })
  const file = groupsFile(options)
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(temp, `${JSON.stringify(document, null, 2)}\n`)
  fs.renameSync(temp, file)
  return { file, problems: [] }
}

/**
 * Reassign every member `order` to a dense 0..n-1 sequence within its group,
 * preserving the current effective order.
 *
 * Duplicate or negative member orders make the sidebar order ambiguous: the
 * picker can then omit projects and drag-and-drop becomes a no-op.
 *
 * IMPORTANT: this must run BEFORE the mutator, never after. A caller that
 * explicitly assigns `order: 0` while another member already holds 0 must keep
 * its intent — normalizing afterwards would renumber by document position and
 * silently invert the requested order.
 *
 * @param {object} document - mutable groups document (pre-mutation)
 * @returns {number} count of members whose order actually changed
 */
export function normalizeMemberOrder(document) {
  if (document === null || typeof document !== 'object' || document.members === null) return 0
  if (typeof document.members !== 'object' || Array.isArray(document.members)) return 0
  let changed = 0
  const byGroup = new Map()
  for (const [workspaceId, member] of Object.entries(document.members)) {
    if (member === null || typeof member !== 'object') continue
    const groupId = String(member.groupId ?? '')
    if (!byGroup.has(groupId)) byGroup.set(groupId, [])
    byGroup.get(groupId).push({ workspaceId, member })
  }
  for (const entries of byGroup.values()) {
    // Nothing to disambiguate when every order is already a distinct integer.
    const seenOrders = new Set()
    let alreadyDense = true
    for (const { member } of entries) {
      if (!Number.isInteger(member.order) || member.order < 0 || seenOrders.has(member.order)) {
        alreadyDense = false
        break
      }
      seenOrders.add(member.order)
    }
    if (alreadyDense) continue
    entries.sort((a, b) => {
      const left = Number.isInteger(a.member.order) ? a.member.order : Number.MAX_SAFE_INTEGER
      const right = Number.isInteger(b.member.order) ? b.member.order : Number.MAX_SAFE_INTEGER
      return left === right ? 0 : left - right
    })
    entries.forEach(({ member }, index) => {
      if (member.order !== index) {
        member.order = index
        changed += 1
      }
    })
  }
  return changed
}

/** Replace the document only if it still validates; used by routes. */
export function mutateGroups(options, mutator) {
  const { document } = readGroups(options)
  const draft = JSON.parse(JSON.stringify(document))
  // Normalize the EXISTING document first, so any legacy duplicate/negative
  // orders are repaired without touching the order the mutator is about to set.
  const normalized = normalizeMemberOrder(draft)
  const result = mutator(draft)
  writeGroups(options, draft)
  return { document: draft, result, normalized }
}

export function listGroups(options) {
  const { document, status, problems } = readGroups(options)
  return {
    status,
    problems,
    groups: [...document.groups].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    members: document.members,
  }
}

export function upsertGroup(options, { groupId, label, order, index, kind, color, pinTop }) {
  if (typeof groupId !== 'string' || groupId.trim() === '') {
    const error = new Error('groupId is required')
    error.code = 'GROUP_ID_REQUIRED'
    throw error
  }
  return mutateGroups(options, (document) => {
    const existing = document.groups.find((group) => group.groupId === groupId)
    if (existing !== undefined) {
      if (typeof label === 'string' && label.trim() !== '') existing.label = label.trim()
      if (Number.isInteger(order)) existing.order = order
      if (typeof index === 'string') existing.index = index
      if (kind !== undefined && GROUP_KINDS.includes(kind)) existing.kind = kind
      if (typeof color === 'string') existing.color = color
      if (typeof pinTop === 'boolean') existing.pinTop = pinTop
      return { created: false, group: existing }
    }
    const group = {
      groupId,
      label: typeof label === 'string' && label.trim() !== '' ? label.trim() : groupId,
      order: Number.isInteger(order) ? order : document.groups.length,
    }
    if (typeof index === 'string') group.index = index
    group.kind = GROUP_KINDS.includes(kind) ? kind : 'project'
    if (typeof color === 'string') group.color = color
    if (typeof pinTop === 'boolean') group.pinTop = pinTop
    if (group.kind === 'system') group.pinTop = pinTop !== false
    document.groups.push(group)
    return { created: true, group }
  })
}

/**
 * Resolve a member by id, then by (path, title) fingerprint.
 * Returns undefined when nothing matches (i.e. the workspace is ungrouped).
 */
export function resolveMember(options, { workspaceId, path: workspacePath, title } = {}) {
  const { document } = readGroups(options)
  if (workspaceId !== undefined && document.members[String(workspaceId)] !== undefined) {
    return { workspaceId: String(workspaceId), member: document.members[String(workspaceId)], matchedBy: 'id' }
  }
  const wanted = fingerprintOf({ path: workspacePath, title })
  if (wanted.path === '' && wanted.title === '') return undefined
  for (const [id, member] of Object.entries(document.members)) {
    if (sameFingerprint(member.fingerprint, wanted)) {
      return { workspaceId: id, member, matchedBy: 'fingerprint' }
    }
  }
  return undefined
}

/**
 * Re-point a member after the workspace id changed (folder rename / restore).
 * Idempotent: a no-op when `fromId` is not a member.
 */
export function repointWorkspace(options, { fromId, toId, path: workspacePath, title } = {}) {
  if (fromId === undefined || toId === undefined) {
    const error = new Error('repointWorkspace requires fromId and toId')
    error.code = 'REPOINT_ARGS'
    throw error
  }
  return mutateGroups(options, (document) => {
    const source = document.members[String(fromId)]
    if (source === undefined) return { repointed: false, reason: 'source-not-a-member' }
    delete document.members[String(fromId)]
    document.members[String(toId)] = {
      ...source,
      fingerprint: fingerprintOf({
        path: workspacePath ?? source.fingerprint?.path,
        title: title ?? source.fingerprint?.title,
      }),
    }
    return { repointed: true, toId: String(toId) }
  })
}

/** Keep the fingerprint fresh after a title-only rename (id unchanged). */
export function refreshFingerprint(options, { workspaceId, path: workspacePath, title } = {}) {
  if (workspaceId === undefined) return { refreshed: false, reason: 'no-workspace-id' }
  return mutateGroups(options, (document) => {
    const member = document.members[String(workspaceId)]
    if (member === undefined) return { refreshed: false, reason: 'not-a-member' }
    member.fingerprint = fingerprintOf({
      path: workspacePath ?? member.fingerprint?.path,
      title: title ?? member.fingerprint?.title,
    })
    return { refreshed: true }
  })
}

export function assignMember(options, { workspaceId, groupId, order, path: workspacePath, title } = {}) {
  if (workspaceId === undefined) {
    const error = new Error('workspaceId is required')
    error.code = 'MEMBER_ID_REQUIRED'
    throw error
  }
  return mutateGroups(options, (document) => {
    if (!document.groups.some((group) => group.groupId === groupId)) {
      const error = new Error(`unknown group: ${groupId}`)
      error.code = 'GROUP_UNKNOWN'
      throw error
    }
    const existing = document.members[String(workspaceId)]
    document.members[String(workspaceId)] = {
      groupId,
      order: Number.isInteger(order) ? order : existing?.order ?? Object.keys(document.members).length,
      fingerprint: fingerprintOf({
        path: workspacePath ?? existing?.fingerprint?.path,
        title: title ?? existing?.fingerprint?.title,
      }),
    }
    return { assigned: true }
  })
}

export function removeMember(options, workspaceId) {
  return mutateGroups(options, (document) => {
    if (document.members[String(workspaceId)] === undefined) return { removed: false }
    delete document.members[String(workspaceId)]
    return { removed: true }
  })
}

/**
 * Produce the grouped view for the sidebar: every registered workspace is placed
 * either in its group or in the visible `ungrouped` bucket. Empty groups are kept.
 */
export function buildGroupedView(options, workspaces = []) {
  const { document, status, problems } = readGroups(options)
  const byGroup = new Map(document.groups.map((group) => [group.groupId, { group, items: [] }]))
  const fingerprintIndex = new Map()
  for (const [id, member] of Object.entries(document.members)) {
    const key = member.fingerprint?.path
    if (key !== undefined) fingerprintIndex.set(`${key}\u0000${member.fingerprint?.title ?? ''}`, id)
  }
  const resolve = (workspace) => {
    const id = String(workspace.id ?? workspace.workspaceId ?? '')
    if (document.members[id] !== undefined) return { workspaceId: id, member: document.members[id], matchedBy: 'id' }
    const fp = fingerprintOf({ path: workspace.path, title: workspace.title })
    const hit = fingerprintIndex.get(`${fp.path}\u0000${fp.title}`)
    if (hit === undefined) return undefined
    return { workspaceId: hit, member: document.members[hit], matchedBy: 'fingerprint' }
  }
  const ungrouped = []
  const stale = []
  for (const workspace of workspaces) {
    const resolved = resolve(workspace)
    if (resolved === undefined) {
      ungrouped.push(workspace)
      continue
    }
    const liveId = String(workspace.id ?? workspace.workspaceId ?? '')
    if (resolved.matchedBy === 'fingerprint' && liveId !== resolved.workspaceId) {
      stale.push({ staleId: resolved.workspaceId, liveId })
    }
    const bucket = byGroup.get(resolved.member.groupId)
    if (bucket === undefined) {
      ungrouped.push(workspace)
      continue
    }
    bucket.items.push({ workspace, order: resolved.member.order ?? 0, matchedBy: resolved.matchedBy })
  }
  const groups = [...byGroup.values()]
    .sort((a, b) => (a.group.order ?? 0) - (b.group.order ?? 0))
    .map(({ group, items }) => ({
      ...group,
      items: items.sort((a, b) => a.order - b.order).map((entry) => entry.workspace),
      empty: items.length === 0,
    }))
  return { status, problems, groups, ungrouped, staleIdHint: stale }
}

/** Parse the `{GROUP}-{INDEX}-{SUB}` convention (returns `grouped:false` when it does not match). */
export function parseGroupedName(name) {
  if (typeof name !== 'string') return { grouped: false, reason: 'not-a-string' }
  const parts = name.split('-')
  if (parts.length < 3) return { grouped: false, reason: 'too-few-segments' }
  if (!/^\d{2,3}$/.test(parts[1])) return { grouped: false, reason: 'index-not-numeric' }
  const group = parts[0]
  const sub = parts.slice(2).join('-')
  if (group === '' || sub === '') return { grouped: false, reason: 'empty-segment' }
  return { grouped: true, group, index: parts[1], indexValue: Number.parseInt(parts[1], 10), sub }
}

/**
 * Compute the target sidebar order: pinned system groups first (by group order,
 * then member order), then project groups by `{INDEX}`, with ungrouped workspaces
 * last in their existing relative order.
 *
 * Pure: no filesystem or registry access, so it can be previewed safely.
 *
 * @returns {{ order: string[], moves: Array<{workspaceId:string,beforeWorkspaceId?:string}>, unchanged: boolean }}
 */
export function planSidebarOrder(options, workspaces = []) {
  const { document } = readGroups(options)
  const byId = new Map(workspaces.map((workspace) => [String(workspace.id ?? workspace.workspaceId), workspace]))
  const fingerprintIndex = new Map()
  for (const [id, member] of Object.entries(document.members)) {
    const key = `${member.fingerprint?.path ?? ''}\u0000${member.fingerprint?.title ?? ''}`
    fingerprintIndex.set(key, id)
  }
  const groupIndexOf = (workspace) => {
    const id = String(workspace.id ?? workspace.workspaceId)
    if (document.members[id] !== undefined) return { member: document.members[id], matchedBy: 'id' }
    const fp = { path: path.resolve(workspace.path ?? '').replace(/\\/g, '/').toLowerCase(), title: workspace.title ?? '' }
    const hit = fingerprintIndex.get(`${fp.path}\u0000${fp.title}`)
    return hit === undefined ? undefined : { member: document.members[hit], matchedBy: 'fingerprint' }
  }

  const groupById = new Map(document.groups.map((group) => [group.groupId, group]))
  const buckets = new Map()
  const ungrouped = []
  const indexOf = new Map(workspaces.map((workspace, position) => [String(workspace.id ?? workspace.workspaceId), position]))

  for (const workspace of workspaces) {
    const resolved = groupIndexOf(workspace)
    const group = resolved === undefined ? undefined : groupById.get(resolved.member.groupId)
    if (group === undefined) {
      ungrouped.push(workspace)
      continue
    }
    if (!buckets.has(group.groupId)) buckets.set(group.groupId, { group, items: [] })
    buckets.get(group.groupId).items.push({ workspace, member: resolved.member })
  }

  const rank = (group) => (group.kind === 'system' ? 0 : 1)
  const orderedGroups = [...buckets.values()].sort((a, b) => {
    const byRank = rank(a.group) - rank(b.group)
    if (byRank !== 0) return byRank
    const byGroupOrder = (a.group.order ?? 0) - (b.group.order ?? 0)
    if (byGroupOrder !== 0) return byGroupOrder
    const ia = a.group.index
    const ib = b.group.index
    if (ia !== undefined && ib !== undefined && ia !== ib) return String(ia).localeCompare(String(ib))
    return String(a.group.groupId).localeCompare(String(b.group.groupId))
  })

  const order = []
  const seen = new Set()
  for (const { group, items } of orderedGroups) {
    const sorted = [...items].sort((a, b) => {
      // `{INDEX}` is authoritative for grouped members (directive: 00 -> 01 -> 02).
      // `member.order` is only a tie-breaker between members that share an index or
      // whose titles do not follow the convention.
      const pa = parseGroupedName(a.workspace.title ?? '')
      const pb = parseGroupedName(b.workspace.title ?? '')
      if (pa.grouped && pb.grouped && pa.indexValue !== pb.indexValue) return pa.indexValue - pb.indexValue
      if (pa.grouped !== pb.grouped) return pa.grouped ? -1 : 1
      const byMember = (a.member.order ?? 0) - (b.member.order ?? 0)
      if (byMember !== 0) return byMember
      // Stable fallback: preserve the caller's existing relative order.
      return (indexOf.get(String(a.workspace.id ?? a.workspace.workspaceId)) ?? 0) -
             (indexOf.get(String(b.workspace.id ?? b.workspace.workspaceId)) ?? 0)
    })
    for (const item of sorted) {
      const id = String(item.workspace.id ?? item.workspace.workspaceId)
      if (seen.has(id)) continue
      seen.add(id)
      order.push(id)
    }
    void group
  }
  for (const workspace of ungrouped) {
    const id = String(workspace.id ?? workspace.workspaceId)
    if (seen.has(id)) continue
    seen.add(id)
    order.push(id)
  }

  // Derive the minimal insertBefore chain from the current order.
  const current = workspaces.map((workspace) => String(workspace.id ?? workspace.workspaceId))
  const moves = []
  const working = [...current]
  for (let target = 0; target < order.length; target += 1) {
    const desired = order[target]
    const at = working.indexOf(desired)
    if (at === target) continue
    working.splice(at, 1)
    working.splice(target, 0, desired)
    moves.push({ workspaceId: desired, beforeWorkspaceId: working[target + 1] })
  }
  // A move whose anchor equals the item itself is meaningless.
  const normalised = moves.filter((move) => move.beforeWorkspaceId !== move.workspaceId)

  return {
    order,
    moves: normalised,
    unchanged: normalised.length === 0 && order.length === current.length && order.every((id, i) => id === current[i]),
    groups: orderedGroups.map(({ group, items }) => ({
      groupId: group.groupId,
      label: group.label,
      kind: group.kind ?? 'project',
      pinTop: group.pinTop === true,
      color: group.color,
      count: items.length,
    })),
  }
}
