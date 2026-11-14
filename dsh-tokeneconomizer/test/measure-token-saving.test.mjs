/**
 * Regression: the token-saving measurement must count a rewritten tool result by
 * its surface structure (`surfaceOp.op === 'replace'` paired with a
 * `compaction/prune`), never by whether the text quotes the pruner's marker.
 *
 * The live corpus (334 sessions, 328,119 events) proved the marker string
 * 'tool result middle pruned' also appears in 225 tool results that are the
 * user's own grep/bash echo of the marker — counting those under-reported the
 * real rewrites by 88.6%. These tests pin the corrected behaviour with a
 * fixture home, so the fix cannot regress without this suite going red.
 *
 * The script itself is a side-effecting CLI that scans a live home, so it is
 * never imported here: the fixture is a throwaway DSH_HOME and the script runs
 * as a child process against it. The live home is never touched: DSH_HOME and
 * TOKENECONOMIZER_HOME both point inside the throwaway directory.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { zstdCompressSync } from 'node:zlib'

const run = promisify(execFile)
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'measure-token-saving.mjs')
const MARKER = 'tool result middle pruned'

/** A tool output long enough to be an ordinary, non-duplicate result. */
function body (seed) {
  return `step ${seed}: ` + ('x'.repeat(90) + ` ${seed} `).repeat(3)
}

/** One event in the fake session log, shaped like the harness's own v4 log. */
function event (type, seq, extra = {}) {
  return { type, seq, time: 1730000000000 + seq, ...extra }
}

/** A request event carrying usage, so the corpus section has something to count. */
function requestEvent (seq, prompt) {
  return event('assistant/message', seq, {
    data: {
      usage: { inputTokens: prompt, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 4 },
      message: { source: { provider: 'fixture', model: 'test-model' } },
    },
  })
}

/** The pruner's own compaction/prune event, shaped as measured on the live corpus. */
function pruneEvent (seq, shadowed) {
  return event('compaction/prune', seq, {
    data: { shadowedRange: { start: shadowed, end: shadowed }, shadowedSeqs: [shadowed], shadowedTokenCount: 400 },
  })
}

/** A tool/result event; surfaceOp is the harness's rewrite record when present. */
function resultEvent (seq, text, surfaceOp) {
  const extra = surfaceOp === undefined ? {} : { surfaceOp }
  return event('tool/result', seq, {
    data: {
      message: {
        role: 'tool',
        toolCallId: `call_${seq}`,
        content: [{ type: 'text', text }],
        isError: false,
      },
    },
    ...extra,
  })
}

/**
 * The fixture sessions:
 *
 *  - session A: 3 true rewrites (each `surfaceOp: { op: 'replace' }` paired with
 *    its own `compaction/prune`), one of which carries the marker in its text;
 *    plus the three traps: the echo, the string surfaceOp, the plain result.
 *  - session B: only a plain result, so per-session sums stay honest.
 *
 * So the true rewrite count is exactly 3, and every wrong way of counting
 * misses it: marker-only gives 2, marker+structure gives 4, structure that
 * trusts a string surfaceOp or the echo gives 4.
 */
function writeFixture (home) {
  const sessionA = [
    event('session', 1, { id: 'session-fixture-a', origin: 'fixture' }),
    requestEvent(2, 500),
    // Case 1 — three true rewrites, structure over text.
    pruneEvent(3, 30),
    resultEvent(4, body(1), { op: 'replace', startSeq: 3, endSeq: 3 }),
    pruneEvent(5, 32),
    resultEvent(6, body(2), { op: 'replace', startSeq: 5, endSeq: 5 }),
    pruneEvent(7, 34),
    // A true rewrite may legitimately carry the marker in its rewritten text:
    // it is one rewrite, not two.
    resultEvent(8, `${body(3)} — [pruner] ${MARKER} (kept for the record)`, { op: 'replace', startSeq: 7, endSeq: 7 }),
    // Case 2 — the echo: the user grepped the marker; no surfaceOp at all.
    resultEvent(9, `$ grep -rn '${MARKER}' .\n${body(4)}\nno matches found for the middle of it, only the quoted marker: ${MARKER}`),
    // Case 2b — a string surfaceOp ('append') is not a rewrite.
    resultEvent(10, body(5), 'append'),
    // Case 3 — an ordinary result: no marker, no surfaceOp.
    resultEvent(11, body(6)),
  ]
  const sessionB = [
    event('session', 1, { id: 'session-fixture-b', origin: 'fixture' }),
    requestEvent(2, 300),
    resultEvent(3, body(7)),
  ]
  for (const [project, id, events] of [
    ['fixture-project', 'session-fixture-a', sessionA],
    ['fixture-project', 'session-fixture-b', sessionB],
  ]) {
    const dir = join(home, 'sessions', project, id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(events.map((e) => JSON.stringify(e)).join('\n') + '\n')))
  }
}

/** The measured rewrite count, read without marrying the script's output format. */
function extractCount (report, stdout) {
  // Preferred: the --json report, under any of the names the fix may choose.
  const paths = [
    ['corpus', 'prunedResults'], ['corpus', 'rewrites'], ['corpus', 'surfaceRewrites'],
    ['corpus', 'replacedResults'], ['rewrites'], ['surfaceRewrites'], ['prunedResults'],
  ]
  for (const path of paths) {
    let value = report
    for (const key of path) value = value && typeof value === 'object' ? value[key] : undefined
    if (typeof value === 'number') return value
  }
  // Fallback: the human stdout line, by meaning rather than by exact wording.
  for (const pattern of [/pruned\s+([\d,]+)/, /rewrit\w*\s*[:=]?\s*([\d,]+)/i]) {
    const match = stdout.match(pattern)
    if (match) return parseInt(match[1].replace(/,/g, ''), 10)
  }
  return undefined
}

test('rewrites are counted by surface structure, not by the quoted marker', async () => {
  const root = mkdtempSync(join(tmpdir(), 'te-measure-'))
  const dshHome = join(root, 'dsh')
  const teHome = join(root, 'tokeneconomizer')
  const jsonPath = join(root, 'report.json')
  try {
    writeFixture(dshHome)
    const { stdout } = await run(process.execPath, [SCRIPT, '--json', jsonPath], {
      cwd: root,
      env: { ...process.env, DSH_HOME: dshHome, TOKENECONOMIZER_HOME: teHome },
      timeout: 30000,
    })
    let report = {}
    try { report = JSON.parse(readFileSync(jsonPath, 'utf8')) } catch { /* the stdout fallback still applies */ }
    const counted = extractCount(report, stdout)
    assert.notEqual(counted, undefined, `the rewrite count is not extractable from the report or stdout:\n${stdout}`)
    assert.equal(counted, 3, `expected exactly the 3 fixture rewrites, got ${counted}. ` +
      'A marker-only count gives 2 (echo + the one rewrite carrying the marker); ' +
      'a count that also trusts the string surfaceOp or the echo gives 4.')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
