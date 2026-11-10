/**
 * The session cost pill in the composer status row.
 *
 * Rejected design, recorded so it is not retried: a per-turn badge in
 * `conversation.chat.turnTail`. It would put a line of cost under every bubble
 * and clutter the transcript. The requirement is ONE cumulative figure for the
 * session, beside the existing "NN tok · cache hit NN%" pill.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  costPillText,
  findStatusRow,
  formatUsd,
  renderCostPill,
  sessionCostOf,
  watchStatusRow,
  OWN_ATTR,
  STAT_ATTR,
} from '../lib/cost-pill.js'

/** Minimal DOM stand-in: only what the pill touches. */
function fakeDocument() {
  const make = (tag) => {
    const classes = new Set()
    const el = {
      tagName: tag.toUpperCase(),
      children: [],
      attributes: {},
      textContent: '',
      title: '',
      parentElement: null,
      get className() { return [...classes].join(' ') },
      set className(value) { classes.clear(); for (const c of String(value).split(/\s+/)) if (c) classes.add(c) },
      setAttribute(name, value) { this.attributes[name] = String(value) },
      getAttribute(name) { return this.attributes[name] ?? null },
      appendChild(child) { child.parentElement = this; this.children.push(child); return child },
      remove() {
        const parent = this.parentElement
        if (!parent) return
        parent.children = parent.children.filter((c) => c !== this)
        this.parentElement = null
      },
      querySelector(selector) {
        const match = (node) => {
          if (selector.startsWith('[')) {
            const name = selector.slice(1, -1)
            return node.attributes?.[name] !== undefined
          }
          // A plain tag selector, which is how the module borrows the host class.
          return node.tagName === selector.toUpperCase()
        }
        const walk = (node) => {
          for (const child of node.children ?? []) {
            if (match(child)) return child
            const deeper = walk(child)
            if (deeper) return deeper
          }
          return null
        }
        return walk(this)
      },
      querySelectorAll(selector) {
        const out = []
        const name = selector.startsWith('[') ? selector.slice(1, -1) : null
        const walk = (node) => {
          for (const child of node.children ?? []) {
            if (name && child.attributes?.[name] !== undefined) out.push(child)
            walk(child)
          }
        }
        void 0
        walk(this)
        return out
      },
    }
    return el
  }
  const body = make('body')
  return { body, createElement: make, querySelector: (sel) => body.querySelector(sel) }
}

/** A composer row with the host's own pills, as measured in the live DOM. */
function statusRow(doc) {
  const row = doc.createElement('div')
  doc.body.appendChild(row)
  const activity = doc.createElement('span')
  activity.className = 'bOPqQW_anchor'
  activity.setAttribute(STAT_ATTR, 'activity')
  const usage = doc.createElement('span')
  usage.className = 'bOPqQW_anchor'
  usage.setAttribute(STAT_ATTR, 'usage')
  const inner = doc.createElement('span')
  inner.className = 'bOPqQW_pill'
  const innerLabel = doc.createElement('span')
  innerLabel.className = 'bOPqQW_label'
  innerLabel.textContent = '141M tok'
  inner.appendChild(innerLabel)
  usage.appendChild(inner)
  row.appendChild(activity)
  row.appendChild(usage)
  return row
}

test('a sub-cent amount stays readable instead of printing $0.00', () => {
  // The measured two-request plan burn was 0.00002786 USD.
  assert.equal(formatUsd(0.00002786), '$0.0000279')
  assert.equal(formatUsd(0.0000096), '$0.0000096')
  assert.equal(formatUsd(0), '$0')
  assert.equal(formatUsd(0.00412), '$0.00412', 'three significant digits, no padding zeros')
  assert.equal(formatUsd(1.239), '$1.24')
  assert.equal(formatUsd(null), '')
  assert.equal(formatUsd(Number.NaN), '')
})

