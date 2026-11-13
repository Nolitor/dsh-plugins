# Custom Router — Transport-Level Retry Policy

<!-- skeleton:
version: 0.0.1-rc.1
kind: spec
status: active
updated: 2026-11-06
summary: Normative bounded retry policy for the custom router: only transport/socket failures and transient 502/503/504, no automatic model fallback, no circuit breaker, short exponential backoff, clean terminal error.
-->

> Status: **specification only**, built on measured source 2026-11-06. Owner instruction:
> *no automatic model fallback* — the model-serving structure is owner-specified and must never
> silently switch to another model; hardening is **retry only**, for transient network/socket
> faults. Permanent errors (401 auth, 403 permission, quota exhaustion) abort immediately.
> No circuit breaker, no session teardown. Document version follows the `rc.#` history scheme;
> plugin `@nolit/dsh-custom-router` is `0.0.1-rc.1`. No `rc#` advanced, no code/profile/version
> changed. Parents: [CUSTOM-ROUTER-PROTOCOL-STANDARD.md](CUSTOM-ROUTER-PROTOCOL-STANDARD.md),
> [WEB-AUTH-PIPELINE-ENGINE.md](WEB-AUTH-PIPELINE-ENGINE.md),
> [PLAN-AND-USAGE-SPEC.md](PLAN-AND-USAGE-SPEC.md).

## 1. Scope and non-goals

| In scope | Out of scope (explicitly excluded by the owner) |
| :--- | :--- |
| bounded retry on transport/socket errors and transient gateway statuses | **automatic model fallback** (never switch the model the owner selected) |
| short exponential backoff, max 2-3 attempts | **circuit breaker / session teardown** (no "거창하게 세션을 끊어버리기") |
| clean terminal failure carrying the original cause | retrying permanent errors (401/403/quota) |
| a policy shared by all three services | changing which model/provider serves the turn |

A retry re-sends **the same request to the same route**. It never changes `provider`, `model`,
or `reasoningEffort`. A failure after the bounded attempts becomes a terminal
`finish{kind:'error'}` with the original cause preserved, as DSH `adapterStream` already
guarantees (`dsh-llm/lib/index.js:2314`, `adapterFailureChunk`).

## 2. Classification — retryable vs terminal (normative)

### 2.1 Retryable: transport level only

| # | Class | Measured signal | Source |
| :--- | :--- | :--- | :--- |
| T1 | socket / connection cut | `ECONNRESET`, `ECONNABORTED`, `EPIPE`, `ETIMEDOUT`, `UND_ERR_SOCKET`, `UND_ERR_CLOSED` | `dsh-opencode-v2/lib/http.js:2114-2121` `TRANSIENT_STREAM_CODES` (measured 2026-10-31) |
| T2 | fetch/stream wording | `TypeError: terminated` (undici), `socket hang up`, `other side closed`, `premature close`, `stream closed` | `http.js:2128-2133` `isTransientStreamError()` |
| T3 | transient gateway | HTTP **502 / 503 / 504** | `http.js:1896`, `dsh-antigravity/lib/adapter.js:262` |
| T4 | daemon IPC momentary hang | local control-plane request that times out or throws with `status === undefined` (no HTTP verdict) | `http.js:445-471` `refreshable = !aborted && !endpoint.owned && status === undefined`; `probeServer` 3s, `requestOnce` 30s |
| T5 | caller abort | `AbortError` / `signal.aborted` | `http.js:457`, `adapter.js:250` — **never retried** (caller cancelled) |

`isTransientStreamError()` already exists in OpenCode v2 and is the reference classifier. The
policy **promotes it to the shared contract**: Antigravity and DeepInfra must classify the same
way. A stream cut after partial text is preserved (`streamCutPreserve`, `http.js:211`), not
turned into an empty turn.

### 2.2 Terminal: abort immediately, no retry

| # | Class | Measured code / signal | Source |
| :--- | :--- | :--- | :--- |
| P1 | auth failure | 401 -> `AUTH` / `OPENCODE_BACKEND_AUTH` / `INVALID_CREDENTIAL` | `adapter.js:397-401`, `http.js:1919`, `dsh-deepinfra/lib/adapter.js:175` |
| P2 | permission / license | 403 -> `NO_LICENSE` / `INVALID_CREDENTIAL` | `adapter.js:398`, `adapter.js:175` |
| P3 | wrong request / model | 400, 404 `NOT_FOUND` / `UNKNOWN_MODEL`, 422 `UNSUPPORTED_OPTION` | `adapter.js:399`, `deepinfra/adapter.js:178-179` |
| P4 | **quota / credit exhausted** | Go plan `limited:true`, `FreeUsageLimitError`, 429 `RESOURCE_EXHAUSTED`, credit/balance exhaustion, 402 | `http.js:2620-2650` plan-usage, `adapter.js:400` `RATE_LIMITED`, [PLAN-AND-USAGE-SPEC.md §1.2](PLAN-AND-USAGE-SPEC.md) |
| P5 | caller abort | `AbortError` | T5 above |

