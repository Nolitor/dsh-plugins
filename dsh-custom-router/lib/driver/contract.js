/**
 * Provider driver contract — the single shape every provider driver must satisfy.
 *
 * A driver is declarative: descriptor data, pure hooks, surface names, and the
 * activation switches that mount it. This module is a leaf — it imports nothing,
 * so a provider adapter can depend on it without creating a cycle.
 *
 * Hooks must be PURE: no I/O (no filesystem, network, process or clock reads),
 * no mutation of shared state, and they never receive ctx. A hook slot that is
 * present but not a function is rejected here, not at call time.
 */

const TOOL_CALL_SHAPES = Object.freeze(['fragmented', 'complete'])
const TOTAL_FORMULAS = Object.freeze(['prompt+output', 'gemini'])
const MALFORMED_POLICIES = Object.freeze(['fail', 'skip'])
const AUTH_MODES = Object.freeze(['web-auth', 'api-key', 'daemon'])
const OPTIONAL_HOOKS = Object.freeze([
  'classifyText',
  'classifyReasoning',
  'classifyBlock',
  'onPart',
  'flush',
  'mapFinish',
  'usageFrom',
  'onMalformed',
  'onEmpty',
  'onCut',
])

function fail(path, message) {
  throw new Error(`${path}: ${message}`)
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reject an own `__proto__`/`constructor`/`prototype` key anywhere in the spec.
 * These keys are how a declarative object reaches the real prototype chain; the
 * builder copies fields explicitly, but deepFreeze would otherwise descend into
 * the caller's payload (measured: an own `__proto__` froze Object.prototype
 * process-wide).
 */
function assertNoReservedKeys(value, path, seen = new Set()) {
  if (value === null || typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)
  for (const key of Object.getOwnPropertyNames(value)) {
    if (DANGEROUS_KEYS.has(key)) fail(`${path}.${key}`, 'must not be a reserved object key')
    assertNoReservedKeys(value[key], `${path}.${key}`, seen)
  }
}

function requireObject(value, path) {
  if (!isPlainObject(value)) fail(path, 'must be an object')
  return value
}

function requireString(value, path) {
  if (typeof value !== 'string') fail(path, 'must be a string')
  if (value.trim() === '') fail(path, 'must be a non-empty string')
  return value
}

function optionalString(value, path) {
  if (value === undefined) return undefined
  return requireString(value, path)
}

function requireEnum(value, path, allowed) {
  if (!allowed.includes(value)) {
    fail(path, `must be one of ${allowed.map((v) => `'${v}'`).join(' | ')}, received ${JSON.stringify(value)}`)
  }
  return value
}

function requireNameList(value, path) {
  if (value === undefined) return
  if (!Array.isArray(value)) fail(path, 'must be an array of strings')
  value.forEach((name, i) => requireString(name, `${path}[${i}]`))
}

function requirePositiveInteger(value, path) {
  if (!Number.isInteger(value) || value < 1) fail(path, 'must be a positive integer')
  return value
}

function validateActivation(activation, at) {
  if (!Array.isArray(activation.switches)) fail(at('activation.switches'), 'must be an array')
  activation.switches.forEach((sw, i) => {
    const path = at(`activation.switches[${i}]`)
    requireObject(sw, path)
    requireString(sw.name, `${path}.name`)
    requireString(sw.module, `${path}.module`)
    requireString(sw.role, `${path}.role`)
  })

  if (activation.readiness === undefined) return
  const readiness = requireObject(activation.readiness, at('activation.readiness'))
  requireString(readiness.bridge, at('activation.readiness.bridge'))
  const { catalogLayer } = readiness
  if (typeof catalogLayer !== 'string' && typeof catalogLayer !== 'number') {
    fail(at('activation.readiness.catalogLayer'), 'must be a string or a number')
  }
  if (typeof catalogLayer === 'string' && catalogLayer.trim() === '') {
    fail(at('activation.readiness.catalogLayer'), 'must be a non-empty string')
  }
  requireEnum(readiness.auth, at('activation.readiness.auth'), AUTH_MODES)
  optionalString(readiness.health, at('activation.readiness.health'))
}

