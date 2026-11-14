/**
 * OpenCode v2 **pure LLM adapter**.
 *
 * This file is deliberately NOT an OpenCode agent client. It uses the local
 * OpenCode server only as a control plane for model discovery, provider
 * metadata, and credentials, then calls the provider's OpenAI-compatible
 * `/chat/completions` endpoint directly.
 *
 * The DSH harness owns the agent loop: system prompt, tool schemas, tool
 * execution, approvals, session history, and the active workspace. The adapter
 * only translates DSH `GenerateOptions` into a raw chat request and translates
 * the provider's SSE deltas back into DSH `StreamChunk`s.
 *
 * Measured control-plane surface (OpenCode v2.2.0):
 *   - `GET /api/info`       -> liveness/version
 *   - `GET /api/model`      -> catalog: `limit.context`, `limit.output`, `variants[]`
 *   - `GET /api/provider/{id}` -> provider `settings.baseURL`, `headers`
 *   - `GET /api/credential` -> active credential (key or OAuth access token)
 *
 * Generation surface:
 *   - `POST {baseURL}/chat/completions` with `stream:true`,
 *     `stream_options.include_usage:true`, OpenAI messages/tools.
 *
 * Forbidden by policy (asserted by tests):
 *   - `POST /api/session/{id}/prompt` and `agent:"build"` session loops
 *   - persona `brief` strings or `[note: the caller declared ...]`
 *   - static `cwd` overrides for model context
 *
 * Stream implementation (A3/R1 — SHARED ONLY). There is exactly one pipeline:
 *
 *   HTTPS response bytes
 *     -> `readSseEvents` / `normalizeStream` from `lib/stream` (shared reader +
 *        shared pipe, shared block lifecycle, finish table, usage ordering and
 *        empty/cut/abort terminal policy)
 *     -> `createStreamHooks` (lib/stream-contract.js), whose `readEvent` delegates
 *        the WIRE to `lib/stream/openai.js` (shared OpenAI core)
 *     -> the vendor-local NOTATION classifier (lib/notation-classifier.js),
 *        reached through the single named export `createNotationClassifier`,
 *        which recovers a call the model wrote as prose.
 *
 * `streamViaSharedPipe()` below is the ONLY stream loop in this file.
 *
 * No legacy fallback remains. The pre-Phase-B loop, the `pipe: 'legacy'` config
 * key, its opt-out branch and the vendor-local SSE reader (`chatSseEvents` /
 * `parseSseBlock`) were DELETED in A3/R1; there is no config that selects a
 * different pipeline, and no second implementation to diff against. The shared
 * output is pinned by literal golden-sequence tests in test/http.test.mjs.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import Schema from '@deepseek-ai/schemastery'

import {
  blocksToText,
} from './provider.js'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_TURN_MAX_TOKENS,
  classifyWire,
  compatibilityOf,
  completionTokensField,
  modelsFromApiPayload,
  reasoningEffortsFromVariants,
  turnCompletionReservation,
  unsupportedEffortMessage,
} from './shared.js'
import { resolveCatalogPath } from './catalog-file.js'
import { createCatalogLifecycle } from './catalog-lifecycle.js'
import { createVerdictStore } from './verdict-store.js'
import { PLANS, PLAN_PROVIDERS, NEW_MODEL_DAYS, isNewModel, orderModels, planOfRoute, rankingForRoutes, rankingFromDataIndex } from './plans.js'
import {
  decideRouterConflict,
  detectRouterConflicts,
  normalizeConflictPolicy,
} from './conflicts.js'
import { createDisplayGate } from './display-gate.js'
import { createStreamHooks, OPENCODE_DESCRIPTOR } from './stream-contract.js'
import { createStreamLifecycle } from './stream-lifecycle.js'
import { normalizeStream, readSseEvents } from '../../../lib/stream/index.js'
import { backoffDelay, isRetryableStatus, sleepFor, statusOf, withRetry } from '../../../lib/retry.js'
import { inferToolFromArguments, normalizeArguments } from './arguments.js'
import { createTrace, summarizeRequest } from './trace.js'
import { finishFromOpenAi, reasoningAccounting, usageFromOpenAi } from './openai-mapping.js'
import { createCostLedger, createCostStore, describeCost, parseCost, pickSession, sharedCostLedger } from './cost.js'
import { installResilience } from './resilience.js'
import { syncOpenCodeSelection } from './opencodex-models.js'
import {
  INVALID_REQUEST,
  RequestShapeError,
  resolveRequestMaxTokens,
  validateRequest,
} from './request-guards.js'
// The mutual-exclusion guard against the beta package was removed with that package
// (owner instruction 2026-11-04). The pre-existing `conflictPolicy` guard below is
// the one that stays: it handles a LEGACY opencode-go/opencode provider, which is a
// real third-party collision, not a second copy of this adapter.

// The pure OpenAI-mapping helpers now live in their own module (Phase B, B-1).
// They are re-exported here so every existing import path (`./http.js`) and every
// existing test keeps working unchanged.
export { usageFromOpenAi, finishFromOpenAi, reasoningAccounting } from './openai-mapping.js'

/** Plugin name; the cordis row uses the `@nolit/dsh-opencode-v2/http` specifier. */
export const name = 'dsh-opencode-v2-http'

/**
 * The llm registry, subprocess (local control-plane/server), live sessions (cwd),
 * and `connection` — the last one owns `ctx.connection.fetch`, which serves the
 * settings tab's routes. Declaring it is mandatory: reading an undeclared service
 * throws and takes the whole plugin entry down (measured in an isolated boot,
 * 2026-10-30). Hosts without it still boot; the routes are simply not registered.
 */
export const inject = ['llm', 'subprocess', 'sessions', 'connection', 'settings']

/** Attribution headers are a host contract; fall back to none in unit tests. */
let attributionHeaders = () => ({})
try {
  const llm = await import('@deepseek-ai/dsh-llm')
  if (typeof llm.attributionHeaders === 'function') attributionHeaders = llm.attributionHeaders
} catch {
  /* unit tests run without the host package on the resolution path */
}

/**
 * The host's `LlmError`, when the host package is resolvable.
 *
 * The shared pipe rethrows a protocol defect rather than turning it into an
 * in-band finish. A uniform host error is preferable when it is available, but
 * this package has no runtime dependency on `@deepseek-ai/dsh-llm` (measured: it
 * is absent from the vendored `node_modules`), so the fallback keeps the same
 * `{ code, cause }` shape and the stream path never depends on the import.
 */
let HostLlmError = null
try {
  const llm = await import('@deepseek-ai/dsh-llm')
  if (typeof llm.LlmError === 'function') HostLlmError = llm.LlmError
} catch {
  /* no host package: the fallback below carries the same facts */
}

/**
 * Build the error thrown out of a shared-pipe protocol defect.
 *
 * @param error - the defect error raised by the pipe (`code`, `message`, `raw`).
 * @returns an `LlmError`-compatible error carrying the stable code.
 */
function protocolDefectError(error) {
  const code = error?.code ?? 'PROTOCOL_DEFECT'
  const message = error instanceof Error ? error.message : String(error)
  if (HostLlmError !== null) return new HostLlmError(message, code, { cause: error })
  const fallback = new Error(message, { cause: error })
  fallback.name = 'LlmError'
  fallback.code = code
  return fallback
}

/**
 * Build the typed refusal for a route whose catalog package is not an OpenAI
 * chat wire.
 *
 * @param {string} modelId - route id as advertised (`provider/model`).
 * @param {string} packageId - the package the catalog declared.
 * @returns {Error} an `LlmError`-compatible error with code `UNSUPPORTED_PROTOCOL`.
 */
export function unsupportedProtocolError(modelId, packageId) {
  const message = `${modelId} uses ${packageId}; this adapter speaks the OpenAI chat wire only`
  if (HostLlmError !== null) return new HostLlmError(message, 'UNSUPPORTED_PROTOCOL')
  const fallback = new Error(message)
  fallback.name = 'LlmError'
  fallback.code = 'UNSUPPORTED_PROTOCOL'
  return fallback
}

const FORWARD_ENV_DEFAULT = [
  'PATH',
  'HOME',
  'USER',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'OPENCODE_CONFIG',
]

const TEXT_INDEX = 0
const REASONING_INDEX = 1
const TOOL_INDEX_BASE = 2

/** Version string of this module, for the load beacon. Must match package.json. */
const VERSION = '0.0.1-rc.1'

/**
 * HTTP statuses one generation request may be retried on.
 *
 * Measured 2026-11-05: a single `451 Endpoint is unavailable` from the OpenCode
 * backend killed a 27-step subagent turn, and the Lead re-ran the whole track
 * (56 duplicate tool calls / 7.8 min). 429/451/502/503/504 are backend refusals
 * that say nothing about the request body, so re-sending it is safe before any
 * delta reached the transcript. 401/403/400 are NOT here: they need a different
 * credential or request, not a retry.
 */
export const DEFAULT_HTTP_RETRY_STATUSES = Object.freeze([429, 451, 502, 503, 504])

