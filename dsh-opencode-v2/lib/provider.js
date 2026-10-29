/**
 * The `opencode-agent` LLM route for OpenCode v2.2.0.
 *
 * Diff vs @quonaro/dsh-plugin-opencode/lib/provider.js:
 *   - v2 argv (no --attach/--pure, `--thinking` on) via shared.js.
 *   - TRUE streaming of reasoning: `reasoning` events stream as
 *     `reasoning-delta` on their OWN block index (host contract
 *     StreamChunk, @deepseek-ai/dsh-llm types.d.ts:429).
 *   - `usage` comes from `opencode session export <sid>`; when that fails the
 *     chunk is OMITTED rather than filled with a characters/4 guess.
 *   - `exportTimeoutMs` bounds the post-run usage fetch.
 *
 * The adapter is duck-typed against the documented LlmAdapter surface (the
 * registry validates behavior, not inheritance), so this module carries no
 * runtime import of @deepseek-ai/dsh-llm.
 */
import Schema from '@deepseek-ai/schemastery'

import { JsonRunParser, buildRunArgv, fetchUsage, forwardedEnv, modelsFromCliOutput, stripUnsupportedFlags } from './shared.js'

/** Plugin name; the cordis.patch.yml row uses the `@nolit/dsh-opencode-v2/provider` specifier. */
export const name = 'dsh-opencode-v2-provider'

/** Services this plugin needs: the llm adapter registry and a subprocess provider. */
export const inject = ['llm', 'subprocess']

const FORWARD_ENV_DEFAULT = [
  'PATH',
  'HOME',
  'USER',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'OPENCODE_CONFIG',
  'OPENCODE_SERVER_USERNAME',
  'OPENCODE_SERVER_PASSWORD',
]

/** Schemastery schema: defaults live here; cordis.yml and GUI edits are validated against it. */
export const Config = Schema.object({
  opencodePath: Schema.string().default('opencode').volatile(),
  auto: Schema.boolean().default(true).volatile(),
  // Legacy @quonaro 0.1.x keys: accepted so old rows load, never emitted.
  attach: Schema.string().default('').volatile(),
  pure: Schema.boolean().default(false).volatile(),
  thinking: Schema.boolean().default(true).volatile(),
  cwd: Schema.string().default('').volatile(),
  timeoutMs: Schema.number().default(1800000).volatile(),
  stderrMaxBytes: Schema.number().default(65536).volatile(),
  forwardEnv: Schema.array(Schema.string()).default(FORWARD_ENV_DEFAULT).volatile(),
  extraArgs: Schema.array(Schema.string()).default([]).volatile(),
  models: Schema.array(
    Schema.object({
      id: Schema.string(),
      opencodeModel: Schema.string().default(''),
      name: Schema.string().default(''),
    }),
  )
    .default([{ id: 'default', opencodeModel: '', name: 'OpenCode (config default)' }])
    .volatile(),
  brief: Schema.string()
    .default(
      'You are OpenCode, an autonomous software-engineering agent, invoked as the model backend of another agent harness. The transcript of the calling conversation is below. Carry out the most recent user request end-to-end using your own tools and judgment. Do not ask questions — act autonomously. Your final printed answer is returned verbatim as the model\'s reply.',
    )
    .volatile(),
  localSessionTitles: Schema.boolean().default(true).volatile(),
  autoDiscoverModels: Schema.boolean().default(true).volatile(),
  discoveryTimeoutMs: Schema.number().default(60000).volatile(),
  discoveryCacheMs: Schema.number().default(300000).volatile(),
  /** Budget for the post-run `session export` usage fetch; 0 disables it. */
  exportTimeoutMs: Schema.number().default(60000).volatile(),
})

const ROLE_LABEL = {
  system: 'system',
  developer: 'developer',
  user: 'user',
  assistant: 'assistant',
  tool: 'tool result',
}

/** Project one message's blocks into transcript text. */
export function blocksToText(blocks) {
  return (blocks ?? [])
    .map((block) => {
      switch (block.type) {
        case 'text':
          return block.text
        case 'reasoning':
          return `<thinking>\n${block.text}\n</thinking>`
        case 'tool-call':
          return `[tool call ${block.name} #${block.id}]: ${block.arguments}`
        case 'image':
          return '[image]'
        case 'file':
          return '[file]'
        case 'tool-addition':
          return `[tool enabled: ${block.toolName}]`
        case 'tool-removal':
          return `[tool disabled: ${block.toolName}]`
        default:
          return `[${block.type}]`
      }
    })
    .join('\n')
}

