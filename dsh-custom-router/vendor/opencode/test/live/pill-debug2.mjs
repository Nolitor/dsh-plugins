import { renderCostPill, OWN_ATTR, STAT_ATTR } from '../../lib/cost-pill.js'
const make = (tag) => {
  const classes = new Set()
  return {
    tagName: tag.toUpperCase(), children: [], attributes: {}, textContent: '', title: '', parentElement: null,
    get className() { return [...classes].join(' ') },
    set className(v) { classes.clear(); for (const c of String(v).split(/\s+/)) if (c) classes.add(c) },
    setAttribute(n, v) { this.attributes[n] = String(v) },
    getAttribute(n) { return this.attributes[n] ?? null },
    appendChild(c) { c.parentElement = this; this.children.push(c); return c },
    remove() { const p = this.parentElement; if (p) p.children = p.children.filter((x) => x !== this) },
    querySelector(sel) {
      const match = (n) => sel.startsWith('[') ? n.attributes?.[sel.slice(1, -1)] !== undefined : n.tagName === sel.toUpperCase()
      const walk = (n) => { for (const c of n.children ?? []) { if (match(c)) return c; const d = walk(c); if (d) return d } return null }
      return walk(this)
    },
    querySelectorAll(sel) {
      const out = []; const name = sel.startsWith('[') ? sel.slice(1, -1) : null
      const walk = (n) => { for (const c of n.children ?? []) { if (name && c.attributes?.[name] !== undefined) out.push(c); walk(c) } }
      walk(this); return out
    },
  }
}
const body = make('body'), row = make('div'); body.appendChild(row)
const usage = make('span'); usage.className = 'bOPqQW_anchor'; usage.setAttribute(STAT_ATTR, 'usage')
const pill = make('span'); pill.className = 'bOPqQW_pill'
const label = make('span'); label.className = 'bOPqQW_label'; label.textContent = 'x'
pill.appendChild(label); usage.appendChild(pill); row.appendChild(usage)
const doc = { body, createElement: make, querySelector: (s) => body.querySelector(s) }

const first = renderCostPill(doc, 'A', 't1')
console.log('after create: wrapper kids =', first.children.length, '| pill kids =', first.children[0]?.children.length)
console.log('  label text =', JSON.stringify(first.children[0]?.children[0]?.textContent))
const second = renderCostPill(doc, 'B', 't2')
console.log('after update: same node =', first === second)
console.log('  wrapper kids =', second.children.length)
console.log('  pill kids    =', second.children[0]?.children.length)
console.log('  label text   =', JSON.stringify(second.children[0]?.children[0]?.textContent))
console.log('  own count    =', row.querySelectorAll('[' + OWN_ATTR + ']').length)
