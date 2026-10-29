#!/usr/bin/env node
/**
 * Local patch: make the `sessionStats` projection measure generated tokens over
 * pure generation time.
 *
 * Three defects are fixed in the installed `@deepseek-ai/dsh-session-stats`:
 *
 *  1. `decodeTokens` counted `usage.outputTokens` only, so reasoning tokens
 *     (reported separately by OpenCode and by every thinking-capable provider)
 *     never entered the speed numerator.
 *  2. `decodeMs` was `assistant/message time - first token`. A provider that
 *     issues many upstream calls inside one DSH step leaves long silent gaps
 *     there, and the wall clock of the whole step became the denominator —
 *     2 tok/s for a 400 tok/s model.
 *  3. The first fix summed every `usage` chunk. Adapters that accumulate (the
 *     OpenCode HTTP route emits the running total of one generation, several
 *     times) then counted each snapshot again, so a 27k-token step reported
 *     3.2M and the whole session froze at ~5,680 tok/s. The sum is only right
 *     for adapters that emit per-call deltas, so the helper now detects which
 *     sequence it sees.
 *  4. `toolMs` only accumulated `tool/call` → `tool/result` pairs, which a
 *     provider-side agent loop never logs: OpenCode runs its own tools inside
 *     one DSH step. Those steps now attribute `wall - TTFT - decode` to
 *     `toolMs`, so the status bar separates remote tool execution (plus the
 *     upstream queueing between calls) from generation.
 *
 * The patch sums packed delta-run delays (`dt` of `text-chunks` /
 * `reasoning-chunks` / `tool-call-chunks`) when the stream carries them, which
 * is inter-token time with all queue and TTFT gaps excluded, and falls back to
 * the wall span for unpacked streams or an all-zero gap run.
 *
 * `stateVersion` is bumped so cached projections recompute from the session log.
 *
 * Re-run after every `dsh` upgrade; the script is idempotent and exits 0 when the
 * patch is already in place.
 */
import { readFileSync, writeFileSync } from 'node:fs'

/** Marker proving the file already carries the v4 patch. */
const V4_MARKER = 'next.toolMs += Math.max(0, stepWall - ttft - decodeSpan)'

/** Marker proving the file carries the v3 (usage-classification) patch. */
const V3_MARKER = 'function streamCumulativeUsage(stream)'

/** Marker proving the file carries the superseded sum-only patch. */
const V2_MARKER = 'function streamDecodeSpan(stream, firstToken, settled)'

const HELPERS = `
/**
 * Reasoning tokens are generated inside the same decode window as output
 * tokens; count them when the provider reports them separately.
 * @param usage - one usage record.
 * @returns the reasoning-token count, or 0 when unreported or invalid.
 */
function usageReasoningTokens(usage) {
\tif (typeof usage !== "object" || usage === null) return 0;
\tconst value = usage.reasoningTokens;
\treturn typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
/**
 * Decide whether a stream's usage records are running totals of one generation
 * or independent per-call deltas.
 *
 * An adapters that accumulates (the OpenCode HTTP route re-emits the generation
 * total after every upstream step) produces a non-decreasing token sequence;
 * summing those snapshots counts the same tokens once per step. An adapter that
 * reports one record per call produces an oscillating sequence, where the sum
 * is the generation total.
 * @param stream - compact records from one durable Assistant settlement.
 * @returns true when the usage records are cumulative snapshots.
 */
function streamCumulativeUsage(stream) {
\tlet previous = null;
\tlet records = 0;
\tfor (const record of stream) {
\t\tif (record.type !== "chunk" || record.chunk?.type !== "usage") continue;
\t\tconst usage = record.chunk.usage;
\t\tconst output = usageOutputTokens(usage);
\t\tif (output === null) continue;
\t\tconst value = output + usageReasoningTokens(usage);
\t\tif (previous !== null && value < previous) return false;
\t\tprevious = value;
\t\trecords += 1;
\t}
\treturn records > 1;
}
/**
 * Generated tokens for one settled step.
 *
 * Cumulative streams keep their last snapshot (the settled message usage);
 * delta streams are summed. Streams without usage records fall back to the
 * settled message usage.
 * @param stream - compact records from one durable Assistant settlement.
 * @param usage - the assistant/message event's usage record.
 * @returns generated tokens (output + reasoning), or null when none is reported.
 */
function streamGeneratedTokens(stream, usage) {
\tconst cumulative = streamCumulativeUsage(stream);
\tlet total = 0;
\tlet last = 0;
\tlet reported = false;
\tfor (const record of stream) {
\t\tif (record.type !== "chunk" || record.chunk?.type !== "usage") continue;
\t\tconst output = usageOutputTokens(record.chunk.usage);
\t\tif (output === null) continue;
\t\treported = true;
\t\tconst value = output + usageReasoningTokens(record.chunk.usage);
\t\ttotal += value;
\t\tlast = value;
\t}
\tif (reported) return cumulative ? last : total;
\tconst output = usageOutputTokens(usage);
\treturn output === null ? null : output + usageReasoningTokens(usage);
}
/**
 * Pure generation span for one settled step.
 *
 * Packed delta runs carry per-fragment delays, so the sum of those delays is the
 * time the model spent emitting tokens, with upstream queueing and every
 * inter-call first-token wait excluded. Streams that pack nothing, or that pack
 * only zero gaps (a provider that coalesces a burst into one record), keep the
 * previous first-token → settlement wall span.
 * @param stream - compact records from one durable Assistant settlement.
 * @param firstToken - first token time already resolved for this step.
 * @param settled - assistant/message event time.
 * @returns generation milliseconds for this step.
 */
function streamDecodeSpan(stream, firstToken, settled) {
\tlet span = 0;
\tlet packed = false;
\tfor (const record of stream) {
\t\tif (record.type === "chunk") continue;
\t\tconst gaps = record.dt;
\t\tif (!Array.isArray(gaps) || gaps.length === 0) continue;
\t\tpacked = true;
\t\tfor (const gap of gaps) {
\t\t\tif (typeof gap === "number" && Number.isFinite(gap) && gap > 0) span += gap;
\t\t}
\t}
\treturn packed && span > 0 ? span : Math.max(0, settled - firstToken);
}
`

