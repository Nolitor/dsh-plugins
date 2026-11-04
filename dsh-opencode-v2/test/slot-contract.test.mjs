/**
 * The cost pill is a composer ACTIVITY occupant, and that slot has a contract.
 *
 * Measured 2026-11-04 against the installed `dsh-client-ui-conversation` types
 * (`InputActivityOwnerProps`, alpha.3):
 *
 *   interface InputActivityOwnerProps extends InputControlOwnerProps {
 *     onActiveChange: (active: boolean) => void   // "whether the occupant needs the
 *   }                                             //  toolbar width before submit"
 *
 *   "A toolbar activity hides ordinary accessory controls while expanded; its
 *    occupant must release expansion on unmount."
 *
 * The pill never expands, so the correct behaviour is to report `false` at mount and
 * again at unmount. Skipping it can leave the composer expanded after the chip is
 * removed (the route gate returns null when another provider is selected), hiding the
 * model selector and the other accessory controls.
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

test('the pill reads the slot props instead of ignoring them', () => {
  const pill = bodyOf('CostPill')
  assert.match(pill, /function CostPill\(props\)/, 'the occupant must accept its props')
  assert.match(pill, /props\?\.onActiveChange/, 'and must read onActiveChange')
})

test('it releases expansion at mount and at unmount, as the slot requires', () => {
  const pill = bodyOf('CostPill')
  const calls = pill.match(/onActiveChange\(false\)/g) ?? []
  assert.ok(calls.length >= 2, 'report false on mount AND release on unmount (found ' + calls.length + ')')
  assert.match(pill, /return \(\) => onActiveChange\(false\)/, 'the cleanup must release expansion')
})

test('a host that passes no props does not crash the occupant', () => {
  const pill = bodyOf('CostPill')
  assert.match(pill, /typeof props\?\.onActiveChange === 'function'/, 'the prop must be optional')
  assert.match(pill, /if \(onActiveChange === null\) return undefined/, 'no prop means no effect work')
})

test('the expansion report never turns the pill into an expanding occupant', () => {
  const pill = bodyOf('CostPill')
  assert.doesNotMatch(pill, /onActiveChange\(true\)/, 'this occupant never needs extra width')
})

test('the other registration (settings.section) needs no close handler', () => {
  // SettingsSectionOwnerProps.close exists, but only for a section that navigates the
  // operator somewhere else. This one does not, so not calling it is correct and is
  // recorded here so a future reader does not "fix" it by inventing a close button.
  assert.match(SRC, /slots\.inject\('settings\.section'/)
  assert.doesNotMatch(SRC, /onboarding|openSection/, 'the section never leaves itself')
})
