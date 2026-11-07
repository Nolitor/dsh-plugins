import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Management-only token; this is never an upstream provider credential. */
export function managementToken(options = {}) {
  const env = options.env ?? process.env
  if (env.OPENCODEX_ADMIN_AUTH_TOKEN?.trim()) return env.OPENCODEX_ADMIN_AUTH_TOKEN.trim()
  try {
    return readFileSync(join(env.OPENCODEX_HOME || join(homedir(), '.opencodex'), 'admin-api-token'), 'utf8').trim()
  } catch { return '' }
}
