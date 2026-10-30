/**
 * `@nolit/dsh-opencode-v2` — browser half.
 *
 * Adds an "OpenCode v2" settings section that lists every model the local
 * OpenCode catalog serves and lets the operator tick the ones the prompt model
 * picker should offer. Ticking only changes what the picker shows; a session that
 * already selected a hidden route keeps running (measured requirement 2026-10-30).
 *
 * The host half owns the data: `/api/local/opencode-v2/model-settings`,
 * `.../measure`, `.../apply` (see `registerModelSettingsRoutes` in lib/http.js).
 * The entitlement sweep is explicit-only — the button, never a conversation.
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
        nav: 'OpenCode v2',
        title: 'OpenCode v2 — 모델 서빙',
        hint: '체크한 모델만 프롬프트의 모델 선택기에 표시됩니다. 이미 선택된 세션은 그대로 동작합니다.',
        measure: '사용 가능 모델 확인',
        measuring: '확인 중… (모델 수만큼 한 번씩 확인합니다)',
        all: '전체 선택',
        none: '전체 해제',
        save: '저장',
        saving: '저장 중…',
        saved: '저장했습니다.',
        countOne: '선택 {a} / 전체',
        stateUsable: '사용 가능',
        stateUnavailable: '사용 불가',
        stateDeprecated: '지원 중단',
        stateAuth: '인증 오류',
        stateForbidden: '구독 없음',
        stateError: '확인 실패',
        unmeasured: '미확인',
        loadError: '설정을 불러오지 못했습니다',
        saveError: '저장하지 못했습니다',
        measureError: '사용 가능 목록을 확인하지 못했습니다',
        measuredAt: '방금 확인한 결과',
      },
      en: {
        nav: 'OpenCode v2',
        title: 'OpenCode v2 — model serving',
        hint: 'Only checked models appear in the prompt model picker. Sessions that already selected one keep working.',
        measure: 'Check usable models',
        measuring: 'Checking… (one request per model)',
        all: 'Select all',
        none: 'Clear all',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved.',
        countOne: '{a} selected / total',
        stateUsable: 'usable',
        stateUnavailable: 'unavailable',
        stateDeprecated: 'deprecated',
        stateAuth: 'auth error',
        stateForbidden: 'no subscription',
        stateError: 'check failed',
        unmeasured: 'not checked',
        loadError: 'Could not load settings',
        saveError: 'Could not save',
        measureError: 'Could not measure the usable models',
        measuredAt: 'measured just now',
      },
    }
    // ===== I18N END =====

    const current = typeof navigator !== 'undefined' && /^ko/i.test(navigator.language ?? '') ? 'ko' : 'en'

    function t(key, params) {
      const text = (I18N[current] ?? I18N.en)[key] ?? (I18N.en[key] ?? key)
      if (!params) return text
      return Object.entries(params).reduce((acc, [name, value]) => acc.split(`{${name}}`).join(String(value)), text)
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
      unavailable: 'stateUnavailable',
      deprecated: 'stateDeprecated',
      auth: 'stateAuth',
      forbidden: 'stateForbidden',
      error: 'stateError',
    }

    function OpenCodeModelSection() {
      const [state, setState] = React.useState({ loading: true, error: null })
      const [enabled, setEnabled] = React.useState([])
      const [measured, setMeasured] = React.useState({}) // route -> state string
      const [busy, setBusy] = React.useState('') // '', 'measure', 'save'
      const [notice, setNotice] = React.useState('')

      React.useEffect(() => {
        let alive = true
        post('model-settings')
          .then((payload) => {
            if (!alive) return
            setEnabled(payload.enabled ?? [])
            setState({ loading: false, error: null, models: payload.models ?? [] })
          })
          .catch((error) => alive && setState({ loading: false, error: error.message, models: [] }))
        return () => {
          alive = false
        }
      }, [])

      const models = state.models ?? []
      const toggle = (route) =>
        setEnabled((prev) => (prev.includes(route) ? prev.filter((item) => item !== route) : [...prev, route]))

      const measure = async () => {
        setBusy('measure')
        setNotice('')
        try {
          const payload = await post('model-settings/measure')
          const next = {}
          for (const result of payload.results ?? []) next[result.route] = result.state
          setMeasured(next)
          setNotice(t('measuredAt'))
        } catch (error) {
          setNotice(`${t('measureError')}: ${error.message}`)
        } finally {
          setBusy('')
        }
      }

      const save = async () => {
        setBusy('save')
        setNotice('')
        try {
          const payload = await post('model-settings/apply', { enabled })
          setEnabled(payload.enabled ?? [])
          setNotice(t('saved'))
        } catch (error) {
          setNotice(`${t('saveError')}: ${error.message}`)
        } finally {
          setBusy('')
        }
      }

      const usableOnly = () => setEnabled(models.filter((model) => measured[model.route] === 'usable').map((model) => model.route))

      if (state.loading) return h('div', { className: 'ocv2-section' }, h('p', null, '…'))
      if (state.error) {
        return h('div', { className: 'ocv2-section' }, h('h3', null, t('title')), h('p', { role: 'alert' }, `${t('loadError')}: ${state.error}`))
      }

      return h(
        'div',
        { className: 'ocv2-section' },
        h('h3', null, t('title')),
        h('p', { className: 'ocv2-hint' }, t('hint')),
        h(
          'div',
          { className: 'ocv2-actions', style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' } },
          h('button', { type: 'button', onClick: measure, disabled: busy !== '' }, busy === 'measure' ? t('measuring') : t('measure')),
          h('button', { type: 'button', onClick: usableOnly, disabled: busy !== '' || Object.keys(measured).length === 0 }, t('all')),
          h('button', { type: 'button', onClick: () => setEnabled([]), disabled: busy !== '' }, t('none')),
          h('button', { type: 'button', onClick: save, disabled: busy !== '' }, busy === 'save' ? t('saving') : t('save')),
          h('span', { style: { alignSelf: 'center', opacity: 0.75 } }, `${t('countOne', { a: enabled.length })} ${models.length}`),
        ),
        notice ? h('p', { role: 'status', style: { margin: '0 0 8px' } }, notice) : null,
        h(
          'ul',
          { className: 'ocv2-list', style: { listStyle: 'none', padding: 0, margin: 0 } },
          models.map((model) => {
            const verdict = measured[model.route]
            return h(
              'li',
              { key: model.route, style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0' } },
              h('input', {
                type: 'checkbox',
                checked: enabled.includes(model.route),
                onChange: () => toggle(model.route),
                id: `ocv2-${model.route}`,
              }),
              h('label', { htmlFor: `ocv2-${model.route}`, style: { flex: 1 } }, model.name ?? model.route),
              h('code', { style: { opacity: 0.6, fontSize: '0.85em' } }, model.route),
              h(
                'span',
                {
                  style: {
                    fontSize: '0.8em',
                    padding: '1px 6px',
                    borderRadius: '999px',
                    background: verdict === 'usable' ? 'rgba(60,180,90,.18)' : verdict ? 'rgba(220,80,80,.16)' : 'transparent',
                    opacity: verdict ? 1 : 0.45,
                  },
                },
                verdict ? t(STATE_KEYS[verdict] ?? 'stateError') : t('unmeasured'),
              ),
            )
          }),
        ),
      )
    }

    const inject = ['slots']

    function apply(ctx) {
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