export const Config = Schema.object({
  /**
   * Model-serving switch (unified with dsh-antigravity): off releases the
   * `opencode-http-agent` adapter so the route disappears from the picker. The
   * control-plane server and the CLI/delegation surfaces are unaffected.
   */
  modelServing: Schema.boolean().default(true).volatile(),
  /** Explicit local OpenCode server URL; empty attaches to the daemon or spawns one. */
  baseUrl: Schema.string().default('').volatile(),
  /**
   * Basic-auth password for the local control-plane server.
   *
   * `role('secret')` is not decoration: the host redacts settings values through
   * `redactSecrets()`, which removes only fields whose schema declares that role.
   * Without it this value rides the settings response into the browser verbatim
   * (measured 2026-11-03 against dsh-settings: 0 secrets declared, plaintext kept).
   */
  password: Schema.string().default('').role('secret').volatile(),
  /**
   * Reaction when a legacy OpenCode provider (`opencode-go` / `opencode`, e.g.
   * llm-pi-ai) is already registered, or another instance owns this provider.
   */
  conflictPolicy: Schema.string().default('warn').volatile(),
  /** Where a running `opencode serve --service` publishes {url,pid,password}. */
  serviceStatePath: Schema.string().default('').volatile(),
  attachToDaemon: Schema.boolean().default(true).volatile(),
  spawnServer: Schema.boolean().default(true).volatile(),
  opencodePath: Schema.string().default('opencode').volatile(),
  spawnTimeoutMs: Schema.number().default(30000).volatile(),
  forwardEnv: Schema.array(Schema.string()).default(FORWARD_ENV_DEFAULT).volatile(),
  /**
   * Local server process cwd only. It is NEVER used as the model context
   * directory: DSH tools own the caller session's cwd.
   */
  cwd: Schema.string().default('').volatile(),
  defaultModel: Schema.string().default('opencode-go/minimax-m3.1-flash').volatile(),
  /**
   * The operator's OWN route table. It seeds NO row.
   *
   * This array used to carry one synthetic entry (id `default`, named after the
   * OpenCode configuration default). That entry is NOT a model id: it was
   * prepended to the picker's provider group as if it were a served route. It
   * is gone from every list and from the config default.
   *
   * The `default` PSEUDO-ROUTE still resolves server-side, and that behaviour
   * is unchanged: `defaultModel` above is what it resolves to
   * (`modelRefFromRoute` -> `entry?.opencodeModel || defaultModel`).
   */
  models: Schema.array(
    Schema.object({
      id: Schema.string(),
      opencodeModel: Schema.string().default(''),
      name: Schema.string().default(''),
    }),
  )
    .default([])
    .volatile(),
  /** Local OpenCode provider id whose backend endpoint and credential are used. */
  backendProviderId: Schema.string().default('opencode-go').volatile(),
  /** Explicit OpenAI-compatible backend root; empty resolves from `/api/provider/{id}`. */
  backendBaseUrl: Schema.string().default('').volatile(),
  /**
   * Explicit bearer token; empty uses OPENCODE_API_KEY or the local credential store.
   * Secret for the same reason as `password` above.
   */
  apiKey: Schema.string().default('').role('secret').volatile(),
  apiKeyEnv: Schema.string().default('OPENCODE_API_KEY').volatile(),
  /**
   * Credential-store label to pin for the backend credential (e.g. `Personal`).
   * Empty means "prefer an active oauth entry, then an active key entry".
   */
  credentialLabel: Schema.string().default('').volatile(),
  /** Header carrying the stable conversation id the Go backend routes on. */
  sessionHeader: Schema.string().default('x-opencode-session').volatile(),
  /** Value used when DSH dispatches without a session id (catalog/title probes). */
  sessionFallback: Schema.string().default('deepseek-harness').volatile(),
  /** Backend-model request path below `backendBaseUrl`. */
  chatPath: Schema.string().default('/chat/completions').volatile(),
  /** How long a resolved provider base/credential pair is reused. */
  credentialCacheMs: Schema.number().default(300000).volatile(),
  /** OpenAI-compatible field carrying streamed reasoning (`reasoning_content`, ...). */
  reasoningField: Schema.string().default('reasoning_content').volatile(),
  /** OpenAI-compatible field carrying the reasoning effort. */
  effortField: Schema.string().default('reasoning_effort').volatile(),
  /**
   * Completion tokens ONE TURN reserves (the host's `defaultMaxTokens`).
   *
   * Separate from the route's capability (`limit.output`, kept in the catalog):
   * the reservation is subtracted from the context window before compaction
   * decides how much room messages get, so publishing a capability-sized number
   * here wastes context on every turn. See DEFAULT_TURN_MAX_TOKENS.
   */
  turnMaxTokens: Schema.number().default(DEFAULT_TURN_MAX_TOKENS).volatile(),
  timeoutMs: Schema.number().default(1800000).volatile(),
  requestTimeoutMs: Schema.number().default(30000).volatile(),
  /**
   * Transparent retries of one generation request after the upstream stream is
   * cut before it produced any delta. Nothing has reached the transcript yet at
   * that point, so a retry cannot duplicate or corrupt content.
   */
  streamRetries: Schema.number().default(1).volatile(),
  /**
   * Keep a step's partial output when the stream is cut after it started. With
   * this off, the adapter reports `OPENCODE_BACKEND` and the harness fails the
   * whole turn (the measured 2026-10-31 `terminated` failure).
   */
  streamCutPreserve: Schema.boolean().default(true).volatile(),
  /**
   * Adapter-level retries when the backend answers a generation request with a
   * retryable status (see `httpRetryStatuses`). Exponential backoff:
   * `httpRetryBaseMs`, x2, x4. `0` keeps the pre-2026-11-05 single-attempt
   * behavior for callers that want it.
   */
  httpRetries: Schema.number().default(3).volatile(),
  /** Statuses that trigger `httpRetries`; 400/401/403 are deliberately absent. */
  httpRetryStatuses: Schema.array(Schema.number()).default([...DEFAULT_HTTP_RETRY_STATUSES]).volatile(),
  /** First backoff step for `httpRetries`; doubles per attempt (1s → 2s → 4s). */
  httpRetryBaseMs: Schema.number().default(1000).volatile(),
  /**
   * Retries of a local control-plane `GET /api/provider/{id}` that answers 404:
   * the attached daemon lost its provider catalog (measured 9 times between
   * 2026-10-31 and 11-04) or was replaced. The backend is re-resolved before
   * every retry, so a stale `opencode-go` root cannot keep failing the turn.
   */
  daemonRetries: Schema.number().default(3).volatile(),
  /** First backoff step for `daemonRetries`; doubles per attempt. */
  daemonRetryBaseMs: Schema.number().default(1000).volatile(),
  /**
   * Where the durable per-session spend ledger lives (`opencode-session-cost.json`).
   * Empty follows the catalog rule (profile dir, then `$DSH_HOME/cache`). This key
   * was read by the adapter but absent from the schema until 2026-11-05, so a
   * profile setting it had no effect.
   */
  costPath: Schema.string().default('').volatile(),
  /**
   * Cancel a parent's running subagent descendants when that parent's turn ends
   * in error/abort, and sweep children whose parent is no longer live. This is
   * the measured 2026-11-05 orphan case: nothing collects the child, yet it
   * keeps spending quota.
   */
  orphanCleanup: Schema.boolean().default(true).volatile(),
  /** Interval of the orphan sweep (ms); minimum 5s. */
  orphanSweepMs: Schema.number().default(60000).volatile(),
  /** Write a salvage manifest when a subagent's turn fails (files survive as-is). */
  salvage: Schema.boolean().default(true).volatile(),
  /** Manifest directory; empty follows `$DSH_HOME/opencode-v2/salvage`. */
  salvageDir: Schema.string().default('').volatile(),
  /** Upper bound of files one salvage manifest names. */
  salvageMaxFiles: Schema.number().default(200).volatile(),
  discoveryCacheMs: Schema.number().default(300000).volatile(),
  autoDiscoverModels: Schema.boolean().default(true).volatile(),
  catalogPath: Schema.string().default('').volatile(),
  catalogSyncMs: Schema.number().default(300000).volatile(),
  /**
   * Where the settings tab's last entitlement sweep is kept. Empty follows the
   * catalog rule (profile dir, then `$DSH_HOME/cache`). The sweep costs ~20 s,
   * so it runs on the button and the snapshot is what every later open shows.
   */
  verdictPath: Schema.string().default('').volatile(),
  /**
   * Which plan the account is on. `go` = the OpenCode Go subscription
   * (`opencode-go/*` routes), `zen` = pay-as-you-go (`opencode/*`). The catalog
   * provider id is the plan, so availability needs no per-model request.
   */
  activePlan: Schema.union(PLANS).default('go').volatile(),
  /** Public usage ranking used to order the checklist inside each group. */
  rankingUrl: Schema.string().default('https://opencode.ai/data/index.json').volatile(),
  /** Where the ranking snapshot is cached; empty follows the catalog rule. */
  rankingPath: Schema.string().default('').volatile(),
  /** How long the cached ranking stays fresh before a refresh fetches again (5 days). */
  rankingTtlMs: Schema.number().default(432000000).volatile(),
  /** Where the first-seen route snapshot lives; empty follows the catalog rule. */
  knownModelsPath: Schema.string().default('').volatile(),
  /** How long a newly appeared route keeps priority-0 ordering. */
  newModelDays: Schema.number().default(NEW_MODEL_DAYS).volatile(),
  /**
   * Route allow-list for the prompt model picker. Empty means "every route the
   * active plan offers". A non-empty list hides every other route from
   * `listModels`, which is what the settings tab writes; running sessions are
   * unaffected.
   */
  enabledModels: Schema.array(Schema.string()).default([]).volatile(),
  /**
   * Refuse a route whose catalog `package` names a wire this adapter does not
   * speak (anthropic, openai/responses, google, …).
   *
   * Default false, deliberately: the backend sits behind a facade that may
   * translate a chat body, so the honest default is to attempt the request and
   * let the backend answer. `true` turns the guess into a clean, typed refusal
   * (`UNSUPPORTED_PROTOCOL`) before any fetch.
   */
  strictWire: Schema.boolean().default(false).volatile(),
  /**
   * Keep provider metadata this adapter does not interpret (`compatibility`
   * keys outside its known set) on the catalog record instead of stripping it,
   * so a route's own declaration survives.
   */
  allowDynamicPassthrough: Schema.boolean().default(true).volatile(),
  /**
   * Send the request exactly as built: skip the wire preflight and every body
   * translation (`maxTokensField`, `streamUsage`, anthropic cache markers).
   */
  rawBypass: Schema.boolean().default(false).volatile(),
})

function joinUrl(base, path) {
  return `${String(base).replace(/\/+$/, '')}${path}`
}

/** Basic auth header for the local control-plane server (`opencode:<password>`). */
export function authHeader(password) {
  return `Basic ${Buffer.from(`opencode:${password ?? ''}`).toString('base64')}`
}

/** `provider/id` -> backend model ref; `default` maps through the route table. */
export function modelRefFromRoute(route, table, defaultModel) {
  const entry = (table ?? []).find((item) => item.id === route)
  const resolved = route === 'default' ? entry?.opencodeModel || defaultModel || '' : entry?.opencodeModel || route
  if (!resolved) return null
  const slash = resolved.indexOf('/')
  if (slash <= 0) return null
  return { providerID: resolved.slice(0, slash), id: resolved.slice(slash + 1) }
}

/** Stable key for "same backend model + variant". */
export function modelKey(ref, variant) {
  return ref ? `${ref.providerID}/${ref.id}${variant ? `#${variant}` : ''}` : ''
}

/**
 * The caller session's active workspace directory, owned by DSH.
 * Missing services/session are non-fatal: the harness never guesses a project.
 */
export function resolveWorkspaceDirectory(ctx, options) {
  try {
    const id = options?.sessionId
    if (!id) return ''
    return ctx?.sessions?.get?.(id)?.header?.cwd ?? ''
  } catch {
    return ''
  }
}

/**
 * The local OpenCode control-plane endpoint. It supplies catalog, provider
 * metadata, and credentials only; generation never goes through it.
 */
export class ServerManager {
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
    this.resolved = null
    this.child = null
    this.state = null
  }

  stateFilePath() {
    return this.config.serviceStatePath.get()
  }

  headers() {
    return { ...attributionHeaders(), authorization: authHeader(this.resolved?.password ?? '') }
  }

  async request(method, path, body, { signal, timeoutMs } = {}) {
    const maxRetries = Math.max(0, Math.trunc(this.config.daemonRetries?.get?.() ?? 3) || 0)
    const baseMs = Math.max(0, Number(this.config.daemonRetryBaseMs?.get?.() ?? 1000) || 0)
    // A provider 404 means the attached daemon's catalog does not contain the
    // route (or the daemon was replaced). Re-resolving before each retry turns
    // that from a dead turn into a recoverable control-plane miss.
    const retryable404 = path.startsWith('/api/provider/')
    // The endpoint the CURRENT attempt resolved; `undefined` means `ensure()`
    // itself threw, and a resolve failure is never retried here.
    let attemptEndpoint
    return withRetry(
      async () => {
        attemptEndpoint = undefined
        const endpoint = await this.ensure()
        attemptEndpoint = endpoint
        return await this.requestOnce(endpoint, method, path, body, { signal, timeoutMs })
      },
      {
        retries: maxRetries,
        baseMs,
        // The measured control-plane loop had no ceiling: keep it uncapped so
        // the delay progression is unchanged (1s -> 2s -> 4s -> ...).
        capMs: Number.MAX_SAFE_INTEGER,
        // This loop classifies failures itself (a bare 404 only matters on a
        // provider path; a status-less failure only on an attached daemon).
        retryStatuses: [],
        shouldRetry: (error) => {
          if (signal?.aborted || !attemptEndpoint) return false
          const status = statusOf(error)
          if (status === undefined) return !attemptEndpoint.owned
          return status === 404 && retryable404
        },
        onRetry: ({ attempt, delay, error }) => {
          this.ctx?.logger?.warn?.(
            `opencode-http-agent: control-plane ${method} ${path} failed (${errorText(error)}); ` +
              `retry ${attempt + 1}/${maxRetries} in ${delay}ms`,
          )
          // Drop the cached endpoint so the next attempt re-resolves.
          this.resolved = null
        },
        signal,
      },
    )
  }

  async requestOnce(endpoint, method, path, body, { signal, timeoutMs } = {}) {
    const controller = new AbortController()
    const timeout = AbortSignal.timeout(timeoutMs ?? this.config.requestTimeoutMs.get())
    const stop = signal ? AbortSignal.any([signal, timeout]) : timeout
    const onAbort = () => controller.abort()
    stop.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await fetch(joinUrl(endpoint.url, path), {
        method,
        headers: {
          ...this.headers(),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
      const text = await response.text()
      let parsed = null
      if (text) {
        try {
          parsed = JSON.parse(text)
        } catch {
          parsed = text
        }
      }
      if (!response.ok) {
        const detail = typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
        const error = new Error(`opencode ${method} ${path} -> HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`)
        error.status = response.status
        throw error
      }
      return parsed
    } finally {
      stop.removeEventListener('abort', onAbort)
    }
  }

  async ensure() {
    if (this.resolved) return this.resolved
    if (!this.resolving) {
      this.resolving = this.resolve().finally(() => {
        this.resolving = undefined
      })
    }
    return this.resolving
  }

  async resolve() {
    const baseUrl = this.config.baseUrl.get()
    if (baseUrl) {
      const password = this.config.password.get()
      const url = baseUrl.replace(/\/+$/, '')
      const info = await probeServer(url, password)
      this.resolved = { url, password, owned: false, version: info?.version }
      return this.resolved
    }
    const reasons = []
    if (this.config.attachToDaemon.get()) {
      const attached = await this.attach()
      if (attached) {
        this.resolved = attached
        return attached
      }
      reasons.push(this.attachReason ?? 'the CLI daemon state file did not yield a reachable server')
    }
    if (!this.config.spawnServer.get()) {
      throw new Error(`no OpenCode server: ${reasons.join('; ') || 'baseUrl is empty'} and spawnServer is disabled`)
    }
    try {
      this.resolved = await this.spawn()
      return this.resolved
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        `OpenCode control plane unavailable: ${[...reasons, `spawn failed (${detail})`].join('; ')}. ` +
          'Set opencodePath to an absolute executable path, or keep a daemon running.',
      )
    }
  }

  async attach() {
    this.attachReason = null
    const failures = []
    for (const path of serviceStateCandidates(this.stateFilePath())) {
      const attached = await this.attachCandidate(path)
      if (attached) return attached
      if (this.attachReason) failures.push(`${path}: ${this.attachReason}`)
    }
    this.attachReason = failures.length
      ? `no reachable daemon state (${failures.join('; ')})`
      : 'no daemon state candidate'
    return null
  }

  async attachCandidate(path) {
    let state
    try {
      const raw = readFileSync(path, 'utf8')
      if (!raw) throw new Error('file is empty')
      state = JSON.parse(raw)
    } catch (error) {
      this.attachReason = `daemon state unreadable (${error instanceof Error ? error.message : String(error)})`
      return null
    }
    if (!state?.url || !state?.password) {
      this.attachReason = 'daemon state file has no url/password'
      return null
    }
    const url = String(state.url).replace(/\/+$/, '')
    const password = String(state.password)
    if (state.pid) {
      try {
        process.kill(state.pid, 0)
      } catch {
        this.attachReason = `daemon pid ${state.pid} is not running`
        return null
      }
    }
    const info = await probeServer(url, password)
    if (!info) {
      this.attachReason = `daemon at ${url} did not answer /api/info`
      return null
    }
    this.state = state
    return { url, password, owned: false, version: info.version }
  }

  async spawn() {
    if (!this.ctx?.subprocess) throw new Error('spawnServer needs ctx.subprocess')
    const env = {}
    for (const key of this.config.forwardEnv.get()) {
      if (process.env[key] !== undefined) env[key] = process.env[key]
    }
    const executable = await this.ctx.subprocess.resolveExecutable(this.config.opencodePath.get(), env)
    const handle = this.ctx.subprocess.spawn({
      argv: [executable, 'serve', '--hostname', '127.0.0.1', '--port', '0'],
      cwd: this.config.cwd.get() || process.cwd(),
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: { maxBytes: 65536 } },
      graceMs: 5000,
      env,
    })
    this.child = handle
    const banner = await readBanner(handle, this.config.spawnTimeoutMs.get())
    if (!banner) {
      handle.terminate?.()
      this.child = null
      throw new Error('opencode serve did not print a usable banner')
    }
    const info = await probeServer(banner.url, banner.password)
    if (!info) {
      handle.terminate?.()
      this.child = null
      throw new Error('opencode serve banner did not answer /api/info')
    }
    return { url: banner.url, password: banner.password, owned: true, version: info.version }
  }

  dispose() {
    if (this.child) {
      try {
        this.child.terminate?.()
      } catch {
        /* already gone */
      }
      this.child = null
    }
    this.resolved = null
  }
}

