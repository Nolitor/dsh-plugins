/**
 * Provider payload mapping — compatibility surface only.
 *
 * Candidate extraction, part classification and the finish table now live in
 * `./stream-contract.js` on top of the shared pipe, so the finish vocabulary is
 * the workspace table rather than a per-vendor copy. This file keeps the
 * published `./map` export working.
 *
 * @module @nolit/dsh-antigravity/map
 */

export { candidateOf, classify, mapFinish as finishReasonFor, partsOf } from './stream-contract.js'