test('the pill shows the charge and, on a plan, the burn separately', () => {
  // Go: charged nothing, but the monthly limit moved.
  assert.equal(costPillText({ requests: 2, costUsd: 0, allowanceUsd: 0.00002786 }), 'free · plan $0.0000279')
  // Balance: charged, no plan.
  assert.equal(costPillText({ requests: 1, costUsd: 0.00412, allowanceUsd: 0 }), '$0.00412')
  // Both.
  assert.equal(costPillText({ requests: 1, costUsd: 0.00412, allowanceUsd: 0.001 }), '$0.00412 · plan $0.001')
  // Nothing measured yet: no pill, rather than a misleading "$0".
  assert.equal(costPillText({ requests: 0 }), '')
  assert.equal(costPillText(null), '')
})

test('the session is picked by id, never by "most recent"', () => {
  const summary = { bySession: [{ sessionId: 'a', requests: 1 }, { sessionId: 'b', requests: 4 }] }
  assert.equal(sessionCostOf(summary, 'b').requests, 4)
  assert.equal(sessionCostOf(summary, 'missing'), null, 'another session\'s spend must never appear')
  assert.equal(sessionCostOf(summary, undefined), null)
  assert.equal(sessionCostOf(null, 'a'), null)
})

test('one pill is appended to the row and reused on the next update', () => {
  const doc = fakeDocument()
  const row = statusRow(doc)
  assert.equal(findStatusRow(doc), row, 'the row is the parent of any stat anchor')

  const first = renderCostPill(doc, 'free · plan $0.0000279', 'session cost')
  assert.ok(first)
  assert.equal(row.querySelectorAll('[' + OWN_ATTR + ']').length, 1)
  // The host's three-span shape: anchor > pill > label. The FONT comes from the
  // anchor (measured: bare .pill renders 16px, nested renders 11px), so the
  // wrapper must carry the anchor class and the text must live in the label.
  assert.equal(first.className, 'bOPqQW_anchor', 'the wrapper is the anchor')
  const pill = first.children[0]
  const label = pill.children[0]
  assert.equal(pill.className, 'bOPqQW_pill')
  assert.equal(label.className, 'bOPqQW_label')
  // The fake DOM does not aggregate descendant text, so read the label directly;
  // a real browser reports the same string through the wrapper's textContent.
  assert.equal(label.textContent, 'free · plan $0.0000279')
  assert.equal(first.title, 'session cost')

  const second = renderCostPill(doc, '$0.00412', 'session cost')
  assert.equal(second, first, 'the same node is updated, not duplicated')
  assert.equal(row.querySelectorAll('[' + OWN_ATTR + ']').length, 1)
  assert.equal(first.children[0].children[0].textContent, '$0.00412', 'the label carries the text')

  // An empty label removes the pill rather than leaving a blank chip.
  assert.equal(renderCostPill(doc, '', ''), null)
  assert.equal(row.querySelectorAll('[' + OWN_ATTR + ']').length, 0)
})

test('nothing is injected when the composer row is absent', () => {
  const doc = fakeDocument()
  assert.equal(findStatusRow(doc), null)
  assert.equal(renderCostPill(doc, '$1', 't'), null, 'a page without a composer must not throw')
})

test('the observer re-attaches the pill after React replaces the row', () => {
  const doc = fakeDocument()
  statusRow(doc)
  let text = 'free'
  const observers = []
  class FakeObserver {
    constructor(handler) { this.handler = handler; observers.push(this) }
    observe() {}
    disconnect() { this.disconnected = true }
    trigger() { this.handler([]) }
  }
  const dispose = watchStatusRow(doc, () => ({ text, title: 'cost' }), { MutationObserver: FakeObserver })
  assert.equal(doc.body.querySelectorAll('[' + OWN_ATTR + ']').length, 1)

  // React throws the whole row away and renders a fresh one; the observer must
  // restore the pill on the new row.
  doc.body.children = []
  statusRow(doc)
  assert.equal(doc.body.querySelectorAll('[' + OWN_ATTR + ']').length, 0, 'the old pill left with its row')
  observers[0].trigger()
  assert.equal(doc.body.querySelectorAll('[' + OWN_ATTR + ']').length, 1, 'reattached on the next mutation')

  text = '$0.00412'
  observers[0].trigger()
  const updated = doc.body.querySelector('[' + OWN_ATTR + ']')
  assert.equal(updated.children[0].children[0].textContent, '$0.00412', 'the label carries the new value')

  dispose()
  assert.equal(observers[0].disconnected, true)
})