export const OLD_BLOCK = `\t\t\t\tif (firstToken !== null) {
\t\t\t\t\tnext.ttftMs += Math.max(0, firstToken - open.startTime);
\t\t\t\t\tnext.ttftSteps += 1;
\t\t\t\t\tconst outputTokens = usageOutputTokens(event.data.usage);
\t\t\t\t\tif (outputTokens !== null) {
\t\t\t\t\t\tnext.decodeMs += Math.max(0, event.time - firstToken);
\t\t\t\t\t\tnext.decodeTokens += outputTokens;
\t\t\t\t\t}
\t\t\t\t}`

export const NEW_BLOCK = `\t\t\t\tif (firstToken !== null) {
\t\t\t\t\tnext.ttftMs += Math.max(0, firstToken - open.startTime);
\t\t\t\t\tnext.ttftSteps += 1;
\t\t\t\t\tconst generatedTokens = streamGeneratedTokens(event.data.stream ?? [], event.data.usage);
\t\t\t\t\tconst decodeSpan = streamDecodeSpan(event.data.stream ?? [], firstToken, event.time);
\t\t\t\t\tif (generatedTokens !== null && decodeSpan > 0) {
\t\t\t\t\t\tnext.decodeMs += decodeSpan;
\t\t\t\t\t\tnext.decodeTokens += generatedTokens;
\t\t\t\t\t}
\t\t\t\t}`

/** The whole `assistant/message` case as the v3 patch left it. */
export const V3_BLOCK = `\t\t\tcase "assistant/message": {
\t\t\t\tconst open = state.openStep;
\t\t\t\tif (open === null || open.turn !== event.data.turn || open.step !== event.data.step) return state;
\t\t\t\tconst firstToken = open.firstTokenTime ?? assistantStreamFirstTokenTime(event.data.stream) ?? null;
\t\t\t\tconst next = {
\t\t\t\t\t...state,
\t\t\t\t\tllmMs: state.llmMs + Math.max(0, event.time - open.startTime),
\t\t\t\t\topenStep: null
\t\t\t\t};
\t\t\t\tif (firstToken !== null) {
\t\t\t\t\tnext.ttftMs += Math.max(0, firstToken - open.startTime);
\t\t\t\t\tnext.ttftSteps += 1;
\t\t\t\t\tconst generatedTokens = streamGeneratedTokens(event.data.stream ?? [], event.data.usage);
\t\t\t\t\tconst decodeSpan = streamDecodeSpan(event.data.stream ?? [], firstToken, event.time);
\t\t\t\t\tif (generatedTokens !== null && decodeSpan > 0) {
\t\t\t\t\t\tnext.decodeMs += decodeSpan;
\t\t\t\t\t\tnext.decodeTokens += generatedTokens;
\t\t\t\t\t}
\t\t\t\t}
\t\t\t\treturn next;
\t\t\t}`

