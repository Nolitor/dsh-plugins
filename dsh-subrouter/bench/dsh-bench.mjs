#!/usr/bin/env node
/**
 * Route benchmark for DeepSeek Harness.
 *
 * Every run boots an isolated `dsh headless` process pinned to one provider
 * route through a temporary patch overlay, sends the same prompt, and reads the
 * resulting session log. The harness never edits a profile.
 *
 * What it measures per route, from the session log and wall clock:
 *   - wall time and step count for the whole task
 *   - time to first tool call (proxy for TTFT + first decision)
 *   - tool/call and tool/result counts (harness ownership of execution)
 *   - tool-event fidelity: results per call, matching call ids
 *   - usage accounting: input/output/cache tokens reported by the adapter
 *   - failure rate and the finish reason
 *   - tiering/dedup/liveness counters from tokeneconomizer diagnostics
 *
 * Usage:
 *   node dsh-subrouter/bench/dsh-bench.mjs --routes deepseek-account/deepseek-flash,subrouter-openai/deepseek-v4.1-flash
 *   node dsh-subrouter/bench/dsh-bench.mjs --routes ... --runs 3 --json out.json
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const DSH = process.env.DSH_BIN || join(homedir(), '.local/bin/dsh')
/**
 * Benchmark profile. `ensureProfile()` creates it once from the shipped
 * headless template plus the same model/protocol plugins the web profile uses,
 * so a route can be compared without editing the live profile.
 */
const PROFILE = process.env.DSH_BENCH_PROFILE || 'bench'
const PATCH = join(HERE, 'routes.patch.yml')
const WORK = join(HERE, '.work')

/** Everything the module needs to stay importable for tests. */
export const BENCH = Object.freeze({ here: HERE, dsh: DSH, profile: PROFILE, patch: PATCH, work: WORK })

/** Default prompt: forces two tool calls and one short answer. */
export const DEFAULT_TASK = [
  'Use bash exactly once to write the exact text bench-ok to bench-proof.txt,',
  'then use read exactly once to read it back.',
  'Reply with only the text from the file.',
].join(' ')

function parseArgs(argv) {
  const args = { runs: 3, routes: [], task: DEFAULT_TASK, json: '', keep: false }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === '--routes') { args.routes = String(value).split(',').map((part) => part.trim()).filter(Boolean); index += 1 }
    else if (flag === '--runs') { args.runs = Number(value); index += 1 }
    else if (flag === '--task') { args.task = String(value); index += 1 }
    else if (flag === '--json') { args.json = String(value); index += 1 }
    else if (flag === '--keep') { args.keep = true }
    else if (flag === '--help') { console.log('--routes a/b,c/d [--runs 3] [--task text] [--json out.json] [--keep]'); process.exit(0) }
  }
  if (!args.routes.length) throw new Error('--routes is required, e.g. deepseek-account/deepseek-flash')
  for (const route of args.routes) {
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._:#-]+$/.test(route)) throw new Error(`invalid route "${route}"`)
  }
  return args
}

/** Create the isolated benchmark profile from the shipped headless template. */
export function ensureProfile() {
  const dir = join(homedir(), '.dsh', 'profiles', PROFILE)
  mkdirSync(dir, { recursive: true })
  const pkg = join(dir, 'package.json')
  try {
    readFileSync(pkg)
  } catch {
    execFileSync(DSH, ['--from-default-profile', 'headless', '--profile', PROFILE, '--dump-config'], { stdio: 'ignore' })
  }
  writeFileSync(pkg, `${JSON.stringify({
    name: `dsh-profile-${PROFILE}`,
    private: true,
    dependencies: {
      '@nolit/dsh-subrouter': `link:${resolve(HERE, '..')}`,
      '@nolit/dsh-tokeneconomizer': `link:${resolve(HERE, '..', '..', 'dsh-tokeneconomizer')}`,
    },
    dsh: {
      profile: {
        bundles: [
          '@deepseek-ai/dsh-base',
          '@deepseek-ai/dsh-headless',
          '@nolit/dsh-subrouter',
          '@nolit/dsh-tokeneconomizer',
        ],
      },
    },
  }, null, 2)}\n`)
  const modules = join(dir, 'node_modules', '@nolit')
  mkdirSync(modules, { recursive: true })
  const links = {
    '@nolit/dsh-subrouter': resolve(HERE, '..'),
    '@nolit/dsh-tokeneconomizer': resolve(HERE, '..', '..', 'dsh-tokeneconomizer'),
  }
  for (const [name, target] of Object.entries(links)) {
    const link = join(modules, name.replace('@nolit/', ''))
    rmSync(link, { recursive: true, force: true })
    try { execFileSync('ln', ['-sfn', target, link]) } catch { /* windows */ }
  }
  return dir
}

