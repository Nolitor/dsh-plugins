/**
 * Row and typography contract for the OpenCode V2 settings tab.
 *
 * Two defects this file exists to prevent, both measured on the live tab
 * (2026-11-04, 1440x1000, DSH 0.2.2-alpha.3):
 *
 *   1. the row rendered the display name and the route as ONE run of text
 *      ("DeepSeek V4.1 Flash (Go)opencode-go/deepseek-v4.1-flash"), because both
 *      spans sat in the same inline label; there was no way to tell where the
 *      name ended and the route began.
 *   2. the section was styled as its own system (13px headings, weight 600,
 *      .5px card border, aria-pressed fill on an UNSET token) while the native
 *      settings page around it measures 14px/22px and a 20px card radius.
 *
 * The native baseline is measured, not assumed: the Settings dialog under
 * "모델" computes 14px/22px for body copy, 12px/18px for secondary copy, a
 * 20px (--dsw-radius-xl) card radius, and a 13px/20px control.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** The injected stylesheet, parsed back out of the module. */
function stylesheet() {
  const match = SRC.match(/const CSS = ("(?:[^"\\]|\\.)*")/)
  assert.ok(match, 'the client must define its stylesheet as a single CSS constant')
  return JSON.parse(match[1])
}

/** One flat rule body, e.g. rule('.ocv2Section') -> "min-width:0;...". */
function rule(css, selector) {
  const at = css.indexOf(selector + '{')
  assert.ok(at >= 0, selector + ' must exist in the stylesheet')
  return css.slice(at + selector.length + 1, css.indexOf('}', at))
}

/** Load the served client module with a stub React, as the shell would. */
function loadClientExports() {
  let registration = null
  new Function('window', SRC)({ __ModuleLoader__: { load: (reg) => { registration = reg } } })
  const stub = () => new Proxy(function () {}, {
    get: (_target, key) => (key === Symbol.toPrimitive ? () => 'stub' : key === 'then' ? undefined : stub()),
    apply: () => stub(),
    construct: () => stub(),
  })
  return registration.factory(() => stub())
}

/** A tree-building stand-in for React.createElement. */
function renderer() {
  const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) })
  return h
}

function findByClass(node, className) {
  const found = []
  const visit = (n) => {
    if (!n || typeof n !== 'object') return
    if (String(n.props?.className ?? '').split(/\s+/).includes(className)) found.push(n)
    for (const child of n.children ?? []) visit(child)
  }
  visit(node)
  return found
}

/** Text nodes of one subtree, in document order. */
function textOf(node) {
  if (typeof node === 'string') return [node]
  if (!node || typeof node !== 'object') return []
  return (node.children ?? []).flatMap(textOf)
}

const MODEL = {
  route: 'opencode-go/deepseek-v4.1-flash',
  name: 'DeepSeek V4.1 Flash (Go)',
  plan: 'go',
  available: true,
  state: 'usable',
  rank: 1,
  isNew: false,
}

test('a row renders the name and the route as two separate lines', () => {
  const exportsObj = loadClientExports()
  assert.equal(typeof exportsObj.ModelRow, 'function', 'the row must be a unit a test can render')
  const row = exportsObj.ModelRow({
    h: renderer(),
    model: MODEL,
    checked: true,
    label: '사용 가능',
    badge: 'ocv2Badge ocv2BadgeUsable',
    checkboxId: 'ocv2-opencode-go-deepseek-v4-1-flash',
    onToggle: () => {},
  })

  const [name] = findByClass(row, 'ocv2Name')
  assert.ok(name, 'the two lines live in one labelled block')
  assert.equal(name.children.length, 2, 'exactly two lines: name, then route')
  assert.deepEqual(textOf(name.children[0]), [MODEL.name])
  assert.deepEqual(textOf(name.children[1]), [MODEL.route])
  // The defect: one text run holding both values.
  assert.ok(
    !textOf(row).some((text) => text.includes(MODEL.name) && text.includes(MODEL.route)),
    'name and route must never share one text node',
  )
})