/** v4: same accounting plus remote-tool attribution for provider-side agent loops. */
export const V4_BLOCK = `\t\t\tcase "assistant/message": {
\t\t\t\tconst open = state.openStep;
\t\t\t\tif (open === null || open.turn !== event.data.turn || open.step !== event.data.step) return state;
\t\t\t\tconst firstToken = open.firstTokenTime ?? assistantStreamFirstTokenTime(event.data.stream) ?? null;
\t\t\t\tconst stepWall = Math.max(0, event.time - open.startTime);
\t\t\t\tconst ttft = firstToken === null ? 0 : Math.max(0, firstToken - open.startTime);
\t\t\t\tconst next = {
\t\t\t\t\t...state,
\t\t\t\t\tllmMs: state.llmMs + stepWall,
\t\t\t\t\topenStep: null
\t\t\t\t};
\t\t\t\tlet decodeSpan = 0;
\t\t\t\tif (firstToken !== null) {
\t\t\t\t\tnext.ttftMs += ttft;
\t\t\t\t\tnext.ttftSteps += 1;
\t\t\t\t\tconst generatedTokens = streamGeneratedTokens(event.data.stream ?? [], event.data.usage);
\t\t\t\t\tdecodeSpan = streamDecodeSpan(event.data.stream ?? [], firstToken, event.time);
\t\t\t\t\tif (generatedTokens !== null && decodeSpan > 0) {
\t\t\t\t\t\tnext.decodeMs += decodeSpan;
\t\t\t\t\t\tnext.decodeTokens += generatedTokens;
\t\t\t\t\t} else {
\t\t\t\t\t\tdecodeSpan = 0;
\t\t\t\t\t}
\t\t\t\t}
\t\t\t\t// A provider that runs its own agent loop executes tools without emitting
\t\t\t\t// tool/call, so every non-generation millisecond of the step is tool or
\t\t\t\t// upstream wait. Attribute it here instead of leaving toolMs at zero.
\t\t\t\tif ((event.data.message?.source?.provider ?? "") === "opencode-http-agent") {
\t\t\t\t\tnext.toolMs += Math.max(0, stepWall - ttft - decodeSpan);
\t\t\t\t}
\t\t\t\treturn next;
\t\t\t}`

/** Superseded sum-only block from the previous revision of this patch. */
export const V2_BLOCK = `\t\t\t\tif (firstToken !== null) {
\t\t\t\t\tnext.ttftMs += Math.max(0, firstToken - open.startTime);
\t\t\t\t\tnext.ttftSteps += 1;
\t\t\t\t\tconst generatedTokens = streamGeneratedTokens(event.data.stream ?? [], event.data.usage);
\t\t\t\t\tif (generatedTokens !== null) {
\t\t\t\t\t\tnext.decodeMs += streamDecodeSpan(event.data.stream ?? [], firstToken, event.time);
\t\t\t\t\t\tnext.decodeTokens += generatedTokens;
\t\t\t\t\t}
\t\t\t\t}`

/**
 * Replace the helper block between `usageOutputTokens` and the projection
 * definition with the current helpers.
 * @param source Installed module source.
 * @returns Source carrying the current helper block.
 */
function replaceHelpers(source) {
  const anchor = 'function usageOutputTokens(usage) {'
  const at = source.indexOf(anchor)
  if (at === -1) throw new Error('usageOutputTokens not found')
  const close = source.indexOf('\n}\n', at)
  if (close === -1) throw new Error('usageOutputTokens has no closing brace')
  const end = source.indexOf('/** The `sessionStats` unit registered', close)
  if (end === -1) throw new Error('sessionStats projection definition not found')
  return source.slice(0, close + 3) + HELPERS + source.slice(end)
}

/**
 * Patch one installed copy.
 * @param path Absolute path of `dsh-session-stats/lib/index.js`.
 * @returns {boolean} true when the file changed.
 */
export function patchSessionStats(path) {
  const source = readFileSync(path, 'utf8')
  if (source.includes(V4_MARKER)) return false
  let patched
  if (source.includes(V3_BLOCK)) {
    if (!source.includes('\tstateVersion: 3,')) {
      throw new Error(`patch-session-stats: expected stateVersion 3 in ${path}`)
    }
    patched = source.replace(V3_BLOCK, V4_BLOCK).replace('\tstateVersion: 3,', '\tstateVersion: 4,')
  } else if (source.includes(V2_BLOCK)) {
    if (!source.includes('\tstateVersion: 2,')) {
      throw new Error(`patch-session-stats: expected stateVersion 2 in ${path}`)
    }
    patched = replaceHelpers(source).replace(V2_BLOCK, NEW_BLOCK).replace('\tstateVersion: 2,', '\tstateVersion: 4,')
    patched = patched.replace(V3_BLOCK, V4_BLOCK)
  } else {
    if (!source.includes(OLD_BLOCK)) {
      throw new Error(`patch-session-stats: decode block not found in ${path} (dsh layout changed?)`)
    }
    if (!source.includes('\tstateVersion: 1,')) {
      throw new Error(`patch-session-stats: expected stateVersion 1 in ${path}`)
    }
    patched = replaceHelpers(source).replace('\tstateVersion: 1,', '\tstateVersion: 4,')
    const upgraded = patched.replace(OLD_BLOCK, NEW_BLOCK).replace(V3_BLOCK, V4_BLOCK)
    if (upgraded === patched) {
      throw new Error(`patch-session-stats: assistant/message case not found in ${path}`)
    }
    patched = upgraded
  }
  writeFileSync(path, patched, 'utf8')
  return true
}


