/**
 * Control-tower (HQ) tree derivation for the Workspace Manager panel.
 *
 * Pure and contract-free: it consumes plain workspace records and the groups
 * registry document, and emits a render-ready tree. Nothing here touches the
 * DOM, the native sidebar, or any private DSH surface.
 *
 * Hierarchy rule (from the directive):
 *   {GROUP}-00-{MAIN}   -> the group's HQ / control tower
 *   {GROUP}-NN-{SUB}    -> decoupled sub-modules that roll up to the HQ
 *
 * A group with no `-00-` member still renders, with `hq: null`, so partially
 * adopted groups are visible rather than silently dropped.
 */
import { parseGroupedName } from './groups.mjs'

const KIND_ORDER = { system: 0, project: 1 }

/**
 * @param {object} input
 * @param {Array<{id:string,path:string,title:string,sessionCount?:number}>} input.workspaces
 * @param {object} input.document - a groups.json document (already migrated)
 * @returns {{ groups: Array<object>, ungrouped: Array<object>, totals: object }}
 */
export function buildHqTree({ workspaces = [], document }) {
  const groups = document?.groups ?? []
  const members = document?.members ?? {}
  const groupById = new Map(groups.map((group) => [group.groupId, group]))
  const fingerprintIndex = new Map()
  for (const [id, member] of Object.entries(members)) {
    const key = `${member.fingerprint?.path ?? ''}\u0000${member.fingerprint?.title ?? ''}`
    fingerprintIndex.set(key, id)
  }

  const resolve = (workspace) => {
    const id = String(workspace.id ?? workspace.workspaceId ?? '')
    if (members[id] !== undefined) return { member: members[id], matchedBy: 'id' }
    const key = `${normalize(workspace.path)}\u0000${workspace.title ?? ''}`
    const hit = fingerprintIndex.get(key)
    return hit === undefined ? undefined : { member: members[hit], matchedBy: 'fingerprint' }
  }

  const buckets = new Map()
  const ungrouped = []
  const looseByGroup = new Map() // parsed group prefix -> workspaces not explicitly assigned

  for (const workspace of workspaces) {
    const resolved = resolve(workspace)
    if (resolved === undefined) {
      // Fall back to the naming convention so an unregistered but well-named
      // workspace still appears under its logical group (proposal only).
      const parsed = parseGroupedName(workspace.title ?? '')
      if (parsed.grouped) {
        if (!looseByGroup.has(parsed.group)) looseByGroup.set(parsed.group, [])
        looseByGroup.get(parsed.group).push({ workspace, parsed })
      } else {
        ungrouped.push(workspace)
      }
      continue
    }
    const group = groupById.get(resolved.member.groupId)
    if (group === undefined) {
      ungrouped.push(workspace)
      continue
    }
    if (!buckets.has(group.groupId)) buckets.set(group.groupId, { group, items: [] })
    buckets.get(group.groupId).items.push({ workspace, member: resolved.member, matchedBy: resolved.matchedBy })
  }

  const sortGroup = (a, b) => {
    const byKind = (KIND_ORDER[a.group.kind] ?? 9) - (KIND_ORDER[b.group.kind] ?? 9)
    if (byKind !== 0) return byKind
    const byOrder = (a.group.order ?? 0) - (b.group.order ?? 0)
    if (byOrder !== 0) return byOrder
    return String(a.group.groupId).localeCompare(String(b.group.groupId))
  }

  const nodes = [...buckets.values()]
    .sort(sortGroup)
    .map(({ group, items }) => {
      const enriched = items.map(({ workspace, member, matchedBy }) => {
        const parsed = parseGroupedName(workspace.title ?? '')
        return {
          workspace,
          member,
          matchedBy,
          index: parsed.grouped ? parsed.index : undefined,
          indexValue: parsed.grouped ? parsed.indexValue : Number.POSITIVE_INFINITY,
          sub: parsed.grouped ? parsed.sub : workspace.title,
          isHq: parsed.grouped ? parsed.indexValue === 0 : false,
        }
      })
      enriched.sort((a, b) => {
        if (a.indexValue !== b.indexValue) return a.indexValue - b.indexValue
        return (a.member.order ?? 0) - (b.member.order ?? 0)
      })
      const hq = enriched.find((entry) => entry.isHq) ?? null
      const modules = enriched.filter((entry) => entry !== hq)
      const sessions = enriched.reduce((sum, entry) => sum + (entry.workspace.sessionCount ?? 0), 0)
      return {
        groupId: group.groupId,
        label: group.label,
        kind: group.kind ?? 'project',
        pinTop: group.pinTop === true,
        color: group.color,
        order: group.order ?? 0,
        hq,
        modules,
        loose: [], // explicit members only
        sessionCount: sessions,
        workspaceCount: enriched.length,
        empty: enriched.length === 0,
        complete: hq !== null,
      }
    })

  // Surface convention-only groups as proposals (never auto-registered).
  for (const [prefix, entries] of looseByGroup) {
    const alreadyCovered = nodes.some((node) => node.label === prefix || node.groupId === prefix)
    if (alreadyCovered) {
      const node = nodes.find((candidate) => candidate.label === prefix || candidate.groupId === prefix)
      node.loose = entries
        .map(({ workspace, parsed }) => ({ workspace, index: parsed.index, indexValue: parsed.indexValue, sub: parsed.sub, isHq: parsed.indexValue === 0 }))
        .sort((a, b) => a.indexValue - b.indexValue)
      node.workspaceCount += node.loose.length
      node.sessionCount += node.loose.reduce((sum, entry) => sum + (entry.workspace.sessionCount ?? 0), 0)
      continue
    }
    nodes.push({
      groupId: `proposed:${prefix}`,
      label: prefix,
      kind: 'project',
      proposed: true,
      pinTop: false,
      order: Number.MAX_SAFE_INTEGER,
      hq: entries.find((entry) => entry.parsed.indexValue === 0) ?? null,
      modules: entries
        .filter((entry) => entry.parsed.indexValue !== 0)
        .map(({ workspace, parsed }) => ({ workspace, index: parsed.index, indexValue: parsed.indexValue, sub: parsed.sub, isHq: false }))
        .sort((a, b) => a.indexValue - b.indexValue),
      loose: [],
      sessionCount: entries.reduce((sum, entry) => sum + (entry.workspace.sessionCount ?? 0), 0),
      workspaceCount: entries.length,
      empty: false,
      complete: entries.some((entry) => entry.parsed.indexValue === 0),
    })
  }

  return {
    groups: nodes,
    ungrouped,
    totals: {
      groups: nodes.length,
      workspaces: workspaces.length,
      hqPresent: nodes.filter((node) => node.hq !== null).length,
      proposed: nodes.filter((node) => node.proposed === true).length,
    },
  }
}

function normalize(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/\\/g, '/').toLowerCase()
}
