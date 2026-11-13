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
    const CSS = ".ocv2Section{min-width:0;max-width:720px;padding:16px 0;display:flex;flex-direction:column;gap:12px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}.ocv2Heading{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}.ocv2Hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}.ocv2Card{border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-xl);padding:12px 14px;display:flex;flex-direction:column;gap:10px;min-width:0}.ocv2CardHead{display:flex;justify-content:space-between;align-items:baseline;gap:12px;min-width:0}.ocv2CardTitle{color:var(--dsw-alias-label-primary);margin:0;font-size:14px;font-weight:500;line-height:22px}.ocv2Meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-align:right;min-width:0}.ocv2Segmented{display:inline-flex;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);overflow:hidden}.ocv2Segment{appearance:none;background:0 0;border:0;cursor:pointer;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;padding:5px 14px}.ocv2Segment+.ocv2Segment{border-left:.5px solid var(--dsw-alias-border-l4)}.ocv2Segment[aria-pressed=true]{background:var(--dsw-alias-button-ghost-active-fill);color:var(--dsw-alias-label-primary);font-weight:500}.ocv2Segment:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}.ocv2Segment:disabled{cursor:default;opacity:.55}.ocv2Actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.ocv2Count{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin-left:auto}.ocv2Models{border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-lg);margin:0;padding:10px;display:flex;flex-direction:column;gap:2px;max-height:320px;overflow:auto}.ocv2Model{border-radius:var(--dsw-radius-md);cursor:pointer;display:grid;grid-template-columns:auto auto minmax(0,1fr) auto auto;align-items:center;gap:8px;padding:6px;min-width:0}@media (hover:hover){.ocv2Model:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}}.ocv2ModelUnavailable{cursor:default;opacity:.6}.ocv2Name{min-width:0;display:flex;flex-direction:column;gap:0}.ocv2ModelName{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.ocv2Route{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.ocv2Badge{flex:0 0 auto;min-width:5.5em;text-align:center;font-size:11px;line-height:18px;padding:0 6px;border-radius:var(--dsw-radius-xs);border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ocv2BadgeUsable{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}.ocv2BadgeNew{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}.ocv2BadgeBad{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}.ocv2Plan{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;min-width:3.5em;text-align:right}.ocv2Rank{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;font-variant-numeric:tabular-nums;min-width:3em;text-align:right}.ocv2Notice{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin:0}.ocv2Error{color:var(--dsw-alias-state-error-primary);font-size:14px;line-height:22px;margin:0;display:flex;justify-content:space-between;align-items:center;gap:12px}.ocv2ErrorAction{color:var(--dsw-alias-link);cursor:pointer;background:0 0;border:0;padding:0;font:inherit}.ocv2PlanPanel{position:fixed;z-index:1000;bottom:64px;right:24px;width:280px;padding:12px 14px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-settings-card-fill);border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-lg);box-shadow:0 8px 24px var(--dsw-alias-bg-mask-2)}.ocv2PlanHead{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary)}.ocv2PlanRefresh{appearance:none;background:0 0;border:0;padding:0;cursor:pointer;color:var(--dsw-alias-link);font:inherit;font-size:12px}.ocv2PlanBody{display:flex;flex-direction:column;gap:10px}.ocv2PlanRow{display:flex;flex-direction:column;gap:4px}.ocv2PlanRowTop{display:flex;justify-content:space-between;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}.ocv2PlanPct{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}.ocv2PlanBar{height:6px;border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-interactive-bg-hover-solid);overflow:hidden}.ocv2PlanFill{height:100%;background:var(--dsw-alias-state-business-primary);border-radius:inherit}.ocv2PlanFill[data-high]{background:var(--dsw-alias-state-error-primary)}.ocv2PlanReset{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}.ocv2PlanNote{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}.ocv2Pill{appearance:none;background:0 0;border:0;display:inline-flex;align-items:center;gap:6px;padding:0 6px;cursor:pointer;font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);white-space:nowrap}.ocv2Pill:hover{color:var(--dsw-alias-label-secondary)}.ocv2PillValue{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}.ocv2PlanSection{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);text-transform:none}.ocv2PlanModel{display:flex;flex-direction:column;gap:1px;min-width:0}.ocv2PlanModelName{font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ocv2PlanModelMeta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}.ocv2PlanDivider{height:.5px;background:var(--dsw-alias-border-l3);margin:2px 0}"
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
        count: '선택 {a} / 사용 가능 {b} / 이 플랜 {c}',
        otherPlan: '다른 플랜 {n}개는 목록에서 제외됩니다',
        costFree: '무료',
        pillLabel: '비용',
        costPlan: '플랜',
        costTitle: '이 세션 요청 {n}건의 실제 비용과 플랜 소진액 — 클릭하면 플랜 사용량',
        planUsageTitle: 'Go 플랜 사용량',
        planUsageRefresh: '새로고침',
        planUsageError: '플랜 사용량을 가져오지 못했습니다',
        planUsageEmpty: '표시할 플랜 사용량이 없습니다',
        windowRolling: '5시간',
        windowWeekly: '주간',
        windowMonthly: '월간',
        planResets: '{at} 초기화',
        costSessionTitle: '이 세션 {n}건 · 모델별',
        costAggregateOnly: '이 세션 {requests}건 · 모델별 내역은 재시작 후 표시됩니다',
        costRequests: '{n}건',
        costCacheRead: '캐시 {n}',
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
        count: '{a} selected / {b} usable / {c} on this plan',
        otherPlan: '{n} more on the other plan, not listed here',
        costFree: 'free',
        pillLabel: 'Cost',
        costPlan: 'plan',
        costTitle: 'Actual cost and plan burn for this session\'s {n} request(s) — click for plan usage',
        planUsageTitle: 'Go plan usage',
        planUsageRefresh: 'Refresh',
        planUsageError: 'Could not read the plan usage',
        planUsageEmpty: 'No plan usage to show',
        windowRolling: '5-hour',
        windowWeekly: 'Weekly',
        windowMonthly: 'Monthly',
        planResets: 'resets {at}',
        costSessionTitle: '{n} requests this session, by model',
        costAggregateOnly: '{requests} requests; the per-model split appears after a restart',
        costRequests: '{n} req',
        costCacheRead: 'cache {n}',
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
        /* no locale service */
      }
      // English is the default. Korean renders ONLY while the DSH locale service's
      // active language is ko; the browser locale is not a fallback (owner rule
      // 2026-11-05).
      return ''
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

    /**
     * Badge text key for one row.
     *
     * STATE decides the badge. "New" is a bonus, not a status: it may decorate a
     * row of the plan being shown, but it must never relabel a route that belongs
     * to another plan. Measured 2026-11-04 before this rule: `pulse-alpha-free`
     * (zen, first seen 2026-11-03T08:32Z) showed the "새 모델" badge while Go was
     * selected, so a model that cannot be chosen looked like the freshest one.
     *
     * @param {{ state: string, isNew?: boolean, plan?: string }} model
     * @returns {string} an I18N key.
     */
    function badgeKey(model) {
      if (model.state === 'usable') return model.isNew ? 'stateNew' : 'stateUsable'
      return STATE_KEYS[model.state] ?? 'stateUnknown'
    }

    /**
     * Badge colour class for one row.
     *
     * @param {{ state: string, isNew?: boolean }} model
     * @returns {string} the class list.
     */
    function badgeClass(model) {
      if (model.state === 'usable') return model.isNew ? 'ocv2Badge ocv2BadgeNew' : 'ocv2Badge ocv2BadgeUsable'
      if (REFUSAL_STATES.has(model.state)) return 'ocv2Badge ocv2BadgeBad'
      return 'ocv2Badge'
    }

    /**
     * One model row: checkbox, status badge, two text lines, plan, rank.
     *
     * Kept as a pure function of its props so the two-line contract can be
     * asserted in the suite (test/client-rows.test.mjs) instead of by rendering
     * the whole settings page. The two lines are deliberately separate spans: the
     * display name is not a prefix of the route, and a reader must be able to see
     * both the friendly name and the exact `provider/model` the call uses.
     *
     * @param {{ h: Function, model: object, checked: boolean, label: string,
     *   badge: string, checkboxId: string, onToggle: (route: string) => void }} props
     * @returns {object} the row element.
     */
    function ModelRow(props) {
      const { h, model, checked, label, badge, checkboxId, onToggle } = props
      const plan = model.plan === 'go' || model.plan === 'zen'
      return h(
        'li',
        {
          key: model.route,
          className: model.available ? 'ocv2Model' : 'ocv2Model ocv2ModelUnavailable',
        },
        h('input', {
          type: 'checkbox',
          id: checkboxId,
          checked,
          onChange: () => onToggle(model.route),
          disabled: !model.available,
        }),
        h('span', { className: badge, title: label }, label),
        h(
          'label',
          { htmlFor: checkboxId, className: 'ocv2Name' },
          h('span', { className: 'ocv2ModelName', title: model.name ?? model.route }, model.name ?? model.route),
          h('span', { className: 'ocv2Route', title: model.route }, model.route),
        ),
        plan ? h('span', { className: 'ocv2Plan' }, model.plan) : h('span', { style: { minWidth: '3.5em' } }),
        typeof model.rank === 'number'
          ? h('span', { className: 'ocv2Rank' }, '#' + model.rank)
          : h('span', { style: { minWidth: '3em' } }),
      )
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
      const [otherPlanCount, setOtherPlanCount] = React.useState(0)
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
            setOtherPlanCount(payload.otherPlanCount ?? 0)
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
          setOtherPlanCount(payload.otherPlanCount ?? 0)
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

          // The list is scoped to the active plan; the other plan is reported as a
          // count so an operator does not have to click a plan switch to learn
          // that routes exist elsewhere.
          otherPlanCount > 0
            ? h('p', { className: 'ocv2Hint' }, t('otherPlan', { n: otherPlanCount }))
            : null,

          notice ? h('p', { className: 'ocv2Notice', role: 'status' }, notice) : null,

          h(
            'ul',
            { className: 'ocv2Models', style: { listStyle: 'none' } },
            models.map((model) => {
              const checkboxId = 'ocv2-' + model.route.replace(/[^a-zA-Z0-9_-]/g, '-')
              return ModelRow({
                h,
                model,
                checked: enabled.includes(model.route),
                label: t(badgeKey(model)),
                badge: badgeClass(model),
                checkboxId,
                onToggle: toggle,
              })
            }),
          ),
        ),
      )
    }

    // ===== STATUS PILL START =====
    /**
     * Session cost pill in the composer status row.
     *
     * The chat renders one `span[data-composer-stat]` per statistic; those pills
     * are chat-internal components, not slots, so this appends one more node to
     * the same row and re-attaches it across React re-renders. One cumulative
     * figure per session — deliberately NOT a per-turn badge.
     */
    const COST_POLL_MS = 15000
    /** Collapse a burst of DOM mutations into one cost read. */
    const COST_REFRESH_DEBOUNCE_MS = 400

    function formatUsd(usd) {
      if (typeof usd !== 'number' || !Number.isFinite(usd)) return ''
      if (usd === 0) return '$0'
      const abs = Math.abs(usd)
      if (abs >= 1) return '$' + usd.toFixed(2)
      if (abs >= 0.01) return '$' + usd.toFixed(4)
      return '$' + usd.toPrecision(3).replace(/0+$/, '').replace(/\.$/, '')
    }

    /**
     * Compact chip label: just the money.
     *
     * The owner rejected the "무료 · 플랜 $x" wording: the words carry no
     * information the panel does not, and on a Go plan the charged amount is
     * always zero, so the label was mostly noise. One figure, one place; the
     * panel holds the breakdown.
     *
     * @param {object|null} session - ledger entry.
     * @returns {string} e.g. `$0.0701`, or the zero form when nothing is spent.
     */
    function costPillText(session) {
      // No ledger entry = this session has no request on our route yet. That is
      // "nothing to show", not "$0": the chip must leave no seat until the first
      // measured request (docs/UI-SLOT-ARCHITECTURE.md §4).
      if (!session || typeof session !== 'object') return ''
      const cost = Number(session.costUsd ?? 0)
      const plan = Number(session.allowanceUsd ?? 0)
      // Go reports cost 0 on every request (usage inside the limit), so the plan
      // burn is the only figure that moves. Show whichever one actually did.
      return formatUsd(cost > 0 ? cost : plan)
    }

    /** Append or update the one plugin-owned pill in the composer status row. */
    /**
     * Append or update the one plugin-owned pill in the composer status row.
     *
     * The host renders its pills as THREE nested spans:
     *
     *   span.anchor[data-composer-stat]   <- font-size/line-height live HERE
     *     span.pill                        <- padding, radius, colour
     *       span.label                     <- ellipsis
     *
     * Measured live 2026-11-04: appending a bare `span.pill` to the row renders
     * 16px/normal/normal-height (26px tall) because `.pill` only sets
     * `font:inherit` — with no `.anchor` parent it inherits the page font. Nesting
     * it the way the host does yields 11px/19px/21px, identical to the host pill.
     * So the pill is built as anchor > pill > label, with the host's own classes
     * read off a live sibling rather than hardcoded (they are hashed per build).
     */
    /**
     * The provider ids THIS PACKAGE registers.
     *
     * `lib/http.js` registers `opencode-http-agent`; `lib/provider.js` registers
     * `opencode-agent`. Both are this plugin's own route, and that id — not a
     * model-name prefix — is what the host stamps on the composer chip.
     */
    const OWN_PROVIDER_IDS = ['opencode-http-agent', 'opencode-agent']

    /**
     * Whether the composer is currently pointed at this plugin's route.
     *
     * The model chip carries the machine-readable route
     * (`data-provider-id` / `data-model-id`, measured live 2026-11-04), so the
     * pill can be shown only while an OpenCode V2 model is selected. Nothing is
     * painted for another provider: a cost figure for a route this plugin does
     * not serve would be a lie.
     *
     * @returns {boolean} true when the selected model belongs to this adapter.
     */
    function usingOwnRoute() {
      if (typeof document === 'undefined') return false
      const node = document.querySelector('[data-provider-id][data-model-id]')
      if (!node) return false
      // ONLY the provider id decides. The model id is NOT evidence: a different
      // router can serve a model whose catalog id begins with `opencode-go/`
      // (that is where the id comes from — OpenCode's catalog — not from this
      // adapter). Measured 2026-11-04, owner report: "오픈코드 v2 서빙된 모델이 아닌
      // 다른 라우터에서 부른 모델인데 왜 이렇게 모델 서빙 옆에 붙냐". Matching the
      // model prefix showed the chip on every router that resells the same ids.
      const provider = node.getAttribute('data-provider-id') ?? ''
      return OWN_PROVIDER_IDS.includes(provider)
    }

    /**
     * Plan windows panel, opened by clicking the cost pill.
     *
     * Mirrors the Hermes `opencode-go-usage` chip: three bars (5 h / 7 d / 30 d)
     * with reset times and a refresh control. The numbers come from
     * `plan-usage`, which reads the local control plane the adapter already
     * uses — no second credential and no sidecar.
     */
    function togglePlanPanel() {
      const existing = document.querySelector('[data-ocv2-plan]')
      if (existing) { existing.remove(); return }
      const panel = document.createElement('div')
      panel.setAttribute('data-ocv2-plan', '1')
      panel.className = 'ocv2PlanPanel'
      panel.setAttribute('role', 'dialog')
      panel.setAttribute('aria-label', t('planUsageTitle'))
      const heading = document.createElement('div')
      heading.className = 'ocv2PlanHead'
      const title = document.createElement('span')
      title.textContent = t('planUsageTitle')
      const refresh = document.createElement('button')
      refresh.type = 'button'
      refresh.className = 'ocv2PlanRefresh'
      refresh.textContent = t('planUsageRefresh')
      heading.appendChild(title)
      heading.appendChild(refresh)
      const body = document.createElement('div')
      body.className = 'ocv2PlanBody'
      body.textContent = t('loading')
      panel.appendChild(heading)
      panel.appendChild(body)
      document.body.appendChild(panel)

      const load = async (force) => {
        body.textContent = t('loading')
        let plan = null
        let cost = null
        try {
          plan = await post('plan-usage' + (force ? '?refresh=1' : ''), {})
        } catch {
          plan = null
        }
        try {
          const sessionId = document.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session') ?? ''
          const payload = await post('cost/session', { sessionId })
          // Prefer the exact session. The aggregate is a last resort only until
          // the server resolves the id; it has no per-model detail, so the panel
          // would have nothing to break down.
          cost = payload.session ?? (payload.totals && payload.totals.requests > 0
            ? { requests: payload.totals.requests, costUsd: payload.totals.costUsd, allowanceUsd: payload.totals.allowanceUsd, byModel: {}, aggregate: true }
            : null)
        } catch {
          cost = null
        }
        body.replaceChildren(...renderPanelBody(plan, cost))
      }
      refresh.addEventListener('click', (event) => { event.stopPropagation(); void load(true) })
      // Close on an outside click — but NOT on the click that opened the panel.
      // That click is still propagating when this listener is added (the chip's
      // handler runs first), so a naive listener removes the panel in the same
      // event turn: measured live 2026-11-04, the plan request returned 200 and
      // the panel count was 0. Deferring the listener to a later task skips it.
      setTimeout(() => {
        document.addEventListener('click', function close(event) {
          if (!panel.isConnected) { document.removeEventListener('click', close); return }
          if (!panel.contains(event.target)) { panel.remove(); document.removeEventListener('click', close) }
        })
      }, 0)
      void load(false)
    }

    /**
     * Panel body: the session's own spend per model, then the plan windows.
     *
     * The session total alone cannot answer "which model cost me this": models
     * are priced differently and consume the plan at different rates, so every
     * model row carries its own requests, money and tokens.
     *
     * @param {object|null} plan - `plan-usage` payload.
     * @param {object|null} cost - one ledger session entry.
     * @returns {Node[]} nodes for the panel body.
     */
    function renderPanelBody(plan, cost) {
      const out = []
      if (cost && Number(cost.requests ?? 0) > 0) {
        const head = document.createElement('div')
        head.className = 'ocv2PlanSection'
        head.textContent = t('costSessionTitle', { n: cost.requests })
        out.push(head)
        const models = Object.entries(cost.byModel ?? {}).sort((a, b) => (b[1].allowanceUsd ?? 0) - (a[1].allowanceUsd ?? 0))
        if (models.length === 0 && cost.aggregate) {
          // The aggregate has no model split; say so instead of an empty block.
          const note = document.createElement('p')
          note.className = 'ocv2PlanNote'
          note.textContent = t('costAggregateOnly', { requests: cost.requests ?? 0 })
          out.push(note)
        }
        for (const [route, stat] of models) {
          const row = document.createElement('div')
          row.className = 'ocv2PlanModel'
          const name = document.createElement('div')
          name.className = 'ocv2PlanModelName'
          name.textContent = String(route).split('/').pop()
          name.title = route
          const meta = document.createElement('div')
          meta.className = 'ocv2PlanModelMeta'
          const money = Number(stat.costUsd ?? 0) > 0 ? stat.costUsd : stat.allowanceUsd ?? 0
          const tokens = stat.tokens ?? {}
          const total = (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.cacheRead ?? 0)
          meta.textContent = [
            t('costRequests', { n: stat.requests ?? 0 }),
            formatUsd(money),
            total > 0 ? formatTokens(total) + ' tok' : null,
            tokens.cacheRead ? t('costCacheRead', { n: formatTokens(tokens.cacheRead) }) : null,
          ].filter(Boolean).join(' · ')
          row.appendChild(name)
          row.appendChild(meta)
          out.push(row)
        }
        const divider = document.createElement('div')
        divider.className = 'ocv2PlanDivider'
        out.push(divider)
      }
      return out.concat(renderPlanWindows(plan))
    }

    /** Compact token formatting for the panel. */
    function formatTokens(value) {
      const n = Number(value ?? 0)
      if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
      if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'
      return String(n)
    }

    /** Three window rows, in the host's type scale. */
    function renderPlanWindows(payload) {
      const out = []
      if (!payload || payload.ok !== true) {
        const error = document.createElement('p')
        error.className = 'ocv2PlanNote'
        error.textContent = t('planUsageError')
        return [error]
      }
      for (const key of ['rolling', 'weekly', 'monthly']) {
        const entry = payload.windows?.[key]
        if (!entry) continue
        const row = document.createElement('div')
        row.className = 'ocv2PlanRow'
        const top = document.createElement('div')
        top.className = 'ocv2PlanRowTop'
        const label = document.createElement('span')
        // The server sends a stable English label; the active locale owns display text.
        label.textContent = t(
          key === 'rolling' ? 'windowRolling' : key === 'weekly' ? 'windowWeekly' : 'windowMonthly',
        )
        const pct = document.createElement('span')
        pct.className = 'ocv2PlanPct'
        pct.textContent = entry.percent + '%'
        top.appendChild(label)
        top.appendChild(pct)
        const bar = document.createElement('div')
        bar.className = 'ocv2PlanBar'
        const fill = document.createElement('div')
        fill.className = 'ocv2PlanFill'
        fill.style.width = Math.min(100, Math.max(0, entry.percent)) + '%'
        if (entry.percent >= 80) fill.setAttribute('data-high', '1')
        bar.appendChild(fill)
        const reset = document.createElement('div')
        reset.className = 'ocv2PlanReset'
        reset.textContent = entry.resetsAt > 0 ? t('planResets', { at: new Date(entry.resetsAt).toLocaleString() }) : ''
        row.appendChild(top)
        row.appendChild(bar)
        row.appendChild(reset)
        out.push(row)
      }
      if (out.length === 0) {
        const none = document.createElement('p')
        none.className = 'ocv2PlanNote'
        none.textContent = t('planUsageEmpty')
        return [none]
      }
      return out
    }

    /**
     * Watch the composer's model chip and report every change.
     *
     * Event-driven on purpose (owner instruction 2026-11-04: "1초 폴링 대신
     * MutationObserver나 모델 변경 이벤트 리스너로"). A 1 s interval above all ran a
     * DOM query every second for the whole lifetime of the page, whether or not
     * the model ever changed.
     *
     * Why an observer and not a host event: the selected route is a DOM fact
     * (`data-provider-id` / `data-model-id` on the composer chip). The client
     * context exposes no model-selection event to a plugin — measured against the
     * running shell: `uiConversation.events` registers turns and messages, not the
     * picker. The chip is re-rendered by React when the model changes, so a
     * childList+attributes observer on the composer is the exact signal, and it
     * costs nothing while the selection is stable.
     *
     * @param {() => void} onChange - called with no arguments on every change.
     * @returns {() => void} disconnect callback.
     */
    function watchRoute(onChange) {
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
      let last = ''
      const current = () => {
        const node = document.querySelector('[data-provider-id][data-model-id]')
        return node === null
          ? ''
          : (node.getAttribute('data-provider-id') ?? '') + '|' + (node.getAttribute('data-model-id') ?? '')
      }
      last = current()
      const check = () => {
        const next = current()
        if (next === last) return
        last = next
        onChange()
      }
      const observer = new MutationObserver(check)
      // Observe the whole body: the composer is re-created on session switches, so
      // a narrower root would go stale after the first navigation.
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-provider-id', 'data-model-id'],
      })
      // The first render may already differ from the value captured above.
      check()
      return () => observer.disconnect()
    }

    /**
     * Watch the conversation for activity, and report it once per burst.
     *
     * A turn's cost lands in the adapter's ledger when the stream ends, and the
     * composer re-renders at that moment (usage pill, token counts). Observing the
     * conversation root turns that into the refresh trigger; the safety tick in
     * the caller covers a page that never re-renders.
     *
     * @param {() => void} onActivity - called after a burst of mutations.
     * @returns {() => void} disconnect callback.
     */
    function watchSession(onActivity) {
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
      const observer = new MutationObserver(onActivity)
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      return () => observer.disconnect()
    }

    /**
     * The composer chip: this plugin's spend for the current session.
     *
     * SEAT (owner instruction 2026-11-05): `conversation.input.right`, the additive
     * LIST slot Antigravity's usage chip already occupies. OpenCode's chip used to
     * sit in `conversation.input.activity` — a SINGLE slot already owned by the
     * token-economizer ("tk"), which is a second registration and renders the chip
     * to the right of the model selector. The instruction is to display it like
     * Antigravity does now: same seat (left of the selector, beside the model
     * serving), same label+value pill shape and the same DSH typography tokens.
     *
     * GATE: rendered only while the composer is on a route this package registers.
     * Ownership is decided by the PROVIDER id, never by a model id (the same catalog
     * ids are resold by other routers; measured 2026-11-04). Off-route it returns
     * null, so no empty node and no cost request for another provider's session.
     */
    function CostPill() {
      /**
       * Whether an OpenCode V2 model is selected RIGHT NOW.
       *
       * The chip is a DOM fact (no client service), so the value is read from the
       * composer and RE-READ when it changes: `watchRoute` observes the chip's
       * provider/model attributes, so a model switch re-evaluates the gate
       * immediately and nothing runs while the selection is stable.
       */
      const [onRoute, setOnRoute] = React.useState(() => usingOwnRoute())
      // Empty first render: with no measured session spend there is no figure to
      // show, and an invented "$0"/"무료" label was rejected by the owner. The chip
      // appears with the first answer from `cost/session`, like Antigravity's chip
      // appears with the first measured token.
      const [text, setText] = React.useState('')
      const [title, setTitle] = React.useState('')
      React.useEffect(() => {
        const disconnect = watchRoute(() => setOnRoute(usingOwnRoute()))
        // The chip may not exist yet at mount (the composer renders after the
        // slot), so the first read happens here rather than only in useState.
        // Measured 2026-11-04: without this the pill stayed hidden until the
        // operator switched models, because no mutation followed the mount.
        setOnRoute(usingOwnRoute())
        return disconnect
      }, [])
      React.useEffect(() => {
        // Nothing to poll while this plugin's route is not the selected one: the
        // figure would describe a session this adapter never served.
        if (!onRoute) return undefined
        let live = true
        const refresh = async () => {
          const sessionId = document.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session') ?? ''
          try {
            const payload = await post('cost/session', { sessionId })
            if (!live) return
            // Until the server resolves the id, fall back to the aggregate so the
            // chip shows a real running total instead of staying empty.
            const entry = payload.session ?? (payload.totals && payload.totals.requests > 0
              ? { requests: payload.totals.requests, costUsd: payload.totals.costUsd, allowanceUsd: payload.totals.allowanceUsd }
              : null)
            const next = costPillText(entry)
            setText(next)
            setTitle(entry ? t('costTitle', { n: entry.requests ?? 0 }) : '')
          } catch {
            /* keep the last value */
          }
        }
        void refresh()
        // Spend only moves when a turn produces usage, so the refresh is driven by
        // activity rather than by the clock alone: the route entry (above), any
        // composer/session mutation (a turn ending re-renders the composer), and a
        // slow safety tick for a page left idle on our route.
        let pending = null
        const schedule = () => {
          if (pending !== null) return
          pending = setTimeout(() => { pending = null; void refresh() }, COST_REFRESH_DEBOUNCE_MS)
        }
        const disconnect = watchSession(schedule)
        const timer = setInterval(() => void refresh(), COST_POLL_MS)
        return () => {
          live = false
          disconnect()
          if (pending !== null) clearTimeout(pending)
          clearInterval(timer)
        }
      }, [onRoute])
      // A different provider is selected: occupy no seat at all. Returning null
      // (not an empty chip) is what makes the figure disappear, and the list slot
      // reflows without leaving a gap.
      if (!onRoute) return null
      // No measured spend yet: no seat either. `text` becomes non-empty as soon as
      // the ledger has a request for this session.
      if (text === '') return null
      return h(
        'button',
        {
          type: 'button',
          className: 'ocv2Pill',
          title,
          'data-ocv2-cost': '1',
          onClick: (event) => { event.preventDefault(); togglePlanPanel() },
        },
        h('span', null, t('pillLabel')),
        h('span', { className: 'ocv2PillValue' }, text),
      )
    }

    // ===== STATUS PILL END =====

    const inject = ['slots', 'locale']

    function apply(ctx) {
      localeReader = () => String(ctx.locale?.getSnapshot?.()?.active ?? '')
      // The cost pill is a COMPOSER SLOT, not a DOM patch (measured 2026-11-04: the
      // host's `[data-composer-stat]` anchors only exist once a session has token
      // usage, so an injected node had nowhere to attach before the first turn).
      //
      // SEAT: `conversation.input.right` — the additive LIST slot Antigravity's usage
      // chip occupies, rendered beside the model selector. Owner instruction
      // 2026-11-05: "오픈코드 v2에서 모델서빙 오른쪽으로 표시되는거 지금 안티그래비티
      // 처럼 표시되게". The previous seat, `conversation.input.activity`, is a SINGLE
      // slot already registered by the token-economizer in the live profile, so this
      // chip was a second registration in a seat that renders one occupant.
      //
      // DO NOT use `conversation.input.model.label`. Measured 2026-11-04: that slot
      // owns the model NAME itself, so a contribution there REPLACES the catalog
      // name — the chip rendered "· $0.1318Max" and the model name vanished from
      // the UI ("모델 리스트가 없어졌어"). Reverted immediately.
      ctx.slots.inject('conversation.input.right', () =>
        ctx.slots.register(
          { name: 'conversation.input.right', id: 'opencode-v2-cost', order: 2 },
          CostPill,
        ),
      )
      // NO settings.section (C5, owner decision D-3, BLUEPRINT Phase C).
      //
      // The model catalogue, the plan choice and the selection save belong to the
      // ROUTER's settings section: the router mounts this plugin and its
      // `opencode` preset descriptor already declares the same catalog route, the
      // same `enabledModels` row and the same plan actions. Registering this
      // section too rendered TWO pages that wrote the same row through two code
      // paths — the duplicate the absorption removes.
      //
      // `OpenCodeModelSection` stays EXPORTED, unmounted: it is the reference
      // implementation of the plan UI and the source of the row semantics the
      // router tab reproduces (`model-settings`, `model-settings/apply`,
      // `model-settings/ranking/refresh`). Mounting it again would re-create the
      // second section this decision removed.
    }

    exports.apply = apply
    exports.inject = inject
    exports.OpenCodeModelSection = OpenCodeModelSection
    exports.ModelRow = ModelRow
    exports.CostPill = CostPill
    exports.badgeKey = badgeKey
    exports.badgeClass = badgeClass
    Object.defineProperty(exports, 'default', { value: { apply, inject } })
    return module.exports
  },
})
