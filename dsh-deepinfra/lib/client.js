/**
 * @nolit/dsh-deepinfra -- browser half.
 *
 * Two slots, each replicated from the verified opencode-v2 implementation:
 *
 *   1. conversation.input.activity -> the composer cost chip, rendered immediately
 *      AFTER the model selector.
 *   2. settings.section            -> the "DeepInfra" / "딥인프라" settings card.
 *
 * MODULE FORMAT: this file is served to the browser as-is and evaluated by
 * window.__ModuleLoader__, so it must be a CommonJS factory. Measured 2026-11-04
 * in an isolated web boot, twice:
 *   - an `import ... with { type: 'json' }` statement -> "Cannot use import
 *     statement outside a module";
 *   - ESM `export` statements -> "Unexpected token 'export'".
 * Both produced "web boot: 1 entry did not activate / @nolit/dsh-deepinfra: import
 * failed". The factory shape below is the one the reference plugin proves.
 *
 * SLOT CONTRACT (installed dsh-client-ui-conversation types):
 *
 *   interface InputControlOwnerProps { locked: boolean }
 *   interface InputActivityOwnerProps extends InputControlOwnerProps {
 *     onActiveChange: (active: boolean) => void
 *   }
 *
 * "A toolbar activity hides ordinary accessory controls while expanded; its
 * occupant must release expansion on unmount." This occupant never expands — the
 * chip is a fixed-size inline button — so it reports active:false on mount and
 * again on unmount. Without that, switching away could leave the composer
 * expanded, hiding the model selector.
 *
 * The chip is gated on the PROVIDER ID only. A model id is shared across routers,
 * so matching it would show the chip on routes this adapter never served.
 */
