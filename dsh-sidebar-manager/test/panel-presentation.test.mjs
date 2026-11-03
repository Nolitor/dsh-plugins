/**
 * Panel presentation contract.
 *
 * The workspace manager panel used to render its own name twice (an <h1> and an
 * <h2>, both "워크스페이스 관리자") because the list section reused the page title.
 * Measured 2026-11-03 in a real browser: headings were
 * ['H1:워크스페이스 관리자', 'H2:가상 그룹 (HQ)', 'H2:워크스페이스 관리자'].
 * This pins the list section to its own string so the duplicate cannot come back.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('the page title is used for the heading and the section aria-label only', () => {
  const uses = source.match(/t\('workspaceManager\.title'\)/g) ?? []
  assert.equal(uses.length, 2, 'one aria-label + one <h1>; a third use means a duplicated heading')
  const headingUses = source.match(/<h[123][^>]*\{\s*t\('workspaceManager\.title'\)\s*\}/g) ?? []
  assert.ok(headingUses.length <= 1, 'the page title must not head more than one element')
})

test('the workspace list has its own section heading', () => {
  assert.ok(source.includes("t('workspaceManager.listTitle')"), 'list section needs its own label')
  assert.equal((source.match(/'workspaceManager\.listTitle':/g) ?? []).length, 2, 'ko + en dictionaries must both define it')
})

test('the page description renders on its own, without the inline hint appended', () => {
  assert.ok(source.includes("h('p', { style: styles.panelDescription }, t('workspaceManager.description'))"), 'description renders alone')
  assert.ok(!source.includes("t('workspaceManager.inlineHint')}`"), 'the inline hint no longer rides in the description')
})

test('the panel is a tabbed surface, not one long page', () => {
  assert.ok(source.includes("role: 'tablist'"), 'needs a tablist')
  assert.ok(source.includes("role: 'tab'"), 'needs tab buttons')
  assert.ok(source.includes("role: 'tabpanel'"), 'needs a tabpanel')
  for (const id of ['tabs.workspaces', 'tabs.groups', 'tabs.diagnostics']) {
    assert.ok(source.includes("t('" + id + "')"), 'missing tab label ' + id)
    assert.equal((source.match(new RegExp("'" + id + "':", 'g')) ?? []).length, 2, id + ' needs ko + en')
  }
})

test('the tab strip follows native DSH keyboard and ARIA conventions', () => {
  assert.ok(source.includes('tabIndex: selected ? 0 : -1'), 'roving tabIndex')
  assert.ok(source.includes("'aria-selected': selected"), 'aria-selected on each tab')
  assert.ok(source.includes("'aria-controls'"), 'tabs reference their panel')
  assert.ok(source.includes("'aria-labelledby'"), 'panel references its tab')
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
    assert.ok(source.includes("'" + key + "'"), 'missing keyboard navigation: ' + key)
  }
})

test('the three tabs are separate components', () => {
  assert.ok(source.includes('function WorkspacesTab()'), 'Workspaces tab component')
  assert.ok(source.includes('function GroupsTab({ onChanged })'), 'Groups tab component')
  assert.ok(source.includes('function DiagnosticsTab({ onChanged })'), 'Diagnostics tab component')
})

test('diagnostics do not render inside the workspace or group tabs', () => {
  const workspaces = source.slice(source.indexOf('function WorkspacesTab()'), source.indexOf('function DiagnosticsTab('))
  assert.ok(!workspaces.includes("t('groups.hqTitle')"), 'HQ bootstrap belongs to Diagnostics')
  assert.ok(!workspaces.includes("t('groups.orphansTitle')"), 'orphan scan belongs to Diagnostics')
  const groups = source.slice(source.indexOf('function GroupsTab('), source.indexOf('function WorkspacesTab()'))
  assert.ok(!groups.includes("t('groups.advisoryTitle')"), 'advisory belongs to Diagnostics')
})

// --- placement: the panel lives in the sidebar's More menu, not the rail -----

test('the panel registers no rail row, only a More-menu row', () => {
  // Measured 2026-11-03: any entry on `sidebar.panellist` becomes its own rail row,
  // sorted by order among the native rows and always placed before the More launcher.
  // The plugin therefore registers ONLY the actions row that lives inside More.
  assert.ok(!/name: 'sidebar\.panellist',/.test(source), 'must not register a sidebar.panellist row')
  assert.ok(source.includes("name: 'sidebar.panellist.actions'"), 'must register the More-menu row')
})

test('the More row opens the panel through ctx.layout, not the panel list', () => {
  // `onOpen` resolves ids through the sidebar panel list, which is built from
  // panellist entries; with no rail entry it cannot find this panel. ctx.layout
  // validates against the `main` slot instead, which this plugin does register.
  assert.ok(source.includes("appContext?.get?.('layout')"), 'opens via the layout service')
  assert.ok(source.includes('layout.selectPanel(PANEL_ID)'), 'selects this panel by id')
  assert.ok(source.includes("name: 'main', key: PANEL_ID"), 'the panel still registers in the main slot')
})

// --- heading hierarchy matches the native page spec -------------------------

test('page title uses the native title spec 20px/500/28px', () => {
  // Native pageTitle/detailTitle: font-size:20px;font-weight:500;line-height:28px
  const at = source.indexOf('panelHeading: {')
  assert.ok(at > 0, 'panelHeading must exist')
  const rule = source.slice(at, source.indexOf('},', at))
  assert.match(rule, /fontSize: 20/)
  assert.match(rule, /fontWeight: 500/)
  assert.match(rule, /lineHeight: '28px'/)
})

test('section heading uses the native section spec 14px/500/22px', () => {
  const at = source.indexOf('panelSectionTitle: {')
  assert.ok(at > 0, 'panelSectionTitle must exist')
  const rule = source.slice(at, source.indexOf('},', at))
  assert.match(rule, /fontSize: 14/)
  assert.match(rule, /fontWeight: 500/)
  assert.match(rule, /lineHeight: '22px'/)
})

// --- session context menu: typography and grouping -------------------------

test('session menu rows use the native 13px/400/20px spec', () => {
  // Measured live 2026-11-03: these rows computed to 16px while every native row
  // in the same menu was 13px, because `font: inherit` took the body default and
  // the menu container sets no size.
  const at = source.indexOf('menuItem: {')
  assert.ok(at > 0, 'menuItem style must exist')
  const rule = source.slice(at, source.indexOf('},', at))
  assert.match(rule, /fontSize: 13/, 'must state the native 13px')
  assert.match(rule, /fontWeight: 400/, 'must state the native 400 weight')
  assert.match(rule, /lineHeight: '20px'/, 'must state the native 20px line height')
  assert.ok(!/font: 'inherit'/.test(rule), "font: 'inherit' is what produced 16px")
})

test('session menu rows sit after every native row and before the pinned archive row', () => {
  // Native order map measured from the shipped bundles:
  //   100 pin | 200 rename | 300 fork | 450 copy-session-id | 500 open-in-app
  //   | 600 archive (afterContent: true, so it is pinned last)
  // Anything in 451..499 lands between native rows; >= 600 lands after the
  // afterContent block. 510..599 is the only gap that reads as its own group.
  const orders = [...source.matchAll(/id: 'sidebar-manager\.(purge|move|fork)', order: (\d+)/g)]
    .map((m) => ({ id: m[1], order: Number(m[2]) }))
  assert.equal(orders.length, 3, 'expected the three maintenance rows')
  for (const { id, order } of orders) {
    assert.ok(order > 500, id + ' must sit after the native open-in-app row (500), got ' + order)
    assert.ok(order < 600, id + ' must sit before the pinned archive row (600), got ' + order)
  }
  const sorted = [...orders].sort((a, b) => a.order - b.order).map((o) => o.order)
  assert.deepEqual(sorted, [510, 520, 530], 'the three rows stay contiguous as one group')
})