export function serviceStateCandidates(configured = '') {
  const home = process.env.HOME ?? ''
  const stateHome = process.env.XDG_STATE_HOME || `${home}/.local/state`
  const configHome = process.env.XDG_CONFIG_HOME || `${home}/.config`
  const candidates = [
    configured,
    process.env.OPENCODE_SERVICE_STATE ?? '',
    `${stateHome}/opencode/service.json`,
    `${configHome}/opencode/service.json`,
  ]
  return [...new Set(candidates.filter((path) => typeof path === 'string' && path.length > 0))]
}

export async function probeServer(url, password, timeoutMs = 3000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(joinUrl(url, '/api/info'), {
      headers: { ...attributionHeaders(), authorization: authHeader(password) },
      signal: controller.signal,
    })
    if (!response.ok) return null
    const info = await response.json()
    return info?.version ? info : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function readBanner(handle, timeoutMs) {
  const stdout = handle?.stdout
  if (!stdout) return null
  const decoder = new TextDecoder()
  const timer = AbortSignal.timeout(timeoutMs)
  let buffer = ''
  const iterator = stdout[Symbol.asyncIterator]()
  try {
    for (;;) {
      const race = await Promise.race([
        iterator.next(),
        new Promise((resolve) => timer.addEventListener('abort', () => resolve({ done: true }), { once: true })),
      ])
      if (race.done) return parseBanner(buffer)
      buffer += decoder.decode(race.value, { stream: true })
      const banner = parseBanner(buffer)
      if (banner?.password) return banner
      if (buffer.length > 65536) return null
    }
  } catch {
    return null
  }
}

export function parseBanner(text) {
  const url = String(text ?? '').match(/server listening on (https?:\/\/\S+)/)
  if (!url) return null
  const password = String(text).match(/server password (\S+)/)
  return { url: url[1].replace(/\/+$/, ''), password: password ? password[1] : '' }
}

/**
 * The assistant prose that is legal to re-send on the wire.
 *
 * Assistant history must carry *prose only*: the route already receives the calls
 * as structured `tool_calls`, and reasoning is not part of the conversation
 * contract. Rendering the whole block list (provider.js `blocksToText`) sent every
 * prior call twice - once as a wire field and once as `[tool call <name> #<id>]:
 * <json>` prose - plus a `<thinking>` wrapper around every reasoning block.
 *
 * Measured 2026-11-01/02 on the owner's own traffic: session `bca2c2f7` sent 73
 * `<thinking>` wrappers and 122 rendered calls, session `edeabe91` 12 and 13. That
 * teaches the model to keep writing the protocol notation it is being shown (the
 * leak the classifier then has to strip) and shows each call twice, which is the
 * shape that makes a turn restate a call it already made.
 *
 * @param {object[]} blocks - DSH content blocks of one assistant message.
 * @returns {string} the text blocks joined, without reasoning or call notation.
 */
export function assistantHistoryText(blocks) {
  const parts = []
  for (const block of blocks ?? []) {
    if (!block || block.type !== 'text') continue
    if (typeof block.text === 'string' && block.text.length > 0) parts.push(block.text)
  }
  return parts.join('\n')
}

/**
 * Clone one chat message with an Anthropic prompt-cache marker attached.
 *
 * A marker lives on a content PART, so string content is rewritten into one text
 * part. Always a copy: the caller's objects are never mutated.
 *
 * @param {object} message
 * @returns {object} the marked copy.
 */
function withCacheMarker(message) {
  const marker = { type: 'ephemeral' }
  if (typeof message.content === 'string') {
    return { ...message, content: [{ type: 'text', text: message.content, cache_control: marker }] }
  }
  if (Array.isArray(message.content) && message.content.length > 0) {
    const parts = message.content.slice()
    const last = parts.length - 1
    const part = parts[last]
    parts[last] = part && typeof part === 'object'
      ? { ...part, cache_control: marker }
      : { type: 'text', text: String(part ?? ''), cache_control: marker }
    return { ...message, content: parts }
  }
  return { ...message, cache_control: marker }
}

/**
 * Add Anthropic prompt-cache markers to a built body (official V2 rules).
 *
 * Exactly three markers: the last tool definition, the system prompt, and the
 * latest message. Everything is cloned, so the caller's objects are untouched.
 *
 * @param {object} body - the built chat request.
 * @returns {object} a marked copy.
 */
export function withAnthropicCacheMarkers(body) {
  const marker = { type: 'ephemeral' }
  const out = { ...body, messages: (body.messages ?? []).map((message) => ({ ...message })) }
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    out.tools = body.tools.map((tool) => ({ ...tool }))
    out.tools[out.tools.length - 1] = { ...out.tools[out.tools.length - 1], cache_control: marker }
  }
  // The system prompt: a system-role message when the history carries one,
  // otherwise the top-level `system` string (rewritten into a text part).
  const systemIndex = out.messages.findIndex((message) => message?.role === 'system')
  if (systemIndex >= 0) {
    out.messages[systemIndex] = withCacheMarker(out.messages[systemIndex])
  } else if (typeof out.system === 'string' && out.system.length > 0) {
    out.system = [{ type: 'text', text: out.system, cache_control: marker }]
  }
  // The latest message, which is the current turn.
  const latest = out.messages.length - 1
  if (latest >= 0) out.messages[latest] = withCacheMarker(out.messages[latest])
  return out
}

/**
 * Build the OpenAI-compatible request body from DSH `GenerateOptions`.
 *
 * @param {object} options - `GenerateOptions`.
 * @param {{ providerID?: string, id: string }} ref - backend model ref.
 * @param {object} config - adapter config (`effortField`, ...).
 * @param {{ model?: unknown, rawBypass?: boolean }} [route]
 *   The catalog record for this route. It decides the completion-budget field
 *   (G4), whether `stream_options` is sent (G5) and whether Anthropic cache
 *   markers are added (G6). Absent means "unknown route", which keeps the
 *   historical OpenAI-chat body.
 */
export function buildChatRequest(options, ref, config, route = {}) {
  const rawBypass = route.rawBypass === true
  const model = route.model ?? null
  const compatibility = rawBypass ? {} : compatibilityOf(model)
  const messages = []
  const append = (role, content) => {
    if (content === undefined || content === null || content === '') return
    messages.push({ role, content })
  }

  if (options.system) append('system', options.system)
  for (const message of options.messages ?? []) {
    const text = blocksToText(message.content).trim()
    if (message.role === 'assistant') {
      const toolCalls = (message.content ?? [])
        .filter((block) => block.type === 'tool-call')
        .map((block) => ({
          id: String(block.id),
          type: 'function',
          function: { name: block.name, arguments: block.arguments },
        }))
      const prose = assistantHistoryText(message.content).trim()
      if (toolCalls.length > 0) {
        messages.push({ role: 'assistant', content: prose || null, tool_calls: toolCalls })
      } else if (prose.length > 0) {
        append('assistant', prose)
      }
      // A message that held only reasoning (or only a call) contributes nothing
      // else: no wrapper, no rendered call, no phantom empty message.
    } else if (message.role === 'tool') {
      // A tool result must keep its call id even when the output was empty; the
      // previous append() dropped empty content and mis-assigned the id.
      messages.push({ role: 'tool', content: text, tool_call_id: String(message.toolCallId) })
    } else if (message.role === 'system' || message.role === 'developer') {
      // DSH's loop-built history carries the system prompt as a leading
      // system-role message (GenerateOptions.messages[0]); mapping it to 'user'
      // silently removed every system instruction from the model.
      append('system', text)
    } else {
      append('user', text)
    }
  }

  const body = {
    model: ref.id,
    messages,
    stream: true,
  }
  // G5: a route that rejects `stream_options` must not receive it. An absent
  // usage chunk is then normal, not a defect.
  if (compatibility.streamUsage !== false) body.stream_options = { include_usage: true }
  // G4: the completion budget goes in the field the route declares. Never both.
  if (options.maxTokens !== undefined) body[completionTokensField(model, { rawBypass })] = options.maxTokens
  // The clamp lives in `stream()` (it needs the live catalog window), not here:
  // buildChatRequest stays a pure translation of GenerateOptions.
  if (options.temperature !== undefined) body.temperature = options.temperature
  if (options.stop !== undefined) body.stop = options.stop
  if (options.reasoningEffort !== undefined && options.reasoningEffort !== 'off') {
    body[config.effortField.get()] = options.reasoningEffort
  }
  if (options.tools?.length) {
    body.tools = options.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))
    body.tool_choice = 'auto'
  }
  // G6: an Anthropic-format proxy needs explicit prompt-cache markers. Built on a
  // clone, so the caller's options and messages stay untouched.
  if (compatibility.cacheFormat === 'anthropic') return withAnthropicCacheMarkers(body)
  return body
}

/**
 * Count the prompt the way the wire will: characters of every message body plus
 * the tool schemas. Only used when the host supplies no measured count.
 *
 * Deliberately crude and labelled as such — recipe's exact answer needs a
 * tokenizer, and this adapter has none. A 3.5 chars/token divisor is the
 * conservative end of the measured range for this traffic, so the estimate errs
 * toward clamping earlier, never later.
 *
 * @param {object} body - the built chat request.
 * @returns {number} estimated prompt tokens.
 */
export function estimatePromptTokens(body) {
  let chars = 0
  for (const message of body?.messages ?? []) {
    if (typeof message.content === 'string') chars += message.content.length
    if (Array.isArray(message.tool_calls)) chars += JSON.stringify(message.tool_calls).length
  }
  if (Array.isArray(body?.tools)) chars += JSON.stringify(body.tools).length
  return Math.ceil(chars / 3.5)
}

