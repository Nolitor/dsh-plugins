/**
 * Beta package manifest.
 *
 * Same plugin surface as the stable package (`/opencode` tool, commands,
 * cli_worker, `opencode-http-agent` route) with ONE difference: the protocol
 * parser is the canonical state machine in `lib/protocol-parser.js` instead of
 * the regex classifier. It is a separate PACKAGE, not a separate row, because
 * two rows registering the same tool, command and provider would collide at
 * mount time (measured: duplicate tool names are a hard mount failure).
 */
export const BETA_PACKAGE = '@nolit/dsh-opencode-v2-beta'

/**
 * Provider namespace this plugin registers.
 *
 * Shared with the stable package ON PURPOSE: the mutual-exclusion guard's whole
 * job is to make sure only one of them can own it in a profile. A distinct id
 * would silently let both run and bill the same route twice.
 */
export const BETA_PROVIDER_ID = 'opencode-http-agent'

/** Tool, command and worker names that collide with the stable package. */
export const BETA_TOOL_NAME = 'opencode'
export const BETA_COMMAND_NAMES = Object.freeze(['opencode', 'ocode'])
export const BETA_CLI_WORKER = true
