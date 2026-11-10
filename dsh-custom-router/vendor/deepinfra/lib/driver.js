/**
 * The DeepInfra provider driver — this vendor's binding to the leaf contract.
 *
 * A driver is declarative: the stream descriptor, pure hooks, the surfaces it
 * occupies and the switches that mount it. Nothing here performs I/O and
 * nothing here changes the route: `adapter.js` and `index.js` keep their own
 * behaviour and their own copy of the stream binding.
 *
 * @module @nolit/dsh-deepinfra/driver
 */

import { defineProviderDriver } from '../../../lib/driver/contract.js'

import { STREAM_DESCRIPTOR, readEvent } from './stream-contract.js'

// The hook lives once, in stream-contract.js, and the driver re-exports it so
// the adapter and the driver can never drift into two implementations.
export { readEvent }

/**
 * The DeepInfra driver. Model serving only: no tools, no commands.
 *
 * `descriptor` is the existing `STREAM_DESCRIPTOR` by reference, so the wire
 * facts (`fragmented` tool calls, `prompt+output` usage, `fail` on a malformed
 * record) are declared once in `stream-contract.js`.
 */
export const DEEPINFRA_DRIVER = defineProviderDriver({
  id: 'deepinfra',
  descriptor: STREAM_DESCRIPTOR,
  hooks: { readEvent },
  surfaces: {
    model: { adapter: true, factory: 'createAdapter' },
    tools: [],
    commands: [],
  },
  activation: {
    switches: [
      { name: 'enabled', module: 'config', role: 'master' },
      { name: 'modelServing', module: 'config', role: 'model' },
      { name: 'anthropicRoute', module: 'config', role: 'auxiliary' },
    ],
    readiness: { bridge: 'deepinfra', catalogLayer: 'probe', auth: 'api-key' },
  },
})
