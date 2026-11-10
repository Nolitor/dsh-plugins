import { renderCostPill, OWN_ATTR, STAT_ATTR } from '../../lib/cost-pill.js'

const make = (tag) => {
  const classes = new Set()
  const el = {
    tagName: tag.toUpperCase(), children: [], attributes: {}, textContent: '', title: '', parentElement: null,
    get className() { return [...classes].join(' ') },
    set className(v) { classes.clear(); for (const c of String(v).split(/\s+/)) if (c) classes.add(c) },
    setAttribute(n, v) { this.attributes[n] = String(v) },
    getAttribute(n) { return this.attributes[n] ?? null },
    appendChild(c) { c.parentElement = this; this.children.push(c); return c },
    remove() {},
    querySelector(sel) {
      const match = (n) => sel.startsWith('[') ? n.attributes?.[sel.slice(1, -1)] !== undefined : n.tagName === sel.toUpperCase()
      const walk = (n) => { for (const c of n.children ?? []) { if (match(c)) return c; const d = walk(c); if (d) return d } return null }
      return walk(this)
    },
    querySelectorAll(sel) {
      const out = []
      const name = sel.startsWith('[') ? sel.slice(1, -1) : null
      const walk = (n) => { for (const c of n.children ?? []) { if (name && c.attributes?.[name] !== undefined) out.push(c); walk(c) } }
      walk(this); return out
    },
  }
  return el
}
const body = make('body')
const row = make('div'); body.appendChild(row)
const usage = make('span'); usage.className = 'bOPqQW_anchor'; usage.setAttribute(STAT_ATTR, 'usage')
const pill = make('span'); pill.className = 'bOPqQW_pill'
const label = make('span'); label.className = 'bOPqQW_label'; label.textContent = '141M tok'
pill.appendChild(label); usage.appendChild(pill); row.appendChild(usage)

const doc = { body, createElement: make, querySelector: (s) => body.querySelector(s) }
const out = renderCostPill(doc, '무료 · 플랜 $0.0000279', 'session cost')
console.log('wrapper class :', JSON.stringify(out?.className))
console.log('child0 class  :', JSON.stringify(out?.children?.[0]?.className))
console.log('child0 child0 :', JSON.stringify(out?.children?.[0]?.children?.[0]?.className))
console.log('row anchors   :', row.querySelectorAll('[' + STAT_ATTR + ']').length)
