/**
 * @nolit/dsh-tokeneconomizer -- browser half: read-only developer statistics.
 *
 * One surface, in the settings list seat:
 *
 *   settings.section -> "TokenEconomizer · Developer statistics"
 *
 * WHY A SETTINGS SECTION AND NOT A CONVERSATION VIEW
 *
 * rc.1 supports both seats (`settings.section`, `conversation.view`). The conversation View is
 * the natural home for a per-turn/per-step table, but it requires a full Node-Definition set
 * (`ctx.uiConversation.events.register`) plus a target builder (`ctx.uiConversation.views.register`)
 * and a view slot entry — and rc.1's own statistics plugin already occupies that tab. A second
 * tab would duplicate the seat's purpose and multiply the client machinery this package must
 * carry. `settings.section` is a LIST seat (additive, no collision), it is the seat this
 * workspace already uses for plugin panels, and it cannot interfere with the composer (tk
 * registers nothing in a composer seat) — so the statistics card goes there and the per-turn /
 * per-step rows render inside it. The host route is the data source; this file derives nothing
 * itself, so the same numbers are testable on the host.
 *
 * MODULE FORMAT: this file is served verbatim and evaluated by `window.__ModuleLoader__`, so it
 * must be a CommonJS factory with no ESM syntax and no JSON imports (measured 2026-11-04 on a
 * sibling track: both forms fail as "1 entry did not activate"). The locale tables are therefore
 * inlined; `locale/en.json` and `locale/ko.json` remain the tooling source of truth and
 * `test/client.test.mjs` asserts the two copies agree.
 *
 * PRINTED VALUES ARE THE HOST'S. The route returns already-derived rows (pure fold in
 * lib/devstats.js); this component formats and renders them. No number is recomputed here.
 *
 * @module @nolit/dsh-tokeneconomizer/client
 */