/**
 * Environment for a benchmark run.
 *
 * The `bench` profile is booted through `headless`, which mounts no credentials
 * service, so provider keys are injected the way a shell export would be. The
 * credential file is read here only to avoid a manual export in the caller.
 */
export function benchEnv(teHome) {
  const env = { ...process.env, TE_DIAG: '1', TOKENECONOMIZER_HOME: teHome }
  if (!env.OPENCODE_API_KEY || !env.DEEPSEEK_API_KEY) {
    try {
      const text = readFileSync(join(homedir(), '.dsh', '.credentials.yaml'), 'utf8')
      for (const [name, value] of Object.entries(readSimpleRefs(text))) {
        if (!env[name] && value) env[name] = value
      }
    } catch {
      /* a missing credential file leaves the provider unauthenticated */
    }
  }
  return env
}

/** Read the `refs:` block of the credentials file without a YAML dependency. */
function readSimpleRefs(text) {
  const refs = {}
  let inside = false
  for (const line of text.split('\n')) {
    if (/^refs:\s*$/.test(line)) { inside = true; continue }
    if (inside && /^\S/.test(line)) break
    const match = /^\s{2}([A-Z0-9_]+):\s*(.+?)\s*$/.exec(line)
    if (inside && match) refs[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return refs
}

/**
 * DSH's session directory name for a working directory. The leading separator
 * becomes a literal `-`, so `/a/b` is `--a-b--` once the `--` decorators are
 * applied.
 */
export function cwdSessionKey(cwd) {
  return `--${String(cwd).replace(/^[/\\]/, '').replace(/[/\\]/g, '-')}--`
}

function writeRoutePatch(route) {
  const [provider, model] = route.split('/')
  writeFileSync(PATCH, `- id: agent-default-model\n  config:\n    provider: ${provider}\n    model: ${model}\n`)
}

/** Read one zstd session log through the `zstdcat` on PATH. */
function readSessionLog(file) {
  const text = execFileSync('zstdcat', [file], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8')
  return text.trim().split('\n').map((line) => JSON.parse(line))
}

function findSessionFile(root) {
  let out = ''
  try {
    out = execFileSync('find', [root, '-name', 'session.v4.jsonl.zstd', '-print'], { encoding: 'utf8' })
  } catch {
    return undefined
  }
  return out.trim().split('\n').filter(Boolean).sort().at(-1)
}

function summarize(events) {
  const counts = {}
  for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1
  const calls = events.filter((event) => event.type === 'tool/call')
  const results = events.filter((event) => event.type === 'tool/result')
  const header = events.find((event) => event.type === 'request/header')
  const turnStart = events.find((event) => event.type === 'turn/start')
  const end = events.find((event) => event.type === 'turn/end')
  const firstCall = calls[0]
  const usages = events
    .filter((event) => event.type === 'assistant/message')
    .map((event) => event.data?.usage ?? event.data?.message?.usage)
    .filter(Boolean)
  const sum = (list, key) => list.reduce((total, usage) => total + (Number(usage?.[key]) || 0), 0)
  const callIds = new Set(calls.map((event) => String(event.data.callId)))
  const resultIds = new Set(results.map((event) => String(event.data?.message?.source?.callId ?? event.data?.callId)))
  const matched = [...callIds].filter((id) => resultIds.has(id)).length
  return {
    provider: header?.data?.header?.config?.provider ?? null,
    model: header?.data?.header?.config?.model ?? null,
    toolsOffered: header?.data?.header?.tools?.length ?? 0,
    steps: counts['step/start'] ?? 0,
    toolCalls: calls.length,
    toolResults: results.length,
    matchedCallIds: matched,
    toolNames: [...new Set(calls.map((event) => event.data.name))],
    resultBytes: results.reduce((total, event) => total + JSON.stringify(event.data ?? {}).length, 0),
    usage: {
      inputTokens: sum(usages, 'inputTokens'),
      outputTokens: sum(usages, 'outputTokens'),
      cacheReadTokens: sum(usages, 'cacheReadTokens'),
      cacheWriteTokens: sum(usages, 'cacheWriteTokens'),
      totalTokens: sum(usages, 'totalTokens'),
    },
    finish: end?.data?.reason?.kind ?? null,
    ttftToolCallMs: firstCall && turnStart ? firstCall.time - turnStart.time : null,
    durationMs: end && turnStart ? end.time - turnStart.time : null,
    approvals: events.filter((event) => event.type === 'approval/policy').map((event) => event.data.policy),
  }
}

async function runOnce(route, args, index) {
  const runDir = join(WORK, `${route.replace(/[/:]/g, '_')}-run${index + 1}`)
  rmSync(runDir, { recursive: true, force: true })
  mkdirSync(runDir, { recursive: true })
  const teHome = join(runDir, 'te')
  mkdirSync(teHome, { recursive: true })

  writeRoutePatch(route)
  const started = Date.now()
  const child = spawn(DSH, [
    '--profile', PROFILE,
    '--patch', PATCH,
    'headless',
    '--permission-mode', 'workspace-write',
    '--approval-policy', 'never',
    args.task,
  ], {
    cwd: runDir,
    env: benchEnv(teHome),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const exitCode = await new Promise((resolve) => child.on('close', resolve))
  const wallMs = Date.now() - started

  const sessionRoot = join(homedir(), '.dsh', 'sessions', cwdSessionKey(runDir))
  let summary = null
  let logError = null
  let sessionFile = null
  try {
    sessionFile = findSessionFile(sessionRoot)
    if (sessionFile) summary = summarize(readSessionLog(sessionFile))
  } catch (error) {
    logError = error instanceof Error ? error.message : String(error)
  }
  let diagnostics = null
  try {
    diagnostics = JSON.parse(readFileSync(join(teHome, 'diagnostics.json'), 'utf8'))
  } catch {
    /* diagnostics are optional */
  }

  return {
    route,
    run: index + 1,
    exitCode,
    wallMs,
    answer: stdout.trim(),
    proof: (() => {
      try { return readFileSync(join(runDir, 'bench-proof.txt'), 'utf8') } catch { return null }
    })(),
    stderrTail: stderr.trim().split('\n').slice(-6).join('\n'),
    logError,
    sessionFile,
    diagnostics,
    ...(summary ?? {}),
  }
}

function median(values) {
  const list = values.filter((value) => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b)
  if (!list.length) return null
  const middle = Math.floor(list.length / 2)
  return list.length % 2 ? list[middle] : Math.round((list[middle - 1] + list[middle]) / 2)
}

function aggregate(runs) {
  const ok = runs.filter((run) => run.exitCode === 0 && run.toolCalls > 0 && run.matchedCallIds === run.toolCalls)
  return {
    runs: runs.length,
    ok: ok.length,
    okRate: runs.length ? ok.length / runs.length : 0,
    wallMs: { min: Math.min(...runs.map((run) => run.wallMs)), median: median(runs.map((run) => run.wallMs)) },
    ttftToolCallMs: median(runs.map((run) => run.ttftToolCallMs)),
    steps: median(runs.map((run) => run.steps)),
    toolCalls: median(runs.map((run) => run.toolCalls)),
    toolResults: median(runs.map((run) => run.toolResults)),
    matchedCallIds: median(runs.map((run) => run.matchedCallIds)),
    inputTokens: median(runs.map((run) => run.usage?.inputTokens)),
    outputTokens: median(runs.map((run) => run.usage?.outputTokens)),
    cacheReadTokens: median(runs.map((run) => run.usage?.cacheReadTokens)),
    errors: runs.filter((run) => run.exitCode !== 0).length,
    finishes: [...new Set(runs.map((run) => run.finish))],
  }
}

function render(byRoute) {
  const rows = []
  for (const [route, runs] of Object.entries(byRoute)) {
    const stats = aggregate(runs)
    rows.push({
      route,
      ok: `${stats.ok}/${stats.runs}`,
      wallMs: stats.wallMs.median ?? '-',
      ttftToolMs: stats.ttftToolCallMs ?? '-',
      steps: stats.steps ?? '-',
      calls: stats.toolCalls ?? '-',
      results: stats.toolResults ?? '-',
      matched: stats.matchedCallIds ?? '-',
      inTok: stats.inputTokens ?? '-',
      outTok: stats.outputTokens ?? '-',
      cacheTok: stats.cacheReadTokens ?? '-',
      finish: stats.finishes.join(','),
    })
  }
  const columns = Object.keys(rows[0] ?? { route: '' })
  const widths = columns.map((column) => Math.max(column.length, ...rows.map((row) => String(row[column]).length)))
  const line = (cells) => cells.map((cell, index) => String(cell).padEnd(widths[index])).join('  ')
  return [line(columns), widths.map((width) => '-'.repeat(width)).join('  '), ...rows.map((row) => line(columns.map((column) => row[column])))]
    .join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  ensureProfile()
  mkdirSync(WORK, { recursive: true })
  const byRoute = {}
  const all = []
  for (const route of args.routes) {
    byRoute[route] = []
    for (let index = 0; index < args.runs; index += 1) {
      process.stderr.write(`[bench] ${route} run ${index + 1}/${args.runs}\n`)
      let run
      try {
        run = await runOnce(route, args, index)
      } catch (error) {
        run = { route, run: index + 1, exitCode: -1, wallMs: 0, toolCalls: 0, matchedCallIds: 0, stderrTail: String(error) }
      }
      byRoute[route].push(run)
      all.push(run)
      process.stderr.write(`[bench]   exit=${run.exitCode} wall=${run.wallMs}ms calls=${run.toolCalls ?? 0} results=${run.toolResults ?? 0}\n`)
    }
  }

  const table = render(byRoute)
  console.log(`\n=== DSH route benchmark (${args.runs} run(s) per route) ===\n`)
  console.log(table)
  console.log('\n=== per-run detail ===')
  for (const run of all) {
    console.log(JSON.stringify({
      route: run.route,
      run: run.run,
      exit: run.exitCode,
      answer: run.answer,
      proof: run.proof,
      finish: run.finish,
      errors: run.exitCode === 0 ? undefined : run.stderrTail,
    }))
  }

  const report = {
    generatedAt: new Date().toISOString(),
    profile: PROFILE,
    task: args.task,
    routes: args.routes.map((route) => ({ route, stats: aggregate(byRoute[route]), runs: byRoute[route] })),
  }
  if (args.json) {
    writeFileSync(resolve(args.json), `${JSON.stringify(report, null, 2)}\n`)
    console.log(`\nJSON written to ${resolve(args.json)}`)
  }
  if (!args.keep) rmSync(WORK, { recursive: true, force: true })
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`dsh-bench: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}