/** Local control-plane catalog + pure OpenAI-compatible generation. */
export class OpencodeHttpAdapter {
  constructor(ctx, config, options = {}) {
    this.ctx = ctx
    this.config = config
    this.providerId = options.providerId ?? 'opencode-http-agent'
    this.standDown = false
    this.server = new ServerManager(ctx, config)
    // Per-session spend, from the wire's own cost fields (lib/cost.js). Kept on
    // the adapter so every stream of one process feeds the same ledger.
    // Persisted so a restart does not reset the session's running total.
    this.costLedger = sharedCostLedger('opencode-http-agent', {
      store: createCostStore({
        explicit: config.costPath?.get?.() ?? '',
        profileDir: ctx?.get?.('profileContext')?.dir,
        dshHome: process.env.DSH_HOME,
      }),
    })
    /** Short cache for the Go plan window panel (60 s, as the operator sees it). */
    this.planCache = null
    this.backendCache = null
    this.lastWorkspace = ''
    // The cache is the router's one module (`lib/catalog-cache.js`); this
    // adapter keeps only the probe, the snapshot path, and the timings.
    this.catalog = createCatalogLifecycle({
      probe: () => this.discoverOnce(),
      path: resolveCatalogPath({
        explicit: config.catalogPath.get(),
        profileDir: ctx?.get?.('profileContext')?.dir,
        dshHome: process.env.DSH_HOME,
        fileName: options.catalogFileName ?? 'opencode-models.json',
      }),
      cacheMs: () => this.config.discoveryCacheMs.get(),
      syncMs: () => this.config.catalogSyncMs.get(),
      onChanged: () => this.announce(),
      warn: (message) => ctx?.logger?.warn?.(message),
    })
  }

  warmStart() {
    this.catalog.seed()
    this.catalog.start()
  }

  dispose() {
    this.catalog.stop()
    this.server.dispose()
  }

