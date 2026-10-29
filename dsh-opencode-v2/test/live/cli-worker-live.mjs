/**
 * Live end-to-end check of the built-in `cli_worker` tool definition:
 * the real `opencode` binary, the real argv/stdin/parse/artifact path, and the
 * schema produced by `defineTool`. Only `ctx.subprocess` is a local shim, so
 * no DSH host is disturbed.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Config } from '../../lib/index.js'
import { registerCliWorker } from '../../lib/workers/index.js'

/** Faithful `ctx.subprocess` shim for one spawn. */
const subprocess = {
  async resolveExecutable(command) {
    return command
  },
  spawn(spec) {
    const child = spawn(spec.argv[0], spec.argv.slice(1), {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const cap = (stream) => {
      let text = ''
      let lossy = false
      const limit = 1 << 20
      stream.on('data', (chunk) => {
        text += chunk
        if (text.length > limit) {
          text = text.slice(-limit)
          lossy = true
        }
      })
      return () => ({ text, nextOffset: text.length, lossy })
    }
    const out = cap(child.stdout)
    const err = cap(child.stderr)
    const done = new Promise((resolve) => {
      child.on('close', (exitCode, signal) => resolve({ exitCode, signal }))
    })
    spec.signal?.addEventListener('abort', () => child.kill('SIGKILL'), { once: true })
    return {
      stdin: child.stdin,
      done,
      collected: { stdout: { readFrom: out }, stderr: { readFrom: err } },
    }
  },
}

const cwd = await mkdtemp(join(tmpdir(), 'cli-worker-live-'))
const config = new Config({
  opencodePath: '/home/minami/.bun/bin/opencode',
  workerTimeoutMs: 300000,
  workerMaxOutputBytes: 262144,
  workerArtifactLimit: 10,
})

const registered = []
const ctx = {
  tools: { register: (definition) => registered.push(definition) },
  inject: () => {},
  subprocess,
}
await registerCliWorker(ctx, config)
const tool = registered.find((definition) => definition.name === 'cli_worker')
if (!tool) throw new Error('cli_worker was not registered')

const backend = process.env.WORKER_BACKEND ?? 'opencode'
const model = process.env.WORKER_MODEL ?? 'opencode-go/deepseek-v4.1-flash'
const task = (process.env.WORKER_TASK ??
  'Create a file named report.txt in the current directory containing exactly the text worker-ok followed by a newline. Then reply with exactly: DONE'
).replaceAll('{cwd}', cwd)

const args = {
  backend,
  task,
  cwd,
  model,
  collect: ['*.txt'],
}

const startedAt = Date.now()
const controller = new AbortController()
const value = await tool.execute(args, { signal: controller.signal })
const elapsed = Date.now() - startedAt

const rendered = tool.output.render(args, value)
const onDisk = await readFile(join(cwd, 'report.txt'), 'utf8').catch(() => null)

console.log(
  JSON.stringify(
    {
      elapsedMs: elapsed,
      value: { ...value, summary: value.summary.slice(0, 400) },
      rendered: rendered.map((part) => part.text).join('\n').slice(0, 900),
      reportText: onDisk,
    },
    null,
    2,
  ),
)
await rm(cwd, { recursive: true, force: true })
