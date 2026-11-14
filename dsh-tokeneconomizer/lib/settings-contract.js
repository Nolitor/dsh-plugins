/**
 * The single source of the settings contract: paths, mode vocabulary, threshold specs, actions
 * and the UI label/selector orderings derived from them.
 *
 * This module is deliberately free of imports — no `node:` builtins, no relative specifiers — so
 * the Node route half (`settings-api.js`) and the browser client half (`client.js`) can read the
 * exact same constants. Duplicating these values in the client would re-create the drift this
 * project already fixed once.
 */

/** Base of the settings surface; one path name under the plugin's local namespace. */
export const SETTINGS_PATH = '/api/local/tokeneconomizer/settings'
/** Batched threshold (and mode) write. */
export const CONFIG_PATH = SETTINGS_PATH + '/config'
/** Undo the tool-prune restriction. */
export const RESTORE_PATH = SETTINGS_PATH + '/restore'
/** Drop stored overrides. */
export const RESET_PATH = SETTINGS_PATH + '/reset'
/** Fold earlier sessions into the engine; asynchronous, answers 202 plus a job id. */
export const IMPORT_PATH = SETTINGS_PATH + '/import'
/** Compare the pinned engine commit with the upstream branch head and latest release. */
export const UPSTREAM_PATH = SETTINGS_PATH + '/upstream-check'
/** The registered provider/model pairs a side call may target. */
export const MODELS_PATH = SETTINGS_PATH + '/models'

/** The three mechanisms the page switches. */
export const MODE_KEY = Object.freeze({ MICROSKILLS: 'microskills', TOOLPRUNE: 'toolprune', LOOPGUARD: 'loopguard' })

/** Every value a mechanism accepts. */
export const MODE_VALUES = Object.freeze({
  microskills: Object.freeze(['off', 'envfacts', 'envfacts+distiller', 'distiller']),
  toolprune: Object.freeze(['off', 'propose', 'auto']),
  loopguard: Object.freeze(['off', 'nudge', 'stop']),
})

// `on` is a write alias, never a stored value.
export const MODE_ALIAS = Object.freeze({ microskills: 'envfacts+distiller', toolprune: 'auto', loopguard: 'nudge' })

/** The numeric settings a person may tune, with their type, range and engine default. */
export const THRESHOLDS = Object.freeze({
  microskills_propose_every: Object.freeze({ key: 'microskills_propose_every', type: 'int', min: 1, max: null, def: 3 }),
  toolprune_evidence: Object.freeze({ key: 'toolprune_evidence', type: 'int', min: 1, max: null, def: 10 }),
  toolprune_min_sessions: Object.freeze({ key: 'toolprune_min_sessions', type: 'int', min: 1, max: null, def: 2 }),
  toolprune_sessions: Object.freeze({ key: 'toolprune_sessions', type: 'int', min: 1, max: null, def: 5 }),
  toolprune_quiet_minutes: Object.freeze({ key: 'toolprune_quiet_minutes', type: 'int', min: 0, max: null, def: 60 }),
  'loopguard.envelope_min_samples': Object.freeze({ key: 'loopguard_thresholds.envelope_min_samples', type: 'int', min: 1, max: null, def: 5 }),
  'loopguard.judge_confidence': Object.freeze({ key: 'loopguard_thresholds.judge_confidence', type: 'float', min: 0, max: 1, def: 0.7 }),
  loopguard_nudges: Object.freeze({ key: 'loopguard_nudges', type: 'int', min: 1, max: null, def: 1 }),
  'loopguard.backstop_mult': Object.freeze({ key: 'loopguard_thresholds.backstop_mult', type: 'float', min: 0.1, max: null, def: 2.5 }),
})

/** Actions are plugin-owned, NOT engine config keys. */
export const ACTIONS = Object.freeze(['toolprune restore', 'reset', 'history_import'])

/**
 * The side-call model slots: which engine config key each one writes.
 *
 * The Micro-skills proposer and the Loop Guard judge are the two LLM side calls the engine
 * makes. Each may name its own `provider/model`; an empty value means "use the deployment's
 * own default route", which is what an unmodified engine does today. The three keys are the
 * engine's own config keys, written through `te config set`.
 *
 * The map is keyed by the slot's own key, so `MODEL_SLOTS[slot]` is the slot — the same way
 * `THRESHOLDS` is keyed by its label.
 *
 * The slot labels are namespaced with `model.` because they share one `set` object with the
 * MECHANISM modes on the write path: the engine's `microskills` key is the mode
 * (`envfacts+distiller`), and a slot called `microskills` would be the same key for two
 * different settings. The namespace keeps the two vocabularies apart.
 */
export const MODEL_SLOTS = Object.freeze({
  'model.default': Object.freeze({ key: 'model.default', label: 'default', engineKey: null }),
  'model.microskills': Object.freeze({ key: 'model.microskills', label: 'microskills', engineKey: 'microskills_model' }),
  'model.loopguard': Object.freeze({ key: 'model.loopguard', label: 'loopguard', engineKey: 'loopguard_model' }),
})

/** The model slots in the order the page paints them. */
export const MODEL_SLOT_KEYS = Object.freeze(Object.keys(MODEL_SLOTS))

/** The `THRESHOLDS` labels in the order the page paints them. */
export const THRESHOLD_LABELS = Object.freeze([
  'microskills_propose_every',
  'toolprune_evidence',
  'toolprune_min_sessions',
  'toolprune_sessions',
  'toolprune_quiet_minutes',
  'loopguard.envelope_min_samples',
  'loopguard.judge_confidence',
  'loopguard_nudges',
  'loopguard.backstop_mult',
])

/** The three mode selectors, each with the values it accepts, in stable order. */
export const MODE_SELECTS = Object.freeze([
  Object.freeze({ key: MODE_KEY.MICROSKILLS, values: MODE_VALUES[MODE_KEY.MICROSKILLS] }),
  Object.freeze({ key: MODE_KEY.TOOLPRUNE, values: MODE_VALUES[MODE_KEY.TOOLPRUNE] }),
  Object.freeze({ key: MODE_KEY.LOOPGUARD, values: MODE_VALUES[MODE_KEY.LOOPGUARD] }),
])
