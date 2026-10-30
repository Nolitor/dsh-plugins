/**
 * Test isolation guard.
 *
 * The adapter writes its durable catalog to `$DSH_HOME/cache/opencode-models.json`
 * when a test builds one without a profile context. A developer shell may export
 * the REAL `DSH_HOME` (the live profile lives there), which made the suite read
 * and overwrite live state and fail non-deterministically (measured 2026-10-30:
 * 5 failures with the live DSH_HOME, 0 without).
 *
 * Point every test process at a throwaway home before anything imports the adapter.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-opencode-v2-test-'))
