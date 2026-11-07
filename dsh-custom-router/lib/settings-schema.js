/**
 * Config schema for the router row — the projection contract the settings
 * service and the browser dashboard read.
 *
 * WHY A SCHEMA (measured, 2026-11-08)
 *   `lib/index.js` shipped no `Config` export, so the host settings service
 *   could not project this row: `~/.dsh` GUI showed the raw package name and no
 *   editable field, and the client dashboard's `ctx.configForms.get(
 *   'dsh-custom-router')` answered `status: 'unavailable'`. A row without a
 *   schema is not configurable, no matter what the runtime body accepts.
 *
 * THE THREE LAYERS THIS SCHEMA MUST KEEP APART
 *   1. **mount-time** (`strict`, `packages`, `profileDir`, `installAnchor`) —
 *      ordinary fields. A write to one of them is REJECTED by the settings
 *      service (`isVolatilePath` check) on purpose: changing where presets
 *      resolve from is a profile edit, not a toggle.
 *   2. **live switches** (`presets`, `vendorConfig`) — `.volatile()`. The
 *      settings service only accepts a write whose path lies under a volatile
 *      node, so these MUST be volatile or the dashboard's switches cannot be
 *      saved at all. `lib/index.js` reads them through `configValue()`, which
 *      unwraps the volatile reference.
 *   3. **measurements** (`usage`) — `.volatile()` as well. It is data the host
 *      may publish for the dashboard; it is never a mount input.
 *
 * SECRETS
 *   `apiKey` / `password` / `clientSecret` / `refreshToken` carry
 *   `role('secret')`. The settings service strips them from every wire read and
 *   answers a sidecar of `{paths, set}` positions instead, so the browser can
 *   render "설정됨 / 미설정" without ever receiving the value. The live patch
 *   currently holds the DeepInfra API key in plaintext; that key must not ride
 *   a settings response (measured: it did not, once the role was declared).
 *
 * UNKNOWN KEYS
 *   The row objects are a SUPERSET of what any one vendor row carries, and
 *   schemastery keeps keys the schema does not name (verified 2026-11-08). A
 *   vendor row added later therefore survives the projection instead of being
 *   silently dropped, and no `default()` is declared on a row field: a default
 *   would be written into a row that never had the field.
 *
 * @module @nolit/dsh-custom-router/settings-schema
 */
import Schema from '@deepseek-ai/schemastery'

/**
 * One vendor row's config, as a superset of every mounted row's fields.
 *
 * No field carries a `default()` and no field is `.volatile()`: the enclosing
 * `vendorConfig` dict is the volatile node (schemastery forbids a volatile field
 * inside a volatile ancestor), and a default here would materialise a value the
 * operator never set.
 */