window.__ModuleLoader__.load({
  id: '@nolit/dsh-tokeneconomizer',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    /** Host route the card reads. Read-only: every method is POST and the route mutates nothing. */
    const DEVSTATS_URL = '/api/local/tokeneconomizer/devstats'

    /** English is the default; Korean renders only while the active locale is `ko`. */
    const I18N = {
      en: {
        'devstats.title': 'TokenEconomizer · Developer statistics',
        'devstats.hint': 'Read-only. Per-turn and per-step figures folded from the DSH session ledger, next to this plugin\'s own in-memory counters.',
        'devstats.source': 'DSH ledger + tk ledger',
        'devstats.session': 'Session',
        'devstats.refresh': 'Refresh',
        'devstats.loading': 'Loading statistics…',
        'devstats.loadError': 'Could not load statistics',
        'devstats.retry': 'Retry',
        'devstats.empty': 'No session in this process has a ledger yet.',
        'devstats.noDetail': 'Select a session to see its turns and steps.',
        'devstats.truncated': 'Only the newest {turns} turns are listed; the totals cover the whole log.',
        'devstats.totals': 'Session totals',
        'devstats.turns': 'Turns',
        'devstats.steps': 'Steps',
        'devstats.context': 'Context',
        'devstats.cacheHit': 'Cache hit',
        'devstats.input': 'Input',
        'devstats.output': 'Output',
        'devstats.reasoning': 'Reasoning',
        'devstats.modelTime': 'Model',
        'devstats.toolTime': 'Tool',
        'devstats.wall': 'Wall',
        'devstats.turnRow': 'Turn {turn}',
        'devstats.stepRow': 'Step {step}',
        'devstats.scope': 'Scope',
        'devstats.cache': 'Cache R / W',
        'devstats.model': 'Model',
        'devstats.tools': 'Tools',
        'devstats.toolCalls': '{n} calls',
        'devstats.toolSummary': '{name} · {ms} · {chars} chars',
        'devstats.toolError': 'error',
        'devstats.callsTruncated': 'Only the first {n} calls are listed.',
        'devstats.running': 'running',
        'devstats.aborted': 'no usage reported',
        'devstats.notReported': '—',
        'devstats.tkLedger': 'tk ledger',
        'devstats.dedupHits': 'Dedup hits',
        'devstats.dedupSaved': 'Dedup saved',
        'devstats.tierReplacements': 'Tier rewrites',
        'devstats.tierShadow': 'Shadowed tokens',
        'devstats.breakerTrips': 'Loop-breaker trips',
        'devstats.watchdogWarns': 'Watchdog warnings',
        'devstats.watchdogInterrupts': 'Watchdog interrupts',
        'devstats.toolCallsCount': 'Tool calls',
        'devstats.toolErrors': 'Tool errors',
        'devstats.notices': 'Notices',
        'devstats.mode': 'Mode',
        'devstats.pinned': 'Pinned rules',
        'devstats.recall': 'Recall',
        'devstats.dshProjections': 'DSH projections',
        'devstats.surface': 'Surface',
        'devstats.projected': 'Projected',
        'devstats.contextWindow': 'Window',
        'devstats.usageUncached': 'Uncached input',
        'devstats.usageOutput': 'Output tokens',
        'devstats.usageCacheRead': 'Cache read',
        'devstats.usageCacheWrite': 'Cache write',
        'devstats.statsTurns': 'Turns',
        'devstats.statsLlm': 'LLM time',
        'devstats.statsTool': 'Tool time',
        'devstats.statsTtft': 'First token',
        'devstats.asOf': 'as of seq {seq}',
        'devstats.on': 'on',
        'devstats.off': 'off',
        'devstats.chars': '{n} chars',
      },
      ko: {
        'devstats.title': '토큰절약기 · 개발자 통계',
        'devstats.hint': '읽기 전용. DSH 세션 원장에서 접은 턴별·단계별 수치와 이 플러그인의 메모리 카운터입니다.',
        'devstats.source': 'DSH 원장 + tk 원장',
        'devstats.session': '세션',
        'devstats.refresh': '새로 고침',
        'devstats.loading': '통계를 불러오는 중…',
        'devstats.loadError': '통계를 불러오지 못했습니다',
        'devstats.retry': '다시 시도',
        'devstats.empty': '이 프로세스에 원장이 있는 세션이 아직 없습니다.',
        'devstats.noDetail': '턴과 단계를 보려면 세션을 선택하세요.',
        'devstats.truncated': '최신 {turns}턴만 표시합니다. 합계는 전체 로그 기준입니다.',
        'devstats.totals': '세션 합계',
        'devstats.turns': '턴',
        'devstats.steps': '단계',
        'devstats.context': '컨텍스트',
        'devstats.cacheHit': '캐시 적중',
        'devstats.input': '입력',
        'devstats.output': '출력',
        'devstats.reasoning': '추론',
        'devstats.modelTime': '모델',
        'devstats.toolTime': '도구',
        'devstats.wall': '총 시간',
        'devstats.turnRow': '턴 {turn}',
        'devstats.stepRow': '단계 {step}',
        'devstats.scope': '범위',
        'devstats.cache': '캐시 읽기 / 쓰기',
        'devstats.model': '모델',
        'devstats.tools': '도구',
        'devstats.toolCalls': '{n}회 호출',
        'devstats.toolSummary': '{name} · {ms} · {chars}자',
        'devstats.toolError': '오류',
        'devstats.callsTruncated': '앞의 {n}개 호출만 표시합니다.',
        'devstats.running': '실행 중',
        'devstats.aborted': 'usage 없음',
        'devstats.notReported': '—',
        'devstats.tkLedger': 'tk 원장',
        'devstats.dedupHits': '중복 제거',
        'devstats.dedupSaved': '절감 문자',
        'devstats.tierReplacements': '계층 재작성',
        'devstats.tierShadow': '가려진 토큰',
        'devstats.breakerTrips': '루프 차단',
        'devstats.watchdogWarns': '워치독 경고',
        'devstats.watchdogInterrupts': '워치독 중단',
        'devstats.toolCallsCount': '도구 호출',
        'devstats.toolErrors': '도구 오류',
        'devstats.notices': '알림',
        'devstats.mode': '모드',
        'devstats.pinned': '고정 규칙',
        'devstats.recall': '이전 세션 회상',
        'devstats.dshProjections': 'DSH 프로젝션',
        'devstats.surface': '서피스',
        'devstats.projected': '예상',
        'devstats.contextWindow': '윈도',
        'devstats.usageUncached': '비캐시 입력',
        'devstats.usageOutput': '출력 토큰',
        'devstats.usageCacheRead': '캐시 읽기',
        'devstats.usageCacheWrite': '캐시 쓰기',
        'devstats.statsTurns': '턴',
        'devstats.statsLlm': 'LLM 시간',
        'devstats.statsTool': '도구 시간',
        'devstats.statsTtft': '첫 토큰',
        'devstats.asOf': 'seq {seq} 기준',
        'devstats.on': '켜짐',
        'devstats.off': '꺼짐',
        'devstats.chars': '{n}자',
      },
    }

    const STYLE_ID = 'tk-devstats-style'
    const CSS = [
      '.tkdsSection{box-sizing:border-box;min-width:0;max-width:980px;padding:16px 0;display:flex;flex-direction:column;gap:12px;font-family:inherit;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary)}',
      '.tkdsHead{display:flex;justify-content:space-between;align-items:baseline;gap:12px;min-width:0;flex-wrap:wrap}',
      '.tkdsTitle{margin:0;font-size:var(--dsh-content-font-size,14px);font-weight:600;line-height:calc(22px + var(--dsh-content-font-delta,0px))}',
      '.tkdsHint{margin:0;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary)}',
      '.tkdsMeta{font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
      '.tkdsCard{border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-xl);padding:12px 14px;display:flex;flex-direction:column;gap:10px;min-width:0}',
      '.tkdsCardTitle{margin:0;font-size:var(--dsh-content-font-size,14px);font-weight:500;line-height:calc(22px + var(--dsh-content-font-delta,0px))}',
      '.tkdsGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;min-width:0}',
      '.tkdsStat{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.tkdsStatLabel{font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary)}',
      '.tkdsStatValue{font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tkdsControls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.tkdsSelect{appearance:none;box-sizing:border-box;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;padding:4px 8px;max-width:100%}',
      '.tkdsButton{appearance:none;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-bg-layer-3));border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;padding:5px 14px}',
      '.tkdsButton:disabled{opacity:.6;cursor:default}',
      '.tkdsScroll{overflow-x:auto;min-width:0}',
      '.tkdsTable{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}',
      '.tkdsTh{text-align:left;font-weight:500;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));padding:4px 8px;border-bottom:.5px solid var(--dsw-alias-border-l3);white-space:nowrap}',
      '.tkdsTd{font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));padding:4px 8px;border-bottom:.5px solid var(--dsw-alias-border-l3);white-space:nowrap}',
      '.tkdsTurnRow{cursor:pointer;background:var(--dsw-alias-bg-layer-1)}',
      '.tkdsTurnRow:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}',
      '.tkdsStepRow{color:var(--dsw-alias-label-secondary)}',
      '.tkdsScope{padding-left:20px}',
      '.tkdsToolRow{color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}',
      '.tkdsToolCell{padding-left:42px;white-space:normal}',
      '.tkdsBadge{display:inline-block;font-size:var(--dsh-content-font-size-secondary,13px);line-height:18px;padding:0 6px;border-radius:var(--dsw-radius-xs);border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);margin-left:6px}',
      '.tkdsError{color:var(--dsw-alias-state-error-primary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));margin:0}',
      '.tkdsMuted{margin:0;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}',
    ].join('\n')

    /** Active dictionary; follows the host locale. */
    let language = 'en'
    /** Context captured by apply(), used only for locale reads. */
    let devstatsCtx = null
    /** Subscribe to locale changes, set by apply(). */
    let ctxLocaleSubscribe = null

    /**
     * Read the active language from the host locale service.
     * @returns {string} `ko` when Korean is active, otherwise `en`.
     */
    function currentLang() {
      try {
        const snapshot = typeof devstatsCtx?.locale?.getSnapshot === 'function'
          ? devstatsCtx.locale.getSnapshot()
          : null
        const active = String(snapshot?.active ?? '')
        return active.toLowerCase().startsWith('ko') ? 'ko' : 'en'
      } catch {
        return 'en'
      }
    }

    /**
     * Translate one key, with `{name}` interpolation.
     * @param {string} key - dictionary key.
     * @param {object} [vars] - interpolation values.
     * @returns {string} the text.
     */
    function t(key, vars) {
      const table = I18N[language] ?? I18N.en
      let text = typeof table[key] === 'string' ? table[key] : (I18N.en[key] ?? key)
      if (vars !== undefined) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.split('{' + name + '}').join(String(value))
        }
      }
      return text
    }

    /** Insert the stylesheet once per document. */
    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID) !== null) return
      const tag = document.createElement('style')
      tag.id = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    /**
     * Group digits without depending on the browser locale.
     * @param {number} value - the number.
     * @returns {string} the grouped text.
     */
    function group(value) {
      return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    }

    /**
     * Format a token count.
     * @param {number|null|undefined} value - the count.
     * @returns {string} the text.
     */
    function fmtInt(value) {
      return typeof value === 'number' && Number.isFinite(value) ? group(value) : t('devstats.notReported')
    }

    /**
     * Format one millisecond span.
     * @param {number|null|undefined} value - milliseconds.
     * @returns {string} the text.
     */
    function fmtMs(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return t('devstats.notReported')
      if (value < 1000) return Math.round(value) + ' ms'
      const seconds = value / 1000
      return (seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1)) + ' s'
    }

    /**
     * Format one cache-hit share.
     * @param {number|null|undefined} value - share in [0, 1].
     * @returns {string} the text.
     */
    function fmtPct(value) {
      return typeof value === 'number' && Number.isFinite(value)
        ? Math.round(Math.min(1, value) * 100) + '%'
        : t('devstats.notReported')
    }

    /**
     * Format one route.
     * @param {string|null} provider - provider id.
     * @param {string|null} model - model id.
     * @returns {string} the text.
     */
    function fmtRoute(provider, model) {
      if (!provider && !model) return t('devstats.notReported')
      if (provider && model) return provider + ' / ' + model
      return provider ?? model
    }

    /**
     * Read the tk ledger rows as label/value pairs.
     * @param {object|null|undefined} ledger - the ledger view.
     * @returns {Array<{label: string, value: string}>} the pairs.
     */
    function ledgerPairs(ledger) {
      if (ledger === null || ledger === undefined) return []
      const pairs = []
      const push = (label, value) => pairs.push({ label, value })
      push(t('devstats.mode'), ledger.mode ?? t('devstats.notReported'))
      push(t('devstats.dedupHits'), fmtInt(ledger.dedup?.hits))
      push(t('devstats.dedupSaved'), fmtInt(ledger.dedup?.savedChars))
      push(t('devstats.tierReplacements'), fmtInt(ledger.tiering?.replacements))
      push(t('devstats.tierShadow'), fmtInt(ledger.tiering?.shadowedTokens))
      push(t('devstats.breakerTrips'), fmtInt(ledger.loopBreaker?.trips))
      push(t('devstats.watchdogWarns'), fmtInt(ledger.watchdog?.warnings))
      push(t('devstats.watchdogInterrupts'), fmtInt(ledger.watchdog?.interrupts))
      push(t('devstats.toolCallsCount'), fmtInt(ledger.toolCalls))
      push(t('devstats.toolErrors'), fmtInt(ledger.toolErrors))
      push(t('devstats.notices'), fmtInt(ledger.notices))
      push(t('devstats.pinned'), ledger.pinned === true ? t('devstats.on') : t('devstats.off'))
      push(t('devstats.recall'), ledger.recall?.done === true ? t('devstats.on') : t('devstats.off'))
      return pairs
    }

    /**
     * The card component.
     * @returns {object} the rendered section.
     */
    function DevStatsSection() {
      ensureStyle()
      const [state, setState] = React.useState({ status: 'loading', error: null, payload: null })
      const [sessionId, setSessionId] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [, setTick] = React.useState(0)

      const load = React.useCallback(async (wanted) => {
        setBusy(true)
        setState((prev) => ({ ...prev, status: prev.payload === null ? 'loading' : 'ready', error: null }))
        try {
          const response = await fetch(DEVSTATS_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(wanted ? { sessionId: wanted } : {}),
          })
          if (!response.ok) throw new Error('HTTP ' + String(response.status))
          const payload = await response.json()
          if (payload?.ok !== true) throw new Error(payload?.error ?? 'unavailable')
          setState({ status: 'ready', error: null, payload })
          const nextId = String(payload?.detail?.sessionId ?? payload?.sessions?.[0]?.id ?? '')
          if (nextId) setSessionId(nextId)
        } catch (error) {
          setState({ status: 'error', error: error instanceof Error ? error.message : String(error), payload: null })
        } finally {
          setBusy(false)
        }
      }, [])

      React.useEffect(() => { void load('') }, [load])

      // Follow host locale changes so every label updates live.
      React.useEffect(() => {
        if (typeof ctxLocaleSubscribe !== 'function') return undefined
        return ctxLocaleSubscribe(() => setTick((n) => n + 1))
      }, [])

      const payload = state.payload
      const detail = payload?.detail
      const sessions = Array.isArray(payload?.sessions) ? payload.sessions : []
      const [openTurns, setOpenTurns] = React.useState({})
      const toggleTurn = (turn) => setOpenTurns((prev) => ({ ...prev, [String(turn)]: prev[String(turn)] !== true }))

      const header = h('div', { className: 'tkdsHead' },
        h('div', { style: { minWidth: 0 } },
          h('h4', { className: 'tkdsTitle' }, t('devstats.title')),
          h('p', { className: 'tkdsHint' }, t('devstats.hint'))),
        h('div', { className: 'tkdsControls' },
          h('button', {
            type: 'button',
            className: 'tkdsButton',
            disabled: busy,
            onClick: () => void load(sessionId),
            'data-tk-devstats-refresh': '1',
          }, t('devstats.refresh'))))

      if (state.status === 'loading') {
        return h('section', { className: 'tkdsSection', 'data-tk-devstats': '1' },
          header, h('p', { className: 'tkdsMuted' }, t('devstats.loading')))
      }
      if (state.status === 'error') {
        return h('section', { className: 'tkdsSection', 'data-tk-devstats': '1' },
          header,
          h('p', { className: 'tkdsError' }, t('devstats.loadError') + ': ' + String(state.error)),
          h('div', { className: 'tkdsControls' },
            h('button', { type: 'button', className: 'tkdsButton', onClick: () => void load(sessionId) }, t('devstats.retry'))))
      }
      if (sessions.length === 0) {
        return h('section', { className: 'tkdsSection', 'data-tk-devstats': '1' },
          header, h('p', { className: 'tkdsMuted' }, t('devstats.empty')))
      }

      const selector = h('div', { className: 'tkdsControls' },
        h('label', { className: 'tkdsMeta', htmlFor: 'tk-devstats-session' }, t('devstats.session')),
        h('select', {
          id: 'tk-devstats-session',
          className: 'tkdsSelect',
          value: sessionId,
          onChange: (event) => {
            const next = String(event.target.value ?? '')
            setSessionId(next)
            void load(next)
          },
        }, sessions.map((entry) => h('option', { key: entry.id, value: entry.id },
          String(entry.id).slice(0, 8) + (entry.cwd ? ' · ' + String(entry.cwd).split('/').pop() : '')))),
        h('span', { className: 'tkdsMeta' }, t('devstats.source')))

      const totals = detail?.totals ?? payload?.sessions?.find((entry) => entry.id === sessionId)?.totals
      const totalsGrid = totals === undefined ? null : h('div', { className: 'tkdsCard' },
        h('h5', { className: 'tkdsCardTitle' }, t('devstats.totals')),
        h('div', { className: 'tkdsGrid' },
          stat(t('devstats.turns'), fmtInt(totals.turns)),
          stat(t('devstats.steps'), fmtInt(totals.steps)),
          stat(t('devstats.context'), fmtInt(totals.contextCumulative)),
          stat(t('devstats.cacheHit'), fmtPct(totals.cacheHit)),
          stat(t('devstats.input'), fmtInt(totals.inputTokens)),
          stat(t('devstats.output'), fmtInt(totals.outputTokens)),
          stat(t('devstats.reasoning'), fmtInt(totals.reasoningTokens)),
          stat(t('devstats.modelTime'), fmtMs(totals.modelMs)),
          stat(t('devstats.toolTime'), fmtMs(totals.toolMs)),
          stat(t('devstats.wall'), fmtMs(totals.wallMs))))

      const projections = detail?.dshProjections
      const projectionCard = projections === null || projections === undefined ? null
        : h('div', { className: 'tkdsCard' },
          h('div', { className: 'tkdsHead' },
            h('h5', { className: 'tkdsCardTitle' }, t('devstats.dshProjections')),
            h('span', { className: 'tkdsMeta' }, t('devstats.asOf', { seq: projections.asOfSeq ?? '—' }))),
          h('div', { className: 'tkdsGrid' },
            stat(t('devstats.surface'), fmtInt(projections.values?.contextPressure?.projectedTokens)),
            stat(t('devstats.projected'), fmtInt(projections.values?.contextPressure?.pressureTokens)),
            stat(t('devstats.contextWindow'), fmtInt(projections.values?.contextPressure?.contextWindow)),
            stat(t('devstats.usageUncached'), fmtInt(projections.values?.tokenUsage?.uncachedInputTokens)),
            stat(t('devstats.usageCacheRead'), fmtInt(projections.values?.tokenUsage?.cacheReadTokens)),
            stat(t('devstats.usageCacheWrite'), fmtInt(projections.values?.tokenUsage?.cacheWriteTokens)),
            stat(t('devstats.usageOutput'), fmtInt(projections.values?.tokenUsage?.outputTokens)),
            stat(t('devstats.statsTurns'), fmtInt(projections.values?.sessionStats?.turns)),
            stat(t('devstats.statsLlm'), fmtMs(projections.values?.sessionStats?.llmMs)),
            stat(t('devstats.statsTool'), fmtMs(projections.values?.sessionStats?.toolMs)),
            stat(t('devstats.statsTtft'), fmtMs(projections.values?.sessionStats?.ttftMs))))

      const ledger = detail?.ledger
      const ledgerCard = ledger === null || ledger === undefined ? null
        : h('div', { className: 'tkdsCard' },
          h('h5', { className: 'tkdsCardTitle' }, t('devstats.tkLedger')),
          h('div', { className: 'tkdsGrid' }, ledgerPairs(ledger).map((pair) => stat(pair.label, pair.value))))

      const truncation = detail?.truncated === true
        ? h('p', { className: 'tkdsMuted' }, t('devstats.truncated', { turns: fmtInt(detail.turns?.length) }))
        : null

      const table = detail === undefined || detail.turns.length === 0
        ? h('p', { className: 'tkdsMuted' }, t('devstats.noDetail'))
        : h('div', { className: 'tkdsScroll' },
          h('table', { className: 'tkdsTable' },
            h('thead', null, h('tr', null,
              h('th', { className: 'tkdsTh' }, t('devstats.scope')),
              h('th', { className: 'tkdsTh' }, t('devstats.context')),
              h('th', { className: 'tkdsTh' }, t('devstats.cache')),
              h('th', { className: 'tkdsTh' }, t('devstats.input')),
              h('th', { className: 'tkdsTh' }, t('devstats.output')),
              h('th', { className: 'tkdsTh' }, t('devstats.reasoning')),
              h('th', { className: 'tkdsTh' }, t('devstats.model')),
              h('th', { className: 'tkdsTh' }, t('devstats.tools')),
              h('th', { className: 'tkdsTh' }, t('devstats.wall')))),
            h('tbody', null, renderTurns(detail.turns, openTurns, toggleTurn))))

      return h('section', { className: 'tkdsSection', 'data-tk-devstats': '1' },
        header, selector, totalsGrid, projectionCard, ledgerCard, truncation, table)
    }

    /**
     * One labelled value cell.
     * @param {string} label - the label.
     * @param {string} value - the formatted value.
     * @returns {object} the element.
     */
    function stat(label, value) {
      return h('div', { className: 'tkdsStat', key: label },
        h('span', { className: 'tkdsStatLabel' }, label),
        h('span', { className: 'tkdsStatValue' }, value))
    }

    /**
     * Render every turn, with its steps when expanded.
     * @param {Array<object>} turns - derived turn rows.
     * @param {object} openTurns - expanded-turn map.
     * @param {(turn: number) => void} toggleTurn - expansion toggle.
     * @returns {Array<object>} the rows.
     */
    function renderTurns(turns, openTurns, toggleTurn) {
      const rows = []
      for (const turn of turns) {
        const open = openTurns[String(turn.turn)] === true
        rows.push(h('tr', {
          key: 'turn-' + String(turn.turn),
          className: 'tkdsTurnRow',
          onClick: () => toggleTurn(turn.turn),
        },
        h('td', { className: 'tkdsTd' }, t('devstats.turnRow', { turn: turn.turn }) + (turn.running ? ' · ' + t('devstats.running') : '')),
        h('td', { className: 'tkdsTd' }, fmtInt(turn.contextCumulative)),
        h('td', { className: 'tkdsTd' }, fmtPct(turn.cacheHit) + ' · ' + fmtInt(turn.cacheReadTokens) + ' / ' + fmtInt(turn.cacheWriteTokens)),
        h('td', { className: 'tkdsTd' }, fmtInt(turn.inputTokens)),
        h('td', { className: 'tkdsTd' }, fmtInt(turn.outputTokens)),
        h('td', { className: 'tkdsTd' }, fmtInt(turn.reasoningTokens)),
        h('td', { className: 'tkdsTd' }, routeOf(turn.routes)),
        h('td', { className: 'tkdsTd' }, t('devstats.toolCalls', { n: fmtInt(turn.toolCalls) }) + ' · ' + fmtMs(turn.toolMs)),
        h('td', { className: 'tkdsTd' }, fmtMs(turn.wallMs))))
        if (!open) continue
        for (const step of turn.steps) {
          rows.push(h('tr', { key: 'step-' + String(turn.turn) + '-' + String(step.step), className: 'tkdsStepRow' },
            h('td', { className: 'tkdsTd tkdsScope' }, t('devstats.stepRow', { step: step.step })),
            h('td', { className: 'tkdsTd' }, fmtInt(step.contextTokens)),
            h('td', { className: 'tkdsTd' }, fmtPct(step.cacheHit) + ' · ' + fmtInt(step.cacheReadTokens) + ' / ' + fmtInt(step.cacheWriteTokens)),
            h('td', { className: 'tkdsTd' }, fmtInt(step.inputTokens)),
            h('td', { className: 'tkdsTd' }, fmtInt(step.outputTokens)),
            h('td', { className: 'tkdsTd' }, fmtInt(step.reasoningTokens)),
            h('td', { className: 'tkdsTd' }, fmtRoute(step.provider, step.model)),
            h('td', { className: 'tkdsTd' }, step.toolCalls > 0
              ? t('devstats.toolCalls', { n: fmtInt(step.toolCalls) }) + ' · ' + fmtMs(step.toolMs) + (step.toolErrorCount > 0 ? ' · ' + t('devstats.toolError') + ' ' + fmtInt(step.toolErrorCount) : '')
              : t('devstats.notReported')),
            h('td', { className: 'tkdsTd' }, fmtMs(step.wallMs) + (step.aborted ? ' · ' + t('devstats.aborted') : ''))))
          if (step.calls.length > 0) {
            const lines = step.calls.map((call) => (call.name ?? '?') + ' · ' + fmtMs(call.ms) + ' · ' + t('devstats.chars', { n: fmtInt(call.resultChars) }) + (call.error ? ' · ' + t('devstats.toolError') : ''))
            if (step.callsTruncated) lines.push(t('devstats.callsTruncated', { n: fmtInt(step.calls.length) }))
            rows.push(h('tr', { key: 'calls-' + String(turn.turn) + '-' + String(step.step) },
              h('td', { className: 'tkdsTd tkdsToolCell', colSpan: 9 },
                h('div', { className: 'tkdsToolRow' }, lines.join('  |  ')))))
          }
        }
      }
      return rows
    }

    /**
     * Render the routes of one turn as one short label.
     * @param {Array<{provider: string|null, model: string|null}>} routes - the turn's routes.
     * @returns {string} the label.
     */
    function routeOf(routes) {
      if (!Array.isArray(routes) || routes.length === 0) return t('devstats.notReported')
      return fmtRoute(routes[0].provider, routes[0].model)
        + (routes.length > 1 ? ' +' + String(routes.length - 1) : '')
    }

    const inject = ['slots', 'locale']

    /**
     * Client plugin body: register the read-only developer statistics card.
     * @param {object} ctx - client root context.
     * @returns {void}
     */
    function apply(ctx) {
      devstatsCtx = ctx
      language = currentLang()
      if (typeof ctx?.locale?.subscribe === 'function') {
        // One subscription keeps the dictionary in sync; the component re-renders through the
        // same service, so a locale change updates labels without a reload.
        const dispose = ctx.locale.subscribe(() => { language = currentLang() })
        ctxLocaleSubscribe = (fn) => {
          const off = ctx.locale.subscribe(fn)
          if (typeof dispose === 'function' && off === undefined) return dispose
          return typeof off === 'function' ? off : undefined
        }
      }
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'tokeneconomizer-devstats',
        order: 62,
        label: () => t('devstats.title'),
      }, DevStatsSection))
    }

    exports.apply = apply
    exports.inject = inject
    exports.DevStatsSection = DevStatsSection
    Object.defineProperty(exports, 'default', { value: { apply, inject } })
    return module.exports
  },
})