/** Flatten one generation request into the prompt handed to `opencode run`. */
export function buildPrompt(options, brief) {
  const parts = [brief, '', '<transcript>']
  if (options.system) parts.push('## system', options.system, '')
  for (const message of options.messages) {
    parts.push(`## ${ROLE_LABEL[message.role] ?? message.role}`, blocksToText(message.content), '')
  }
  parts.push('</transcript>')
  if (options.tools?.length) {
    const names = options.tools
      .map((tool) => tool.name)
      .slice(0, 12)
      .join(', ')
    parts.push(
      '',
      `[note: the caller declared ${options.tools.length} of its own tools (${names}${options.tools.length > 12 ? ', …' : ''}) — you cannot invoke them; complete the work with your own capabilities.]`,
    )
  }
  return parts.join('\n')
}

/**
 * Map an advertised route id to its `-m` value.
 * A route missing from the table passes through verbatim; the literal
 * `default` maps to `''` only when the table's `default` entry says so.
 */
export function resolveOpencodeModel(routeId, table) {
  const entry = (table ?? []).find((m) => m.id === routeId)
  if (entry) return entry.opencodeModel
  return routeId === 'default' ? '' : routeId
}

/**
 * Prefix the host wraps session-title requests in (`dsh-session-title-llm`
 * `frameMessages`): the actual human messages sit inside a JSON payload.
 */
const TITLE_FRAME_PREFIX = 'Generate the session title from this JSON array of human messages:'

/**
 * Source text for a cheap local session title: the last user message, with the
 * host's title-request JSON framing unwrapped to the first framed human message.
 */
export function sessionTitleText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'user') continue
    const raw = blocksToText(message.content)
    const at = raw.indexOf(TITLE_FRAME_PREFIX)
    if (at === -1) return raw.replace(/\s+/g, ' ').trim() || 'OpenCode session'
    try {
      const items = JSON.parse(raw.slice(at + TITLE_FRAME_PREFIX.length))
      if (Array.isArray(items)) {
        for (const item of items) {
          if (!item) continue
          const text = (
            typeof item.text === 'string' ? item.text : Array.isArray(item.content) ? blocksToText(item.content) : ''
          )
            .replace(/\s+/g, ' ')
            .trim()
          if (text) return text
        }
      }
    } catch {
      /* fall through */
    }
    return 'OpenCode session'
  }
  return 'OpenCode session'
}

/** Discover the model catalog by listing `opencode models`. */
export async function discoverModels(ctx, opts) {
  const env = forwardedEnv(opts.envNames)
  const executable = await ctx.subprocess.resolveExecutable(opts.opencodePath, env, opts.signal)
  const timeout = AbortSignal.timeout(opts.timeoutMs)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
  const handle = ctx.subprocess.spawn({
    argv: [executable, 'models'],
    cwd: opts.cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 4194304 },
      stderr: { maxBytes: opts.stderrMaxBytes ?? 65536 },
    },
    graceMs: 5000,
    signal,
    env,
  })
  try {
    if ((await handle.done).exitCode !== 0) return null
    return modelsFromCliOutput(handle.collected.stdout?.readFrom(0).text ?? '')
  } catch {
    return null
  } finally {
    handle.terminate()
    await handle.waitForExit(AbortSignal.timeout(6000)).catch(() => false)
  }
}

/** Block index for reasoning. Text owns index 0; reasoning must differ. */
export const REASONING_INDEX = 1

/**
 * Turn an ordered parser event list into block lifecycle chunks.
 *
 * Reasoning and text each own a block index (text=0, reasoning=1). An index is
 * opened on first use and closed by `closeBlocks()` once the part family ends,
 * so reasoning-then-text yields start(1)…end(1) then start(0)…end(0).
 *
 * @param {readonly {kind: 'text'|'reasoning', partId: string, delta: string}[]} events
 * @param {Map<number, {type: string, text: string, closed: boolean}>} state
 *   shared across calls when streaming incrementally; fresh for a one-shot call
 * @returns {object[]} start/delta chunks only (no block-end)
 */