export const VendorRow = Schema.object({
  // ---- switches (the dashboard's three layers) --------------------------
  /** Preset master switch (the row's own `enabled`, where the row has one). */
  enabled: Schema.boolean(),
  /** Model serving / model-router surface. */
  modelServing: Schema.boolean(),
  /** Subagent provider surface. */
  subagent: Schema.boolean(),
  /** CLI worker surface (OpenCode names it `cli`). */
  cli: Schema.boolean(),
  /** CLI worker surface (Antigravity names it `cliWorker`). */
  cliWorker: Schema.boolean(),
  /** The CLI worker's mode flag; paired atomically with the surface flag. */
  workerEnabled: Schema.boolean(),
  /** Sync batch CLI surface (Antigravity only). */
  cliBatch: Schema.boolean(),
  /** Composer usage chip. */
  usagePill: Schema.boolean(),

  // ---- credentials (write-only; redacted on every read) -----------------
  /** DeepInfra API key. */
  apiKey: Schema.string().role('secret'),
  /** Generic password field (web-auth presets). */
  password: Schema.string().role('secret'),
  /** OAuth client secret (Antigravity). */
  clientSecret: Schema.string().role('secret'),
  /** OAuth refresh token (Antigravity). */
  refreshToken: Schema.string().role('secret'),

  // ---- non-secret row options (kept so a live row projects intact) ------
  /** OAuth client id. */
  clientId: Schema.string(),
  /** Credential file the child probes. */
  tokenFile: Schema.string(),
  /** Provider base URL override. */
  baseUrl: Schema.string(),
  /** Control-plane base URL override. */
  controlBaseUrl: Schema.string(),
  /** Cloud project id. */
  project: Schema.string(),
  /** User-Agent override. */
  userAgent: Schema.string(),
  /** Catalog cache TTL (ms). */
  catalogTtlMs: Schema.number(),
  /** Advertised model ids; empty = the live catalog. */
  enabledModels: Schema.array(Schema.string()).default(undefined),
  /** Extra headers merged into generation requests. */
  extraHeaders: Schema.dict(Schema.string()).default(undefined),
  /** `agy` executable path. */
  agyPath: Schema.string(),
  /** Default model for the CLI surface. */
  model: Schema.string(),
  /** Default reasoning effort. */
  effort: Schema.string(),
  /** Permission mode for the CLI surface. */
  mode: Schema.string(),
  /** CLI timeout (ms). */
  timeoutMs: Schema.number(),
  /** CLI output cap (bytes). */
  maxOutputBytes: Schema.number(),
  /** Extra CLI arguments. */
  extraArgs: Schema.array(Schema.string()).default(undefined),
  /** Artifact count cap. */
  artifactLimit: Schema.number(),
  /** Local `opencode` executable path. */
  opencodePath: Schema.string(),
  /** Daemon working directory. */
  cwd: Schema.string(),
  /** Default model id for the OpenCode HTTP route. */
  defaultModel: Schema.string(),
  /** OpenCode plan (`go` / `zen`). */
  activePlan: Schema.string(),
  /** Conflict policy when a daemon is already running. */
  conflictPolicy: Schema.string(),
  /** Attach to an existing daemon instead of spawning one. */
  attachToDaemon: Schema.boolean(),
  /** Spawn the daemon when it is absent. */
  spawnServer: Schema.boolean(),
  /** Per-turn output token cap. */
  turnMaxTokens: Schema.number(),
  /** Default effort for the DeepInfra route. */
  defaultEffort: Schema.string(),
})

/**
 * One published usage measurement for the dashboard.
 *
 * Shaped for `lib/usage.js` readings, not invented: a window carries a percent
 * only when a probe measured one, and a reset only when the provider reported
 * one. `null` fields mean "not measured" — the client renders "미제공", never 0.
 */
export const UsageMeasurement = Schema.object({
  /** When the measurement was taken (ISO string or epoch ms). */
  measuredAt: Schema.any(),
  /** Subscription windows (5h / weekly / monthly). */
  windows: Schema.array(Schema.object({
    /** Normalised window id (`5h`, `weekly`, `monthly`). */
    id: Schema.string(),
    /** Consumed percentage, 0-100; absent when unmeasured. */
    percent: Schema.number(),
    /** Reset instant (ISO string or epoch ms). */
    resetsAt: Schema.any(),
  })),
  /** Serving summary for the card footer. */
  serving: Schema.object({
    /** Models the route currently serves. */
    modelCount: Schema.number(),
    /** `healthy` / `degraded` / `unknown`. */
    health: Schema.string(),
  }),
  /** Pay-per-token billing figures. */
  spend: Schema.number(),
  /** Request count for the billing period. */
  requests: Schema.number(),
  /** Input tokens for the billing period. */
  inputTokens: Schema.number(),
  /** Output tokens for the billing period. */
  outputTokens: Schema.number(),
  /** input USD per 1M tokens. */
  inputRate: Schema.number(),
  /** output USD per 1M tokens. */
  outputRate: Schema.number(),
  /** Account balance, when the provider reports one. */
  balance: Schema.number(),
})

/**
 * The router row's Config schema.
 *
 * `strict` and the resolution anchors stay ordinary on purpose: a settings write
 * to a non-volatile path is refused by the service, which is the correct
 * behaviour for fields that decide what gets mounted.
 */
export const Config = Schema.object({
  /** Throw on an invalid preset plan instead of warning. */
  strict: Schema.boolean().default(true),
  /** Which presets are mounted, keyed by preset id. */
  presets: Schema.dict(Schema.boolean()).volatile(),
  /** Per-row config handed to each mounted child, keyed by ROW id. */
  vendorConfig: Schema.dict(VendorRow).volatile(),
  /** Published measurements for the dashboard, keyed by preset id. */
  usage: Schema.dict(UsageMeasurement).volatile(),
  /** Module override for a preset's own package, keyed by preset id. */
  packages: Schema.dict(Schema.string()),
  /** Profile whose `node_modules` holds the `@nolit/*` links. */
  profileDir: Schema.string(),
  /** DSH install package.json (host-shared rows resolve through it). */
  installAnchor: Schema.string(),
})

export default Config
