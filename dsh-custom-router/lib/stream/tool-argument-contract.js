/**
 * Tool-argument contract reconciliation — the L1 seam that makes a streamed
 * tool call EXECUTABLE, without knowing which vendor or wire produced it.
 *
 * WHY THIS EXISTS
 * A provider gives us argument JSON as the model wrote it. The host, before it
 * executes a call, enforces CONTRACTS the provider's own schema cannot express.
 * Measured 2026-11-14 (`@deepseek-ai/dsh-sandbox` `validateEscalationArgs`):
 *
 *   sandbox_permissions defined, justification undefined
 *     -> SandboxEscalationError "invalid escalation: sandbox_permissions
 *        requires a justification"
 *   justification defined, sandbox_permissions undefined
 *     -> SandboxEscalationError "invalid escalation: justification is only
 *        valid together with sandbox_permissions"
 *   justification defined but blank after trim
 *     -> SandboxEscalationError "invalid justification: expected a non-empty
 *        sentence"
 *
 * The host validates this on the EXECUTION path, not on the wire, so a call the
 * model emitted in a drifted shape reaches it intact and the turn dies with a
 * runtime error the model cannot see coming. That is what happened on a live
 * Gemini/Antigravity run: a `write` call carried `justification` alone (its
 * sibling `sandbox_permissions` was pruned or never emitted) and the host
 * refused the escalation.
 *
 * WHY L1 AND NOT A VENDOR
 * Every vendor in this router hands its tool calls to the ONE shared pipe
 * (`normalizeStream`), and the pipe's `block-end` block is authoritative for
 * execution: the host's `BlockAssembler` keeps `partial.block` and ignores the
 * accumulated `tool-call-delta` text once a block closes. So this one function,
 * applied at the single emission point, covers all four vendors and any future
 * one — a per-vendor patch would have to be written four times and would go
 * stale for the fifth. It also carries no vendor name, no model name and no
 * per-vendor branch, so the L1 boundary rule is untouched.
 *
 * WHY THE RULE IS DERIVED, NOT A FIELD NAME
 * The pairing is not a Gemini quirk and not a `justification` quirk: it is a
 * HOST contract, and the host states its pairings the only way JSON Schema
 * lets it — in the dependent field's `description`, with the stable phrase
 * "Required with <other_field>" (measured on `dsh-tool-bash`, `dsh-tool-fs`
 * and `dsh-tool-pwsh`, all three spelling it identically). This module reads
 * that phrase out of the tool schema the request itself carries, so the rules
 * come from the declared contract rather than from a list of field names
 * maintained here. A future host contract that phrases its dependency the same
 * way is covered with no edit; a field hardcoded here would silently miss it.
 * `tool-argument-contract.test.mjs` pins the derivation against the measured
 * host text so a rephrasing upstream fails a test instead of going quiet.
 *
 * @module @nolit/dsh-custom-router/stream/tool-argument-contract
 */

/** The phrase the host uses to declare a dependent argument, in its own schema prose. */
const DEPENDENCY_PHRASE = /\bRequired with\s+([a-z][a-z0-9_]*)\b/i

/**
 * A JSON value that carries nothing a user would miss.
 * @param {unknown} value - candidate.
 * @returns {boolean} true for undefined, null, and whitespace-only strings.
 */
function blank(value) {
  if (value === undefined || value === null) return true
  return typeof value === 'string' && value.trim().length === 0
}

/**
 * Dependent-argument pairs declared by one tool schema.
 *
 * A pair is `{ field, requires }`: `field` may only appear when `requires` is
 * present. Derived from the schema's `description` text, never from a field
 * list, so it follows the host's declaration rather than a copy of it.
 *
 * @param {object|undefined|null} schema - the tool's `parameters` JSON Schema.
 * @returns {{ field: string, requires: string }[]} declared pairs, empty when none.
 */
export function dependentArguments(schema) {
  const properties = schema?.properties
  if (properties === null || typeof properties !== 'object') return []
  const pairs = []
  for (const [field, declaration] of Object.entries(properties)) {
    const description = declaration?.description
    if (typeof description !== 'string') continue
    const match = DEPENDENCY_PHRASE.exec(description)
    if (match === null) continue
    const requires = match[1]
    // A declaration naming itself, or a field the schema does not carry, states
    // no constraint this layer can enforce.
    if (requires === field || !Object.hasOwn(properties, requires)) continue
    pairs.push({ field, requires })
  }
  return pairs
}

/**
 * Reconcile one call's arguments with a tool schema's declared contracts.
 *
 * Deliberately narrow: it repairs the ONE malformed shape the host refuses and
 * leaves every other argument byte-identical, so a well-formed escalation is
 * passed through untouched and a call with no escalation at all is returned
 * as-is (same reference, no copy).
 *
 * The repair direction is fixed by what the model meant. A dependent field
 * present WITHOUT its principal is dropped: the principal is what grants wider
 * access, so a lone reason asks for nothing and cannot be honoured — dropping
 * the reason turns an unrunnable call into the un-escalated call the model
 * would have made anyway, which the sandbox then refuses or allows on its own
 * merits. A principal present with a present-but-blank dependent keeps the
 * escalation (the model DID ask for wider access) and supplies no fabricated
 * reason: the blank value is removed so the host reports the missing reason
 * rather than a malformed pair. Nothing here invents a justification — a
 * fabricated approval reason would be a safety regression, not a repair.
 *
 * @param {unknown} args - parsed call arguments (any JSON value).
 * @param {object|undefined|null} schema - the tool's `parameters` JSON Schema.
 * @returns {unknown} reconciled arguments; the same reference when nothing changed.
 */
export function reconcileToolArguments(args, schema) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return args
  const pairs = dependentArguments(schema)
  if (pairs.length === 0) return args
  let out = args
  for (const { field, requires } of pairs) {
    if (!Object.hasOwn(out, field)) continue
    if (blank(out[requires])) {
      // The dependent stands alone: drop it, keep everything else.
      if (out === args) out = { ...args }
      delete out[field]
      continue
    }
    // The pair is well formed; a blank dependent cannot be honoured either, so
    // remove it and let the host name the missing reason.
    if (blank(out[field])) {
      if (out === args) out = { ...args }
      delete out[field]
    }
  }
  return out
}

/**
 * Reconcile the JSON-string form the pipe carries.
 *
 * Tool arguments travel as a raw JSON string end-to-end (the host contract), so
 * this is the shape the emission point holds. Unparseable text is returned
 * unchanged: an argument string this layer cannot read is a provider/stream
 * defect the failure policy owns, and rewriting it here would hide that.
 *
 * @param {string} text - raw argument JSON.
 * @param {object|undefined|null} schema - the tool's `parameters` JSON Schema.
 * @returns {string} the reconciled JSON string (the same string when unchanged).
 */
export function reconcileArgumentText(text, schema) {
  if (typeof text !== 'string' || text.length === 0) return text
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return text
  }
  const reconciled = reconcileToolArguments(parsed, schema)
  if (reconciled === parsed) return text
  return JSON.stringify(reconciled)
}
