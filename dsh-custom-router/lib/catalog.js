/**
 * Catalog merge — the 3-layer synchronization the owner fixed on 2026-11-07.
 *
 * Layer 1 `upstream`: the pi-ai static snapshot (default fallback).
 * Layer 2 `probe`:    a live API / web-auth probe of an endpoint that advertises models.
 * Layer 3 `override`: manual preset/local data (local models, new prices).
 *
 * Precedence is 3 > 2 > 1 and merging is **field-level**: a later layer patches
 * only the fields it defines, so a pricing override does not erase the context
 * window the upstream snapshot supplied (and vice versa). Each merged model
 * records the highest layer that contributed to it (`source`) plus the ordered
 * `layers` list, so a stale or surprising value can be traced.
 *
 * Pure module: no host context, no I/O, no registration.
 *
 * @module @nolit/dsh-custom-router/catalog
 */
import { CATALOG_LAYERS, validateCatalogModel, validateModelCost } from './preset-schema.js'

const RATE_FIELDS = Object.freeze(['input', 'output', 'cacheRead', 'cacheWrite'])

/**
 * Merge two cost records field by field; `tiers` replaces only when defined.
 * @param {object|undefined} base - lower-layer cost.
 * @param {object|undefined} patch - higher-layer cost.
 * @returns {object|undefined} merged cost.
 */
export function mergeCost(base, patch) {
  if (patch === undefined) return base
  const merged = { ...(base ?? {}) }
  for (const field of RATE_FIELDS) {
    if (patch[field] !== undefined) merged[field] = patch[field]
  }
  if (patch.tiers !== undefined) merged.tiers = patch.tiers
  return merged
}

/**
 * Merge one model entry field by field.
 * @param {object|undefined} base - lower-layer model.
 * @param {object} patch - higher-layer model.
 * @returns {object} merged model.
 */
export function mergeModel(base, patch) {
  const merged = { ...(base ?? {}), ...patch }
  if (patch.cost !== undefined || base?.cost !== undefined) {
    merged.cost = mergeCost(base?.cost, patch.cost)
  }
  return merged
}

/**
 * Merge the catalog layers for one provider.
 * @param {readonly {source: string, models?: object[], pricing?: {modelId: string, cost: object}[]}[]} [layers] - ordered layers.
 * @returns {{models: object[], errors: string[]}} merged catalog and validation errors.
 */
export function mergeCatalog(layers = []) {
  const errors = []
  if (!Array.isArray(layers)) return { models: [], errors: ['layers must be an array'] }
  const order = []
  for (const [index, layer] of layers.entries()) {
    if (layer === null || typeof layer !== 'object') { errors.push(`layer ${index} must be an object`); continue }
    const position = CATALOG_LAYERS.indexOf(layer.source)
    if (position === -1) { errors.push(`layer ${index} has an unknown source "${String(layer.source)}"`); continue }
    order.push(position)
    for (const model of layer.models ?? []) {
      errors.push(...validateCatalogModel(model, { partialCost: true }).map((error) => `${layer.source} model: ${error}`))
    }
    for (const item of layer.pricing ?? []) {
      if (item === null || typeof item !== 'object' || typeof item.modelId !== 'string' || item.modelId === '') {
        errors.push(`${layer.source} pricing entry needs a modelId`)
        continue
      }
      errors.push(...validateModelCost(item.cost, { partial: true }).map((error) => `${layer.source} pricing "${item.modelId}": ${error}`))
    }
  }
  for (let index = 1; index < order.length; index += 1) {
    if (order[index] < order[index - 1]) errors.push('layers must be ordered upstream → probe → override')
  }

  /** @type {Map<string, {model: object, layers: string[], source: string}>} */
  const merged = new Map()
  for (const layer of layers) {
    if (layer === null || typeof layer !== 'object' || !CATALOG_LAYERS.includes(layer.source)) continue
    for (const model of layer.models ?? []) {
      if (model === null || typeof model !== 'object' || typeof model.id !== 'string') continue
      const current = merged.get(model.id)
      merged.set(model.id, {
        model: mergeModel(current?.model, model),
        layers: [...(current?.layers ?? []), layer.source],
        source: layer.source,
      })
    }
    for (const item of layer.pricing ?? []) {
      if (item === null || typeof item !== 'object' || typeof item.modelId !== 'string') continue
      const current = merged.get(item.modelId)
      const base = current?.model ?? { id: item.modelId }
      merged.set(item.modelId, {
        model: mergeModel(base, { cost: item.cost }),
        layers: [...(current?.layers ?? []), layer.source],
        source: layer.source,
      })
    }
  }

  const models = [...merged.values()]
    .map((entry) => ({ ...entry.model, source: entry.source, layers: entry.layers }))
    .sort((left, right) => left.id.localeCompare(right.id))
  return { models, errors }
}

/**
 * Look up one merged model by id.
 * @param {readonly object[]} models - merged models.
 * @param {string} id - model id.
 * @returns {object|undefined} the model.
 */
export function findModel(models, id) {
  return models.find((model) => model.id === id)
}
