/**
 * Message tables for the local delegation worker.
 *
 * English is the default and the only model-facing language: the tool
 * description and schema stay English regardless of the configured locale.
 * Korean is used for the rendered result text ONLY when `locale: "ko"`, and
 * any future locale falls back to English. Keeping the table flat and keyed
 * lets a test assert key parity across languages.
 *
 * @module @nolit/dsh-subagent-local/locales
 */

/** Languages this package ships text for. */
export const SUPPORTED_LOCALES = Object.freeze(['en', 'ko'])

/** Default locale. */
export const DEFAULT_LOCALE = 'en'

/** English message table. */
export const EN = Object.freeze({
  'result.finished': '{backend} finished.',
  'result.finishedWithModel': '{backend} finished (model {model}).',
  'result.timedOut': '{backend} timed out after {ms} ms and was terminated.',
  'result.exited': '{backend} exited with code {code}.',
  'result.signaled': '{backend} was terminated by signal {signal}.',
  'result.disabled': 'delegate_local is disabled by configuration (enabled: false).',
  'result.providerMounted':
    'Backend "{backend}" is served by the mounted subagent provider "{provider}". '
    + 'Use that provider\'s delegation tool instead of spawning a second CLI process.',
  'result.noOutput': '(no output)',
  'usage.tokens': '[tokens: input {input}, output {output}, thinking {thinking}, cached {cached}]',
  'artifacts.header': '[artifacts]',
  'artifacts.missing': '[no match for: {patterns}]',
  'artifacts.skipped': '[{count} artifact(s) dropped by the collection limit]',
  'output.truncated': '[output truncated — increase maxOutputBytes]',
  'stderr.header': '--- stderr ---',
})

/** Korean message table (used only when the configured locale is `ko`). */
export const KO = Object.freeze({
  'result.finished': '{backend} 작업이 끝났습니다.',
  'result.finishedWithModel': '{backend} 작업이 끝났습니다 (모델 {model}).',
  'result.timedOut': '{backend} 작업이 {ms}ms 후 시간 초과되어 종료되었습니다.',
  'result.exited': '{backend} 작업이 코드 {code}(으)로 종료되었습니다.',
  'result.signaled': '{backend} 작업이 시그널 {signal}(으)로 종료되었습니다.',
  'result.disabled': 'delegate_local이 설정에서 비활성화되어 있습니다 (enabled: false).',
  'result.providerMounted':
    '"{backend}" 백엔드는 이미 마운트된 서브에이전트 프로바이더 "{provider}"가 담당합니다. '
    + '두 번째 CLI 프로세스를 띄우지 말고 해당 프로바이더의 위임 도구를 사용하세요.',
  'result.noOutput': '(출력 없음)',
  'usage.tokens': '[토큰: 입력 {input}, 출력 {output}, 사고 {thinking}, 캐시 {cached}]',
  'artifacts.header': '[산출물]',
  'artifacts.missing': '[일치 없음: {patterns}]',
  'artifacts.skipped': '[수집 한도를 넘어 {count}개 산출물이 제외되었습니다]',
  'output.truncated': '[출력이 잘렸습니다 — maxOutputBytes를 늘리세요]',
  'stderr.header': '--- stderr ---',
})

/** All shipped tables by locale id. */
export const TABLES = Object.freeze({ en: EN, ko: KO })

/**
 * Resolve the message table for a configured locale.
 * @param {string} [locale] - configured locale id.
 * @returns {Readonly<Record<string, string>>} English for anything but `ko`.
 */
export function tableFor(locale) {
  return locale === 'ko' ? KO : EN
}

/**
 * Fill `{name}` placeholders in one message.
 * @param {string} template - message template.
 * @param {Record<string, string|number>} values - replacement values.
 * @returns {string} the filled message.
 */
export function format(template, values = {}) {
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
  ))
}

/**
 * Render one canonical worker result as text.
 *
 * Localization covers the headline, usage and artifact labels; the worker's
 * answer body is returned verbatim because it is the CLI's output, not ours.
 * @param {object} result - canonical worker result.
 * @param {string} [locale] - configured locale id.
 * @returns {string} rendered report.
 */
export function renderResult(result, locale) {
  const table = tableFor(locale)
  const tr = (key, values) => format(table[key] ?? EN[key] ?? key, values)
  let head
  if (result.errorKind === 'provider-mounted') {
    head = tr('result.providerMounted', { backend: result.backend, provider: result.yieldedProvider })
  } else if (result.errorKind === 'disabled') {
    head = tr('result.disabled')
  } else if (result.timedOut) {
    head = tr('result.timedOut', { backend: result.backend, ms: result.elapsedMs })
  } else if (result.ok) {
    head = tr('result.finishedWithModel', { backend: result.backend, model: result.model || 'default' })
  } else if (result.signal) {
    head = tr('result.signaled', { backend: result.backend, signal: result.signal })
  } else {
    head = tr('result.exited', { backend: result.backend, code: result.exitCode })
  }
  const usage = tr('usage.tokens', {
    input: result.usage.inputTokens,
    output: result.usage.outputTokens,
    thinking: result.usage.thinkingTokens,
    cached: result.usage.cacheReadTokens,
  })
  const files = result.artifacts.length
    ? `\n${tr('artifacts.header')}\n${result.artifacts.map((file) => `${file.path} (${file.bytes} B, sha256 ${file.sha256.slice(0, 12)}…)`).join('\n')}`
    : ''
  const missing = result.missing.length ? `\n${tr('artifacts.missing', { patterns: result.missing.join(', ') })}` : ''
  const skipped = result.skipped ? `\n${tr('artifacts.skipped', { count: result.skipped })}` : ''
  const truncated = result.truncated ? `\n${tr('output.truncated')}` : ''
  const diagnostic = result.diagnostic ? `\n[${result.diagnostic}]` : ''
  const body = result.summary || tr('result.noOutput')
  const stderr = result.stderrTail ? `\n\n${tr('stderr.header')}\n${result.stderrTail}` : ''
  return `${head}${diagnostic}${usage}${files}${missing}${skipped}${truncated}\n\n${body}${stderr}`
}
