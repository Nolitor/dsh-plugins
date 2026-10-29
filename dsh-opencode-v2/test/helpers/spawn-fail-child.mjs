/**
 * Child process used by the P0-2 regression test.
 *
 * Runs the plugin's real `stream()` against a subprocess seam whose `done`
 * rejects (exactly what a failed spawn produces), then prints the chunk types.
 * If the adapter attaches its rejection handler too late, Node kills this
 * process with a nonzero code before it can print — which is precisely the
 * host's fail-loud behavior. Running out-of-process is the only way to observe
 * that: an in-process `unhandledRejection` listener changes the semantics.
 */
import { OpencodeLlmAdapter } from '../../lib/provider.js'

const get = (v) => ({ get: () => v })
const config = {
  opencodePath: get('opencode'),
  auto: get(true),
  thinking: get(true),
  cwd: get('/tmp'),
  timeoutMs: get(60000),
  stderrMaxBytes: get(65536),
  forwardEnv: get([]),
  extraArgs: get([]),
  models: get([]),
  brief: get('brief'),
  localSessionTitles: get(false),
  autoDiscoverModels: get(false),
  exportTimeoutMs: get(0),
}

const ctx = {
  subprocess: {
    async resolveExecutable() {
      return '/fake/opencode'
    },
    spawn() {
      return {
        collected: {
          stdout: { readFrom: () => ({ text: '' }) },
          stderr: { readFrom: () => ({ text: '' }) },
        },
        // The defect trigger: a rejected settlement promise.
        done: Promise.reject(new Error('spawn ENOENT')),
        // Yield after a macrotask so the rejection is observed first.
        stdout: (async function* () {
          await new Promise((resolve) => setTimeout(resolve, 1))
        })(),
        terminate() {},
        waitForExit: async () => true,
      }
    },
  },
}

const adapter = new OpencodeLlmAdapter(ctx, config)
const chunks = []
for await (const chunk of adapter.stream({
  provider: 'opencode-agent',
  model: 'default',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
})) {
  chunks.push(chunk)
}
const last = chunks.at(-1)
process.stdout.write(
  JSON.stringify({
    types: chunks.map((c) => c.type),
    finishKind: last?.type === 'finish' ? last.reason.kind : null,
    code: last?.type === 'finish' ? last.reason.failure?.code ?? null : null,
  }),
)