  announce() {
    try {
      this.ctx?.emit?.('llm/models-updated', this.providerId)
    } catch (error) {
      this.ctx?.logger?.warn?.(`model catalog announcement failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  providerInfo(provider) {
    return { id: provider, name: 'OpenCode Go (direct)' }
  }

  providerRetryPolicy() {}
  imageRequestPricing() {}

  async discover() {
    if (!this.config.autoDiscoverModels.get()) return null
    return this.catalog.read()
  }

  async discoverOnce() {
    try {
      const payload = await this.server.request('GET', '/api/model')
      const result = modelsFromApiPayload(payload, {
        allowDynamicPassthrough: this.config.allowDynamicPassthrough?.get?.() !== false,
        // Only `strictWire` hides an unsupported-package route from the catalog.
        // The default advertises it, marked `unverifiedWire`, because the facade
        // in front of the backend may still translate a chat body.
        strictWire: this.config.strictWire?.get?.() === true,
      })
      if (result) {
        this.discoveryError = null
        return result
      }
      this.discoveryError = new Error('GET /api/model returned an unexpected payload')
      return null
    } catch (error) {
      this.discoveryError = error instanceof Error ? error : new Error(String(error))
      throw this.discoveryError
    }
  }

  describe() {
    const version = this.server.resolved?.version
    return version ? `OpenCode Go v${version} (OpenAI-compatible backend)` : 'OpenCode Go (OpenAI-compatible backend)'
  }

  async listModels(provider) {
    const discovered = await this.discover()
    const description = this.describe()
    const enabled = enabledRouteFilter(this.config.enabledModels.get().map((entry) => String(entry)))
    // The prompt picker only offers routes the active plan can use. Availability
    // is decided from the provider id alone (no per-model request), so this is a
    // pure filter and never touches the backend.
    const activePlan = this.config.activePlan.get()
    const allowsPlan = (route) => planOfRoute(route) === activePlan
    if (discovered?.models?.length) {
      this.markKnown(discovered.models.map((model) => String(model.id)))
      const firstSeen = this.readFirstSeen().firstSeen
      const ranking = this.readRanking().byModel
      const now = Date.now()
      const newWithinDays = this.config.newModelDays.get()
      const rows = discovered.models
        // Catalog ids are already `provider/model` (measured: no separate providerID field).
        // A route that just appeared is offered even when the allow-list is set,
        // so a new model is reachable from the prompt without hunting for it. The
        // plan gate still applies, and the window closes after `newModelDays`.
        .filter((model) => {
          const route = String(model.id)
          if (!allowsPlan(route)) return false
          if (enabled === null || enabled.has(route)) return true
          return isNewModel(route, { firstSeen, ranking, now, newWithinDays })
        })
        .map((model) => ({
          provider,
          id: model.id,
          name: model.name,
          description,
          // The route's own declared modalities travel with the discovery row.
          // Advertised as text-only, an image-capable route was refused by the
          // host before the request was ever built.
          ...(Array.isArray(model.inputModalities) ? { inputModalities: model.inputModalities } : {}),
        }))
      // Priority 0 for a route that just appeared, so it shows up at the top of
      // the prompt picker instead of behind 40 ranked models.
      rows.sort((left, right) => {
        const leftNew = isNewModel(left.id, { firstSeen, ranking, now, newWithinDays })
        const rightNew = isNewModel(right.id, { firstSeen, ranking, now, newWithinDays })
        if (leftNew !== rightNew) return leftNew ? -1 : 1
        return String(left.name ?? left.id).localeCompare(String(right.name ?? right.id))
      })
      // No synthetic `default` row: the picker shows the served catalog only.
      // The `default` pseudo-route still resolves on the wire (`defaultModel`),
      // it is just not ADVERTISED as a model.
      return rows
    }
    if (this.config.autoDiscoverModels.get()) {
      const reason = this.discoveryError?.message ?? 'the server returned no models'
      throw new Error(`OpenCode model catalog unavailable: ${reason}`)
    }
    return this.config.models
      .get()
      .filter((entry) => allowsPlan(String(entry.id)) && (enabled === null || enabled.has(String(entry.id))))
      .map((entry) => ({
        provider,
        id: entry.id,
        name: entry.name || `OpenCode ${entry.id}`,
        description,
        ...(Array.isArray(entry.inputModalities) ? { inputModalities: entry.inputModalities } : {}),
      }))
  }

  async resolveModel(provider, model) {
    const found = await this.lookupModel(model)
    if (!found && model !== 'default' && this.config.autoDiscoverModels.get()) {
      this.ctx?.logger?.warn?.(`OpenCode route "${model}" is not in the served catalog`)
    }
    const efforts = found?.variants?.length ? reasoningEffortsFromVariants(found.variants) : []
    return {
      provider,
      id: model,
      name: found?.name ?? `OpenCode ${model}`,
      description: this.describe(),
      // Absent means "unknown" to the host, which then sends no image cap; a
      // route that declared image input keeps that declaration here.
      ...(Array.isArray(found?.inputModalities) ? { inputModalities: found.inputModalities } : {}),
      context: { contextWindow: found?.contextWindow ?? DEFAULT_CONTEXT_WINDOW },
      // The RESERVATION for one turn, not the route's capability. The capability
      // still travels in the catalog (`maxTokens`) and in the settings UI.
      defaultMaxTokens: turnCompletionReservation(found?.maxTokens, this.config.turnMaxTokens.get()),
      ...(efforts.length ? { reasoning: { efforts } } : {}),
    }
  }

  async lookupModel(model) {
    const discovered = await this.discover()
    if (!discovered?.models?.length) return null
    const ref = model === 'default'
      ? modelRefFromRoute('default', this.config.models.get(), this.config.defaultModel.get())
      : null
    const routeId = ref ? `${ref.providerID}/${ref.id}` : model
    return (
      discovered.models.find((entry) => entry.id === routeId) ??
      discovered.models.find((entry) => entry.id.endsWith(`/${routeId}`)) ??
      null
    )
  }

  async prepareCall(provider, model) {
    return { model: await this.resolveModel(provider, model), stream: (options) => this.stream(options) }
  }

  /**
   * Resolve the OpenAI-compatible backend root and bearer credential.
   *
   * Priority:
   *   1. explicit `backendBaseUrl` / `apiKey` (or `OPENCODE_API_KEY`)
   *   2. local control plane: `/api/provider/{id}` + active `/api/credential`
   *
   * The result is cached for `credentialCacheMs`; a 401 forces one refresh.
   */
  /**
   * Record one request's cost against its session, and log it at debug.
   *
   * Never throws into the stream: a cost bookkeeping failure must not fail a
   * generation.
   *
   * @param {string|undefined} sessionId - DSH session id.
   * @param {string|undefined} model - the route on the wire.
   * @param {object} cost - a record from `parseCost`.
   * @returns {void}
   */
  recordCost(sessionId, model, cost) {
    try {
      this.costLedger.record(sessionId, model, cost)
      this.ctx?.logger?.debug?.('opencode-http-agent cost: ' + describeCost(cost))
    } catch (error) {
      this.ctx?.logger?.warn?.('opencode-http-agent: cost bookkeeping failed: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  /** Per-session spend summary; see lib/cost.js. */
  costSummary() {
    return this.costLedger.summary()
  }

  async resolveBackend(signal, { force = false, model = '' } = {}) {
    const now = Date.now()
    // The endpoint belongs to the ROUTE, not to a configured default: Go and Zen
    // are different roots with different entitlements (measured 2026-11-04). The
    // cache is therefore keyed by provider, or a Zen route would reuse the Go
    // baseURL resolved moments earlier for a Go route.
    const providerId = backendProviderForRoute(model, this.config)
    if (
      !force &&
      this.backendCache &&
      this.backendCache.providerId === providerId &&
      now - this.backendCache.at < this.config.credentialCacheMs.get()
    ) {
      return this.backendCache.value
    }
    let provider = null
    let baseURL = this.config.backendBaseUrl.get()
    if (!baseURL) {
      const payload = await this.server.request('GET', `/api/provider/${encodeURIComponent(providerId)}`, undefined, { signal })
      provider = payload?.data
      baseURL = provider?.settings?.baseURL
      if (!baseURL) throw new Error(`OpenCode provider "${providerId}" exposes no settings.baseURL`)
    }
    let credential = this.config.apiKey.get()
    if (!credential && this.config.apiKeyEnv.get()) credential = process.env[this.config.apiKeyEnv.get()] ?? ''
    if (!credential) credential = await this.activeCredential(provider, signal)
    if (!credential) throw new Error(`no credential for OpenCode provider "${providerId}"`)
    const value = {
      baseURL: String(baseURL).replace(/\/+$/, ''),
      headers: {
        ...attributionHeaders(),
        accept: 'text/event-stream',
        'content-type': 'application/json',
        ...(provider?.headers ?? {}),
        authorization: `Bearer ${credential}`,
      },
    }
    this.backendCache = { at: now, providerId, value }
    return value
  }

  /**
   * Choose the credential for the backend from the local credential store.
   *
   * Order matters and was measured (2026-10-30): the Go endpoint rejects a
   * revoked `key` credential with 401 while the active web `oauth` token is
   * accepted, so a literal "first active match" sends a dead key. Preference:
   *
   *   1. an active `oauth` entry of this integration (the web login is the
   *      credential the user actually maintains),
   *   2. an active `key` entry,
   *   3. the first active entry of the integration.
   *
   * Optionally pinned by `credentialLabel`. A 401 triggers one refresh, so a
   * rotated credential is picked up without a restart.
   */
  async activeCredential(provider, signal) {
    const payload = await this.server.request('GET', '/api/credential', undefined, { signal })
    const entries = Array.isArray(payload?.data) ? payload.data : []
    const providerId = this.config.backendProviderId.get()
    const integration = provider?.integrationID ?? providerId
    const label = this.config.credentialLabel.get()
    /**
     * The credential store files credentials under `opencode` (the web login and
     * the master keys), while the model route is `opencode-go`. Accept every id
     * that can own the credential so one live credential is never invisible.
     */
    const owners = new Set(
      [integration, providerId, provider?.id, 'opencode-go', 'opencode'].filter(
        (id) => typeof id === 'string' && id.length > 0,
      ),
    )
    let candidates = entries.filter(
      (entry) => entry?.active === true && owners.has(entry.integrationID),
    )
    if (label) {
      const pinned = candidates.filter((entry) => String(entry.label ?? '') === label)
      if (pinned.length > 0) candidates = pinned
    }
    const rank = (entry) => (entry?.value?.type === 'oauth' ? 0 : entry?.value?.type === 'key' ? 1 : 2)
    candidates = candidates.slice().sort((left, right) => rank(left) - rank(right))
    const value = candidates[0]?.value ?? {}
    if (value.type === 'oauth') return value.access ?? ''
    if (value.type === 'key') return value.key ?? ''
    return ''
  }

  /**
   * Persist what the backend already said about a route during real traffic.
   *
   * There is deliberately no probe routine: one request per route per sweep cost
   * 49 requests against a per-request quota. A real turn that the backend refuses
   * (`unavailable`, `deprecated`, 401, 403) is the same evidence for free, and a
   * success clears a stale refusal. Written only when the state changes, so the
   * common path performs no I/O.
   *
   * @param route - `provider/model` catalog id.
   * @param state - `classifyProbe()` result.
   * @returns true when the snapshot changed on disk.
   */
  observe(route, state) {
    const key = String(route ?? '')
    // Only real `provider/model` routes are recorded; `default` is a pseudo-row.
    if (key.length === 0 || !key.includes('/')) return false
    const store = (this.verdictStore ??= createVerdictStore({
      explicit: this.config.verdictPath.get(),
      profileDir: this.ctx?.get?.('profileContext')?.dir,
      dshHome: process.env.DSH_HOME,
    }))
    const snapshot = store.read()
    if (state === 'usable') {
      // Plan availability already says "usable"; drop a stale refusal instead of
      // storing a second source of truth.
      if (snapshot.verdicts[key] === undefined) return false
      delete snapshot.verdicts[key]
    } else {
      if (snapshot.verdicts[key] === state) return false
      snapshot.verdicts[key] = state
    }
    store.write({ verdicts: snapshot.verdicts, measuredAt: new Date().toISOString() })
    return true
  }

  /** Current refusal snapshot (`route -> state`) for the settings tab. */
  verdicts() {
    const store = (this.verdictStore ??= createVerdictStore({
      explicit: this.config.verdictPath.get(),
      profileDir: this.ctx?.get?.('profileContext')?.dir,
      dshHome: process.env.DSH_HOME,
    }))
    return store.read()
  }

  /** Where the first-seen snapshot is kept. */
  knownFile() {
    return resolveCatalogPath({
      explicit: this.config.knownModelsPath.get(),
      profileDir: this.ctx?.get?.('profileContext')?.dir,
      dshHome: process.env.DSH_HOME,
      fileName: 'opencode-known-models.json',
    })
  }

  /** `{ firstSeen: { route: ISO } }`; never performs network I/O. */
  readFirstSeen() {
    if (this.firstSeenValue) return this.firstSeenValue
    const path = this.knownFile()
    let snapshot = { firstSeen: {} }
    if (path) {
      try {
        const raw = JSON.parse(readFileSync(path, 'utf8'))
        snapshot = { firstSeen: raw?.firstSeen && typeof raw.firstSeen === 'object' ? raw.firstSeen : {} }
      } catch {
        /* first run */
      }
    }
    this.firstSeenValue = snapshot
    return snapshot
  }

  /**
   * Record routes seen for the first time.
   *
   * The very first run seeds the whole catalog at the epoch instead of "now", so
   * an existing deployment does not label all 49 routes as new. Only routes that
   * appear later get a real timestamp and thereby priority-0 ordering for
   * `newModelDays`. Plan availability is untouched: a new route from the other
   * plan is still not offered.
   *
   * @param routes - current catalog routes.
   * @returns the routes added by this call.
   */
  markKnown(routes) {
    const snapshot = this.readFirstSeen()
    const path = this.knownFile()
    const firstRun = path ? !existsSync(path) : false
    const stamp = firstRun ? '1970-01-01T00:00:00.000Z' : new Date().toISOString()
    const added = []
    for (const route of routes ?? []) {
      const key = String(route ?? '')
      if (key.length === 0 || snapshot.firstSeen[key] !== undefined) continue
      snapshot.firstSeen[key] = stamp
      if (!firstRun) added.push(key)
    }
    if (added.length > 0 || firstRun) {
      if (path) {
        try {
          mkdirSync(dirname(path), { recursive: true })
          writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`)
        } catch {
          /* the snapshot is best effort */
        }
      }
    }
    return added
  }

  /** Where the public usage ranking is cached. */
  rankingFile() {
    return resolveCatalogPath({
      explicit: this.config.rankingPath.get(),
      profileDir: this.ctx?.get?.('profileContext')?.dir,
      dshHome: process.env.DSH_HOME,
      fileName: 'opencode-data-ranking.json',
    })
  }

  /** Cached `{ byModel, updatedAt, fetchedAt }`; never performs network I/O. */
  readRanking() {
    if (this.rankingValue) return this.rankingValue
    const path = this.rankingFile()
    let snapshot = { byModel: {}, updatedAt: null, fetchedAt: 0 }
    if (path) {
      try {
        const raw = JSON.parse(readFileSync(path, 'utf8'))
        snapshot = {
          byModel: raw?.byModel && typeof raw.byModel === 'object' ? raw.byModel : {},
          updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : null,
          fetchedAt: typeof raw?.fetchedAt === 'number' ? raw.fetchedAt : 0,
        }
      } catch {
        /* no cache yet */
      }
    }
    this.rankingValue = snapshot
    return snapshot
  }

  /**
   * Refresh the usage ranking from `opencode.ai/data/index.json`.
   *
   * One GET, unrelated to the model quota; cached for `rankingTtlMs` so the tab
   * can sort without a network call on every open.
   *
   * @param force - fetch even when the cache is still fresh.
   */
  async refreshRanking(force = false) {
    const current = this.readRanking()
    if (!force && current.fetchedAt > 0 && Date.now() - current.fetchedAt < this.config.rankingTtlMs.get()) {
      return current
    }
    const response = await fetch(this.config.rankingUrl.get(), { headers: { accept: 'application/json' }, redirect: 'error' })
    if (!response.ok) throw new Error(`usage ranking fetch failed: HTTP ${response.status}`)
    const parsed = rankingFromDataIndex(await response.json())
    const snapshot = { byModel: parsed.ranking, updatedAt: parsed.updatedAt, fetchedAt: Date.now() }
    this.rankingValue = snapshot
    const path = this.rankingFile()
    if (path) {
      try {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`)
      } catch {
        /* the cache is best effort */
      }
    }
    return snapshot
  }

  async *stream(options) {
    if (this.standDown) {
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            code: 'ROUTER_STANDDOWN',
            message: 'dsh-opencode-v2-http yielded the OpenCode namespace to a legacy provider (conflictPolicy: stand-down)',
          },
        },
      }
      return
    }

    const config = this.config
    const timeout = AbortSignal.timeout(config.timeoutMs.get())
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    this.lastWorkspace = resolveWorkspaceDirectory(this.ctx, options)

    const ref = modelRefFromRoute(options.model, config.models.get(), config.defaultModel.get())
    if (!ref) {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'OPENCODE_HTTP_MODEL', message: `unmapped route ${options.model}` } } }
      return
    }
    if (options.reasoningEffort !== undefined) {
      let found = null
      try {
        found = await this.lookupModel(options.model)
      } catch {
        /* discovery unavailable: let the backend decide */
      }
      if (found && !(found.variants ?? []).includes(options.reasoningEffort)) {
        const message = unsupportedEffortMessage(options.provider, options.model, options.reasoningEffort, found.variants ?? [])
        this.ctx?.logger?.warn?.(`opencode-http-agent: ${message}`)
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'UNSUPPORTED_REASONING_EFFORT', message } } }
        return
      }
    }

    // The route's own reasoning field name, when discovery declared one.
    let routeReasoningField = null
    let routeRecord = null
    try {
      routeRecord = await this.lookupModel(options.model)
      if (typeof routeRecord?.reasoningField === 'string' && routeRecord.reasoningField.length > 0) {
        routeReasoningField = routeRecord.reasoningField
      }
    } catch {
      /* discovery unavailable: the configured field still applies */
    }

    // --- Ingress Protocol Guard (G2/G3) -----------------------------------
    // The catalog says which wire serves this route. The default is advisory:
    // the backend sits behind a facade that may translate a chat body, so an
    // unsupported package is recorded (`wire: 'unverified'`) and the request is
    // attempted. Only `strictWire` turns the guess into a refusal, and even then
    // it happens before any fetch.
    // A config built outside the schema (a test double, an older profile row)
    // simply has no key: absent means the documented default.
    const rawBypass = config.rawBypass?.get?.() === true
    const strictWire = config.strictWire?.get?.() === true
    let wireState = 'chat'
    if (!rawBypass) {
      // `classifyWire` separates a KNOWN foreign wire from an unknown package:
      // only the former may be refused, because an unknown id is a server newer
      // than this adapter and must keep working.
      const wire = routeRecord === null ? 'unknown' : classifyWire(routeRecord.package)
      if (wire === 'chat') {
        wireState = 'chat'
      } else {
        wireState = 'unverified'
        if (wire === 'unsupported' && strictWire) {
          throw unsupportedProtocolError(String(options.model), routeRecord.package)
        }
        if (wire === 'unsupported') {
          this.ctx?.logger?.warn?.(
            `opencode-http-agent: ${options.model} uses ${routeRecord.package}; this adapter speaks the OpenAI chat wire only` +
              ' — attempting anyway (strictWire=false)',
          )
        }
      }
    }

    const declaredTools = (Array.isArray(options.tools) ? options.tools : [])
      .filter((tool) => tool && typeof tool.name === 'string' && tool.name.length > 0)
    const declaredToolNames = new Set(declaredTools.map((tool) => tool.name))

    // Whether the backend sent the protocol terminator for the current attempt.
    // An EOF without it is a cut, not a completion: measured 2026-11-03, four
    // long requests ended this way carrying reasoning only, and the default
    // branch of the finish table reported them as a clean `stop`.
    const sseState = { done: false }
    /** The current attempt's response; the status-retry loop below replaces it. */
    let response = null
    let backend = null

    const maxStreamRetries = Math.max(0, Math.trunc(config.streamRetries.get()) || 0)

    try {
      backend = await this.resolveBackend(signal, { model: options.model })

      // Pre-flight: a malformed tool block is a bug in the caller's request, and
      // the route answers it with an opaque 400 after the whole prompt has been
      // uploaded. Fail here instead, with a code the operator can search for.
      const guard = validateRequest(options)
      if (!guard.ok) {
        yield {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: { code: INVALID_REQUEST, message: guard.errors.join('; ').slice(0, 600) },
          },
        }
        return
      }

      const body = buildChatRequest(options, ref, config, { model: routeRecord, rawBypass })

      // The completion budget cannot exceed the context left. The host normally
      // supplies `maxTokens` (its reservation), but a session restored from an
      // older build, or a caller that sets its own, can still ask for more than
      // the window holds. Measured 2026-11-04: 3,140 recorded requests carried
      // >120k prompt characters and none of them was checked against the window.
      const routeWindow = routeRecord ?? (await this.lookupModel(options.model).catch(() => null))
      const promptEstimate = estimatePromptTokens(body)
      const budget = resolveRequestMaxTokens({
        reservation: options.maxTokens ?? turnCompletionReservation(routeWindow?.maxTokens, config.turnMaxTokens.get()),
        promptTokens: promptEstimate,
        contextWindow: routeWindow?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      })
      if (budget.overflow) {
        yield {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: {
              code: 'OPENCODE_CONTEXT_OVERFLOW',
              message: `the prompt alone is ~${budget.overflow.promptTokens} tokens and the route's window is ${budget.overflow.contextWindow}; the request cannot be served without compaction`,
            },
          },
        }
        return
      }
      // G4: the clamp writes the same field the builder chose; the two must never
      // both appear on the body.
      const budgetField = completionTokensField(routeRecord, { rawBypass })
      body[budgetField] = budget.maxTokens
      if (budget.clamped && options.maxTokens !== undefined) {
        this.ctx?.logger?.debug?.(
          `opencode-http-agent: ${budgetField} lowered from ${options.maxTokens} to ${budget.maxTokens} (${budget.remaining} left of the window)`,
        )
      }
      // Real-traffic evidence (no bodies, no credentials): a short probe cannot
      // reproduce the leak because it produces almost no output. Opt out with
      // OPENCODE_V2_TRACE=0.
      const trace = createTrace()
      // G3: `wire: 'unverified'` means the catalog did not confirm an OpenAI chat
      // package (or had no record at all), so a silent wire change is visible.
      trace.request({ ...summarizeRequest(body), session: options.sessionId ?? null, wire: wireState })
      const headers = sessionHeaders(backend.headers, options, config)
      const send = () => fetch(joinUrl(backend.baseURL, config.chatPath.get()), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
        redirect: 'error',
      })
      // One generation attempt's POST. A 401 means the credential rotated, so the
      // backend is re-resolved and the request re-sent ONCE inside the same
      // attempt: that refresh is not a retry and must not consume the budget.
      const postOnce = async () => {
        response = await send()
        if (response.status === 401) {
          backend = await this.resolveBackend(signal, { force: true })
          response = await send()
        }
        return response
      }
      response = await postOnce()

      const maxStatusRetries = Math.max(0, Math.trunc(config.httpRetries.get()) || 0)
      const retryStatuses = new Set((config.httpRetryStatuses.get() ?? []).map((value) => Number(value)))
      const statusBaseMs = Math.max(0, Number(config.httpRetryBaseMs.get()) || 0)
      let statusRetries = 0
      for (;;) {
        if (!response.ok) {
          const text = await response.text().catch(() => '')
          // A retryable refusal (429/451/502/503/504) is a backend condition, not
          // a request defect: nothing reached the transcript, so the same body is
          // sent again after backoff (1s → 2s → 4s). Only the final refusal is
          // recorded as the route's verdict.
          if (isRetryableStatus(response.status, retryStatuses) && statusRetries < maxStatusRetries) {
            const delay = backoffDelay(statusRetries, statusBaseMs, Number.MAX_SAFE_INTEGER)
            statusRetries += 1
            trace.error({ detail: `HTTP ${response.status}; adapter retry ${statusRetries}/${maxStatusRetries}`, transient: true, emitted: 0, retried: statusRetries })
            this.ctx?.logger?.warn?.(
              `opencode-http-agent: backend HTTP ${response.status} (${text.slice(0, 120)}); ` +
                `retry ${statusRetries}/${maxStatusRetries} in ${delay}ms`,
            )
            if (!(await sleepFor(delay, signal))) {
              yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'request cancelled by the caller' } } }
              return
            }
            response = await postOnce()
            continue
          }
          // Free entitlement evidence: the backend just answered for this route, so
          // a refusal is recorded without spending another request on a probe.
          const observed = classifyProbe(response.status, text)
          if (String(options.model ?? '').includes('/')) this.observe(options.model, observed)
          yield {
            type: 'finish',
            reason: {
              kind: 'error',
              failure: {
                code: response.status === 401 || response.status === 403 ? 'OPENCODE_BACKEND_AUTH' : 'OPENCODE_BACKEND_HTTP',
                message: `OpenCode backend HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`,
              },
            },
          }
          return
        }
        if (!response.body) {
          yield { type: 'finish', reason: { kind: 'error', failure: { code: 'OPENCODE_BACKEND_EMPTY', message: 'backend returned no response body' } } }
          return
        }
        // A served route clears any stale refusal recorded for it.
        if (String(options.model ?? '').includes('/')) this.observe(options.model, 'usable')

        // The shared pipe owns the terminal policy, but the transparent retry
        // of a cut that produced NO visible output stays here: the pipe rethrows
        // that case precisely so this loop can re-run the request from a clean
        // attempt, which is invisible to the transcript.
        let streamAttempt = 0
        for (;;) {
          try {
            yield* this.streamViaSharedPipe(options, {
              response,
              declaredTools,
              declaredToolNames,
              routeReasoningField: routeReasoningField ?? config.reasoningField.get(),
              config,
              signal,
              timeout,
              sseState,
            })
            return
          } catch (error) {
            if (options.signal?.aborted) {
              yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'request cancelled by the caller' } } }
              return
            }
            const detail = errorText(error)
            const transient = isTransientStreamError(error)
            trace.error({ detail: detail.slice(0, 240), transient, emitted: 0, retried: streamAttempt })
            // Only a transport cut with nothing on screen is retryable, and the
            // budget is the same `streamRetries` the pipe consumer honours.
            if (transient && streamAttempt < maxStreamRetries) {
              streamAttempt += 1
              this.ctx?.logger?.warn?.(
                `opencode-http-agent: upstream stream cut before any output (${detail}); retry ${streamAttempt}/${maxStreamRetries}`,
              )
              response = await postOnce()
              if (!response.ok) {
                yield {
                  type: 'finish',
                  reason: {
                    kind: 'error',
                    failure: { code: 'OPENCODE_BACKEND_HTTP', message: `OpenCode backend HTTP ${response.status}` },
                  },
                }
                return
              }
              continue
            }
            // Nothing to preserve: keep the honest error verdict.
            yield {
              type: 'finish',
              reason: { kind: 'error', failure: { code: 'OPENCODE_BACKEND', message: detail } },
            }
            return
          }
        }

      }
    } catch (error) {
      yield {
        type: 'finish',
        reason: options.signal?.aborted
          ? { kind: 'aborted', failure: { code: 'ABORTED', message: 'request cancelled by the caller' } }
          : {
              kind: 'error',
              failure: {
                code: 'OPENCODE_BACKEND',
                message: error instanceof Error ? error.message : String(error),
              },
            },
      }
    }
  }
  /**
   * Serve one generation attempt through the shared downstream pipe.
   *
   * Everything provider-specific stays here; the block lifecycle, finish table,
   * usage ordering and the empty/cut/abort terminal policy come from
   * `lib/stream/index.js`. Three provider contracts are preserved here:
   *
   *   1. **Cost is recorded once per usage event**, on arrival, through the same
   *      `recordCost` path.
   *   2. **A protocol defect is thrown**, not turned into an in-band finish: the
   *      pipe rethrows it, and it leaves this method as an `LlmError`.
   *   3. **A transport cut stays in-band**, so partial output is preserved —
   *      except when nothing reached the host at all, where this method rethrows
   *      so the caller's retry loop can re-run the request invisibly.
   *
   * The policy seams the pipe leaves to a provider are all used here: `mapFinish`
   * (a missing `finish_reason` is a TRANSPORT cut, not a clean `stop`), `onCut`
   * (preserve-after-output vs rethrow-before-output), `classifyText` (the JSON
   * body probe) and `beforeSettle` (the probe drains before the gate decides).
   *
   * @param options - the caller's request options.
   * @param context - `{ response, declaredTools, declaredToolNames, routeReasoningField, config, signal, timeout, sseState }`.
   * @returns async generator of `StreamChunk`s.
   */
  async *streamViaSharedPipe(options, context) {
    const { response, declaredTools, declaredToolNames, routeReasoningField, config, signal, timeout, sseState } = context
    const schemaFor = (name) => {
      const tool = declaredTools.find((item) => item.name === name)
      const parameters = tool?.parameters
      return parameters && typeof parameters === 'object' ? parameters : null
    }

    // One lifecycle owner per stream (CP3): one controller, the caller's abort
    // forwarded into it, and the listener removed on dispose.
    const lifecycle = createStreamLifecycle(signal)

    // The display gate is built from the declared names, so a call recovered
    // from prose is judged by exactly the same rules as a structured one.
    const gate = createDisplayGate({ toolNames: declaredToolNames })
    // The probe drain is handed to the contract as its pre-settle seam, so a body
    // payload that is really a tool call is still a candidate when the gate
    // decides. It is installed after the probe exists; the closure reads it late.
    let drainProbe = () => []
    const hooks = createStreamHooks({
      reasoningField: routeReasoningField,
      toolNames: declaredToolNames,
      tools: declaredTools,
      gate,
      beforeSettle: () => drainProbe(),
    })

    /* ---------------------------------------------------------------------- */
    /* State the pipe does not own, kept here (it is provider policy, not core) */
    /* ---------------------------------------------------------------------- */
    /** Whether a visible block (text or tool call) reached the host. */
    let sawVisible = false
    /** Whether ANY chunk reached the host, reasoning included. */
    let emittedAny = false
    /** The terminal cut, once known: only a cut justifies repairing arguments. */
    let cutFailure = null

    // The JSON probe is the one provider behaviour the contract does not model:
    // a body that is nothing but a JSON object may be a tool call the route
    // failed to send structurally. It holds such text back instead of showing
    // it, and its drain must run AFTER the contract's own flush (which settles
    // the gate), so it is composed around `hooks.flush` rather than beside it.
    const probeState = { buffered: '' }
    const MAX_JSON_PROBE = 65536
    const fencedBody = (text) => {
      const match = /^\s```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/.exec(text)
      return match ? match[1].trim() : null
    }
    /** Feed text to the probe; returns null when held, a part to emit otherwise. */
    const holdJsonText = (text) => {
      probeState.buffered += text
      const fenced = fencedBody(probeState.buffered)
      const candidates = fenced !== null ? [fenced] : [probeState.buffered.trim()]
      for (const body of candidates) {
        let value = null
        try { value = JSON.parse(body) } catch { value = null }
        if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
        const name = inferToolFromArguments(value, declaredTools)
        if (name === null) continue
        gate.addCandidate({ kind: 'tool-call', id: '', name, arguments: JSON.stringify(value), source: 'json' })
        probeState.buffered = ''
        return null
      }
      if (probeState.buffered.length > MAX_JSON_PROBE) {
        const released = probeState.buffered
        probeState.buffered = ''
        return { kind: 'text', text: released }
      }
      return null
    }
    /** Drain the probe at end of stream (called before the gate settles). */
    const flushJsonProbe = () => {
      if (probeState.buffered.length === 0) return []
      const pending = probeState.buffered
      const held = holdJsonText('')
      if (held === null && probeState.buffered.length === 0) return []
      probeState.buffered = ''
      return [{ kind: 'text', text: pending }]
    }

    // Cost is parsed from the RAW usage object, which the pipe does not hand
    // back to `onUsage` (it passes the normalized usage), so the raw object is
    // kept on arrival and cost is written exactly once, through the same
    // ledger path.
    const readEventWithCost = (payload) => {
      const record = hooks.readEvent(payload)
      if (record?.usage !== undefined) this.recordCost(options.sessionId, options.model, parseCost(record.usage))
      return record
    }

    // The probe owns text BEFORE it becomes a block: a body that is only a
    // tool-shaped JSON object must never reach the screen. This is the same
    // predicate the retired routeParts used (probe already holding, or the
    // text block has not started and the text opens like JSON).
    const classifyText = (text) => {
      const parts = hooks.classifyText(text)
      const out = []
      for (const part of Array.isArray(parts) ? parts : []) {
        if (part?.kind !== 'text' || typeof part.text !== 'string' || part.text.length === 0) {
          out.push(part)
          continue
        }
        if (probeState.buffered.length > 0) {
          const held = holdJsonText(part.text)
          if (held !== null) out.push(held)
          continue
        }
        const trimmed = part.text.trimStart()
        if (!sawVisible && (trimmed.startsWith('{') || trimmed.startsWith('```'))) {
          const held = holdJsonText(part.text)
          if (held !== null) out.push(held)
          continue
        }
        out.push(part)
      }
      return out
    }

    // The contract flush already drains both classifiers, runs the probe through
    // the `beforeSettle` seam, then settles the gate — the required order.
    drainProbe = flushJsonProbe

    const createHooks = () => ({
      ...hooks,
      readEvent: readEventWithCost,
      classifyText,
      flush: () => hooks.flush(),
      // A finish_reason that never arrived is a CUT, not a completion. Measured
      // 2026-11-03: four requests ended exactly this way carrying reasoning only;
      // the default table reported them as a clean `stop`, so the host committed
      // a half response and no retry ran. Reporting a retryable TRANSPORT failure
      // hands the step back to llm-retry.
      mapFinish: (value) => {
        if (value === undefined && sawVisible === false) {
          const reason = sseState?.done ? 'without finish_reason' : 'before [DONE]'
          return {
            kind: 'error',
            failure: {
              code: 'TRANSPORT',
              message: `OpenCode backend stream ended ${reason} after no visible output`,
            },
          }
        }
        return hooks.mapFinish(value)
      },
      // Keep the terminal policy: a cut after visible output is preserved as a
      // `stop` (the host keeps the partial turn), a cut with nothing to keep is
      // rethrown so the caller's own retry loop can re-run the request, and a
      // caller that opted out keeps the honest error verdict.
      onCut: (failure) => {
        cutFailure = failure
        const detail = failure?.message ?? 'the upstream stream was cut'
        const transient = isTransientStreamError(Object.assign(new Error(detail), { code: failure?.code }))
        // The retry is only invisible to the transcript when NOTHING was emitted:
        // once any chunk (reasoning included) reached the host, re-running the
        // request would duplicate it, so the cut is handled in-band instead.
        if (emittedAny === false && transient) {
          throw Object.assign(new Error(detail), { code: failure?.code ?? 'STREAM_CUT' })
        }
        if (config.streamCutPreserve.get()) {
          return { type: 'finish', reason: { kind: 'stop' } }
        }
        return {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: { code: 'OPENCODE_BACKEND', message: detail, ...(transient ? {} : {}) },
          },
        }
      },
    })

    // A tool call's final arguments are normalised before the host sees them: the
    // route re-sends a whole arguments snapshot instead of a fragment (measured
    // 2026-11-01: 30 of 80 calls), and a cut can leave one unparseable. Both are
    // repaired here, at the boundary, so the pipe stays canonical.
    const finalizeToolBlock = (block) => {
      const normalized = normalizeArguments(block.arguments, schemaFor(block.name))
      if (normalized.mode === 'invalid') {
        const repaired = cutFailure !== null ? (repairJson(block.arguments) ?? '{}') : normalized.value
        return { ...block, arguments: repaired }
      }
      return { ...block, arguments: normalized.value }
    }

    try {
      // `readSseEvents` yields decoded payloads; the pipe never sees bytes.
      const events = readSseEvents(response.body, { signal: lifecycle.signal, malformed: 'fail' })
      const stream = normalizeStream({
        events,
        descriptor: OPENCODE_DESCRIPTOR,
        createHooks,
        signal: lifecycle.signal,
      })
      // A tool block's final arguments depend on whether the stream was CUT: only
      // a cut justifies repairing invalid JSON. The pipe closes its blocks
      // BEFORE it calls `onCut`, so every tool `block-end` is buffered here and
      // released once the terminal state is known — order is preserved because
      // the pipe emits `block-end`s first and its terminal chunk after.
      const pendingToolEnds = []
      const releaseToolEnds = function* () {
        for (const chunk of pendingToolEnds.splice(0)) {
          yield { ...chunk, block: finalizeToolBlock(chunk.block) }
        }
      }
      for await (const chunk of stream) {
        emittedAny = true
        if (chunk?.type === 'block-start' && (chunk.blockType === 'text' || chunk.blockType === 'tool-call')) sawVisible = true
        if (chunk?.type === 'block-end' && chunk.block?.type === 'tool-call') {
          pendingToolEnds.push(chunk)
          continue
        }
        // Any other chunk means the pipe is past its block-closing phase.
        yield* releaseToolEnds()
        // A caller timeout reaches the pipe as an abort; the adapter publishes
        // its own stable code for it, exactly as the retirement path did.
        if (chunk?.type === 'finish' && chunk.reason?.kind === 'aborted' && timeout?.aborted && !options.signal?.aborted) {
          yield {
            type: 'finish',
            reason: {
              kind: 'error',
              failure: {
                code: 'OPENCODE_TIMEOUT',
                message: `OpenCode backend exceeded timeoutMs=${config.timeoutMs.get()}`,
              },
            },
          }
          continue
        }
        yield chunk
      }
      yield* releaseToolEnds()
    } catch (error) {
      // A protocol defect leaves as a thrown failure (contract rule N5); a
      // transport cut is already in-band from the pipe's terminal policy.
      if (error?.code === 'PROTOCOL_DEFECT') throw protocolDefectError(error)
      throw error
    } finally {
      lifecycle.dispose()
    }
  }
}

