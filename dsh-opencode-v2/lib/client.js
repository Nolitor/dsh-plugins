/**
 * `@nolit/dsh-opencode-v2` — browser half.
 *
 * Adds an "OpenCode V2" settings section that lists the models the local
 * OpenCode catalog serves, groups them by plan (Go subscription vs Zen
 * pay-as-you-go), and lets the operator tick the ones the prompt model picker
 * should offer.
 *
 * Availability is decided from the catalog's provider id alone — no per-model
 * request, so opening this tab costs nothing against the account's request
 * quota. The host annotates and orders the rows; this file only renders them.
 * Refusals the backend reports during real turns are recorded by the host and
 * surface here as a badge.
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

    // ===== I18N START =====
    const I18N = {
      ko: {
        nav: '오픈코드 V2',
        title: '오픈코드 V2 — 모델 서빙',
        hint: '플랜에 맞는 모델만 사용 가능으로 표시됩니다. 체크한 모델만 프롬프트의 모델 선택기에 나타나고, 이미 선택된 세션은 그대로 동작합니다.',
        planGo: 'Go 구독',
        planZen: 'Zen 종량제',
        planLabel: '내 플랜',
        selectAllAvailable: '사용 가능 전체 선택',
        clearAll: '전체 해제',
        save: '저장',
        saving: '저장 중…',
        saved: '저장했습니다.',
        count: '선택 {a} · 사용 가능 {b} · 전체 {c}',
        stateUsable: '사용 가능',
        stateOtherPlan: '다른 플랜',
        stateUnavailable: '사용 불가',
        stateDeprecated: '지원 중단',
        stateAuth: '인증 오류',
        stateForbidden: '권한 없음',
        stateUnknown: '알 수 없음',
        refreshRanking: '사용량 순위 갱신',
        refreshing: '갱신 중…',
        rankingUpdated: '사용량 순위 {at} 기준',
        rankingMissing: '사용량 순위 없음 — 이름순으로 표시',
        rankingError: '사용량 순위를 가져오지 못했습니다',
        observedAt: '최근 관측 {at}',
        loadError: '설정을 불러오지 못했습니다',
        saveError: '저장하지 못했습니다',
      },
      en: {
        nav: 'OpenCode V2',
        title: 'OpenCode V2 — model serving',
        hint: 'Only models your plan offers are usable. Checked models appear in the prompt model picker; sessions that already selected one keep working.',
        planGo: 'Go subscription',
        planZen: 'Zen pay-as-you-go',
        planLabel: 'My plan',
        selectAllAvailable: 'Select all usable',
        clearAll: 'Clear all',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved.',
        count: '{a} selected · {b} usable · {c} total',
        stateUsable: 'usable',
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
      },
    }
    // ===== I18N END =====

    // The settings shell's locale service outranks the browser language: it is
    // the language the surrounding UI actually renders in. `apply()` binds the
    // reader so the label and the section agree with the rest of the shell.
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
      return Object.entries(params).reduce((acc, [name, value]) => acc.split(`{${name}}`).join(String(value)), text)
    }

    function formatWhen(value) {
      if (!value) return ''
      const when = new Date(value)
      if (Number.isNaN(when.getTime())) return ''
      return when.toLocaleString(currentLang() === 'ko' ? 'ko-KR' : 'en-US')
    }

    async function post(route, body) {
      const response = await fetch(`/api/local/opencode-v2/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`)
      return payload
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

    function OpenCodeModelSection() {
      const [state, setState] = React.useState({ loading: true, error: null })
      const [enabled, setEnabled] = React.useState([])
      const [plan, setPlan] = React.useState('go')
      const [models, setModels] = React.useState([])
      const [ranking, setRanking] = React.useState({ updatedAt: null, fetchedAt: 0 })
      const [observedAt, setObservedAt] = React.useState(null)
      const [busy, setBusy] = React.useState('') // '', 'save', 'ranking'
      const [notice, setNotice] = React.useState('')

      React.useEffect(() => {
        let alive = true
        post('model-settings')
          .then((payload) => {
            if (!alive) return
            setEnabled(payload.enabled ?? [])
            setPlan(payload.activePlan ?? 'go')
            setModels(payload.models ?? [])
            setRanking(payload.ranking ?? { updatedAt: null, fetchedAt: 0 })
            setObservedAt(payload.observedAt ?? null)
            setState({ loading: false, error: null })
          })
          .catch((error) => alive && setState({ loading: false, error: error.message }))
        return () => {
          alive = false
        }
      }, [])

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
          setNotice(`${t('saveError')}: ${error.message}`)
        } finally {
          setBusy('')
        }
      }

      const choosePlan = (nextPlan) => {
        setPlan(nextPlan)
        // Switching plans is a decision, not a draft: persist it immediately so
        // the prompt picker follows the same plan.
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
          setNotice(`${t('rankingError')}: ${error.message}`)
        } finally {
          setBusy('')
        }
      }

      if (state.loading) return h('div', { className: 'ocv2-section' }, h('p', null, '…'))
      if (state.error) {
        return h('div', { className: 'ocv2-section' }, h('h3', null, t('title')), h('p', { role: 'alert' }, `${t('loadError')}: ${state.error}`))
      }

      const stamp = ranking.updatedAt ? t('rankingUpdated', { at: formatWhen(ranking.updatedAt) }) : t('rankingMissing')

      return h(
        'div',
        { className: 'ocv2-section' },
        h('h3', null, t('title')),
        h('p', { className: 'ocv2-hint' }, t('hint')),
        h(
          'div',
          { className: 'ocv2-plan', style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px' } },
          h('span', { style: { opacity: 0.75 } }, t('planLabel')),
          h(
            'button',
            {
              type: 'button',
              'aria-pressed': plan === 'go',
              onClick: () => choosePlan('go'),
              disabled: busy !== '',
              style: plan === 'go' ? { fontWeight: 600, outline: '2px solid currentColor' } : undefined,
            },
            t('planGo'),
          ),
          h(
            'button',
            {
              type: 'button',
              'aria-pressed': plan === 'zen',
              onClick: () => choosePlan('zen'),
              disabled: busy !== '',
              style: plan === 'zen' ? { fontWeight: 600, outline: '2px solid currentColor' } : undefined,
            },
            t('planZen'),
          ),
        ),
        h(
          'div',
          { className: 'ocv2-actions', style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' } },
          h('button', { type: 'button', onClick: () => save(), disabled: busy !== '' }, busy === 'save' ? t('saving') : t('save')),
          h(
            'button',
            { type: 'button', onClick: () => save(plan, models.filter((m) => m.available).map((m) => m.route)), disabled: busy !== '' },
            t('selectAllAvailable'),
          ),
          h('button', { type: 'button', onClick: () => setEnabled([]), disabled: busy !== '' }, t('clearAll')),
          h('button', { type: 'button', onClick: refreshRanking, disabled: busy !== '' }, busy === 'ranking' ? t('refreshing') : t('refreshRanking')),
          h('span', { style: { alignSelf: 'center', opacity: 0.75 } }, t('count', { a: enabled.length, b: usableCount, c: models.length })),
        ),
        notice ? h('p', { role: 'status', style: { margin: '0 0 6px' } }, notice) : null,
        h(
          'p',
          { style: { margin: '0 0 10px', opacity: 0.6, fontSize: '0.85em' } },
          [stamp, observedAt ? t('observedAt', { at: formatWhen(observedAt) }) : ''].filter(Boolean).join(' · '),
        ),
        h(
          'ul',
          { className: 'ocv2-list', style: { listStyle: 'none', padding: 0, margin: 0 } },
          models.map((model) => {
            const badge = STATE_KEYS[model.state] ?? 'stateUnknown'
            const tone =
              model.state === 'usable'
                ? 'rgba(60,180,90,.18)'
                : model.state === 'other-plan'
                  ? 'rgba(120,120,120,.16)'
                  : 'rgba(220,80,80,.16)'
            return h(
              'li',
              {
                key: model.route,
                style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0', opacity: model.available ? 1 : 0.55 },
              },
              h('input', {
                type: 'checkbox',
                checked: enabled.includes(model.route),
                onChange: () => toggle(model.route),
                disabled: !model.available,
                id: `ocv2-${model.route}`,
              }),
              // The badge sits immediately beside the checkbox: the eye scans
              // "usable?" left to right before the name gets in the way.
              h(
                'span',
                {
                  title: t(badge),
                  style: {
                    flex: '0 0 auto',
                    minWidth: '5.5em',
                    textAlign: 'center',
                    fontSize: '0.8em',
                    padding: '1px 6px',
                    borderRadius: '999px',
                    background: tone,
                  },
                },
                t(badge),
              ),
              h('label', { htmlFor: `ocv2-${model.route}`, style: { flex: 1 } }, model.name ?? model.route),
              h('code', { style: { opacity: 0.6, fontSize: '0.85em' } }, model.route),
              model.plan === 'go' || model.plan === 'zen'
                ? h('span', { style: { opacity: 0.5, fontSize: '0.75em', minWidth: '3.5em', textAlign: 'right' } }, model.plan)
                : null,
              typeof model.rank === 'number'
                ? h('span', { style: { opacity: 0.5, fontSize: '0.75em', minWidth: '3em', textAlign: 'right' } }, `#${model.rank}`)
                : h('span', { style: { minWidth: '3em' } }),
            )
          }),
        ),
      )
    }

    const inject = ['slots', 'locale']

    function apply(ctx) {
      // Bind the shell locale once: the nav label and the section both read it,
      // so the tab follows the UI language instead of the browser default.
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
