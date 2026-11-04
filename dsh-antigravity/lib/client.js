/**
 * @nolit/dsh-antigravity -- browser half.
 *
 * Two slots, each following the pattern proven by the DeepInfra and OpenCode v2
 * tracks:
 *
 *   1. settings.section              -> the "Antigravity" / "안티그래비티" card.
 *   2. conversation.input.right      -> the usage chip beside the model selector.
 *
 *      The composer's `conversation.input.activity` slot is SINGLE and already
 *      owned by the token-economizer ("tk") in the live profile. Registering a
 *      second occupant there throws a page error and hides the chip (measured
 *      2026-11-05). `input.right` is a LIST slot with the same visual position,
 *      so the chip is additive and never fights for a single seat.
 *
 * MODULE FORMAT: served to the browser as-is and evaluated by
 * window.__ModuleLoader__, so it must be a CommonJS factory. ESM import/export
 * statements both fail to load.
 *
 * LOCALE: strings live in locale/en.json and locale/ko.json. That JSON is the
 * single source of truth; scripts/gen-locale.mjs bakes it into lib/locale-table.js
 * which the loader injects below. English is the default; when the host locale is
 * Korean every string switches, and a locale change re-renders live.
 *
 * STYLE ISOLATION: every colour, border, radius, size and line-height is a
 * --dsw-* design token or inherited. The root sets `font: inherit` so this
 * section cannot change the host font family, and no rule targets a bare element
 * selector, so nothing leaks outside .agSection / .agPill.
 *
 * DISABLE: with the master switch off the section still renders (so it can be
 * turned back on) but shows a notice and disables every control; the chip renders
 * nothing at all, leaving no empty node in the composer toolbar.
 */