**P4 is decisive:** quota exhaustion is a *user state*, not a transport fault. Retrying it
cannot help and only burns more requests. It must surface immediately with the provider's
message and the plan/credit reading, and the user decides what to do. **No automatic fallback
to another plan, provider, or model.**

### 2.3 Classification decision order (normative)

```
1. signal.aborted / AbortError            -> TERMINAL (P5), no retry
2. HTTP response present?
   a. 401 / 403 / 400 / 404 / 422 / 402   -> TERMINAL (P1-P3), no retry
   b. 429                                 -> read the body/plan state:
        quota|limit|credit|FreeUsage      -> TERMINAL (P4), no retry
        engine_overloaded / transient     -> retryable ONLY if T3-class transient gateway;
                                           otherwise treat as P4 to avoid quota burn
   c. 502 / 503 / 504                    -> RETRYABLE (T3), bounded
   d. 500 / 451 / other statuses         -> TERMINAL (not in the owner's transient list)
3. no HTTP verdict (fetch threw)         -> isTransientStreamError(error)?
        true                             -> RETRYABLE (T1/T2), bounded
        false                            -> TERMINAL, wrap as LlmError TRANSPORT
4. daemon/control-plane request timed out or threw with status===undefined
                                          -> RETRYABLE (T4), bounded, re-resolve endpoint
```

## 3. Bounded retry budget (normative)

| Parameter | Value | Rationale |
| :--- | :--- | :--- |
| `maxAttempts` (retries after the first) | **2 or 3** (default **3**) | owner: "최대 2~3회 재시도" |
| `baseMs` | **500 ms** | owner: "짧은 간격(예: 500ms ~ 2s)" |
| backoff | exponential x2, **capped at 2000 ms** | 500 -> 1000 -> 2000; never exceeds the owner's 2s ceiling |
| jitter | small full jitter, 0-25% of the step | avoid synchronised retries from concurrent subagents (see §5) |
| per-attempt timeout | unchanged: 30 s generation request, 3 s daemon probe, 30 s spawn banner | measured `http.js:476,659,679` |
| total added latency ceiling | **<= 3 x (2000 ms) = 6 s of backoff** plus per-attempt timeouts | bounded, no infinite loop |
| attempt counter scope | **per turn / per request**, never global | no circuit breaker, no cross-session state |
| on exhaustion | terminal `finish{kind:'error'}` carrying the **original** code, status, and message | "깔끔하게 실패 원인을 반환" |

Backoff formula: `delay(n) = min(2000, 500 * 2^n) * (0.75 + 0.25 * random())`, n = 0..maxAttempts-1.

**No circuit breaker.** The owner explicitly rejected a CB-style session teardown. Instead of
remembering "the daemon is down" across turns, each turn gets its own small bounded budget and
then fails cleanly. This keeps isolation (one slow route never freezes the host) without
introducing a global state machine.

## 4. Per-service application (measured baseline vs this policy)

| Service | Current code (measured 2026-11-06) | Delta to this policy (spec only, no code change) |
| :--- | :--- | :--- |
| OpenCode v2 | `httpRetries=3`, `httpRetryBaseMs=1000` (1s->2s->4s), `httpRetryStatuses=[429,451,502,503,504]` (`http.js:218-222`); `daemonRetries=3`, base 1000 (`:229-231`); socket classifier `isTransientStreamError()` (`:2114-2133`); `refreshable` control-plane retry (`:460`) | base 1000 -> **500**, cap **2000**; **remove 429 and 451 and 500** from the retry set (keep 502/503/504); promote the existing socket classifier to the shared contract; keep `streamCutPreserve` |
| Antigravity | `httpRetries=3`, base 1000, statuses `[429,451,500,502,503,504]` (`index.js:132-136`); `authRetried` 401-refresh-once (`adapter.js:256-260`); retryable statuses from `DEFAULT_ANTIGRAVITY_RETRY_STATUSES` (`adapter.js:41`) | same: base 500/cap 2000, keep only 502/503/504, drop 429/451/500; add T1/T2 socket classification (currently only `AbortError` is distinguished, `adapter.js:250`); **401-refresh-once stays** — it is auth repair, not a retry of a permanent error |
| DeepInfra | `LlmError` mapping 429 -> `RATE_LIMIT`, >=500 -> `SERVER`, 402 -> `INVALID_REQUEST` (`adapter.js:174-191`); `sse.js:37` maps aborts to `AbortError` | add the same bounded transport retry (currently no adapter-level generation retry); classify 429/402 as terminal (quota/credit, P4); keep `retryAfter` from the response as a *hint*, never as the sole gate |

**Measured conflicts with the current code, recorded as deltas (not fixed here):**

1. **429 is currently retried** in both OpenCode and Antigravity, but the owner classifies quota
   exhaustion as permanent. A 429 whose body says `RESOURCE_EXHAUSTED`/`FreeUsageLimitError`
   must be terminal; a 429 that is genuinely `engine_overloaded` belongs to the transient
   class only if the gateway status is 502/503/504-class, otherwise it is safer to stop.
