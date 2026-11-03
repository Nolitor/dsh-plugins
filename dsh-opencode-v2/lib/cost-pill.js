/**
 * Session cost pill for the composer status row.
 *
 * The chat status row renders one `span[data-composer-stat]` per statistic
 * (measured in dsh-client-ui-chat: `stats` -> activity, `usage` -> the token /
 * cache-hit readout). Those pills are chat-internal components, not slots, so a
 * plugin cannot register beside them — but the row is plain DOM, and the anchors
 * carry a stable data attribute. This module appends one more pill to that row.
 *
 * Design rules, each from a measurement:
 *
 *   - ONE pill for the whole session, never per message. A per-turn badge was
 *     explicitly rejected: it clutters the transcript.
 *   - The value is the session's cumulative cost and plan burn, which the server
 *     already computes per session (lib/cost.js) and serves on `model-settings`.
 *   - The row is re-rendered by React, so the node is re-attached by a
 *     MutationObserver instead of being injected once.
 *   - No layout shift: the pill copies the sibling pill's class list, so it is
 *     sized and coloured by the host's own stylesheet.
 *
 * @module @nolit/dsh-opencode-v2/cost-pill
 */

/** Attribute the host puts on every composer statistic pill. */
export const STAT_ATTR = 'data-composer-stat'

/** Marks the pill this plugin owns. */
export const OWN_ATTR = 'data-ocv2-cost'

/** Rendered when the session has cost the account nothing. */
export const FREE_LABEL = '무료'

/**
 * Format US dollars so a sub-cent amount is still readable.
 *
 * Measured plan burns are fractions of a cent (`0.00002786` for two requests),
 * so a fixed 2-decimal format would print `$0.00` forever.
 *
 * @param {number|null|undefined} usd - amount.
 * @returns {string} e.g. `$0.0041`, `$0.000028`, `$1.23`.
 */
export function formatUsd(usd) {
  if (typeof usd !== 'number' || !Number.isFinite(usd)) return ''
  if (usd === 0) return '$0'
  const abs = Math.abs(usd)
  if (abs >= 1) return '$' + usd.toFixed(2)
  if (abs >= 0.01) return '$' + usd.toFixed(4)
  // Below a cent: keep three significant digits so the number is not lost.
  return '$' + usd.toPrecision(3).replace(/0+$/, '').replace(/\.$/, '')
}

/**
 * Compose the pill text from a session cost summary.
 *
 * Shows the charged amount, and appends the plan burn when the session ran on a
 * subscription — a Go user pays $0 but still consumes the monthly limit, and an
 * unlabelled `$0` would look like a bug.
 *
 * @param {{costUsd?: number, allowanceUsd?: number, requests?: number, pricedRequests?: number}|null} session - one session entry.
 * @returns {string} e.g. `$0 · 플랜 $0.000028`, `$0.0041`, or '' when there is nothing to show.
 */
export function costPillText(session) {
  if (!session || typeof session !== 'object') return ''
  const requests = Number(session.requests ?? 0)
  if (requests <= 0) return ''
  const cost = typeof session.costUsd === 'number' ? session.costUsd : 0
  const allowance = typeof session.allowanceUsd === 'number' ? session.allowanceUsd : 0
  const charged = cost > 0 ? formatUsd(cost) : FREE_LABEL
  if (allowance > 0) return charged + ' · 플랜 ' + formatUsd(allowance)
  return charged
}

/**
 * Pick the cost entry for one session out of a server summary.
 *
 * @param {{bySession?: {sessionId: string}[]}|null} summary - `cost` from model-settings.
 * @param {string|null|undefined} sessionId - current DSH session id.
 * @returns {object|null} the entry, or null.
 */
export function sessionCostOf(summary, sessionId) {
  const list = Array.isArray(summary?.bySession) ? summary.bySession : []
  if (list.length === 0) return null
  if (sessionId) {
    const exact = list.find((entry) => entry?.sessionId === sessionId)
    if (exact) return exact
  }
  return null
}

/**
 * Find the composer status row on the page.
 *
 * @param {Document} doc - document to search.
 * @returns {HTMLElement|null} the row that holds the statistic pills.
 */
export function findStatusRow(doc) {
  const anchor = doc.querySelector('[' + STAT_ATTR + ']')
  return anchor ? anchor.parentElement : null
}

/**
 * Ensure exactly one cost pill exists in the row.
 *
 * @param {Document} doc - document to mutate.
 * @param {string} text - pill label; an empty string removes the pill.
 * @param {string} title - tooltip text.
 * @returns {HTMLElement|null} the pill, or null when none is shown.
 */
export function renderCostPill(doc, text, title) {
  const row = findStatusRow(doc)
  if (!row) return null
  const existing = row.querySelector('[' + OWN_ATTR + ']')
  if (text === '') {
    if (existing) existing.remove()
    return null
  }
  // The host renders three nested spans and `.pill` only sets `font:inherit`:
  // the FONT comes from `.anchor`. Measured live 2026-11-04, a bare `.pill`
  // appended to the row renders 16px/normal (26px tall) while the host pill is
  // 11px/19px (21px). So the wrapper must be an anchor, and the text must sit in
  // a label, exactly as the host builds it.
  if (existing) {
    // The label is two levels down (anchor > pill > label); fall back to the
    // wrapper itself when the host markup is not the shape this module built.
    const pill = existing.querySelector?.('span') ?? null
    const label = pill?.querySelector?.('span') ?? pill ?? existing
    label.textContent = text
    existing.title = title
    return existing
  }
  // Use the first anchor that actually carries the pill > label nesting: a
  // bare anchor (no children) would yield four empty class names and render the
  // new pill with the page font again — the exact defect this shape prevents.
  const anchors = row.querySelectorAll('[' + STAT_ATTR + ']')
  let hostAnchor = null
  let hostPill = null
  let hostLabel = null
  for (const candidate of anchors) {
    const pill = candidate.querySelector?.('span') ?? null
    const label = pill?.querySelector?.('span') ?? null
    if (candidate.className && pill?.className && label?.className) {
      hostAnchor = candidate
      hostPill = pill
      hostLabel = label
      break
    }
  }
  const wrapper = doc.createElement('span')
  if (hostAnchor?.className) wrapper.className = hostAnchor.className
  wrapper.setAttribute(OWN_ATTR, '1')
  wrapper.title = title
  const pill = doc.createElement('span')
  if (hostPill?.className) pill.className = hostPill.className
  const label = doc.createElement('span')
  if (hostLabel?.className) label.className = hostLabel.className
  label.textContent = text
  pill.appendChild(label)
  wrapper.appendChild(pill)
  row.appendChild(wrapper)
  return wrapper
}

/**
 * Keep the pill attached across React re-renders.
 *
 * @param {Document} doc - document to watch.
 * @param {() => {text: string, title: string}} read - current label supplier.
 * @param {{MutationObserver?: typeof MutationObserver}} [options] - observer seam for tests.
 * @returns {() => void} disposer.
 */
export function watchStatusRow(doc, read, options = {}) {
  const Observer = options.MutationObserver ?? (typeof MutationObserver === 'undefined' ? null : MutationObserver)
  const sync = () => {
    const { text, title } = read()
    renderCostPill(doc, text, title)
  }
  sync()
  if (Observer === null || typeof doc === 'undefined' || doc === null) return () => {}
  const observer = new Observer(() => sync())
  observer.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true })
  return () => observer.disconnect()
}