export function eventsToChunks(events, state = new Map()) {
  const chunks = []
  for (const event of events) {
    const index = event.kind === 'reasoning' ? REASONING_INDEX : 0
    const blockType = event.kind === 'reasoning' ? 'reasoning' : 'text'
    const existing = state.get(index)
    if (existing?.closed) throw new Error(`opencode stream reopened closed block index ${index}`)
    if (!existing) state.set(index, { type: blockType, text: '', closed: false })
    const block = state.get(index)
    if (block.type !== blockType) throw new Error(`block index ${index} reused for ${blockType}`)
    if (!existing) chunks.push({ type: 'block-start', index, blockType })
    block.text += event.delta
    chunks.push({ type: event.kind === 'reasoning' ? 'reasoning-delta' : 'text-delta', index, text: event.delta })
  }
  return chunks
}

/**
 * Close every open block index in first-seen order. Idempotent.
 * @param {Map<number, {type: string, text: string, closed: boolean}>} state
 */
export function closeBlocks(state) {
  const chunks = []
  for (const [index, block] of state) {
    if (block.closed) continue
    block.closed = true
    chunks.push({ type: 'block-end', index, block: { type: block.type, text: block.text } })
  }
  return chunks
}

/** One-shot convenience: full lifecycle for a finished event list. */
export function eventsToFullChunks(events) {
  const state = new Map()
  return [...eventsToChunks(events, state), ...closeBlocks(state)]
}

