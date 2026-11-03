/**
 * `@nolit/dsh-opencode-v2` — browser half.
 *
 * Renders the single settings surface for this plugin: the "OpenCode V2" section.
 * It lists the models the local OpenCode catalog serves, groups them by plan (Go
 * subscription vs Zen pay-as-you-go), and lets the operator tick the ones the
 * prompt model picker should offer.
 *
 * Design notes:
 *   - This section is the ONLY place this plugin is configured. The generic
 *     auto-generated form is deliberately not advertised by the host half, so
 *     there is never a second screen over the same row.
 *   - Styling follows the native settings sections: a stylesheet injected once
 *     through a `data-plugin-css` tag, `--dsw-*` design tokens for every colour,
 *     border and radius, and card/list geometry matching
 *     `dsh-client-ui-settings-subagent`.
 *   - Availability is decided from the catalog's provider id alone — no per-model
 *     request, so opening this tab costs nothing against the account's quota.
 *     Refusals the backend reports during real turns surface here as badges.
 *
 * CommonJS module-loader factory: this file is served to the browser as-is.
 */
window.__ModuleLoader__.load({
  id: '@nolit/dsh-opencode-v2',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    // ===== STYLESHEET START =====
    // Injected exactly like a native section does: one `<style data-plugin-css>`
    // tag keyed by a stable id, so a reload replaces rather than duplicates it.
    const CSS = ".ocv2Section{min-width:0;padding:16px 0;display:grid;gap:16px}.ocv2Heading{color:var(--dsw-alias-label-primary);margin:0;font-size:13px;font-weight:600;line-height:1.5}.ocv2Hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}.ocv2Card{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);padding:14px;display:grid;gap:10px;min-width:0}.ocv2CardHead{display:flex;justify-content:space-between;align-items:baseline;gap:12px;min-width:0}.ocv2CardTitle{color:var(--dsw-alias-label-primary);margin:0;font-size:13px;font-weight:600;line-height:1.5}.ocv2Meta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5;text-align:right}.ocv2Segmented{display:inline-flex;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);overflow:hidden}.ocv2Segment{appearance:none;background:0 0;border:0;cursor:pointer;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:5px 14px;line-height:1.4}.ocv2Segment+.ocv2Segment{border-left:.5px solid var(--dsw-alias-border-l4)}.ocv2Segment[aria-pressed=\"true\"]{background:var(--dsw-alias-bg-layer-4);color:var(--dsw-alias-label-primary);font-weight:600}.ocv2Segment:disabled{cursor:default;opacity:.55}.ocv2Actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.ocv2Count{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;margin-left:auto}.ocv2Models{border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-lg);margin:0;padding:10px;display:grid;gap:6px;max-height:320px;overflow:auto}.ocv2Model{border-radius:var(--dsw-radius-md);cursor:pointer;display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;align-items:center;gap:8px;padding:6px;min-width:0}@media (hover:hover){.ocv2Model:hover{background:var(--dsw-alias-bg-layer-4)}}.ocv2ModelUnavailable{cursor:default;opacity:.6}.ocv2ModelName{color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.ocv2Route{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ocv2Badge{flex:0 0 auto;min-width:5.5em;text-align:center;font-size:11px;line-height:1.4;padding:1px 6px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}.ocv2BadgeUsable{color:var(--dsw-alias-label-primary)}.ocv2BadgeNew{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}.ocv2BadgeBad{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}.ocv2Plan{color:var(--dsw-alias-label-tertiary);font-size:11px;min-width:3.5em;text-align:right}.ocv2Rank{color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums;min-width:3em;text-align:right}.ocv2Notice{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;margin:0}.ocv2Error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.5;margin:0;display:flex;justify-content:space-between;align-items:center;gap:12px}.ocv2ErrorAction{color:var(--dsw-alias-link);cursor:pointer;background:0 0;border:0;padding:0;font:inherit}"
    const CSS_TAG_ID = '@nolit/dsh-opencode-v2/settings.css'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG_ID) + ']') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = '@nolit/dsh-opencode-v2'
      tag.dataset.pluginCss = CSS_TAG_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }
    // ===== STYLESHEET END =====

    // ===== I18N START =====
    const I18N = {
      ko: {
        nav: '오픈코드 V2',
        title: '오픈코드 V2 — 모델 서빙',
        hint: '이 탭이 이 플러그인의 유일한 설정 화면입니다. 체크한 모델만 프롬프트의 모델 선택기에 나타나며, 이미 선택된 세션은 그대로 동작합니다.',
        planTitle: '플랜',
        planHint: '계정에 있는 두 제공자 중 어느 쪽 모델을 쓸지 정합니다. 모델 id만으로 판정하므로 백엔드 요청이 발생하지 않습니다.',
        modelsTitle: '모델',
        modelsHint: '사용 가능으로 표시된 모델만 선택할 수 있습니다. 아무것도 고르지 않으면 플랜의 모든 모델이 제공됩니다.',
        planGo: 'Go 구독',
        planZen: 'Zen 종량제',
        selectAllAvailable: '사용 가능 전체 선택',
        clearAll: '전체 해제',
        save: '저장',
        saving: '저장 중…',
        saved: '저장했습니다.',
        count: '선택 {a} / 사용 가능 {b} / 전체 {c}',
        stateUsable: '사용 가능',
        stateNew: '새 모델',
        stateOtherPlan: '다른 플랜',
        stateUnavailable: '사용 불가',
        stateDeprecated: '지원 중단',
        stateAuth: '인증 오류',
        stateForbidden: '권한 없음',
        stateUnknown: '알 수 없음',
        refreshRanking: '사용량 순위 갱신',
        refreshing: '갱신 중…',
        rankingUpdated: '사용량 순위 {at} 기준',
        rankingMissing: '사용량 순위 없음 — 이름순 표시',
        rankingError: '사용량 순위를 가져오지 못했습니다',
        observedAt: '최근 관측 {at}',
        loadError: '설정을 불러오지 못했습니다',
        saveError: '저장하지 못했습니다',
        reload: '다시 불러오기',
        loading: '불러오는 중…',
      },
      en: {
        nav: 'OpenCode V2',
        title: 'OpenCode V2 — model serving',
        hint: 'This tab is the only configuration surface for this plugin. Checked models appear in the prompt model picker; sessions that already selected one keep working.',
        planTitle: 'Plan',
        planHint: 'Chooses which of the two providers on this account the picker offers. Decided from the model id alone, so no backend request is made.',
        modelsTitle: 'Models',
        modelsHint: 'Only usable models can be checked. Selecting none offers every model the plan allows.',
        planGo: 'Go subscription',
        planZen: 'Zen pay-as-you-go',
        selectAllAvailable: 'Select all usable',
        clearAll: 'Clear all',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved.',
        count: '{a} selected / {b} usable / {c} total',
        stateUsable: 'usable',
        stateNew: 'new model',
        stateOtherPlan: 'other plan',
        stateUnavailable: 'unavailable',
        stateDeprecated: 'deprecated',
        stateAuth: 'auth error',
        stateForbidden: 'no access',
        stateUnknown: 'unknown',
        refreshRanking: 'Refresh usage ranking',
        refreshing: 'Refreshing…',
        rankingUpdated: 'ranked by usage as of {at}',
        rankingMissing: 'no usage ranking — sorted by name',
        rankingError: 'Could not fetch the usage ranking',
        observedAt: 'last observed {at}',
        loadError: 'Could not load settings',
        saveError: 'Could not save',
        reload: 'Reload',
        loading: 'Loading…',
      },
    }
    // ===== I18N END =====

    let localeReader = null

    function activeLanguage() {
      try {
        const active = localeReader?.()
        if (active) return String(active)
      } catch {
        /* no locale service: fall through to the browser */
      }
      return typeof navigator !== 'undefined' ? String(navigator.language ?? '') : ''
    }

    function currentLang() {
      return /^ko/i.test(activeLanguage()) ? 'ko' : 'en'
    }

    function t(key, params) {
      const language = currentLang()
      const text = (I18N[language] ?? I18N.en)[key] ?? (I18N.en[key] ?? key)
      if (!params) return text
      return Object.entries(params).reduce((acc, [name, value]) => acc.split('{' + name + '}').join(String(value)), text)
    }

    function formatWhen(value) {
      if (!value) return ''
      const when = new Date(value)
      if (Number.isNaN(when.getTime())) return ''
      return when.toLocaleString(currentLang() === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })
    }

    async function post(route, payload) {
      const response = await fetch('/api/local/opencode-v2/' + route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body?.error ?? 'HTTP ' + response.status)
      return body
    }

    const STATE_KEYS = {
      usable: 'stateUsable',
      'other-plan': 'stateOtherPlan',
      unavailable: 'stateUnavailable',
      deprecated: 'stateDeprecated',
      auth: 'stateAuth',
      forbidden: 'stateForbidden',
      unknown: 'stateUnknown',
    }

    /** Rejection states that render in the error colour. */
    const REFUSAL_STATES = new Set(['unavailable', 'deprecated', 'auth', 'forbidden'])

    function badgeClass(model) {
      if (model.isNew) return 'ocv2Badge ocv2BadgeNew'
      if (REFUSAL_STATES.has(model.state)) return 'ocv2Badge ocv2BadgeBad'
      if (model.state === 'usable') return 'ocv2Badge ocv2BadgeUsable'
      return 'ocv2Badge'
    }

    /** A titled card, matching the native settings section grouping. */
    function Card(props) {
      return h(
        'section',
        { className: 'ocv2Card' },
        h(
          'div',
          { className: 'ocv2CardHead' },
          h('h4', { className: 'ocv2CardTitle' }, props.title),
          props.meta ? h('span', { className: 'ocv2Meta' }, props.meta) : null,
        ),
        props.hint ? h('p', { className: 'ocv2Hint' }, props.hint) : null,
        props.children,
      )
    }

    function OpenCodeModelSection() {
      const [state, setState] = React.useState({ status: 'loading', error: null })
      const [enabled, setEnabled] = React.useState([])
      const [plan, setPlan] = React.useState('go')
      const [models, setModels] = React.useState([])
      const [ranking, setRanking] = React.useState({ updatedAt: null, fetchedAt: 0 })
      const [observedAt, setObservedAt] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [reloadToken, setReloadToken] = React.useState(0)

      React.useEffect(() => {
        let alive = true
        setState({ status: 'loading', error: null })
        post('model-settings')
          .then((payload) => {
            if (!alive) return
            setEnabled(payload.enabled ?? [])
            setPlan(payload.activePlan ?? 'go')
            setModels(payload.models ?? [])
            setRanking(payload.ranking ?? { updatedAt: null, fetchedAt: 0 })
            setObservedAt(payload.observedAt ?? null)
            setState({ status: 'ready', error: null })
          })
          .catch((error) => alive && setState({ status: 'error', error: error.message }))
        return () => {
          alive = false
        }
      }, [reloadToken])

      const usableCount = models.filter((model) => model.available).length
      const toggle = (route) =>
        setEnabled((prev) => (prev.includes(route) ? prev.filter((item) => item !== route) : [...prev, route]))

      const save = async (nextPlan = plan, nextEnabled = enabled) => {
        setBusy('save')
        setNotice('')
        try {
          const payload = await post('model-settings/apply', { enabled: nextEnabled, activePlan: nextPlan })
          setEnabled(payload.enabled ?? [])
          setPlan(payload.activePlan ?? nextPlan)
          setModels(payload.models ?? [])
          setNotice(t('saved'))
        } catch (error) {
          setNotice(t('saveError') + ': ' + error.message)
        } finally {
          setBusy('')
        }
      }

      // Switching plans is a decision, not a draft: persist immediately so the
      // prompt picker follows the same plan.
      const choosePlan = (nextPlan) => {
        if (nextPlan === plan) return
        setPlan(nextPlan)
        save(nextPlan, enabled)
      }

      const refreshRanking = async () => {
        setBusy('ranking')
        setNotice('')
        try {
          const payload = await post('model-settings/ranking/refresh')
          setRanking({ updatedAt: payload.updatedAt ?? null, fetchedAt: payload.fetchedAt ?? 0 })
          const reloaded = await post('model-settings')
          setModels(reloaded.models ?? [])
          setNotice(t('rankingUpdated', { at: formatWhen(payload.updatedAt) }))
        } catch (error) {
          setNotice(t('rankingError') + ': ' + error.message)
        } finally {
          setBusy('')
        }
      }

      const heading = h('h3', { className: 'ocv2Heading' }, t('title'))

      if (state.status === 'loading') {
        return h('div', { className: 'ocv2Section' }, heading, h('p', { className: 'ocv2Hint' }, t('loading')))
      }
      if (state.status === 'error') {
        return h(
          'div',
          { className: 'ocv2Section' },
          heading,
          h(
            'p',
            { className: 'ocv2Error', role: 'alert' },
            h('span', null, t('loadError') + ': ' + state.error),
            h(
              'button',
              { type: 'button', className: 'ocv2ErrorAction', onClick: () => setReloadToken((n) => n + 1) },
              t('reload'),
            ),
          ),
        )
      }

      const stamp = ranking.updatedAt ? t('rankingUpdated', { at: formatWhen(ranking.updatedAt) }) : t('rankingMissing')
      const meta = [stamp, observedAt ? t('observedAt', { at: formatWhen(observedAt) }) : ''].filter(Boolean).join(' · ')

      return h(
        'div',
        { className: 'ocv2Section' },
        heading,
        h('p', { className: 'ocv2Hint' }, t('hint')),

        h(
          Card,
          { title: t('planTitle'), hint: t('planHint') },
          h(
            'div',
            { className: 'ocv2Segmented', role: 'group', 'aria-label': t('planTitle') },
            h(
              'button',
              {
                type: 'button',
                className: 'ocv2Segment',
                'aria-pressed': plan === 'go',
                disabled: busy !== '',
                onClick: () => choosePlan('go'),
              },
              t('planGo'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'ocv2Segment',
                'aria-pressed': plan === 'zen',
                disabled: busy !== '',
                onClick: () => choosePlan('zen'),
              },
              t('planZen'),
            ),
          ),
        ),

        h(
          Card,
          { title: t('modelsTitle'), hint: t('modelsHint'), meta },
          h(
            'div',
            { className: 'ocv2Actions' },
            h(
              'button',
              { type: 'button', className: 'ocv2Segment', disabled: busy !== '', onClick: () => save() },
              busy === 'save' ? t('saving') : t('save'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'ocv2Segment',
                disabled: busy !== '',
                onClick: () => save(plan, models.filter((model) => model.available).map((model) => model.route)),
              },
              t('selectAllAvailable'),
            ),
            h(
              'button',
              { type: 'button', className: 'ocv2Segment', disabled: busy !== '', onClick: () => setEnabled([]) },
              t('clearAll'),
            ),
            h(
              'button',
              { type: 'button', className: 'ocv2Segment', disabled: busy !== '', onClick: refreshRanking },
              busy === 'ranking' ? t('refreshing') : t('refreshRanking'),
            ),
            h('span', { className: 'ocv2Count' }, t('count', { a: enabled.length, b: usableCount, c: models.length })),
          ),

          notice ? h('p', { className: 'ocv2Notice', role: 'status' }, notice) : null,

          h(
            'ul',
            { className: 'ocv2Models', style: { listStyle: 'none' } },
            models.map((model) => {
              const badgeKey = STATE_KEYS[model.state] ?? 'stateUnknown'
              const label = model.isNew ? t('stateNew') : t(badgeKey)
              const checkboxId = 'ocv2-' + model.route.replace(/[^a-zA-Z0-9_-]/g, '-')
              return h(
                'li',
                {
                  key: model.route,
                  className: model.available ? 'ocv2Model' : 'ocv2Model ocv2ModelUnavailable',
                },
                h('input', {
                  type: 'checkbox',
                  id: checkboxId,
                  checked: enabled.includes(model.route),
                  onChange: () => toggle(model.route),
                  disabled: !model.available,
                }),
                h('span', { className: badgeClass(model), title: label }, label),
                h(
                  'label',
                  { htmlFor: checkboxId, style: { minWidth: 0 } },
                  h('span', { className: 'ocv2ModelName' }, model.name ?? model.route),
                  h('span', { className: 'ocv2Route' }, model.route),
                ),
                model.plan === 'go' || model.plan === 'zen'
                  ? h('span', { className: 'ocv2Plan' }, model.plan)
                  : h('span', { style: { minWidth: '3.5em' } }),
                typeof model.rank === 'number'
                  ? h('span', { className: 'ocv2Rank' }, '#' + model.rank)
                  : h('span', { style: { minWidth: '3em' } }),
              )
            }),
          ),
        ),
      )
    }

    const inject = ['slots', 'locale']

    function apply(ctx) {
      localeReader = () => String(ctx.locale?.getSnapshot?.()?.active ?? '')
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'opencode-v2',
            order: 60,
            label: () => t('nav'),
          },
          OpenCodeModelSection,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    exports.OpenCodeModelSection = OpenCodeModelSection
    Object.defineProperty(exports, 'default', { value: { apply, inject } })
    return module.exports
  },
})