function validateSurfaces(surfaces, at) {
  const model = requireObject(surfaces.model, at('surfaces.model'))
  if (model.adapter !== true) fail(at('surfaces.model.adapter'), 'must be true')
  requireString(model.factory, at('surfaces.model.factory'))

  if (surfaces.cli !== undefined) {
    const cli = requireObject(surfaces.cli, at('surfaces.cli'))
    requireString(cli.toolName, at('surfaces.cli.toolName'))
    optionalString(cli.commandName, at('surfaces.cli.commandName'))
  }

  if (surfaces.subagent !== undefined) {
    const subagent = requireObject(surfaces.subagent, at('surfaces.subagent'))
    requireString(subagent.toolRow, at('surfaces.subagent.toolRow'))
    requireString(subagent.toolName, at('surfaces.subagent.toolName'))
    requirePositiveInteger(subagent.maxDepth, at('surfaces.subagent.maxDepth'))
  }

  if (surfaces.batch !== undefined) {
    const batch = requireObject(surfaces.batch, at('surfaces.batch'))
    requireString(batch.toolName, at('surfaces.batch.toolName'))
    if (batch.gate !== undefined && typeof batch.gate !== 'function') {
      requireString(batch.gate, at('surfaces.batch.gate'))
    }
  }

  requireNameList(surfaces.tools, at('surfaces.tools'))
  requireNameList(surfaces.commands, at('surfaces.commands'))
}

/**
 * Validate a driver spec. `prefix` is the field-path root: '' for a single
 * definition, `driver[<i>]` inside the registry check.
 */
function validateDriverSpec(spec, prefix) {
  const at = (key) => (prefix ? `${prefix}.${key}` : key)

  if (!isPlainObject(spec)) fail(prefix || 'driver', 'must be an object')
  assertNoReservedKeys(spec, prefix || 'driver')
  requireString(spec.id, at('id'))

  const { descriptor } = spec
  requireObject(descriptor, at('descriptor'))
  requireEnum(descriptor.toolCallShape, at('descriptor.toolCallShape'), TOOL_CALL_SHAPES)
  requireObject(descriptor.usage, at('descriptor.usage'))
  requireEnum(descriptor.usage.totalFormula, at('descriptor.usage.totalFormula'), TOTAL_FORMULAS)
  requireEnum(descriptor.malformedRecord, at('descriptor.malformedRecord'), MALFORMED_POLICIES)

  const hooks = requireObject(spec.hooks, at('hooks'))
  // OWN enumeration is required: the builder copies hooks explicitly, so an
  // inherited function would validate and then vanish from the built driver.
  if (!Object.prototype.hasOwnProperty.call(hooks, 'readEvent') || typeof hooks.readEvent !== 'function') {
    fail(at('hooks.readEvent'), 'must be an own function')
  }
  for (const key of OPTIONAL_HOOKS) {
    if (!Object.prototype.hasOwnProperty.call(hooks, key)) continue
    if (hooks[key] === undefined) continue
    if (typeof hooks[key] !== 'function') fail(at(`hooks.${key}`), 'must be a function when present')
  }

  const surfaces = requireObject(spec.surfaces, at('surfaces'))
  validateSurfaces(surfaces, at)

  requireObject(spec.activation, at('activation'))
  validateActivation(spec.activation, at)
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  if (Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const key of Object.getOwnPropertyNames(value)) {
    if (DANGEROUS_KEYS.has(key)) continue
    deepFreeze(value[key])
  }
  return value
}

/** Copy only the declared hooks (own keys), so a spread cannot drop one. */
function buildHooks(hooks) {
  const built = { readEvent: hooks.readEvent }
  for (const key of OPTIONAL_HOOKS) {
    if (!Object.prototype.hasOwnProperty.call(hooks, key)) continue
    if (hooks[key] === undefined) continue
    built[key] = hooks[key]
  }
  return built
}

/** Copy the validated spec into a fresh, deeply frozen driver definition. */
function buildDriver(spec) {
  const { surfaces, activation } = spec
  const built = {
    id: spec.id,
    descriptor: {
      toolCallShape: spec.descriptor.toolCallShape,
      usage: { totalFormula: spec.descriptor.usage.totalFormula },
      malformedRecord: spec.descriptor.malformedRecord,
    },
    hooks: buildHooks(spec.hooks),
    surfaces: {
      model: { adapter: true, factory: surfaces.model.factory },
      ...(surfaces.cli
        ? {
            cli: {
              toolName: surfaces.cli.toolName,
              ...(surfaces.cli.commandName !== undefined ? { commandName: surfaces.cli.commandName } : {}),
            },
          }
        : {}),
      ...(surfaces.subagent
        ? {
            subagent: {
              toolRow: surfaces.subagent.toolRow,
              toolName: surfaces.subagent.toolName,
              maxDepth: surfaces.subagent.maxDepth,
            },
          }
        : {}),
      ...(surfaces.batch
        ? {
            batch: {
              toolName: surfaces.batch.toolName,
              ...(surfaces.batch.gate !== undefined ? { gate: surfaces.batch.gate } : {}),
            },
          }
        : {}),
      ...(surfaces.tools !== undefined ? { tools: [...surfaces.tools] } : {}),
      ...(surfaces.commands !== undefined ? { commands: [...surfaces.commands] } : {}),
    },
    activation: {
      switches: activation.switches.map((sw) => ({ name: sw.name, module: sw.module, role: sw.role })),
      ...(activation.readiness !== undefined
        ? {
            readiness: {
              bridge: activation.readiness.bridge,
              catalogLayer: activation.readiness.catalogLayer,
              auth: activation.readiness.auth,
              ...(activation.readiness.health !== undefined ? { health: activation.readiness.health } : {}),
            },
          }
        : {}),
    },
  }
  return deepFreeze(built)
}

