/**
 * Test isolation guard.
 *
 * The ledger path resolves from `$DSH_HOME`, and this plugin WRITES on every
 * recorded request. A developer shell exports the real `DSH_HOME`, so an
 * un-isolated suite wrote test fixtures straight into the operator's live usage
 * file. Measured 2026-11-05: `/home/minami/.dsh/deepinfra-session-cost.json`
 * accumulated sessions named `abc`, `b`, `s` and `session-t` with fake model id
 * `m` and fake costs up to $3.00, and the usage panel then displayed
 * $5.02 for a plugin that had billed fractions of a cent.
 *
 * Point every test process at a throwaway home before anything imports the
 * plugin, exactly as dsh-opencode-v2 does.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-deepinfra-test-'))