window.__ModuleLoader__.load({
  id: '@nolit/dsh-deepinfra',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    /**
     * Message tables.
     *
     * INLINED because the loader evaluates this file as a plain script. The
     * locale/*.json files remain the source of truth for tooling, and
     * test/client.test.mjs asserts these tables match them so the duplication
     * cannot drift silently.
     */
    const I18N = {
      en: {
      meta: {
        title: "DeepInfra",
        description: "DeepInfra model serving for DeepSeek Harness",
      },
      nav: "DeepInfra",
      loading: "Loading DeepInfra settings…",
      loadError: "Could not load settings",
      retry: "Retry",
      save: "Save",
      saved: "Saved.",
      saveError: "Could not save",
      nothingToSave: "Nothing changed.",
      credentialsTitle: "Credentials",
      credentialsHint: "A key saved here is used before {env}. Leave the field empty to keep using the environment.",
      apiKeyLabel: "API key",
      apiKeyPlaceholder: "Not set",
      apiKeyHint: "Stored as a secret: the server never returns it. Precedence: this field, then {env}.",
      sourceUi: "Source: this plugin's settings",
      sourceEnv: "Source: {env} environment",
      sourceNone: "Source: no key set",
      modelTitle: "Model serving",
      modelHint: "Only chat-capable catalog routes are advertised. Context and reasoning come from the live catalog.",
      modelCount: "{n} models",
      catalogError: "Catalog unavailable",
      turnLabel: "Completion tokens per turn",
      turnHint: "Reserved output budget for one turn. The catalog's max_tokens equals its context window, so it is not used as an output cap.",
      effortLabel: "Default reasoning effort",
      effortDefault: "Provider default",
      effortHint: "Used when a request does not select an effort. Reasoning-capable routes stream thinking separately from visible text.",
      usageTitle: "Usage and cost",
      usageMeta: "{sessions} sessions recorded",
      usageRequests: "Requests",
      usageCost: "Billed",
      usageHint: "Cost comes from the provider's own estimated_cost field, in USD. Records are stored locally and survive a restart.",
      usageResetButton: "Reset usage",
      usageReset: "Usage reset.",
      costFree: "$0",
      costTitle: "{n} requests this session",
      modelsTitle: "Served models",
      modelsHint: "Only ticked models appear in the model picker. Promotional routes are listed first.",
      modelsCount: "{enabled} of {total} enabled",
      modelsPromotions: "{n} on promotion",
      modelsAll: "All",
      modelsNone: "None",
      modelsSave: "Save model selection",
      modelsSaved: "Model selection saved.",
      modelsSearch: "Filter by id…",
      modelsEmpty: "No models matched.",
      badgePromo: "{pct}% off",
      badgeVision: "vision",
      badgeReasoning: "reasoning",
      priceLabel: "in ${in} · out ${out} / Mtok",
      priceList: "list ${in} · ${out}",
      contextLabel: "{n} ctx",
      enabledLabel: "Shown",
      usageList: "List price",
      usageSavings: "Promotion saved {amount}",
      chipBilledTitle: "{n} requests · billed by DeepInfra",
      platformTitle: "Platform status",
      platformHint: "Live values from GET /v1/metrics/live. These describe DeepInfra's whole fleet, not this account or this turn.",
      platformTps: "Tokens/s",
      platformRps: "Requests/s",
      platformTtft: "First token",
      platformUnavailable: "Live metrics unavailable right now.",
    },
      ko: {
      meta: {
        title: "딥인프라",
        description: "DeepSeek Harness용 딥인프라 모델 서빙",
      },
      nav: "딥인프라",
      loading: "딥인프라 설정을 불러오는 중…",
      loadError: "설정을 불러오지 못했습니다",
      retry: "다시 시도",
      save: "저장",
      saved: "저장했습니다.",
      saveError: "저장하지 못했습니다",
      nothingToSave: "변경된 내용이 없습니다.",
      credentialsTitle: "자격 증명",
      credentialsHint: "여기에 저장한 키를 {env}보다 먼저 사용합니다. 비워 두면 환경 변수를 계속 사용합니다.",
      apiKeyLabel: "API 키",
      apiKeyPlaceholder: "설정되지 않음",
      apiKeyHint: "비밀 값으로 저장되어 서버가 다시 반환하지 않습니다. 우선순위: 이 입력값, 그다음 {env}.",
      sourceUi: "출처: 이 플러그인 설정",
      sourceEnv: "출처: {env} 환경 변수",
      sourceNone: "출처: 설정된 키 없음",
      modelTitle: "모델 서빙",
      modelHint: "대화가 가능한 카탈로그 경로만 표시합니다. 컨텍스트와 추론 수준은 실시간 카탈로그에서 가져옵니다.",
      modelCount: "모델 {n}개",
      catalogError: "카탈로그를 사용할 수 없습니다",
      turnLabel: "턴당 완료 토큰",
      turnHint: "한 턴에 예약하는 출력 예산입니다. 카탈로그의 max_tokens는 컨텍스트 창과 같아서 출력 상한으로 쓰지 않습니다.",
      effortLabel: "기본 추론 수준",
      effortDefault: "제공자 기본값",
      effortHint: "요청에서 추론 수준을 고르지 않았을 때 사용합니다. 추론 지원 경로는 사고 과정을 본문과 분리해 스트리밍합니다.",
      usageTitle: "사용량과 비용",
      usageMeta: "세션 {sessions}개 기록됨",
      usageRequests: "요청 수",
      usageCost: "청구 금액",
      usageHint: "청구 금액은 DeepInfra가 실제로 과금한 값(estimated_cost)입니다. 정가는 같은 토큰을 카탈로그 정가로 계산한 값이며, 차액이 프로모션 할인입니다.",
      usageResetButton: "사용량 초기화",
      usageReset: "사용량을 초기화했습니다.",
      costFree: "$0",
      costTitle: "이 세션 요청 {n}건",
      modelsTitle: "서빙 모델",
      modelsHint: "체크한 모델만 모델 선택기에 나타납니다. 프로모션 경로가 먼저 표시됩니다.",
      modelsCount: "{total}개 중 {enabled}개 활성",
      modelsPromotions: "프로모션 {n}개",
      modelsAll: "전체",
      modelsNone: "없음",
      modelsSave: "모델 선택 저장",
      modelsSaved: "모델 선택을 저장했습니다.",
      modelsSearch: "모델 id로 검색…",
      modelsEmpty: "일치하는 모델이 없습니다.",
      badgePromo: "{pct}% 할인",
      badgeVision: "비전",
      badgeReasoning: "추론",
      priceLabel: "입력 ${in} · 출력 ${out} / Mtok",
      priceList: "정가 ${in} · ${out}",
      contextLabel: "컨텍스트 {n}",
      enabledLabel: "표시",
      usageList: "정가 합계",
      usageSavings: "프로모션 절감 {amount}",
      chipBilledTitle: "{n}개 요청 · 실제 청구 금액",
      platformTitle: "플랫폼 상태",
      platformHint: "GET /v1/metrics/live 실시간 값입니다. 이 값은 딥인프라 전체 플릿 기준이며, 이 계정이나 이번 턴의 수치가 아닙니다.",
      platformTps: "토큰/초",
      platformRps: "요청/초",
      platformTtft: "첫 토큰",
      platformUnavailable: "지금은 실시간 지표를 가져올 수 없습니다.",
    },
    }

    const OWN_PROVIDER_IDS = ['deepinfra']
    const COST_POLL_MS = 15000
    const COST_REFRESH_DEBOUNCE_MS = 400

    // Root states font-size 14px / line-height 22px: DSH defines no font-size
    // token and sets none on body, so an omitted size inherits the UA 16px
    // (docs/PLUGIN-STYLE-STANDARD.md). Every colour is a --dsw-* token.
    const CSS = [
  '.difSection{min-width:0;max-width:720px;padding:16px 0;display:flex;flex-direction:column;gap:12px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}',
  '.difCard{border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-xl);padding:12px 14px;display:flex;flex-direction:column;gap:10px;min-width:0}',
  '.difCardHead{display:flex;justify-content:space-between;align-items:baseline;gap:12px;min-width:0}',
  '.difCardTitle{color:var(--dsw-alias-label-primary);margin:0;font-size:14px;font-weight:500;line-height:22px}',
  '.difMeta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-align:right;min-width:0}',
  '.difHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}',
  '.difField{display:flex;flex-direction:column;gap:6px;min-width:0}',
  '.difLabel{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}',
  '.difInput{appearance:none;box-sizing:border-box;width:100%;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:6px 10px}',
  '.difInput:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}',
  '.difRow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
  '.difButton{appearance:none;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-bg-layer-3));border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:13px;line-height:20px;padding:5px 14px}',
  '.difButton:disabled{cursor:default;opacity:.55}',
  '.difButtonGhost{background:0 0}',
  '.difNotice{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin:0}',
  '.difError{color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:20px;margin:0}',
  '.difOk{color:var(--dsw-alias-state-success-primary);font-size:13px;line-height:20px;margin:0}',
  '.difStats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}',
  '.difStat{display:flex;flex-direction:column;gap:2px;min-width:0}',
  '.difStatLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
  '.difStatValue{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px;font-variant-numeric:tabular-nums}',
  '.difChip{box-sizing:border-box;display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:var(--dsw-radius-sm);background:0 0;border:0;cursor:pointer;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:19px;white-space:nowrap;font-variant-numeric:tabular-nums}',
  '.difChip:hover{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-secondary)}',
  '.difToolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
  '.difSearch{flex:1 1 160px;min-width:120px}',
  '.difList{border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-lg);margin:0;padding:8px;list-style:none;display:flex;flex-direction:column;gap:2px;max-height:340px;overflow:auto}',
  '.difRowItem{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;padding:6px;border-radius:var(--dsw-radius-md);min-width:0}',
  '@media (hover:hover){.difRowItem:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}}',
  '.difRowMain{display:flex;flex-direction:column;gap:1px;min-width:0}',
  '.difRowId{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.difRowMeta{display:flex;gap:6px;flex-wrap:wrap;align-items:center;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}',
  '.difBadge{flex:0 0 auto;font-size:11px;line-height:16px;padding:0 6px;border-radius:var(--dsw-radius-xs);border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);white-space:nowrap}',
  '.difBadgePromo{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}',
  '.difBadgeVision{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
  '.difPriceOld{text-decoration:line-through;opacity:.7}',
].join('')
    const CSS_TAG_ID = '@nolit/dsh-deepinfra/ui.css'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG_ID) + ']') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = '@nolit/dsh-deepinfra'
      tag.dataset.pluginCss = CSS_TAG_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    /** Current host language; falls back to the browser locale. */
    let localeReader = () => ''
    function currentLang() {
      const active = String(localeReader() || (typeof navigator !== 'undefined' ? navigator.language : '') || '')
      return /^ko/i.test(active) ? 'ko' : 'en'
    }

    /**
     * Translate one key.
     * @param {string} key - message key.
     * @param {object} [params] - {name} placeholders.
     * @returns {string} localized text.
     */
    function t(key, params) {
      const table = I18N[currentLang()] ?? I18N.en
      const text = table[key] ?? I18N.en[key] ?? key
      if (!params) return text
      return Object.entries(params).reduce((acc, [name, value]) => acc.split('{' + name + '}').join(String(value)), text)
    }

    /**
     * Post to this plugin's local route.
     * @param {string} route - route suffix.
     * @param {object} [payload] - JSON body.
     * @returns {Promise<object>} the reply.
     */
    async function post(route, payload) {
      const response = await fetch('/api/local/deepinfra/' + route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok && body?.error === undefined) throw new Error('HTTP ' + response.status)
      return body
    }

    /**
     * Whether the composer currently has a DeepInfra route selected.
     *
     * The PROVIDER id is the only evidence used: model ids are shared across
     * routers, so matching them shows the chip on routes this adapter never served.
     *
     * @returns {boolean} true when this plugin owns the selected route.
     */
    function usingOwnRoute() {
      if (typeof document === 'undefined') return false
      const node = document.querySelector('[data-provider-id][data-model-id]')
      if (node === null) return false
      return OWN_PROVIDER_IDS.includes(node.getAttribute('data-provider-id') ?? '')
    }

    /**
     * Observe composer route changes.
     * @param {() => void} onChange - called when the selection changes.
     * @returns {() => void} disconnect.
     */
    function watchRoute(onChange) {
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
      let last = ''
      const current = () => {
        const node = document.querySelector('[data-provider-id][data-model-id]')
        return node === null ? '' : (node.getAttribute('data-provider-id') ?? '') + '|' + (node.getAttribute('data-model-id') ?? '')
      }
      last = current()
      const check = () => {
        const next = current()
        if (next === last) return
        last = next
        onChange()
      }
      const observer = new MutationObserver(check)
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-provider-id', 'data-model-id'],
      })
      return () => observer.disconnect()
    }

    /**
     * The composer cost chip.
     * @param {object} props - InputActivityOwnerProps.
     * @returns {object|null} the chip, or null to occupy no seat.
     */
    function CostPill(props) {
      const onActiveChange = typeof props?.onActiveChange === 'function' ? props.onActiveChange : null
      // Release composer expansion on mount and unmount: never expands.
      React.useEffect(() => {
        if (onActiveChange === null) return undefined
        onActiveChange(false)
        return () => onActiveChange(false)
      }, [])
      const [onRoute, setOnRoute] = React.useState(() => usingOwnRoute())
      const [text, setText] = React.useState('')
      const [title, setTitle] = React.useState('')
      React.useEffect(() => {
        const disconnect = watchRoute(() => setOnRoute(usingOwnRoute()))
        // The composer may not exist yet at mount, so read once here too.
        setOnRoute(usingOwnRoute())
        return disconnect
      }, [])
      React.useEffect(() => {
        if (!onRoute) return undefined
        let live = true
        const refresh = async () => {
          const sessionId = document.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session') ?? ''
          try {
            const payload = await post('cost/session', { sessionId })
            if (!live) return
            const entry = payload.session ?? (payload.totals && payload.totals.requests > 0
              ? { requests: payload.totals.requests, costUsd: payload.totals.costUsd }
              : null)
            setText(typeof payload.text === 'string' ? payload.text : '')
            setTitle(entry ? t('costTitle', { n: entry.requests ?? 0 }) : '')
          } catch {
            /* keep the last value */
          }
        }
        void refresh()
        let pending = null
        const schedule = () => {
          if (pending !== null) return
          pending = setTimeout(() => { pending = null; void refresh() }, COST_REFRESH_DEBOUNCE_MS)
        }
        const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule)
        observer?.observe(document.body, { childList: true, subtree: true, characterData: true })
        const timer = setInterval(() => void refresh(), COST_POLL_MS)
        return () => {
          live = false
          observer?.disconnect()
          if (pending !== null) clearTimeout(pending)
          clearInterval(timer)
        }
      }, [onRoute])
      // Another provider is selected: occupy no seat at all.
      if (!onRoute) return null
      return h('button', {
        type: 'button',
        className: 'difChip',
        title,
        'data-dif-cost': '1',
        onClick: (event) => { event.preventDefault() },
      }, text === '' ? t('costFree') : text)
    }

    /**
     * The settings card: credential, catalog and usage.
     * @returns {object} the section element.
     */
    function DeepInfraSection() {
      const [state, setState] = React.useState({ status: 'loading', error: null })
      const [info, setInfo] = React.useState(null)
      const [draft, setDraft] = React.useState({ apiKey: '', turnMaxTokens: '', defaultEffort: '' })
      const [busy, setBusy] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [, setTick] = React.useState(0)
      const [models, setModels] = React.useState({ status: 'loading', rows: [], total: 0, enabled: 0, promotions: 0 })
      const [picked, setPicked] = React.useState([])
      const [filter, setFilter] = React.useState('')

      const load = React.useCallback(async () => {
        setState({ status: 'loading', error: null })
        try {
          const payload = await post('setup')
          setInfo(payload)
          setDraft({ apiKey: '', turnMaxTokens: String(payload.turnMaxTokens ?? ''), defaultEffort: String(payload.defaultEffort ?? '') })
          setState({ status: 'ready', error: null })
        } catch (error) {
          setState({ status: 'error', error: error.message })
        }
      }, [])

      React.useEffect(() => { void load() }, [load])

      const loadModels = React.useCallback(async () => {
        setModels((prev) => ({ ...prev, status: 'loading' }))
        try {
          const payload = await post('models')
          const rows = Array.isArray(payload.models) ? payload.models : []
          setPicked(rows.filter((row) => row.enabled).map((row) => row.id))
          setModels({
            status: 'ready',
            rows,
            total: payload.total ?? rows.length,
            enabled: rows.filter((row) => row.enabled).length,
            promotions: payload.promotionCount ?? 0,
          })
        } catch (error) {
          setModels({ status: 'error', rows: [], total: 0, enabled: 0, promotions: 0, error: error.message })
        }
      }, [])

      React.useEffect(() => { void loadModels() }, [loadModels])

      // Follow host locale changes so every label updates live.
      React.useEffect(() => {
        if (typeof ctxLocaleSubscribe !== 'function') return undefined
        return ctxLocaleSubscribe(() => setTick((n) => n + 1))
      }, [])

      const save = async () => {
        setBusy('save')
        setNotice('')
        try {
          const payload = {}
          if (draft.apiKey.trim().length > 0) payload.apiKey = draft.apiKey.trim()
          if (draft.turnMaxTokens.trim().length > 0) payload.turnMaxTokens = Number(draft.turnMaxTokens)
          if (draft.defaultEffort.trim().length > 0) payload.defaultEffort = draft.defaultEffort.trim()
          if (Object.keys(payload).length === 0) {
            setNotice(t('nothingToSave'))
            return
          }
          const next = await post('setup/apply', payload)
          if (next.error) { setNotice(t('saveError') + ': ' + next.error); return }
          setInfo(next)
          setDraft({ apiKey: '', turnMaxTokens: String(next.turnMaxTokens ?? ''), defaultEffort: String(next.defaultEffort ?? '') })
          setNotice(t('saved'))
        } catch (error) {
          setNotice(t('saveError') + ': ' + error.message)
        } finally {
          setBusy('')
        }
      }

      const resetUsage = async () => {
        setBusy('reset')
        try {
          await post('cost/reset', {})
          await load()
          setNotice(t('usageReset'))
        } finally {
          setBusy('')
        }
      }

      if (state.status === 'loading') return h('section', { className: 'difSection' }, h('p', { className: 'difHint' }, t('loading')))
      if (state.status === 'error') {
        return h('section', { className: 'difSection' },
          h('p', { className: 'difError' }, t('loadError') + ': ' + state.error),
          h('button', { type: 'button', className: 'difButton', onClick: () => void load() }, t('retry')))
      }

      const sourceLabel = info.apiKeySource === 'ui' ? t('sourceUi') : info.apiKeySource === 'env' ? t('sourceEnv') : t('sourceNone')
      return h('section', { className: 'difSection' },
        h('div', { className: 'difCard' },
          h('div', { className: 'difCardHead' },
            h('h4', { className: 'difCardTitle' }, t('credentialsTitle')),
            h('span', { className: 'difMeta' }, sourceLabel)),
          h('p', { className: 'difHint' }, t('credentialsHint', { env: info.apiKeyEnvName ?? 'DEEPINFRA_API_KEY' })),
          h('div', { className: 'difField' },
            h('label', { className: 'difLabel', htmlFor: 'difApiKey' }, t('apiKeyLabel')),
            h('input', {
              id: 'difApiKey',
              className: 'difInput',
              type: 'password',
              autoComplete: 'off',
              placeholder: info.hasApiKey ? info.apiKey : t('apiKeyPlaceholder'),
              value: draft.apiKey,
              onChange: (event) => setDraft((prev) => ({ ...prev, apiKey: event.target.value })),
            }),
            h('p', { className: 'difHint' }, t('apiKeyHint', { env: info.apiKeyEnvName ?? 'DEEPINFRA_API_KEY' }))),
          h('div', { className: 'difRow' },
            h('button', { type: 'button', className: 'difButton', disabled: busy === 'save', onClick: () => void save() }, t('save'))),
          notice === '' ? null : h('p', { className: notice === t('saved') || notice === t('usageReset') || notice === t('modelsSaved') ? 'difOk' : 'difError' }, notice)),
        h('div', { className: 'difCard' },
          h('div', { className: 'difCardHead' },
            h('h4', { className: 'difCardTitle' }, t('modelTitle')),
            h('span', { className: 'difMeta' }, t('modelCount', { n: info.catalogCount ?? 0 }))),
          h('p', { className: 'difHint' }, info.catalogError ? t('catalogError') + ': ' + info.catalogError : t('modelHint')),
          h('div', { className: 'difField' },
            h('label', { className: 'difLabel', htmlFor: 'difTurn' }, t('turnLabel')),
            h('input', {
              id: 'difTurn',
              className: 'difInput',
              type: 'number',
              min: '1',
              value: draft.turnMaxTokens,
              onChange: (event) => setDraft((prev) => ({ ...prev, turnMaxTokens: event.target.value })),
            }),
            h('p', { className: 'difHint' }, t('turnHint'))),
          h('div', { className: 'difField' },
            h('label', { className: 'difLabel', htmlFor: 'difEffort' }, t('effortLabel')),
            h('select', {
              id: 'difEffort',
              className: 'difInput',
              value: draft.defaultEffort,
              onChange: (event) => setDraft((prev) => ({ ...prev, defaultEffort: event.target.value })),
            },
              h('option', { value: '' }, t('effortDefault')),
              ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((id) => h('option', { key: id, value: id }, id))),
            h('p', { className: 'difHint' }, t('effortHint')))),
        h('div', { className: 'difCard' },
          h('div', { className: 'difCardHead' },
            h('h4', { className: 'difCardTitle' }, t('modelsTitle')),
            h('span', { className: 'difMeta' },
              t('modelsCount', { enabled: models.enabled, total: models.total })
              + (models.promotions > 0 ? ' · ' + t('modelsPromotions', { n: models.promotions }) : ''))),
          h('p', { className: 'difHint' }, t('modelsHint')),
          h('div', { className: 'difToolbar' },
            h('input', {
              className: 'difInput difSearch',
              type: 'search',
              placeholder: t('modelsSearch'),
              value: filter,
              onChange: (event) => setFilter(event.target.value),
            }),
            h('button', {
              type: 'button',
              className: 'difButton difButtonGhost',
              onClick: () => setPicked(models.rows.map((row) => row.id)),
            }, t('modelsAll')),
            h('button', {
              type: 'button',
              className: 'difButton difButtonGhost',
              onClick: () => setPicked([]),
            }, t('modelsNone'))),
          models.status === 'error'
            ? h('p', { className: 'difError' }, t('catalogError') + ': ' + models.error)
            : h('ul', { className: 'difList' },
                models.rows
                  .filter((row) => filter.trim().length === 0 || row.id.toLowerCase().includes(filter.trim().toLowerCase()))
                  .map((row) => {
                    const checked = picked.includes(row.id)
                    const priceText = row.price && row.price.output !== null
                      ? t('priceLabel', { in: Number(row.price.input ?? 0).toFixed(2), out: Number(row.price.output).toFixed(2) })
                      : ''
                    return h('li', { key: row.id, className: 'difRowItem' },
                      h('input', {
                        type: 'checkbox',
                        checked,
                        onChange: () => setPicked((prev) => (prev.includes(row.id) ? prev.filter((id) => id !== row.id) : [...prev, row.id])),
                      }),
                      h('div', { className: 'difRowMain' },
                        h('span', { className: 'difRowId', title: row.id }, row.id),
                        h('span', { className: 'difRowMeta' },
                          row.promotion
                            ? h('span', { className: 'difBadge difBadgePromo' }, t('badgePromo', { pct: row.promotion.percentOff }))
                            : null,
                          row.promotion && row.price && row.price.listOutput !== null
                            ? h('span', { className: 'difPriceOld' }, t('priceList', {
                                in: Number(row.price.listInput ?? 0).toFixed(2),
                                out: Number(row.price.listOutput).toFixed(2),
                              }))
                            : null,
                          priceText ? h('span', null, priceText) : null,
                          row.contextWindow ? h('span', null, t('contextLabel', { n: row.contextWindow })) : null,
                          row.vision ? h('span', { className: 'difBadge difBadgeVision' }, t('badgeVision')) : null,
                          row.reasoning ? h('span', { className: 'difBadge' }, t('badgeReasoning')) : null)),
                      h('span', { className: 'difMeta' }, checked ? t('enabledLabel') : ''))
                  })),
          h('div', { className: 'difRow' },
            h('button', {
              type: 'button',
              className: 'difButton',
              disabled: busy === 'models',
              onClick: async () => {
                setBusy('models')
                setNotice('')
                try {
                  const payload = await post('models/apply', { enabled: picked })
                  const rows = Array.isArray(payload.models) ? payload.models : []
                  setModels({
                    status: 'ready',
                    rows,
                    total: payload.total ?? rows.length,
                    enabled: rows.filter((item) => item.enabled).length,
                    promotions: payload.promotionCount ?? 0,
                  })
                  setNotice(payload.error ? t('saveError') + ': ' + payload.error : t('modelsSaved'))
                } catch (error) {
                  setNotice(t('saveError') + ': ' + error.message)
                } finally {
                  setBusy('')
                }
              },
            }, t('modelsSave')))),
        h('div', { className: 'difCard' },
          h('div', { className: 'difCardHead' },
            h('h4', { className: 'difCardTitle' }, t('platformTitle')),
            h('span', { className: 'difMeta' }, 'GET /v1/metrics/live')),
          h('p', { className: 'difHint' }, t('platformHint')),
          info.platform
            ? h('div', { className: 'difStats' },
                h('div', { className: 'difStat' },
                  h('span', { className: 'difStatLabel' }, t('platformTps')),
                  h('span', { className: 'difStatValue' }, Number(info.platform.tokens_per_second ?? 0).toFixed(0))),
                h('div', { className: 'difStat' },
                  h('span', { className: 'difStatLabel' }, t('platformRps')),
                  h('span', { className: 'difStatValue' }, Number(info.platform.requests_per_second ?? 0).toFixed(0))),
                h('div', { className: 'difStat' },
                  h('span', { className: 'difStatLabel' }, t('platformTtft')),
                  h('span', { className: 'difStatValue' }, Number(info.platform.time_to_first_token ?? 0).toFixed(3) + 's')))
            : h('p', { className: 'difHint' }, t('platformUnavailable'))),
        h('div', { className: 'difCard' },
          h('div', { className: 'difCardHead' },
            h('h4', { className: 'difCardTitle' }, t('usageTitle')),
            h('span', { className: 'difMeta' }, t('usageMeta', { sessions: info.usage?.sessions ?? 0 }))),
          h('div', { className: 'difStats' },
            h('div', { className: 'difStat' },
              h('span', { className: 'difStatLabel' }, t('usageRequests')),
              h('span', { className: 'difStatValue' }, String(info.usage?.requests ?? 0))),
            h('div', { className: 'difStat' },
              h('span', { className: 'difStatLabel' }, t('usageCost')),
              h('span', { className: 'difStatValue' }, '$' + Number(info.usage?.costUsd ?? 0).toFixed(6))),
            h('div', { className: 'difStat' },
              h('span', { className: 'difStatLabel' }, t('usageList')),
              h('span', { className: 'difStatValue' }, '$' + Number(info.usage?.listCostUsd ?? 0).toFixed(6)))),
          Number(info.usage?.listCostUsd ?? 0) > Number(info.usage?.costUsd ?? 0)
            ? h('p', { className: 'difOk' }, t('usageSavings', { amount: '$' + (Number(info.usage?.listCostUsd ?? 0) - Number(info.usage?.costUsd ?? 0)).toFixed(6) }))
            : null,
          h('p', { className: 'difHint' }, t('usageHint')),
          h('div', { className: 'difRow' },
            h('button', { type: 'button', className: 'difButton difButtonGhost', disabled: busy === 'reset', onClick: () => void resetUsage() }, t('usageResetButton')))))
    }

    const inject = ['slots', 'locale']

    /** Set by apply() so the section can follow locale changes. */
    let ctxLocaleSubscribe = null

    function apply(ctx) {
      localeReader = () => String(ctx?.locale?.getSnapshot?.()?.active ?? '')
      if (typeof ctx?.locale?.subscribe === 'function') {
        ctxLocaleSubscribe = (fn) => {
          const dispose = ctx.locale.subscribe(fn)
          return typeof dispose === 'function' ? dispose : undefined
        }
      }
      ctx.slots.inject('conversation.input.activity', () =>
        ctx.slots.register(
          { name: 'conversation.input.activity', id: 'deepinfra-cost', order: 0 },
          CostPill,
        ))
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          { name: 'settings.section', id: 'deepinfra', order: 61, label: () => (currentLang() === 'ko' ? '딥인프라' : 'DeepInfra') },
          DeepInfraSection,
        ))
    }

    exports.apply = apply
    exports.inject = inject
    exports.CostPill = CostPill
    exports.DeepInfraSection = DeepInfraSection
    Object.defineProperty(exports, 'default', { value: { apply, inject } })
    return module.exports
  },
})
