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
        nav: '오픈코드 V2',
        title: '오픈코드 V2 — 모델 서빙',
        hint: '체크한 모델만 프롬프트의 모델 선택기에 표시됩니다. 이미 선택된 세션은 그대로 동작합니다. 사용 가능한 모델이 위로 정렬됩니다.',
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
        lastMeasured: '마지막 확인 {at}',
      },
      en: {
        nav: 'OpenCode V2',
        title: 'OpenCode V2 — model serving',
        hint: 'Only checked models appear in the prompt model picker. Sessions that already selected one keep working. Usable models are sorted to the top.',
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
        lastMeasured: 'last checked {at}',
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

    /**
     * Display order for the checklist: usable first, then routes nobody has
     * checked yet, then everything the sweep rejected (unavailable, deprecated,
     * auth, forbidden, error) at the bottom. Ties keep a stable name order.
     */
    function sortModels(models, verdicts) {
      const rank = (verdict) => {
        if (verdict === 'usable') return 0
        if (verdict === undefined || verdict === null || verdict === '') return 1
        return 2
      }
      return [...(models ?? [])].sort((left, right) => {
        const delta = rank(verdicts?.[left.route]) - rank(verdicts?.[right.route])
        if (delta !== 0) return delta
        const nameDelta = String(left.name ?? left.route).localeCompare(String(right.name ?? right.route), currentLang())
        return nameDelta !== 0 ? nameDelta : String(left.route).localeCompare(String(right.route))
      })
    }

    function formatMeasuredAt(measuredAt) {
      if (!measuredAt) return ''
      const when = new Date(measuredAt)
      if (Number.isNaN(when.getTime())) return ''
      return t('lastMeasured', { at: when.toLocaleString(currentLang() === 'ko' ? 'ko-KR' : 'en-US') })
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
      const [verdicts, setVerdicts] = React.useState({}) // route -> state string, persisted by the host
      const [measuredAt, setMeasuredAt] = React.useState(null)
      const [busy, setBusy] = React.useState('') // '', 'measure', 'save'
      const [notice, setNotice] = React.useState('')

      React.useEffect(() => {
        let alive = true
        post('model-settings')
          .then((payload) => {
            if (!alive) return
            setEnabled(payload.enabled ?? [])
            setVerdicts(payload.verdicts ?? {})
            setMeasuredAt(payload.measuredAt ?? null)
            setState({ loading: false, error: null, models: payload.models ?? [] })
          })
          .catch((error) => alive && setState({ loading: false, error: error.message, models: [] }))
        return () => {
          alive = false
        }
      }, [])

      const models = state.models ?? []
      const ordered = sortModels(models, verdicts)
      const toggle = (route) =>
        setEnabled((prev) => (prev.includes(route) ? prev.filter((item) => item !== route) : [...prev, route]))

      const measure = async () => {
        setBusy('measure')
        setNotice('')
        try {
          // The host persists the snapshot, so the next open shows it without a sweep.
          const payload = await post('model-settings/measure')
          setVerdicts(payload.verdicts ?? {})
          setMeasuredAt(payload.measuredAt ?? null)
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

      const usableOnly = () => setEnabled(models.filter((model) => verdicts[model.route] === 'usable').map((model) => model.route))

      if (state.loading) return h('div', { className: 'ocv2-section' }, h('p', null, '…'))
      if (state.error) {
        return h('div', { className: 'ocv2-section' }, h('h3', null, t('title')), h('p', { role: 'alert' }, `${t('loadError')}: ${state.error}`))
      }

      const stamp = formatMeasuredAt(measuredAt)

      return h(
        'div',
        { className: 'ocv2-section' },
        h('h3', null, t('title')),
        h('p', { className: 'ocv2-hint' }, t('hint')),
        h(
          'div',
          { className: 'ocv2-actions', style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' } },
          h('button', { type: 'button', onClick: measure, disabled: busy !== '' }, busy === 'measure' ? t('measuring') : t('measure')),
          h('button', { type: 'button', onClick: usableOnly, disabled: busy !== '' || Object.keys(verdicts).length === 0 }, t('all')),
          h('button', { type: 'button', onClick: () => setEnabled([]), disabled: busy !== '' }, t('none')),
          h('button', { type: 'button', onClick: save, disabled: busy !== '' }, busy === 'save' ? t('saving') : t('save')),
          h('span', { style: { alignSelf: 'center', opacity: 0.75 } }, `${t('countOne', { a: enabled.length })} ${models.length}`),
        ),
        notice || stamp ? h('p', { role: 'status', style: { margin: '0 0 8px' } }, notice || stamp) : null,
        h(
          'ul',
          { className: 'ocv2-list', style: { listStyle: 'none', padding: 0, margin: 0 } },
          ordered.map((model) => {
            const verdict = verdicts[model.route]
            return h(
              'li',
              { key: model.route, style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0' } },
              h('input', {
                type: 'checkbox',
                checked: enabled.includes(model.route),
                onChange: () => toggle(model.route),
                id: `ocv2-${model.route}`,
              }),
              // The verdict sits immediately beside the checkbox: the eye scans
              // "usable?" left to right before the name gets in the way.
              h(
                'span',
                {
                  title: verdict ? t(STATE_KEYS[verdict] ?? 'stateError') : t('unmeasured'),
                  style: {
                    flex: '0 0 auto',
                    minWidth: '4.5em',
                    fontSize: '0.8em',
                    padding: '1px 6px',
                    borderRadius: '999px',
                    background: verdict === 'usable' ? 'rgba(60,180,90,.18)' : verdict ? 'rgba(220,80,80,.16)' : 'transparent',
                    opacity: verdict ? 1 : 0.45,
                  },
                },
                verdict ? t(STATE_KEYS[verdict] ?? 'stateError') : t('unmeasured'),
              ),
              h('label', { htmlFor: `ocv2-${model.route}`, style: { flex: 1 } }, model.name ?? model.route),
              h('code', { style: { opacity: 0.6, fontSize: '0.85em' } }, model.route),
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
    exports.sortModels = sortModels
    Object.defineProperty(exports, 'default', { value: { apply, inject } })
    return module.exports
  },
})