/**
 * Error codes and messages that mean "the connection dropped", not "the request
 * was wrong".
 *
 * Measured 2026-10-31: an upstream cut surfaces from `fetch` as
 * `TypeError: terminated` (undici), and from the socket layer as `ECONNRESET` /
 * `UND_ERR_SOCKET`. These are the only errors a retry can plausibly fix.
 */
const TRANSIENT_STREAM_CODES = new Set([
  'ECONNRESET',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_CLOSED',
])

/**
 * Whether a stream failure is a transport cut rather than a request verdict.
 * @param {unknown} error - the thrown value.
 * @returns {boolean} whether a retry or a partial preserve is appropriate.
 */
export function isTransientStreamError(error) {
  if (!error) return false
  const code = String(error.code ?? error.cause?.code ?? '')
  if (TRANSIENT_STREAM_CODES.has(code)) return true
  const message = String(error.message ?? error)
  return /terminated|socket hang up|other side closed|premature close|stream closed/i.test(message)
}

/**
 * The balanced closers `text` needs, or null when it closes more than it opens.
 * @param {string} text - a JSON fragment.
 * @returns {string | null} `"` plus `}`/`]` in reverse open order.
 */
function balancedClosers(text) {
  let inString = false
  let escape = false
  const stack = []
  for (const ch of text) {
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (inString) {
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') {
      if (stack.length === 0) return null
      stack.pop()
    }
  }
  let out = inString ? '"' : ''
  for (let index = stack.length - 1; index >= 0; index -= 1) out += stack[index] === '{' ? '}' : ']'
  return out
}