test('both lines carry the full value as a tooltip so truncation loses nothing', () => {
  const exportsObj = loadClientExports()
  const row = exportsObj.ModelRow({
    h: renderer(),
    model: { ...MODEL, name: 'Muse Spark 1.3 Contributor', route: 'opencode-go/muse-spark-1.3-contributor' },
    checked: false,
    label: '사용 가능',
    badge: 'ocv2Badge ocv2BadgeUsable',
    checkboxId: 'x',
    onToggle: () => {},
  })
  const [nameLine] = findByClass(row, 'ocv2ModelName')
  const [routeLine] = findByClass(row, 'ocv2Route')
  assert.equal(nameLine.props.title, 'Muse Spark 1.3 Contributor')
  assert.equal(routeLine.props.title, 'opencode-go/muse-spark-1.3-contributor')
})

test('each line ellipsises inside its own column instead of wrapping', () => {
  const css = stylesheet()
  for (const selector of ['.ocv2ModelName', '.ocv2Route']) {
    const body = rule(css, selector)
    assert.match(body, /white-space:nowrap/, selector + ' must stay on one line')
    assert.match(body, /text-overflow:ellipsis/, selector + ' must truncate, not overflow')
    assert.match(body, /min-width:0/, selector + ' must be allowed to shrink inside the grid')
  }
  const rowBody = rule(css, '.ocv2Model')
  assert.match(rowBody, /grid-template-columns:auto auto minmax\(0,1fr\)/, 'the text column must be the flexible one')
})

test('the section states the native settings baseline itself', () => {
  const css = stylesheet()
  const section = rule(css, '.ocv2Section')
  assert.match(section, /font-size:14px/, 'the native settings body size')
  assert.match(section, /line-height:22px/, 'the native settings line height')
  // Nothing may reintroduce the 16px UA default on a body-sized surface; the one
  // legitimate 16px in this sheet is the page title, which the native page also
  // renders at 16px/24px (measured).
  assert.equal(rule(css, '.ocv2Heading').includes('font-size:16px'), true)
  for (const selector of ['.ocv2Hint', '.ocv2ModelName', '.ocv2CardTitle']) {
    assert.match(rule(css, selector), /font-size:14px/)
  }
  for (const selector of ['.ocv2Route', '.ocv2Meta', '.ocv2Count', '.ocv2Notice']) {
    assert.match(rule(css, selector), /font-size:12px/, selector + ' is native secondary copy')
  }
})

test('cards and controls use the native geometry, not a private one', () => {
  const css = stylesheet()
  assert.match(rule(css, '.ocv2Card'), /border-radius:var\(--dsw-radius-xl\)/, 'native row cards measure 20px')
  assert.match(rule(css, '.ocv2Card'), /var\(--dsw-alias-settings-card-stroke\)/)
  assert.match(rule(css, '.ocv2Segment'), /font-size:13px/, 'native controls measure 13px/20px')
  assert.ok(!/font-weight:600/.test(css), 'the native settings pages use weight 500 for emphasis')
})

test('no rule paints with a token that is unset at runtime', () => {
  const css = stylesheet()
  const used = new Set([...css.matchAll(/var\((--dsw-[a-z0-9-]+)\)/g)].map((m) => m[1]))
  // Measured live 2026-11-04 by reading computed values off the shell: every
  // token below resolved. --dsw-alias-bg-layer-4 is DECLARED in the theme sheet
  // but resolves to the empty string, so a rule that uses it paints nothing -
  // that is exactly how the plan switch lost its selected state before.
  const defined = new Set([
    '--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary',
    '--dsw-alias-border-l3', '--dsw-alias-border-l4',
    '--dsw-alias-settings-card-fill', '--dsw-alias-settings-card-stroke',
    '--dsw-alias-button-ghost-active-fill', '--dsw-alias-interactive-bg-hover-solid',
    '--dsw-alias-state-success-primary', '--dsw-alias-state-business-primary',
    '--dsw-alias-state-error-primary', '--dsw-alias-link',
    // Measured in the theme sheet (both light and dark): #0000001f / #0003.
    '--dsw-alias-bg-mask-2',
    '--dsw-radius-xs', '--dsw-radius-sm', '--dsw-radius-md', '--dsw-radius-lg', '--dsw-radius-xl',
  ])
  assert.deepEqual([...used].filter((token) => !defined.has(token)), [], 'unset token')
  assert.ok(!used.has('--dsw-alias-bg-layer-4'), 'bg-layer is unset at runtime; the selected fill must be a real token')
})