/**
 * Marker proving the token-meter patch is present.
 */
export const TOKEN_METER_MARKER = 'function requestPressureUsage(event)'

/** Helper inserted into dsh-token-meter next to `pressureFrom`. */
const TOKEN_METER_HELPER = `
/**
 * Prompt-side usage of the LAST request in one settled attempt.
 *
 * An adapter that accumulates a generation total (OpenCode's HTTP route emits
 * the running total after every internal step) makes the settled usage grow to
 * millions of prompt tokens, so a meter that reads it directly reports several
 * hundred percent of the window. The stream keeps every snapshot, so the last
 * request is the delta between the final two samples; per-call adapters keep
 * oscillating samples and fall through to the settled usage.
 * @param event - one durable Assistant settlement.
 * @returns the last request's prompt usage, or undefined when the stream is not cumulative.
 */
function requestPressureUsage(event) {
	const stream = event.data && event.data.stream;
	if (!Array.isArray(stream)) return void 0;
	const samples = [];
	for (const record of stream) {
		if (record.type !== "chunk" || record.chunk?.type !== "usage") continue;
		const usage = record.chunk.usage;
		if (usage === void 0 || usage === null) continue;
		samples.push(usage);
	}
	if (samples.length < 2) return void 0;
	for (let index = 1; index < samples.length; index += 1) {
		if (pressureFrom(samples[index]) < pressureFrom(samples[index - 1])) return void 0;
	}
	const last = samples[samples.length - 1];
	const previous = samples[samples.length - 2];
	return {
		inputTokens: Math.max(0, last.inputTokens - previous.inputTokens),
		cacheReadTokens: Math.max(0, (last.cacheReadTokens ?? 0) - (previous.cacheReadTokens ?? 0)),
		cacheWriteTokens: Math.max(0, (last.cacheWriteTokens ?? 0) - (previous.cacheWriteTokens ?? 0))
	};
}
`

/** The pressure line the stock module computes. */
const TOKEN_METER_PRESSURE_LINE = 'const pressureTokens = pressureFrom(usage);'

/** The pressure line with the last-request correction. */
const TOKEN_METER_PATCHED_LINE = 'const pressureTokens = pressureFrom(requestPressureUsage(event) ?? usage);'

/**
 * Patch one installed `dsh-token-meter` copy so the context meter reads the last
 * request's prompt size instead of a generation-cumulative total.
 * @param path Absolute path of `dsh-token-meter/lib/index.js`.
 * @returns {boolean} true when the file changed.
 */
export function patchTokenMeter(path) {
  const source = readFileSync(path, 'utf8')
  if (source.includes(TOKEN_METER_MARKER)) return false
  if (!source.includes(TOKEN_METER_PRESSURE_LINE)) {
    throw new Error(`patch-token-meter: pressure line not found in ${path} (dsh layout changed?)`)
  }
  if (!source.includes('\tstateVersion: 5,')) {
    throw new Error(`patch-token-meter: expected contextPressure stateVersion 5 in ${path}`)
  }
  const anchor = 'const pressureFrom = (usage) => usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);'
  if (!source.includes(anchor)) {
    throw new Error(`patch-token-meter: pressureFrom not found in ${path}`)
  }
  let patched = source.replace(anchor, anchor + TOKEN_METER_HELPER)
  patched = patched.replace(TOKEN_METER_PRESSURE_LINE, TOKEN_METER_PATCHED_LINE)
  patched = patched.replace('\tstateVersion: 5,', '\tstateVersion: 6,')
  writeFileSync(path, patched, 'utf8')
  return true
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const roots = process.argv.slice(2)
  if (roots.length === 0) {
    console.error('usage: node patch-session-stats.mjs <dsh-install-root>...')
    process.exit(2)
  }
  for (const root of roots) {
    const statsTarget = root.endsWith('.js') ? root : `${root}/node_modules/@deepseek-ai/dsh-session-stats/lib/index.js`
    const meterTarget = root.endsWith('.js') ? root : `${root}/node_modules/@deepseek-ai/dsh-token-meter/lib/index.js`
    try {
      const changed = patchSessionStats(statsTarget)
      console.log(`${changed ? 'patched' : 'already patched'}: ${statsTarget}`)
      if (!root.endsWith('.js')) {
        const meterChanged = patchTokenMeter(meterTarget)
        console.log(`${meterChanged ? 'patched' : 'already patched'}: ${meterTarget}`)
      }
    } catch (error) {
      console.error(String(error.message ?? error))
      process.exit(1)
    }
  }
}
