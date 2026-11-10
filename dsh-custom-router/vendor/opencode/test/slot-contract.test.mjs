/**
 * The cost chip is a composer `conversation.input.right` occupant.
 *
 * OWNER INSTRUCTION 2026-11-05: "오픈코드 v2에서 모델서빙 오른쪽으로 표시되는거 지금
 * 안티그래비티 처럼 표시되게 수정해 주라". Antigravity's usage chip is the reference
 * implementation (docs/UI-SLOT-ARCHITECTURE.md §4): it registers in
 * `conversation.input.right`, a LIST slot beside the model selector, and renders one
 * label+value pill.
 *
 * The previous seat was `conversation.input.activity` — a SINGLE slot. The
 * token-economizer ("tk") already registers there in the live profile, so this
 * plugin's registration was a second occupant in a one-occupant seat; measured live
 * pageerror: `single slot "conversation.input.activity" already has a registration`.
 * The single-slot activity contract (`InputActivityOwnerProps.onActiveChange`) no
 * longer applies to this component and must not be re-introduced.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** The body of one named function, from its `function` keyword to the next one. */
function bodyOf(name) {
  const start = SRC.indexOf('function ' + name + '(')
  assert.ok(start >= 0, name + ' must exist')
  const rest = SRC.slice(start)
  const end = rest.indexOf('\n    function ', 1)
  return end < 0 ? rest : rest.slice(0, end)
}

test('the chip registers in the additive input.right slot', () => {
  assert.match(SRC, /slots\.inject\('conversation\.input\.right'/, 'the seat is the list slot Antigravity uses')
  assert.match(SRC, /name: 'conversation\.input\.right', id: 'opencode-v2-cost'/, 'provider-owned id in the same slot')
})

test('the single activity seat is no longer registered by this plugin', () => {
  assert.doesNotMatch(
    SRC,
    /slots\.inject\('conversation\.input\.activity'/,
    'the activity seat is single and owned by tk; a second registration is a page error',
  )
})

test('the chip does not carry the activity-expansion contract', () => {
  const pill = bodyOf('CostPill')
  assert.doesNotMatch(pill, /onActiveChange/, 'input.right has no expansion contract to report')
  assert.doesNotMatch(pill, /function CostPill\(props\)/, 'the list occupant takes no activity props')
})

test('it renders as the same label + value pill Antigravity uses', () => {
  const pill = bodyOf('CostPill')
  assert.match(pill, /className: 'ocv2Pill'/, 'the pill owns the reference shape')
  assert.match(pill, /ocv2PillValue/, 'the number is the secondary, tabular value')
  assert.match(pill, /t\('pillLabel'\)/, 'a label precedes the value, like "사용량 179,958"')
  assert.match(SRC, /\.ocv2Pill\{[^}]*font-size:var\(--dsh-content-font-size-secondary,13px\)/, 'DSH typography token, not a fixed px')
  assert.match(SRC, /\.ocv2Pill\{[^}]*line-height:calc\(20px \+ var\(--dsh-content-font-delta-secondary,0px\)\)/, 'DSH line-height token')
  assert.match(SRC, /\.ocv2PillValue\{[^}]*font-variant-numeric:tabular-nums/, 'the value aligns like the reference chip')
})

test('no measured spend means no chip, never an invented zero label', () => {
  const pill = bodyOf('CostPill')
  assert.match(pill, /if \(text === ''\) return null/, 'the figure appears with the first measured request')
  assert.doesNotMatch(pill, /costFree/, 'the rejected "free / 0" label must not come back')
})

test('a foreign route hides the chip and stops the cost poll', () => {
  const pill = bodyOf('CostPill')
  assert.match(pill, /if \(!onRoute\) return null/, 'off-route occupies no seat')
  assert.match(pill, /if \(!onRoute\) return undefined/, 'and does not poll another provider\'s session')
  assert.match(pill, /watchRoute\b/, 'a model switch re-evaluates the gate')
})

test('the dead DOM painter is gone, so only one painter exists', () => {
  assert.doesNotMatch(SRC, /paintCostPill/, 'the DOM patch path had no owner after the slot migration')
  assert.doesNotMatch(SRC, /startCostPill/, 'and neither did its entry point')
})