/**
 * Best-effort JSON for tool arguments that were cut mid-flight.
 *
 * It truncates the fragment at a token boundary and appends the closers the
 * fragment needs, keeping the values that were already complete. `null` means no
 * prefix repaired, and the caller must fall back to `{}`.
 * @param {string} text - the accumulated (incomplete) arguments.
 * @returns {string | null} valid JSON text.
 */
export function repairJson(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  try {
    JSON.parse(raw)
    return raw
  } catch {
    /* fall through to the repair ladder */
  }
  if (raw[0] !== '{' && raw[0] !== '[') return null
  const floor = Math.max(0, raw.length - 400)
  for (let end = raw.length; end > floor; end -= 1) {
    const head = raw.slice(0, end).replace(/[\s,:]+$/, '')
    if (!head) continue
    const closers = balancedClosers(head)
    if (closers === null) continue
    const candidate = head + closers
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      /* keep shortening */
    }
  }
  return null
}


/**
 * Append-only beacon proving which plugin code a process actually loaded.
 *
 * Written at stream start: if the beacon says `0.7.5` while the transcript still
 * shows protocol notation, the notation is not produced by this adapter. If the
 * beacon is missing, the plugin is not the code on disk.
 *
 * @param {string} event - the beacon event name.
 * @param {object} [detail] - extra fields.
 * @returns {void}
 */
function bootBeacon(event, detail = {}) {
  if (process.env.OPENCODE_V2_BEACON === '0') return
  try {
    const file = '/tmp/opencode-v2-boot.jsonl'
    const size = existsSync(file) ? statSync(file).size : 0
    if (size > 1_000_000) return
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, version: VERSION, event, ...detail })}\n`)
  } catch {
    /* a beacon must never affect the plugin */
  }
}

/** Human text for a string, an Error-shaped object, or an arbitrary payload. */
export function errorText(value) {
  if (typeof value === 'string') return value
  const message = value && typeof value === 'object' ? value.message ?? value.error?.message : undefined
  if (typeof message === 'string') return message
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return 'OpenCode backend failed'
}

/**
 * Build the prompt-picker allow-list.
 *
 * An empty list means "no restriction" (every served route is selectable), which
 * keeps an unconfigured install behaving exactly as before. Hiding a route only
 * changes what the picker offers: a session that already selected it keeps
 * running, which is the measured 2026-10-30 requirement ("display only").
 *
 * @param routes - `provider/id` entries from the settings tab.
 * @returns the matching set, or `null` when nothing is restricted.
 */
export function enabledRouteFilter(routes) {
  const list = (routes ?? []).filter((route) => typeof route === 'string' && route.trim().length > 0)
  return list.length === 0 ? null : new Set(list.map((route) => route.trim()))
}

/**
 * Classify a one-shot probe result for the entitlement sweep.
 *
 * The Go backend answers a usable model with 200 and an unusable one with 400
 * `Model is unavailable.`, 410 `... has been deprecated`, or 403 (no
 * subscription). Classification is the backend's own message, never a guess.
 *
 * @param status - HTTP status of the probe.
 * @param message - `error.message` when the probe failed.
 * @returns the measured state of that route.
 */
export function classifyProbe(status, message) {
  const text = String(message ?? '')
  if (status >= 200 && status < 300) return 'usable'
  if (/deprecated/i.test(text)) return 'deprecated'
  if (/unavailable/i.test(text)) return 'unavailable'
  if (status === 401) return 'auth'
  if (status === 403) return 'forbidden'
  return 'error'
}

/**
 * Add the conversation-identity header the Go backend requires.
 *
 * Measured 2026-10-30 against `https://opencode.ai/inference/go/openai/v1`:
 * a request without `x-opencode-session` is rejected with HTTP 400
 * `{"type":"error","error":{"type":"MissingSessionID", ...}}`; with the header
 * the same request is served. The OpenCode console documents this for Go
 * ("Send a stable session ID in `x-opencode-session` for each conversation") and
 * lists DeepSeek Harness under known problematic clients for exactly this gap.
 *
 * A dispatch without a DSH session id (catalog or title probes, direct adapter
 * callers) still needs a stable value, otherwise the backend answers 400 before
 * it ever looks at the credential.
 */
export function sessionHeaders(headers, options, config) {
  const name = config.sessionHeader.get()
  if (!name) return headers
  const session = options?.sessionId !== undefined && options?.sessionId !== null && options.sessionId !== ''
    ? String(options.sessionId)
    : config.sessionFallback.get()
  if (!session) return headers
  return { ...headers, [name]: session }
}

/**
 * Which provider owns the backend endpoint for one route.
 *
 * The provider id `opencode-go` is the Go subscription root
 * (`/inference/go/openai/v1`) and `opencode` is the Zen pay-as-you-go root
 * (`/inference/openai/v1`). They are different endpoints with different
 * entitlements, measured 2026-11-04: a zen-only route on the Go root answers 400
 * "Model is unavailable.", and a Go route on the Zen root answers 402
 * "Insufficient account funds".
 *
 * So the route decides the endpoint, not the configured default. A bare model id
 * (`default`, worker callers) keeps the configured provider, and an unknown
 * prefix is passed through rather than silently sent to the Go root.
 *
 * @param {string} model - the route as the host passes it (`provider/id` or bare id).
 * @param {{ backendProviderId: { get: () => string } }} config - row config.
 * @returns {string} provider id whose `/api/provider/{id}` supplies baseURL + headers.
 */
export function backendProviderForRoute(model, config) {
  const route = typeof model === 'string' ? model : ''
  const slash = route.indexOf('/')
  if (slash <= 0) return config.backendProviderId.get()
  return route.slice(0, slash)
}

/** Legacy OpenCode `tokens` mapper, kept for batch-worker consumers/tests. */
export function usageFromTokens(tokens) {
  const usage = {
    inputTokens: Number(tokens?.input ?? 0),
    outputTokens: Number(tokens?.output ?? 0),
    reasoningTokens: Number(tokens?.reasoning ?? 0),
    cacheReadTokens: Number(tokens?.cache?.read ?? 0),
    cacheWriteTokens: Number(tokens?.cache?.write ?? 0),
  }
  usage.totalTokens =
    usage.inputTokens + usage.outputTokens + usage.reasoningTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  return usage
}

/** Sum two legacy usage records bucket by bucket. */
export function addUsage(previous, next) {
  if (!previous) return next
  const sum = {
    inputTokens: previous.inputTokens + next.inputTokens,
    outputTokens: previous.outputTokens + next.outputTokens,
    reasoningTokens: (previous.reasoningTokens ?? 0) + (next.reasoningTokens ?? 0),
    cacheReadTokens: previous.cacheReadTokens + next.cacheReadTokens,
    cacheWriteTokens: previous.cacheWriteTokens + next.cacheWriteTokens,
  }
  sum.totalTokens = sum.inputTokens + sum.outputTokens + sum.reasoningTokens + sum.cacheReadTokens + sum.cacheWriteTokens
  return sum
}

/**
 * Plugin body: register the native `opencode-http-agent` route, own its
 * catalog/server lifecycle, and reconcile runtime conflicts.
 */