window.__ModuleLoader__.load({
  id: '@nolit/dsh-antigravity',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    // Baked from locale/*.json by scripts/gen-locale.mjs.
    const I18N = {
  "en": {
    "meta": {
      "title": "Antigravity Agent",
      "description": "CLI worker, subscription model serving, and usage for Antigravity."
    },
    "nav": "Antigravity",
    "loading": "Loading Antigravity settings…",
    "sectionTitle": "Antigravity",
    "sectionHint": "Runs on your Antigravity subscription. The CLI worker and the HTTP model route share one credential.",
    "switchesTitle": "Surfaces",
    "enabledLabel": "Enabled",
    "enabledHint": "Master switch. Off removes the model route, the CLI worker, the subagent and the usage chip. This panel stays so you can turn it back on.",
    "modelServingLabel": "Model serving",
    "modelServingHint": "Offer the `antigravity` route to the model picker.",
    "cliWorkerLabel": "CLI worker",
    "cliWorkerHint": "Expose the /agy command and the agy_worker tool.",
    "usagePillLabel": "Usage chip",
    "usagePillHint": "Show token usage beside the model selector.",
    "accountTitle": "Account",
    "tier": "Tier",
    "paidTier": "Paid tier",
    "project": "Project",
    "endpoint": "Endpoint",
    "modelsTitle": "Models",
    "modelsHint": "Fetched live from the account, grouped by usage family. Quota is shared across the group.",
    "groupGemini": "Gemini Models",
    "groupClaudeGpt": "Claude and GPT models",
    "groupArgon": "Gemini 4 Argon",
    "groupOther": "Other models",
    "noModelsSelected": "Select at least one model.",
    "weeklyLimit": "Weekly",
    "fiveHourLimit": "5-hour",
    "modelsCount": "{enabled} of {total} enabled",
    "modelsSave": "Save selection",
    "modelsSaved": "Selection saved.",
    "shownLabel": "Shown",
    "quota": "quota left",
    "usageTitle": "Usage",
    "usageHint": "Counted by this plugin from real turns since the harness started.",
    "usageRequests": "requests",
    "usageInput": "input",
    "usageOutput": "output",
    "usageReasoning": "reasoning",
    "usageResetButton": "Reset",
    "saveError": "Could not save",
    "loadError": "Could not load",
    "disabledNotice": "Antigravity is disabled. Turn it on to use the model route and CLI worker.",
    "pillLabel": "usage",
    "noModels": "No models reported for this account."
  },
  "ko": {
    "meta": {
      "title": "안티그래비티 에이전트",
      "description": "안티그래비티 CLI 워커, 구독 모델 서빙, 사용량입니다."
    },
    "nav": "안티그래비티",
    "loading": "안티그래비티 설정을 불러오는 중…",
    "sectionTitle": "안티그래비티",
    "sectionHint": "안티그래비티 구독으로 동작합니다. CLI 워커와 HTTP 모델 라우트가 하나의 자격증명을 함께 씁니다.",
    "switchesTitle": "표면",
    "enabledLabel": "활성화",
    "enabledHint": "마스터 스위치입니다. 끄면 모델 라우트, CLI 워커, 서브에이전트, 사용량 칩이 사라집니다. 이 탭은 다시 켤 수 있도록 남습니다.",
    "modelServingLabel": "모델 서빙",
    "modelServingHint": "`antigravity` 라우트를 모델 선택기에 제공합니다.",
    "cliWorkerLabel": "CLI 워커",
    "cliWorkerHint": "/agy 명령과 agy_worker 도구를 노출합니다.",
    "usagePillLabel": "사용량 칩",
    "usagePillHint": "모델 선택기 옆에 토큰 사용량을 표시합니다.",
    "accountTitle": "계정",
    "tier": "등급",
    "paidTier": "유료 등급",
    "project": "프로젝트",
    "endpoint": "엔드포인트",
    "modelsTitle": "모델",
    "modelsHint": "계정에서 실시간으로 가져옵니다. 사용량 패밀리별로 묶이며 쿼터는 그룹 단위로 공유됩니다.",
    "groupGemini": "Gemini 모델",
    "groupClaudeGpt": "Claude 및 GPT 모델",
    "groupArgon": "Gemini 4 Argon",
    "groupOther": "기타 모델",
    "noModelsSelected": "모델을 하나 이상 선택하세요.",
    "weeklyLimit": "주간",
    "fiveHourLimit": "5시간",
    "modelsCount": "{total}개 중 {enabled}개 활성",
    "modelsSave": "선택 저장",
    "modelsSaved": "선택을 저장했습니다.",
    "shownLabel": "표시",
    "quota": "쿼터 잔여",
    "usageTitle": "사용량",
    "usageHint": "하네스 시작 이후 실제 턴에서 이 플러그인이 집계한 값입니다.",
    "usageRequests": "요청",
    "usageInput": "입력",
    "usageOutput": "출력",
    "usageReasoning": "추론",
    "usageResetButton": "초기화",
    "saveError": "저장할 수 없습니다",
    "loadError": "불러오지 못했습니다",
    "disabledNotice": "안티그래비티가 비활성화되어 있습니다. 모델 라우트와 CLI 워커를 쓰려면 켜세요.",
    "pillLabel": "사용량",
    "noModels": "이 계정에서 보고된 모델이 없습니다."
  }
}

    const CSS = [
      '.agSection{min-width:0;max-width:720px;padding:16px 0;display:flex;flex-direction:column;gap:12px;font-family:inherit;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary)}',
      '.agHeading{color:var(--dsw-alias-label-primary);margin:0;font-family:inherit;font-size:calc(var(--dsh-content-font-size,14px) + 2px);font-weight:500;line-height:24px}',
      '.agHint{color:var(--dsw-alias-label-tertiary);margin:0;font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}',
      '.agCard{border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-xl);padding:12px 14px;display:flex;flex-direction:column;gap:10px;min-width:0}',
      '.agCardHead{display:flex;justify-content:space-between;align-items:baseline;gap:12px;min-width:0}',
      '.agCardTitle{color:var(--dsw-alias-label-primary);margin:0;font-family:inherit;font-size:var(--dsh-content-font-size,14px);font-weight:500;line-height:calc(22px + var(--dsh-content-font-delta,0px))}',
      '.agMeta{color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));text-align:right;min-width:0}',
      '.agRow{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}',
      '.agRowText{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.agRowLabel{color:var(--dsw-alias-label-primary);font-family:inherit;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px))}',
      '.agRowHint{color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));margin:0}',
      '.agToggle{appearance:none;border:.5px solid var(--dsw-alias-border-l4);background:0 0;border-radius:999px;width:36px;height:20px;position:relative;cursor:pointer;flex:0 0 auto;padding:0}',
      '.agToggle::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-tertiary);transition:transform .15s ease}',
      '.agToggle[aria-pressed=true]{background:var(--dsw-alias-button-ghost-active-fill);border-color:var(--dsw-alias-state-success-primary)}',
      '.agToggle[aria-pressed=true]::after{transform:translateX(16px);background:var(--dsw-alias-state-success-primary)}',
      '.agToggle:disabled{opacity:.55;cursor:default}',
      '.agStats{display:flex;flex-wrap:wrap;gap:16px}',
      '.agStat{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.agStatLabel{color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}',
      '.agStatValue{color:var(--dsw-alias-label-primary);font-family:inherit;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));font-variant-numeric:tabular-nums}',
      '.agModels{border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-lg);margin:0;padding:10px;display:flex;flex-direction:column;gap:2px;max-height:320px;overflow:auto}',
      '.agModel{border-radius:var(--dsw-radius-md);cursor:pointer;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px;padding:6px;min-width:0}',
      '@media (hover:hover){.agModel:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}}',
      '.agModelName{color:var(--dsw-alias-label-primary);font-family:inherit;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.agRoute{color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.agQuota{color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.agActions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
      '.agButton{appearance:none;border:.5px solid var(--dsw-alias-border-l4);background:0 0;border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;padding:5px 14px;cursor:pointer}',
      '.agButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}',
      '.agButton:disabled{opacity:.55;cursor:default}',
      '.agNotice{color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));margin:0}',
      '.agError{color:var(--dsw-alias-state-error-primary);font-family:inherit;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));margin:0}',
      '.agPill{display:inline-flex;align-items:center;gap:6px;font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);padding:0 6px;white-space:nowrap}',
      '.agPillValue{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
    ].join('')

    let localeReader = () => ''
    const currentLang = () => (String(localeReader() || '').toLowerCase().startsWith('ko') ? 'ko' : 'en')
    const table = () => I18N[currentLang()] ?? I18N.en
    const t = (key, vars) => {
      const value = table()[key] ?? I18N.en[key] ?? key
      if (!vars) return value
      return String(value).replace(/\{(\w+)\}/g, (match, name) => String(vars[name] ?? ''))
    }

    /** Inject the stylesheet once, keyed so a reload replaces it. */
    function ensureStyle() {
      if (typeof document === 'undefined' || !document.head) return
      if (document.head.querySelector('style[data-plugin-css="@nolit/dsh-antigravity"]')) return
      const style = document.createElement('style')
      style.setAttribute('data-plugin-css', '@nolit/dsh-antigravity')
      style.textContent = CSS
      document.head.appendChild(style)
    }

    /**
     * Read one panel route.
     *
     * POST, not GET: the host route descriptor declares `methods: ['POST']` (the
     * same descriptor dsh-deepinfra uses), so a GET never reaches the handler and
     * the fetch answers 404 even though the route is registered.
     */
    async function get(suffix) {
      const response = await fetch('/api/local/dsh-antigravity/' + suffix, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      if (!response.ok) throw new Error('HTTP ' + response.status)
      return response.json()
    }

    /** Post to one panel route. */
    async function post(suffix, body) {
      const response = await fetch('/api/local/dsh-antigravity/' + suffix, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error('HTTP ' + response.status)
      return response.json()
    }

    /**
     * The settings section: MODEL SELECTION ONLY.
     *
     * The plugin's own options (master enable, modelServing, cliWorker,
     * usagePill) live in the plugin row / profile patch and are toggled from the
     * DSH Plugins page. Repeating them here duplicated the control surface and
     * made the tab noisy, so this section keeps only the one task that has no
     * other home: choosing which account models the picker advertises.
     */
    function AntigravitySection() {
      ensureStyle()
      const [state, setState] = React.useState({ status: 'loading' })
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState('')
      const [, forceRender] = React.useReducer((n) => n + 1, 0)

      const load = React.useCallback(() => {
        return get('models')
          .then((models) => setState({ status: 'ready', models }))
          .catch((error) => setState({ status: 'error', error: error.message }))
      }, [])

      React.useEffect(() => {
        let alive = true
        void load()
        const unsubscribe = ctxLocaleSubscribe
          ? ctxLocaleSubscribe(() => { if (alive) forceRender() })
          : undefined
        return () => { alive = false; if (typeof unsubscribe === 'function') unsubscribe() }
      }, [load])

      if (state.status === 'loading') {
        return h('section', { className: 'agSection' }, h('p', { className: 'agHint' }, t('loading')))
      }
      if (state.status === 'error') {
        return h('section', { className: 'agSection' },
          h('h3', { className: 'agHeading' }, t('sectionTitle')),
          h('p', { className: 'agError' }, t('loadError') + ': ' + state.error))
      }

      const { groups, total, enabled: enabledCount } = state.models
      const GROUP_LABEL = {
        gemini: 'groupGemini',
        'claude-gpt': 'groupClaudeGpt',
        argon: 'groupArgon',
        other: 'groupOther',
      }
      const limitLabel = (window) => window === 'weekly' ? t('weeklyLimit') : t('fiveHourLimit')
      const groupLimits = (group) => {
        if (Array.isArray(group.limits) && group.limits.length > 0) {
          return group.limits
            .map((limit) => limitLabel(limit.window) + ' ' + Math.round(limit.remainingFraction * 100) + '%')
            .join(' · ')
        }
        return group.quotaRemaining === null || group.quotaRemaining === undefined
          ? ''
          : Math.round(group.quotaRemaining * 100) + '% ' + t('quota')
      }
      const groupLimitTitle = (group) => (group.limits ?? []).map((limit) => limit.description).filter(Boolean).join(' / ')

      return h('section', { className: 'agSection' },
        h('h3', { className: 'agHeading' }, t('sectionTitle')),
        h('p', { className: 'agHint' }, t('sectionHint')),

        h('div', { className: 'agCard' },
          h('div', { className: 'agCardHead' },
            h('h4', { className: 'agCardTitle' }, t('modelsTitle')),
            h('span', { className: 'agMeta' }, t('modelsCount', { enabled: enabledCount, total }))),
          h('p', { className: 'agHint' }, t('modelsHint'))),

        groups.length === 0
          ? h('div', { className: 'agCard' }, h('p', { className: 'agHint' }, t('noModels')))
          : groups.map((group) => h('div', { className: 'agCard', key: group.kind + '|' + (group.quotaReset ?? '') },
              h('div', { className: 'agCardHead' },
                h('h4', { className: 'agCardTitle' }, t(GROUP_LABEL[group.kind] ?? 'groupOther')),
                h('span', { className: 'agMeta', title: groupLimitTitle(group) }, groupLimits(group))),
              h('div', { className: 'agModels' },
                group.models.map((model) => h('label', { key: model.id, className: 'agModel' },
                  h('input', {
                    type: 'checkbox',
                    checked: model.enabled,
                    onChange: () => {
                      const nextGroups = groups.map((candidate) => candidate !== group ? candidate : {
                        ...candidate,
                        models: candidate.models.map((item) => item.id === model.id
                          ? { ...item, enabled: !model.enabled }
                          : item),
                      })
                      setState((prev) => prev.status === 'ready'
                        ? { ...prev, models: { ...prev.models, groups: nextGroups } }
                        : prev)
                    },
                  }),
                  h('span', { className: 'agRoute' },
                    h('div', { className: 'agModelName' }, model.name ?? model.id),
                    model.id)))))),

        h('div', { className: 'agCard' },
          h('div', { className: 'agActions' },
            h('button', {
              type: 'button',
              className: 'agButton',
              disabled: busy,
              onClick: () => {
                const allEnabled = groups.every((group) => group.models.every((model) => model.enabled))
                const picked = allEnabled
                  ? []
                  : groups.flatMap((group) => group.models.filter((model) => model.enabled).flatMap((model) => model.variants))
                if (!allEnabled && picked.length === 0) {
                  setNotice(t('noModelsSelected'))
                  return
                }
                setBusy(true)
                post('models/apply', { enabled: picked })
                  .then(() => { setNotice(t('modelsSaved')); return load() })
                  .catch((error) => setNotice(t('saveError') + ': ' + error.message))
                  .finally(() => setBusy(false))
              },
            }, t('modelsSave')),
            notice ? h('span', { className: 'agNotice' }, notice) : null)))
    }

    /**
     * The usage chip.
     *
     * Renders nothing unless the plugin is enabled and its usage switch is on, so
     * a disabled plugin leaves no empty node in the composer toolbar. The count
     * is this plugin's own measured usage, never a guessed price: the
     * subscription has no per-call dollar figure.
     */
    function UsageChip() {
      ensureStyle()
      const [snapshot, setSnapshot] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        const tick = () => get('info')
          .then((value) => { if (alive) setSnapshot(value) })
          .catch(() => { if (alive) setSnapshot(null) })
        void tick()
        const timer = setInterval(tick, 5000)
        return () => { alive = false; clearInterval(timer) }
      }, [])
      if (!snapshot) return null
      if (snapshot.switches.enabled === false || snapshot.switches.usagePill === false) return null
      const usage = snapshot.usage ?? {}
      const total = Number(usage.inputTokens ?? 0) + Number(usage.outputTokens ?? 0) + Number(usage.reasoningTokens ?? 0)
      if (total === 0) return null
      return h('span', { className: 'agPill', title: t('pillLabel') },
        h('span', null, t('pillLabel')),
        h('span', { className: 'agPillValue' }, total.toLocaleString()))
    }

    /**
     * Services this factory needs before `apply` may run.
     *
     * MANDATORY and EXPORTED. docs/dsh-plugin-runtime-spec.md §3.1: the loader
     * injects only what `module.exports.inject` lists. A merely-declared array
     * buys nothing, `ctx.slots`/ `ctx.locale` come back undefined, the first call
     * throws during activation, and the shell reports
     * "web boot: N entries did not activate" — which stops the ENTIRE web UI
     * from mounting while the Host side stays healthy. That is exactly how
     * opencode-v2@0.6.0 broke the GUI (measured 2026-10-30).
     *
     * Every service touched in apply() must appear here: apply() uses ctx.slots
     * (two registrations) and ctx.locale (subscribe + getSnapshot).
     */
    const inject = ['slots', 'locale']

    /** Set by apply() so the section follows host locale changes. */
    let ctxLocaleSubscribe = null

    function apply(ctx) {
      localeReader = () => String(ctx?.locale?.getSnapshot?.()?.active ?? '')
      if (typeof ctx?.locale?.subscribe === 'function') {
        ctxLocaleSubscribe = (fn) => {
          const dispose = ctx.locale.subscribe(fn)
          return typeof dispose === 'function' ? dispose : undefined
        }
      }
      const releases = []
      releases.push(ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          { name: 'settings.section', id: 'antigravity', order: 62, label: () => (currentLang() === 'ko' ? '\uc548\ud2f0\uadf8\ub798\ube44\ud2f0' : 'Antigravity') },
          AntigravitySection,
        )))
      releases.push(ctx.slots.inject('conversation.input.right', () =>
        ctx.slots.register(
          { name: 'conversation.input.right', id: 'antigravity-usage', order: 1 },
          UsageChip,
        )))
      return () => {
        for (const release of releases.reverse()) {
          try { release?.() } catch { /* already released */ }
        }
      }
    }

    exports.apply = apply
    exports.inject = inject
    exports.I18N = I18N
    exports.UsageChip = UsageChip
    exports.AntigravitySection = AntigravitySection
    return module.exports
  },
})