2. **451 and 500 are currently retried**; the owner's transient list is only 502/503/504 plus
   socket errors. They move to terminal.
3. **Backoff is 1000ms with no cap** (1s/2s/4s); the owner wants 500ms-2s. Cap at 2000ms.

These are **specification deltas**. No source file, Config default, or live profile was edited.

## 5. Interaction with the concurrency lock (owner risk #1)

- The Antigravity `TokenProvider.inflight` single-flight lock (`auth.js:103-110`) stays. A retry
  after a 401 refresh calls `tokens.get()` again; concurrent subagents share that one refresh
  instead of each starting a grant.
- Retry **jitter** (§3) prevents N subagents from re-sending at the same 500/1000/2000ms instant.
- The `invalidate()` / `inflight` race noted in the runtime-risk report (2026-11-06) is **not**
  widened by this policy: no new global state is added, and the attempt counter is per turn.
- OpenCode's `backendCache` (`credentialCacheMs=300000`) is **not** invalidated by a transport
  retry; only a 401 does `resolveBackend(force:true)` (`http.js:1886`). A socket cut reuses the
  same endpoint/credential pair, which is the correct behaviour for T1/T2.

## 6. Failure output contract (clean cause)

```ts
interface RetryOutcome {
  retried: number                 // 0..maxAttempts, actual attempts made
  exhausted: boolean              // true when the budget was used up
  cause: {                       // ORIGINAL cause, never replaced by a retry message
    code: string                  // e.g. 'ECONNRESET' | 'OPENCODE_BACKEND_HTTP' | 'RATE_LIMITED'
    status?: number               // HTTP status if one arrived
    message: string               // provider message, truncated to a bounded length
    transport: boolean           // true for T1/T2/T4
  }
  terminal: "finish{kind:'error'}" | "finish{kind:'aborted'}"
}
```

Rules: (a) never emit a fabricated success after exhaustion; (b) never emit partial text as a
complete answer — preserve it with `streamCutPreserve` and then fail with the cause; (c) the
UI may show the cause and the plan/usage reading, but **must not offer a different model**
(no fallback). This supersedes the earlier U5 wording in
[PLAN-AND-USAGE-SPEC.md](PLAN-AND-USAGE-SPEC.md) ("offers another service"), which is
**withdrawn** by the owner's 2026-11-06 instruction.

## 7. Conformance gates (for a future implementation)

| # | Gate | Threshold |
| :--- | :--- | :--- |
| R1 | classification table | every T1-T5 and P1-P5 class has a test |
| R2 | permanent errors | 401/403/429-quota/402/400/404/422 produce **0** retries |
| R3 | transient statuses | only 502/503/504 retried; 429/451/500 not retried |
| R4 | socket errors | `ECONNRESET`/`ETIMEDOUT`/`EPIPE`/`terminated` retried; other transports not |
| R5 | bounded | attempts <= 3, any delay <= 2000 ms, total backoff <= 6 s |
| R6 | no state across turns | no circuit breaker, no session teardown, counter reset per turn |
| R7 | no fallback | `provider`/`model`/`reasoningEffort` byte-identical between attempts |
| R8 | clean cause | terminal finish carries the original code/status/message; no empty turn |
| R9 | abort honored | `signal.aborted` stops retries immediately |
| R10 | regression tests | one test per closed defect, in the owning track's `CHANGELOG.md` |

Existing tests that already cover part of this: `http.test.mjs:459,476,493` (stable error
finish, bounded retry), `adapter.test.mjs:99` (401 refresh exactly once),
`adapter.test.mjs:222` (429 -> RATE_LIMIT), `discovery.test.mjs:160` (failed probe keeps the
last good catalog).

## 8. What this document does NOT do

- No code, Config default, cordis patch, live profile, service restart, or version change.
- No automatic model/provider fallback (owner-excluded).
- No circuit breaker or session teardown (owner-excluded).
- No real-mount / browser-boot verification of a new retry implementation — that is a later,
  owner-approved implementation round.

## 9. References

- [CUSTOM-ROUTER-PROTOCOL-STANDARD.md](CUSTOM-ROUTER-PROTOCOL-STANDARD.md), [WEB-AUTH-PIPELINE-ENGINE.md](WEB-AUTH-PIPELINE-ENGINE.md), [PLAN-AND-USAGE-SPEC.md](PLAN-AND-USAGE-SPEC.md), [CUSTOM-ROUTER-ARCHITECTURE.md](CUSTOM-ROUTER-ARCHITECTURE.md)
- [dsh-opencode-v2/lib/http.js](../../archive/dsh-opencode-v2/lib/http.js), [dsh-antigravity/lib/adapter.js](../vendor/antigravity/lib/adapter.js), [dsh-antigravity/lib/auth.js](../vendor/antigravity/lib/auth.js), [dsh-deepinfra/lib/adapter.js](../vendor/deepinfra/lib/adapter.js)
- [OPENCODE-MODEL-SERVING-PLAN.md](../../archive/dsh-opencode-v2/docs/OPENCODE-MODEL-SERVING-PLAN.md), [docs/RULES.md](../../docs/RULES.md)
