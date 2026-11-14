/**
 * TypeScript declarations for the provenance records this plugin writes.
 *
 * Declaration only: nothing imports this file at runtime, and it adds no runtime
 * import to the package. It exists so editors resolve the record payloads and so
 * `npx tsc --noEmit` can check a caller against the same shapes the validators in
 * `lib/attribution.js` enforce at read time.
 *
 * The names are fixed identifiers: renaming one is a migration of already
 * committed logs, not a refactor.
 */

/** One plugin surface rewrite, written after the replacement it describes. */
export interface TokenEconomizerSurfaceRewrite {
  /** Surface node the replacement targeted. */
  readonly nodeSeq: number
  /** Retention tier the node was moved into. */
  readonly tier: 'warm' | 'cold'
  /** Replaced text length before the rewrite. */
  readonly charsBefore: number
  /** Replacement text length after the rewrite. */
  readonly charsAfter: number
  /** Token estimate of the shadowed original. */
  readonly shadowTokens: number
  /** The surface write that carried this rewrite, when the pair is split. */
  readonly pairedRewriteSeq?: number
  /** Why the rewrite happened, in the plugin's own vocabulary. */
  readonly reason: string
}

/** One tier decision, whether or not it produced a rewrite. */
export interface TokenEconomizerTierDecision {
  /** Surface node the decision was made for. */
  readonly nodeSeq: number
  /** Tier the policy selected. */
  readonly tier: 'hot' | 'warm' | 'cold'
  /** Turn index at decision time. */
  readonly turn: number
  /** Step index at decision time. */
  readonly step: number
  /** Digest of the policy that produced the decision. */
  readonly policyHash: string
  /** Why this tier was selected. */
  readonly reason: string
}

/** One application of the engine's tool prune, with its visible intersection. */
export interface TokenEconomizerToolpruneApplied {
  /** Tool names the engine proposed for removal. */
  readonly tools: readonly string[]
  /** Visible tool count before the restriction. */
  readonly countBefore: number
  /** Visible tool count after the restriction. */
  readonly countAfter: number
  /** Tools both proposed and actually visible, so actually lifted. */
  readonly visibleIntersection: readonly string[]
  /** Engine proposal this application came from, when one was matched. */
  readonly proposalId?: string
  /** Repository key the evidence belonged to. */
  readonly repoKey: string
  /** Unix epoch milliseconds at decision time. */
  readonly time: number
}

/**
 * The `plugin:tokeneconomizer/` namespace in the harness plugin record catalog.
 *
 * `toolprune-applied` mirrors the engine's own `toolprune_*` key vocabulary; the
 * spelling is part of the record name and cannot be hyphenated to `tool-prune`.
 */
declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** One surface rewrite: which node, which tier, and the text sizes around it. */
    'plugin:tokeneconomizer/surface-rewrite': TokenEconomizerSurfaceRewrite
    /** One retention-tier decision, including the hot tier that writes nothing. */
    'plugin:tokeneconomizer/tier-decision': TokenEconomizerTierDecision
    /** One applied tool prune, mirroring the engine's `toolprune_*` vocabulary. */
    'plugin:tokeneconomizer/toolprune-applied': TokenEconomizerToolpruneApplied
  }
}