/** The provider-wire adapter. */
export class OpencodeLlmAdapter {
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
  }

  providerInfo(provider) {
    return { id: provider, name: 'OpenCode v2' }
  }

  providerRetryPolicy() {}

  imageRequestPricing() {}

  /** List `opencode models` for the real catalog (cached); null on failure/disabled. */
  async discover() {
    if (!this.config.autoDiscoverModels.get()) return null
    const cacheMs = this.config.discoveryCacheMs.get()
    if (this.discovered && Date.now() - this.discovered.at < cacheMs) return this.discovered.result
    try {
      const result = await discoverModels(this.ctx, {
        opencodePath: this.config.opencodePath.get(),
        envNames: this.config.forwardEnv.get(),
        cwd: this.config.cwd.get() || process.cwd(),
        timeoutMs: this.config.discoveryTimeoutMs.get(),
        stderrMaxBytes: this.config.stderrMaxBytes.get(),
      })
      if (result) this.discovered = { at: Date.now(), result }
      return result
    } catch {
      return null
    }
  }

  async listModels(provider) {
    const discovered = await this.discover()
    if (discovered && discovered.models.length > 0) {
      return [
        {
          provider,
          id: 'default',
          name: 'OpenCode (config default)',
          description: 'OpenCode agent, spawned headless per generation',
          inputModalities: ['text'],
        },
        ...discovered.models.map((m) => ({
          provider,
          id: m.id,
          name: m.name,
          description: 'OpenCode agent, spawned headless per generation',
          inputModalities: ['text'],
        })),
      ]
    }
    return this.config.models.get().map((entry) => ({
      provider,
      id: entry.id,
      name: entry.name || `OpenCode ${entry.id}`,
      description: 'OpenCode agent, spawned headless per generation',
      inputModalities: ['text'],
    }))
  }

  resolveModel(provider, model) {
    return Promise.resolve({ provider, id: model, name: `OpenCode ${model}`, inputModalities: ['text'] })
  }

  async prepareCall(provider, model, signal) {
    return { model: await this.resolveModel(provider, model, signal), stream: (options) => this.stream(options) }
  }

  async *stream(options) {
    if (options.purpose === 'session-title' && this.config.localSessionTitles.get()) {
      const text = sessionTitleText(options.messages).slice(0, 80)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }

    const config = this.config
    let env, executable, handle, timeout, prompt, parser, carry, settled
    try {
      env = forwardedEnv(config.forwardEnv.get())
      executable = await this.ctx.subprocess.resolveExecutable(config.opencodePath.get(), env, options.signal)
      timeout = AbortSignal.timeout(config.timeoutMs.get())
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
      prompt = buildPrompt(options, config.brief.get())
      const argv = [
        executable,
        ...buildRunArgv(
          {
            model: resolveOpencodeModel(options.model, config.models.get()),
            auto: config.auto.get(),
            thinking: config.thinking.get(),
            format: 'json',
            extraArgs: stripUnsupportedFlags(config.extraArgs.get()),
          },
          prompt,
        ),
      ]
      handle = this.ctx.subprocess.spawn({
        argv,
        cwd: config.cwd.get() || process.cwd(),
        stdio: { stdin: 'ignore', stdout: 'pipe', stderr: { maxBytes: config.stderrMaxBytes.get() } },
        graceMs: 10000,
        signal,
        env,
      })
      // Attach the settlement handler IMMEDIATELY: `handle.done` can reject
      // (spawn failure, kill), and we must consume stdout first. An unhandled
      // rejection here would be turned into `process.exit(1)` by the host's
      // fail-loud installer, so it is converted to a value before any await.
      settled = handle.done.then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error }),
      )
      parser = new JsonRunParser()
      carry = { buffer: '' }
    } catch (error) {
      // Spawn/resolve failure: never crash the host.
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'OPENCODE_SPAWN', message: messageOf(error) } } }
      return
    }

    // Per-chunk event lists are flattened into ONE ordered delta sequence, so
    // a block index is opened and closed exactly once (a per-chunk
    // eventsToChunks() call would re-open index 0 on every stdout chunk).
    const blockState = new Map()
    const streamChunks = (events) => eventsToChunks(events, blockState)
    try {
      const stdout = handle.stdout
      const decoder = new TextDecoder()
      if (stdout) {
        for await (const chunk of stdout) {
          for (const streamChunk of streamChunks(parser.feed(decoder.decode(chunk, { stream: true }), carry))) {
            yield streamChunk
          }
        }
      }
      const tail = parser.feed(decoder.decode(), carry)
      for (const streamChunk of streamChunks(tail)) yield streamChunk
    } catch (error) {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'OPENCODE_STREAM', message: messageOf(error) } } }
      return
    }

    const end = await settled
    if (!end.ok) {
      // Spawn/guard failure surfaced through `done`: a normal error finish,
      // never a thrown exception.
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: { code: 'OPENCODE_SPAWN', message: messageOf(end.error) },
        },
      }
      return
    }
    const outcome = end.value

    // Flush any unterminated trailing line; `finish()` returns a new event
    // only when the snapshots changed, so these deltas are strictly new.
    const before = parser.events.length
    const remainder = parser.finish(carry)
    for (const streamChunk of streamChunks(remainder.events.slice(before))) yield streamChunk
    for (const streamChunk of closeBlocks(blockState)) yield streamChunk

    // Authoritative usage, or nothing at all.
    if (remainder.sessionId && (config.exportTimeoutMs?.get?.() ?? 0) > 0) {
      const usage = await fetchUsage({
        ctx: this.ctx,
        opencodePath: config.opencodePath.get(),
        sessionId: remainder.sessionId,
        env,
        cwd: config.cwd.get() || process.cwd(),
        timeoutMs: config.exportTimeoutMs.get(),
      })
      if (usage) {
        yield {
          type: 'usage',
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            reasoningTokens: usage.reasoningTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
            totalTokens: usage.totalTokens,
          },
        }
      }
    }

    if (timeout.aborted) {
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            code: 'OPENCODE_TIMEOUT',
            message: `opencode exceeded timeoutMs=${config.timeoutMs.get()} and was terminated`,
          },
        },
      }
    } else if (outcome.exitCode !== 0 || remainder.errors.length > 0) {
      const stderr = handle.collected.stderr?.readFrom(0)?.text ?? ''
      const detail = remainder.errors.length ? remainder.errors.join('; ') : tailOf(stderr, 400)
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            code: 'OPENCODE_EXIT',
            message: `opencode exited ${outcome.exitCode ?? `signal ${outcome.signal}`}${detail ? ` — ${detail}` : ''}`,
          },
        },
      }
    } else {
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function tailOf(text, max) {
  const clean = String(text ?? '').trim()
  return clean.length > max ? clean.slice(-max) : clean
}

/**
 * Plugin body: register the `opencode-agent` provider route and declare it in
 * the configurable-provider directory so the web Models page can see it.
 */
export function apply(ctx, config) {
  ctx.llm.registerAdapter(['opencode-agent'], new OpencodeLlmAdapter(ctx, config))
  ctx.llm.registerConfigurableProviders([
    {
      provider: 'opencode-agent',
      displayName: 'OpenCode v2',
      settingsNs: name,
      settingsPath: [],
    },
  ])
}
