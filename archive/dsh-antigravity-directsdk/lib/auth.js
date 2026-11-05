/**
 * Antigravity credential acquisition.
 *
 * Measured 2026-11-05 against the live token endpoint:
 *   POST https://oauth2.googleapis.com/token
 *   grant_type=refresh_token & client_id & client_secret & refresh_token
 *   => 200 { access_token, expires_in: 3599, scope: "... aicode ..." }
 *
 * The refresh token lives in the `agy` credential file
 * (~/.gemini/antigravity-cli/antigravity-oauth-token):
 *   { "token": { "access_token", "refresh_token", "expiry", "expires_in" }, "auth_method": "consumer" }
 *
 * This module never writes to that file. Google may rotate the refresh token;
 * when the grant fails the caller gets a classified error instead of a silent
 * retry loop.
 *
 * @module @nolit/dsh-antigravity-directsdk/auth
 */
import { readFileSync } from 'node:fs'

import { resolveClient, resolveTokenSource } from './settings.js'

/** Credentials are re-fetched this long before the reported expiry. */
const EXPIRY_SKEW_MS = 60_000

/**
 * Read a refresh token from the `agy` credential file(s).
 * @param files - candidate paths, highest precedence first.
 * @returns the refresh token and the file it came from.
 * @throws {AuthError} when no file yields a token.
 */
export function readRefreshTokenFromFile(files) {
  const attempts = []
  for (const file of files) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      const token = parsed?.token ?? parsed
      const refresh = token?.refresh_token
      if (typeof refresh === 'string' && refresh !== '') return { refreshToken: refresh, source: file }
      attempts.push(`${file}: no refresh_token`)
    } catch (error) {
      attempts.push(`${file}: ${error?.code ?? error?.message ?? 'unreadable'}`)
    }
  }
  throw new AuthError(
    'No Antigravity refresh token found. Sign in with `agy`, or set refreshToken / ANTIGRAVITY_REFRESH_TOKEN.',
    'NO_CREDENTIAL',
    { attempts },
  )
}

/** A credential or token-endpoint failure, classified for the host. */
export class AuthError extends Error {
  /**
   * @param message - human-readable reason.
   * @param code - stable machine code.
   * @param details - extra diagnostic fields.
   */
  constructor(message, code, details = {}) {
    super(message)
    this.name = 'AuthError'
    this.code = code
    this.details = details
  }
}

/**
 * Acquire and cache an access token via the refresh-token grant.
 *
 * Concurrent calls share one in-flight request, so a burst of subagent turns
 * does not produce a burst of token refreshes.
 */
export class TokenProvider {
  /**
   * @param options - `{ config, env, fetchImpl, log, now }`.
   */
  constructor(options) {
    this.config = options.config
    this.env = options.env ?? process.env
    this.fetch = options.fetchImpl ?? globalThis.fetch
    this.log = options.log
    this.now = options.now ?? Date.now
    this.cached = null
    this.inflight = null
  }

  /**
   * Read the current refresh token without caching it, so a rotated file is
   * picked up on the next refresh attempt.
   * @returns the refresh token string.
   */
  refreshToken() {
    const source = resolveTokenSource(this.config, this.env)
    if (source.explicit) return source.explicit
    return readRefreshTokenFromFile(source.files).refreshToken
  }

  /**
   * Return a valid access token, refreshing when absent or near expiry.
   * @param signal - cancellation for the refresh request.
   * @returns a bearer token.
   */
  async get(signal) {
    const now = this.now()
    if (this.cached && this.cached.expiresAt - EXPIRY_SKEW_MS > now) return this.cached.accessToken
    if (this.inflight) return this.inflight
    this.inflight = this.refresh(signal).finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  /**
   * Perform the refresh-token grant.
   * @param signal - cancellation.
   * @returns the new access token.
   */
  async refresh(signal) {
    const client = resolveClient(this.config, this.env)
    const refreshToken = this.refreshToken()
    const body = new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })
    let response
    try {
      response = await this.fetch(client.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal,
      })
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      throw new AuthError(`Token endpoint unreachable: ${error?.message ?? error}`, 'TOKEN_UNREACHABLE')
    }
    const text = await response.text()
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      throw new AuthError(`Token endpoint returned non-JSON (HTTP ${response.status})`, 'TOKEN_PROTOCOL', { text: text.slice(0, 200) })
    }
    if (!response.ok) {
      // invalid_grant means the refresh token was revoked or rotated away.
      const code = payload?.error === 'invalid_grant' ? 'CREDENTIAL_REJECTED' : 'TOKEN_REJECTED'
      throw new AuthError(
        `Token refresh failed: ${payload?.error ?? response.status} ${payload?.error_description ?? ''}`.trim(),
        code,
        { status: response.status },
      )
    }
    const accessToken = payload.access_token
    const expiresIn = Number(payload.expires_in) || 3599
    if (typeof accessToken !== 'string' || accessToken === '') {
      throw new AuthError('Token endpoint returned no access_token', 'TOKEN_PROTOCOL')
    }
    this.cached = { accessToken, expiresAt: this.now() + expiresIn * 1000 }
    this.log?.debug?.('antigravity: access token refreshed')
    return accessToken
  }

  /** Drop the cached token (e.g. after a 401). */
  invalidate() {
    this.cached = null
  }
}