/** Frozen, validated driver definition. Throws with the offending field path. */
export function defineProviderDriver(spec) {
  validateDriverSpec(spec, '')
  return buildDriver(spec)
}

/**
 * Every name the driver declares, with the field it came from. This is the one
 * union implementation; effectiveSurfaceNames and the registry check both use it.
 */
function surfaceProvenance(driver) {
  if (!isPlainObject(driver) || !isPlainObject(driver.surfaces)) {
    fail('surfaces', 'must be an object')
  }
  const { surfaces } = driver
  const tools = []
  const commands = []

  const collect = (list, target, base) => {
    if (list === undefined) return
    if (!Array.isArray(list)) fail(base, 'must be an array of strings')
    list.forEach((name, i) => {
      requireString(name, `${base}[${i}]`)
      target.push({ name, source: `${base}[${i}]` })
    })
  }

  collect(surfaces.tools, tools, 'surfaces.tools')
  collect(surfaces.commands, commands, 'surfaces.commands')

  if (isPlainObject(surfaces.cli)) {
    if (surfaces.cli.toolName !== undefined) {
      tools.push({ name: surfaces.cli.toolName, source: 'surfaces.cli.toolName' })
    }
    if (surfaces.cli.commandName !== undefined) {
      commands.push({ name: surfaces.cli.commandName, source: 'surfaces.cli.commandName' })
    }
  }
  if (isPlainObject(surfaces.subagent) && surfaces.subagent.toolName !== undefined) {
    tools.push({ name: surfaces.subagent.toolName, source: 'surfaces.subagent.toolName' })
  }
  if (isPlainObject(surfaces.batch) && surfaces.batch.toolName !== undefined) {
    tools.push({ name: surfaces.batch.toolName, source: 'surfaces.batch.toolName' })
  }

  return { tools, commands }
}

/**
 * The normalised name sets a driver actually occupies: surfaces.tools, cli,
 * subagent and batch tool names unioned, plus surfaces.commands and the CLI
 * command name. De-duplicated and sorted, so registry checks never depend on
 * the raw field layout.
 */
export function effectiveSurfaceNames(driver) {
  const { tools, commands } = surfaceProvenance(driver)
  return {
    tools: [...new Set(tools.map((entry) => entry.name))].sort(),
    commands: [...new Set(commands.map((entry) => entry.name))].sort(),
  }
}

function sourceOf(driver, kind, name) {
  const entries = surfaceProvenance(driver)[kind]
  const hit = entries.find((entry) => entry.name === name)
  return hit ? hit.source : `surfaces.${kind}`
}

/**
 * Validate a set of driver specs: field paths, then id uniqueness, then tool and
 * command name collisions across drivers via effectiveSurfaceNames. One Error,
 * naming the offending field path. Returns the frozen driver array.
 */
export function validateDrivers(drivers) {
  if (!Array.isArray(drivers)) fail('drivers', 'must be an array')

  const built = []
  const idOwners = new Map()
  const toolOwners = new Map()
  const commandOwners = new Map()

  drivers.forEach((spec, i) => {
    const prefix = `driver[${i}]`
    validateDriverSpec(spec, prefix)
    const driver = buildDriver(spec)

    const idOwner = idOwners.get(driver.id)
    if (idOwner !== undefined) {
      fail(`${prefix}.id`, `duplicate id '${driver.id}' (already declared at driver[${idOwner}].id)`)
    }
    idOwners.set(driver.id, i)

    const names = effectiveSurfaceNames(driver)
    const check = (kind, owners) => {
      for (const name of names[kind]) {
        const owner = owners.get(name)
        if (owner !== undefined) {
          const path = `${prefix}.${sourceOf(driver, kind, name)}`
          fail(path, `${kind.slice(0, -1)} name '${name}' already declared at driver[${owner.index}].${owner.source}`)
        }
        owners.set(name, { index: i, source: sourceOf(driver, kind, name) })
      }
    }
    check('tools', toolOwners)
    check('commands', commandOwners)

    built.push(driver)
  })

  return Object.freeze(built)
}