export function apply(ctx, config) {
  const providerId = 'opencode-http-agent'
  const adapter = new OpencodeHttpAdapter(ctx, config, { providerId })

  const policy = () => normalizeConflictPolicy(
    typeof config?.conflictPolicy?.get === 'function'
      ? config.conflictPolicy.get()
      : config?.conflictPolicy,
  )
  const log = (message) => {
    try {
      ctx?.logger?.warn?.(message)
    } catch {
      /* logging is advisory */
    }
  }

  // Orphan cleanup + partial-artifact salvage. Both are opt-out through config
  // and both are best-effort: a failed teardown must never fail the route.
  try {
    if (typeof ctx?.effect === 'function') {
      ctx.effect(() => {
        const resilience = installResilience(ctx, config, log)
        return () => resilience.dispose()
      }, 'dsh-opencode-v2-http: subagent resilience')
    } else {
      installResilience(ctx, config, log)
    }
  } catch (error) {
    log(`dsh-opencode-v2-http: resilience install failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  let registration = null

  let warmed = false
  let busy = false
  let released = false
  let lastCode = ''

  const commit = () => {
    busy = true
    try {
      registration = ctx.llm.registerAdapter([providerId], adapter)
      adapter.standDown = false
    } finally {
      busy = false
    }
    // The generic settings form is deliberately NOT advertised.
    //
    // `registerConfigurableProviders` makes the Models settings tab render one row
    // per directory entry, and that row is a raw form over every volatile field of
    // the owning namespace - 40 fields here. This plugin already ships a purpose
    // built panel (`lib/client.js`, the "OpenCode V2" section) editing the same row,
    // so advertising the directory gave operators two competing screens over one
    // persistence layer, differing in what they show and when they refresh.
    //
    // Removing the entry hides only that form. The panel keeps working: the host
    // settings service resolves a namespace through `configEditor.entries()` (the
    // loader tree), never through this directory (verified 2026-11-03), so
    // `ctx.settings.update('dsh-opencode-v2-http', ...)` still persists allow-list and
    // plan changes. `configurableProviders` stays declared for `dispose()`.
    if (!warmed) {
      warmed = true
      try {
        adapter.warmStart()
      } catch (error) {
        log(`dsh-opencode-v2-http: catalog warm start failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  const reconcile = () => {
    if (released || busy) return
    const serving = (() => {
      const entry = config?.modelServing
      if (entry !== null && typeof entry === 'object' && typeof entry.get === 'function') return entry.get() !== false
      return entry === undefined ? true : entry !== false
    })()
    if (!serving) {
      if (registration) {
        const release = registration
        registration = null
        adapter.standDown = true
        try { release() } catch { /* the host may have released it first */ }
      } else {
        adapter.standDown = true
      }
      return
    }
    const decision = decideRouterConflict(detectRouterConflicts(ctx?.llm, providerId), policy())
    if (decision.code !== lastCode) {
      lastCode = decision.code
      if (decision.warning) log(decision.warning)
    }
    if (decision.action === 'serve') {
      if (!registration) commit()
      return
    }
    if (registration) {
      const release = registration
      registration = null
      adapter.standDown = true
      try {
        release()
      } catch {
        /* the host may have released it first */
      }
    } else {
      adapter.standDown = true
    }
  }

  reconcile()
  if (typeof ctx?.on === 'function') ctx.on('llm/adapters-updated', () => reconcile())

  const dispose = () => {
    if (released) return
    released = true
    try {
      registration?.()
    } catch {
      /* already released */
    }
    registration = null
    adapter.dispose()
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => dispose(), 'dsh-opencode-v2-http: dispose adapter and owned server')
  }
  registerModelSettingsRoutes(ctx, adapter, config, log, {
    onModelsApplied: async (enabled) => {
      return syncOpenCodeSelection(enabled, { activePlan: config.activePlan?.get?.() ?? 'go' })
    },
  })
  return dispose
}

/**
 * Settings namespace of this plugin row.
 *
 * The loader derives a row's settings namespace from its config row id, which the
 * bundle patch pins to `dsh-opencode-v2-http` (the module name). Keeping the
 * derivation in one place makes a rename a single edit.
 *
 * @param config - the row config (unused today; kept for a future explicit override).
 * @returns the namespace `ctx.settings` expects.
 */
export function settingsNs(config) {
  const explicit = config?.settingsNs
  if (explicit && typeof explicit.get === 'function') {
    const value = explicit.get()
    if (typeof value === 'string' && value.length > 0) return value
  }
  return 'dsh-opencode-v2-http'
}

/**
 * Serve the settings tab's operations over the local connection.
 *
 * `model-settings` returns the catalog plus the current allow-list;
 * `model-settings/measure` runs the entitlement sweep; `model-settings/apply`
 * persists a new allow-list. The sweep runs only on an explicit measure request —
 * never during a conversation — so the prompt path never pays for it.
 *
 * Registration is optional: a host without `ctx.connection.fetch` simply has no
 * settings tab, and every adapter behaviour stays intact.
 *
 * @param ctx - plugin context.
 * @param adapter - the mounted HTTP adapter.
 * @param config - the row config carrying `enabledModels`.
 * @param log - warning sink.
 * @returns true when the routes were registered.
 */
export function registerModelSettingsRoutes(ctx, adapter, config, log = () => {}, options = {}) {
  const register = ctx?.connection?.fetch?.register
  if (typeof register !== 'function') return false
  const respond = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  /**
   * Whether one request asks for a cache bypass (`?refresh=1`).
   * @param {Request} request - the route request.
   * @returns {boolean} true when the client asked for a fresh upstream answer.
   */
  const isForcedRequest = (request) => {
    try {
      return new URL(request?.url ?? 'http://localhost/').searchParams.get('refresh') === '1'
    } catch {
      return false
    }
  }

  const readJson = async (request) => {
    try {
      const text = await request.text()
      return text ? JSON.parse(text) : {}
    } catch {
      return null
    }
  }

  /**
   * Annotate and order the served catalog for the settings checklist.
   *
   * Scoped to the active plan. Measured 2026-11-04 before this: the tab served
   * all 50 routes while only 28 could be clicked — 44% of the list was rows that
   * say "다른 플랜" and refuse input. The plan is already a first-class choice in
   * this panel, so the other plan's rows carry no decision the operator can act
   * on; `otherPlanCount` reports them instead of rendering them.
   *
   * @returns {Promise<{ models: object[], otherPlanCount: number, verdicts: object, observedAt: string|null, ranking: object }>}
   */
  const describeModels = async () => {
    const discovered = await adapter.discover().catch(() => null)
    const rows = (discovered?.models ?? []).map((model) => ({ route: String(model.id), name: model.name ?? String(model.id) }))
    const ranking = adapter.readRanking()
    const snapshot = adapter.verdicts()
    adapter.markKnown(rows.map((row) => row.route))
    const activePlan = config.activePlan?.get?.() ?? 'go'
    const ordered = orderModels(rows, {
      activePlan,
      verdicts: snapshot.verdicts,
      ranking: rankingForRoutes(rows.map((row) => row.route), ranking.byModel),
      firstSeen: adapter.readFirstSeen().firstSeen,
      newWithinDays: config.newModelDays?.get?.() ?? NEW_MODEL_DAYS,
    })
    // Ordering already puts the active plan first; the split keeps the payload
    // scoped without a second pass over the catalog.
    const models = ordered.filter((model) => model.plan === activePlan)
    return {
      models,
      otherPlanCount: ordered.length - models.length,
      verdicts: snapshot.verdicts,
      observedAt: snapshot.measuredAt,
      ranking,
    }
  }

  const visibleRoutes = async () =>
    adapter
      .listModels()
      .then((list) => list.map((model) => model.id).filter((id) => id !== 'default'))
      .catch(() => [])

  const routes = {
    /**
     * `model-settings` reports the served catalog and the current allow-list.
     *
     * `?refresh=1` forces a catalog probe first. `catalog.read()` answers from
     * the snapshot and only revalidates in the background, so without this flag
     * the panel's refresh button would render the same rows again (measured
     * 2026-11-13: `discoveryCacheMs` is 5 minutes).
     * @param {Request} request - the route request.
     */
    'model-settings': async (request) => {
      if (isForcedRequest(request)) {
        // A failed probe must not fail the read: `describeModels()` still has
        // whatever the lifecycle holds, and the panel shows the last good rows.
        try {
          await adapter.catalog?.refresh?.()
        } catch {
          /* the cached snapshot stays authoritative */
        }
      }
      const state = await describeModels()
      return respond({
        activePlan: config.activePlan?.get?.() ?? 'go',
        plans: PLANS,
        enabled: config.enabledModels?.get?.() ?? [],
        models: state.models,
        // Routes of the plan NOT being shown: reported as a number, never as rows
        // (measured 2026-11-04: 20 of 50 rows were unclickable "다른 플랜" entries).
        otherPlanCount: state.otherPlanCount,
        // What the requests of this process actually cost, per session, parsed
        // from the wire's own usage.cost / usage.opencode (lib/cost.js).
        cost: adapter.costSummary(),
        visible: await visibleRoutes(),
        verdicts: state.verdicts,
        observedAt: state.observedAt,
        ranking: {
          updatedAt: state.ranking.updatedAt,
          fetchedAt: state.ranking.fetchedAt,
          covered: Object.keys(state.ranking.byModel ?? {}).length,
        },
      })
    },
    'model-settings/ranking/refresh': async () => {
      const snapshot = await adapter.refreshRanking(true)
      return respond({
        updatedAt: snapshot.updatedAt,
        fetchedAt: snapshot.fetchedAt,
        covered: Object.keys(snapshot.byModel ?? {}).length,
      })
    },
    /**
     * Go plan windows (rolling / weekly / monthly).
     *
     * The local control plane already reports this and the adapter already talks
     * to it, so the panel needs no extra credential. Measured 2026-11-04 against
     * the Hermes `opencode-go-usage` sidecar on 127.0.0.1:17799: identical numbers
     * (3% / 3% / 27%), so this is the same source, reached without the sidecar.
     *
     * `?refresh=1` bypasses the short cache, mirroring that sidecar's flag.
     */
    'plan-usage': async (request) => {
      const url = new URL(request.url)
      const force = url.searchParams.get('refresh') === '1'
      const now = Date.now()
      if (!force && adapter.planCache !== null && now - adapter.planCache.at < 60000) {
        return respond(adapter.planCache.value)
      }
      try {
        const payload = await adapter.server.request('GET', '/api/experimental/usage/limits')
        const data = payload?.data ?? {}
        const go = data.go ?? {}
        const window = (entry, label) => ({
          label,
          percent: Number(entry?.percent ?? 0),
          limited: entry?.limited === true,
          resetsAt: Number(entry?.resetsAt ?? 0),
        })
        const value = {
          ok: true,
          workspace: data.workspace?.name ?? null,
          usageUrl: data.workspace?.usageURL ?? null,
          windows: {
            rolling: window(go.rolling, '5-hour'),
            weekly: window(go.weekly, 'Weekly'),
            monthly: window(go.monthly, 'Monthly'),
          },
          fetchedAt: now,
        }
        adapter.planCache = { at: now, value }
        return respond(value)
      } catch (error) {
        return respond({ ok: false, error: error instanceof Error ? error.message : String(error) }, 502)
      }
    },
    /**
     * Session cost for the composer status pill.
     *
     * The chat status row reads this while a session is open; it answers from the
     * in-process ledger, so it costs no backend request. Keyed by the DSH session
     * id the client already has.
     */
    'cost/session': async (request) => {
      const payload = await readJson(request)
      if (payload === null) return respond({ error: 'expected JSON' }, 400)
      const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
      const summary = adapter.costSummary()
      // The client knows the session by its DSH id; the adapter records whatever
      // identity the loop stamped on the request. Measured 2026-11-04 they are the
      // same `session-<uuid>` shape, but a client may hold the bare uuid (the DOM
      // attribute is not guaranteed to keep the prefix). Match on either form
      // rather than reporting "no data" for a session that has cost.
      const entry = pickSession(summary, sessionId)
      return respond({
        session: entry,
        totals: {
          sessions: summary.sessions,
          requests: summary.requests,
          costUsd: summary.costUsd,
          allowanceUsd: summary.allowanceUsd,
        },
      })
    },
    'model-settings/apply': async (request) => {
      const payload = await readJson(request)
      if (payload === null) return respond({ error: 'expected JSON' }, 400)
      const wantsEnabled = Array.isArray(payload.enabled)
      const wantsPlan = typeof payload.activePlan === 'string'
      if (!wantsEnabled && !wantsPlan) {
        return respond({ error: 'expected { enabled?: string[], activePlan?: "go"|"zen" }' }, 400)
      }
      const settings = ctx?.settings
      if (typeof settings?.update !== 'function') {
        return respond({ error: 'this host exposes no settings service; set enabledModels / activePlan in the profile patch' }, 409)
      }
      const patch = {}
      if (wantsEnabled) {
        patch.enabledModels = payload.enabled
          .filter((route) => typeof route === 'string' && route.trim().length > 0)
          .map((route) => route.trim())
      }
      if (wantsPlan) {
        if (!PLANS.includes(payload.activePlan)) {
          return respond({ error: `activePlan must be one of ${PLANS.join(', ')}` }, 400)
        }
        patch.activePlan = payload.activePlan
      }
      await settings.update(settingsNs(config), patch)
      if (wantsEnabled && typeof options.onModelsApplied === 'function') {
        await options.onModelsApplied(patch.enabledModels)
      }
      const state = await describeModels()
      return respond({
        activePlan: config.activePlan?.get?.() ?? 'go',
        enabled: config.enabledModels?.get?.() ?? [],
        models: state.models,
        otherPlanCount: state.otherPlanCount,
        visible: await visibleRoutes(),
      })
    },
  }

  for (const [suffix, handler] of Object.entries(routes)) {
    try {
      ctx.effect(
        () =>
          register({
            path: `/api/local/opencode-v2/${suffix}`,
            methods: ['POST'],
            requestBody: 'buffered',
            fetch: async (request) => {
              try {
                return await handler(request)
              } catch (error) {
                log(`dsh-opencode-v2-http: ${suffix} failed: ${error instanceof Error ? error.message : String(error)}`)
                return respond({ error: String(error?.message ?? error) }, 500)
              }
            },
          }),
        `dsh-opencode-v2-http: ${suffix}`,
      )
    } catch (error) {
      log(`dsh-opencode-v2-http: could not register ${suffix}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return true
}

// Load beacon: written when this module is evaluated in the serving process, so a
// restart can be verified without spending a model request (a 'stream' beacon is
// only written once a request actually starts). Both events carry the same VERSION
// constant, so a beacon line for pid N names the build that pid loaded.
bootBeacon('load')
