/**
 * @nolit/dsh-tokeneconomizer -- browser half: developer statistics and the settings page.
 *
 * Two surfaces, both additive entries in the settings list seat:
 *
 *   settings.section -> "TokenEconomizer · Developer statistics"  (read-only card, order 62)
 *   settings.section -> "TokenEconomizer · Settings"               (write page,    order 63)
 *
 * The statistics card stays read-only: it reads one POST route and mutates nothing. The
 * settings page is a separate entry with its own routes from `lib/settings-contract.js`; it
 * writes through the engine seam and re-reads before painting, so a write is confirmed, never
 * assumed.
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
    /**
     * Read the statistics payload for the section headline.
     *
     * The full card owns its own loading state; this is a single quiet read so the section can
     * state what the plugin saved before a tab is chosen. A failure returns null and the headline
     * simply omits the figure — a summary must never be able to break the page.
     * @returns {Promise<object|null>} the payload, or null when unavailable.
     */
    async function devstatsFetch() {
      try {
        const response = await fetch(DEVSTATS_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        })
        if (!response.ok) return null
        const payload = await response.json()
        return payload?.ok === true ? payload : null
      } catch {
        return null
      }
    }

    // Mirrors lib/settings-contract.js, which is the source of truth. The client half cannot import: the loader exposes a fixed module table and this file must carry no import statements.
    /** The five settings routes, verbatim from the contract. */
    const SETTINGS_ROUTES = Object.freeze({
      read: '/api/local/tokeneconomizer/settings',
      config: '/api/local/tokeneconomizer/settings/config',
      restore: '/api/local/tokeneconomizer/settings/restore',
      reset: '/api/local/tokeneconomizer/settings/reset',
      importJob: '/api/local/tokeneconomizer/settings/import',
    })

    /** The nine numeric settings, in the contract's own paint order. */
    const SETTINGS_THRESHOLDS = Object.freeze([
      Object.freeze({ label: 'microskills_propose_every', key: 'microskills_propose_every', type: 'int', min: 1, max: null, def: 3 }),
      Object.freeze({ label: 'toolprune_evidence', key: 'toolprune_evidence', type: 'int', min: 1, max: null, def: 10 }),
      Object.freeze({ label: 'toolprune_min_sessions', key: 'toolprune_min_sessions', type: 'int', min: 1, max: null, def: 2 }),
      Object.freeze({ label: 'toolprune_sessions', key: 'toolprune_sessions', type: 'int', min: 1, max: null, def: 5 }),
      Object.freeze({ label: 'toolprune_quiet_minutes', key: 'toolprune_quiet_minutes', type: 'int', min: 0, max: null, def: 60 }),
      Object.freeze({ label: 'loopguard.envelope_min_samples', key: 'loopguard_thresholds.envelope_min_samples', type: 'int', min: 1, max: null, def: 5 }),
      Object.freeze({ label: 'loopguard.judge_confidence', key: 'loopguard_thresholds.judge_confidence', type: 'float', min: 0, max: 1, def: 0.7 }),
      Object.freeze({ label: 'loopguard_nudges', key: 'loopguard_nudges', type: 'int', min: 1, max: null, def: 1 }),
      Object.freeze({ label: 'loopguard.backstop_mult', key: 'loopguard_thresholds.backstop_mult', type: 'float', min: 0.1, max: null, def: 2.5 }),
    ])

    /** The three mode selectors and the values each accepts. */
    const SETTINGS_MODES = Object.freeze([
      Object.freeze({ key: 'microskills', values: Object.freeze(['off', 'envfacts', 'envfacts+distiller', 'distiller']) }),
      Object.freeze({ key: 'toolprune', values: Object.freeze(['off', 'propose', 'auto']) }),
      Object.freeze({ key: 'loopguard', values: Object.freeze(['off', 'nudge', 'stop']) }),
    ])

    /** `on` is a write alias, never a stored value: the select sends the alias target instead. */
    const SETTINGS_MODE_ALIAS = Object.freeze({
      microskills: 'envfacts+distiller',
      toolprune: 'auto',
      loopguard: 'nudge',
    })

    /** English is the default; Korean renders only while the active locale is `ko`. */
    const I18N = {
      en: {
        'devstats.title': "Statistics",
        'devstats.hint': "How much TokenEconomizer actually saved in this session, and where it came from.",
        'devstats.source': "DSH ledger + tk ledger",
        'devstats.session': "Session",
        'devstats.refresh': "Refresh",
        'devstats.loading': "Loading statistics…",
        'devstats.loadError': "Could not load statistics",
        'devstats.retry': "Retry",
        'devstats.empty': "No session in this process has a ledger yet.",
        'devstats.noDetail': "Select a session to see its turns and steps.",
        'devstats.truncated': "Only the newest {turns} turns are listed; the totals cover the whole log.",
        'devstats.totals': "Session totals",
        'devstats.turns': "Turns",
        'devstats.steps': "Steps",
        'devstats.context': "Context",
        'devstats.cacheHit': "Cache hit",
        'devstats.input': "Input",
        'devstats.output': "Output",
        'devstats.reasoning': "Reasoning",
        'devstats.modelTime': "Model",
        'devstats.toolTime': "Tool",
        'devstats.wall': "Wall",
        'devstats.turnRow': "Turn {turn}",
        'devstats.stepRow': "Step {step}",
        'devstats.scope': "Scope",
        'devstats.cache': "Cache R / W",
        'devstats.model': "Model",
        'devstats.tools': "Tools",
        'devstats.toolCalls': "{n} calls",
        'devstats.toolSummary': "{name} · {ms} · {chars} chars",
        'devstats.toolError': "error",
        'devstats.callsTruncated': "Only the first {n} calls are listed.",
        'devstats.running': "running",
        'devstats.aborted': "no usage reported",
        'devstats.notReported': "—",
        'devstats.tkLedger': "tk ledger",
        'devstats.dedupHits': "Dedup hits",
        'devstats.dedupSaved': "Dedup saved",
        'devstats.tierReplacements': "Tier rewrites",
        'devstats.tierShadow': "Shadowed tokens",
        'devstats.breakerTrips': "Loop-breaker trips",
        'devstats.watchdogWarns': "Watchdog warnings",
        'devstats.watchdogInterrupts': "Watchdog interrupts",
        'devstats.toolCallsCount': "Tool calls",
        'devstats.toolErrors': "Tool errors",
        'devstats.notices': "Notices",
        'devstats.mode': "Mode",
        'devstats.pinned': "Pinned rules",
        'devstats.recall': "Recall",
        'devstats.dshProjections': "DSH projections",
        'devstats.surface': "Surface",
        'devstats.projected': "Projected",
        'devstats.contextWindow': "Window",
        'devstats.usageUncached': "Uncached input",
        'devstats.usageOutput': "Output tokens",
        'devstats.usageCacheRead': "Cache read",
        'devstats.usageCacheWrite': "Cache write",
        'devstats.statsTurns': "Turns",
        'devstats.statsLlm': "LLM time",
        'devstats.statsTool': "Tool time",
        'devstats.statsTtft': "First token",
        'devstats.asOf': "as of seq {seq}",
        'devstats.on': "on",
        'devstats.off': "off",
        'devstats.chars': "{n} chars",
        'devstats.savedTitle': "Savings",
        'devstats.savedTotal': "Total saved",
        'devstats.savedRate': "Saving rate",
        'devstats.savedContext': "Of context",
        'devstats.byDedup': "Dedup",
        'devstats.byTiering': "Tiering",
        'devstats.byToolprune': "Tool mask",
        'devstats.savedChars': "Chars saved",
        'devstats.savedTokens': "Tokens saved (est.)",
        'devstats.noSavings': "Nothing has been saved in this session yet.",
        'devstats.share': "Share",
        'devstats.actionsTitle': "Activity",
        'devstats.none': "None",
        'devstats.hits': "duplicate hits",
      },
      ko: {
        'devstats.title': "통계",
        'devstats.hint': "이 세션에서 토큰절약기가 실제로 아낀 양과 출처별 비중입니다.",
        'devstats.source': "DSH 원장 + tk 원장",
        'devstats.session': "세션",
        'devstats.refresh': "새로 고침",
        'devstats.loading': "통계를 불러오는 중…",
        'devstats.loadError': "통계를 불러오지 못했습니다",
        'devstats.retry': "다시 시도",
        'devstats.empty': "이 프로세스에 원장이 있는 세션이 아직 없습니다.",
        'devstats.noDetail': "턴과 단계를 보려면 세션을 선택하세요.",
        'devstats.truncated': "최신 {turns}턴만 표시합니다. 합계는 전체 로그 기준입니다.",
        'devstats.totals': "세션 합계",
        'devstats.turns': "턴",
        'devstats.steps': "단계",
        'devstats.context': "컨텍스트",
        'devstats.cacheHit': "캐시 적중",
        'devstats.input': "입력",
        'devstats.output': "출력",
        'devstats.reasoning': "추론",
        'devstats.modelTime': "모델",
        'devstats.toolTime': "도구",
        'devstats.wall': "총 시간",
        'devstats.turnRow': "턴 {turn}",
        'devstats.stepRow': "단계 {step}",
        'devstats.scope': "범위",
        'devstats.cache': "캐시 읽기 / 쓰기",
        'devstats.model': "모델",
        'devstats.tools': "도구",
        'devstats.toolCalls': "{n}회 호출",
        'devstats.toolSummary': "{name} · {ms} · {chars}자",
        'devstats.toolError': "오류",
        'devstats.callsTruncated': "앞의 {n}개 호출만 표시합니다.",
        'devstats.running': "실행 중",
        'devstats.aborted': "usage 없음",
        'devstats.notReported': "—",
        'devstats.tkLedger': "tk 원장",
        'devstats.dedupHits': "중복 제거",
        'devstats.dedupSaved': "절감 문자",
        'devstats.tierReplacements': "계층 재작성",
        'devstats.tierShadow': "가려진 토큰",
        'devstats.breakerTrips': "루프 차단",
        'devstats.watchdogWarns': "워치독 경고",
        'devstats.watchdogInterrupts': "워치독 중단",
        'devstats.toolCallsCount': "도구 호출",
        'devstats.toolErrors': "도구 오류",
        'devstats.notices': "알림",
        'devstats.mode': "모드",
        'devstats.pinned': "고정 규칙",
        'devstats.recall': "이전 세션 회상",
        'devstats.dshProjections': "DSH 프로젝션",
        'devstats.surface': "서피스",
        'devstats.projected': "예상",
        'devstats.contextWindow': "윈도",
        'devstats.usageUncached': "비캐시 입력",
        'devstats.usageOutput': "출력 토큰",
        'devstats.usageCacheRead': "캐시 읽기",
        'devstats.usageCacheWrite': "캐시 쓰기",
        'devstats.statsTurns': "턴",
        'devstats.statsLlm': "LLM 시간",
        'devstats.statsTool': "도구 시간",
        'devstats.statsTtft': "첫 토큰",
        'devstats.asOf': "seq {seq} 기준",
        'devstats.on': "켜짐",
        'devstats.off': "꺼짐",
        'devstats.chars': "{n}자",
        'devstats.savedTitle': "절감 효과",
        'devstats.savedTotal': "총 절감",
        'devstats.savedRate': "절감률",
        'devstats.savedContext': "컨텍스트 대비",
        'devstats.byDedup': "중복 제거",
        'devstats.byTiering': "계층 압축",
        'devstats.byToolprune': "도구 마스크",
        'devstats.savedChars': "절감 문자",
        'devstats.savedTokens': "절감 토큰(추정)",
        'devstats.noSavings': "이 세션에서는 아직 절감이 발생하지 않았습니다.",
        'devstats.share': "비중",
        'devstats.actionsTitle': "개입 현황",
        'devstats.none': "없음",
        'devstats.hits': "중복 적중",
      },
    }

    /**
     * Style tag key. The host claims `<style data-plugin-css>` tags by this value, so a
     * reload replaces the stylesheet instead of adding a second one.
     */
    const CSS_TAG = '@nolit/dsh-tokeneconomizer'

    /**
     * The settings page's own copy, kept in a second table so the statistics table above stays
     * exactly the `devstats` key set and the drift gate can bind each table to its own locale
     * block. Declared after `CSS_TAG` on purpose: the extractor for `I18N` slices to that marker.
     */
    const SETTINGS_I18N = {
      en: {
        'settings.title': "Settings",
        'settings.save': "Save",
        'settings.saving': "Saving…",
        'settings.saved': "Saved",
        'settings.reset': "Reset to default",
        'settings.resetAll': "Reset all to defaults",
        'settings.restore': "Restore tools",
        'settings.import': "Import sessions",
        'settings.importRunning': "Importing…",
        'settings.importDone': "Import complete",
        'settings.engineDefault': "Engine default",
        'settings.override': "Overridden",
        'settings.effective': "Effective",
        'settings.range': "Range: {min} – {max}",
        'settings.invalid': "Invalid value",
        'settings.engineError': "The engine rejected it: {reason}",
        'settings.judgeUnavailable': "The judge model is unavailable — running in heuristic mode",
        'settings.mode': "Mode",
        'settings.thresholds': "Thresholds",
        'settings.actions': "Actions",
        'settings.modeOff': "Off",
        'settings.modeOn': "On",
        'settings.navTitle': "Token Economizer",
        'settings.summarySaving': "Saved {chars} characters so far — about {rate} of session context.",
        'settings.summaryIdle': "Nothing saved yet. Turn a feature on below and start using it.",
      },
      ko: {
        'settings.title': "환경설정",
        'settings.save': "저장",
        'settings.saving': "저장 중…",
        'settings.saved': "저장됨",
        'settings.reset': "기본값으로",
        'settings.resetAll': "모두 기본값으로",
        'settings.restore': "도구 복원",
        'settings.import': "세션 가져오기",
        'settings.importRunning': "가져오는 중…",
        'settings.importDone': "가져오기 완료",
        'settings.engineDefault': "엔진 기본값",
        'settings.override': "재정의됨",
        'settings.effective': "적용값",
        'settings.range': "범위: {min} ~ {max}",
        'settings.invalid': "값이 올바르지 않습니다",
        'settings.engineError': "엔진이 거부했습니다: {reason}",
        'settings.judgeUnavailable': "판정 모델을 사용할 수 없습니다 — 휴리스틱 모드로 동작합니다",
        'settings.mode': "모드",
        'settings.thresholds': "임계값",
        'settings.actions': "동작",
        'settings.modeOff': "끄기",
        'settings.modeOn': "켜기",
        'settings.navTitle': "토큰절약기",
        'settings.summarySaving': "지금까지 {chars}자를 절감했습니다. 세션 컨텍스트의 약 {rate}입니다.",
        'settings.summaryIdle': "아직 절감 실적이 없습니다. 아래에서 기능을 켜고 사용해 보세요.",
      },
    }

    /**
     * The settings page dictionary, kept out of `I18N` on purpose.
     *
     * `I18N` mirrors the `devstats` block of `locale/*.json` and a test pins it key for key; the
     * settings page owns a different block, so it carries its own table and its own drift gate.
     * Keys are the dotted `settings.*` names from `locale/en.json` and `locale/ko.json`.
     */

    const CSS = [
      // The settings seat is a narrow column, so the section stops at the DSH settings
      // read-width and centres itself instead of stretching across the pane.
      // A settings section is CONTENT ONLY. The host owns the panel, the nav rail, the header and
      // the scrolling column (`.options`, padding `0 24px 24px`), so this must not impose its own
      // max-width, centring, or card frame — that is what made the page look like a foreign app
      // inside the settings dialog instead of part of it.
      '.tkdsSection{box-sizing:border-box;min-width:0;width:100%;padding:0;word-break:keep-all;overflow-wrap:break-word;display:flex;flex-direction:column;gap:12px;font-family:inherit;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary)}',
      '.tkdsHead{display:flex;justify-content:space-between;align-items:baseline;gap:12px;min-width:0;flex-wrap:wrap}',
      // Internal tab pair: one sidebar row, two reachable halves. The active tab uses the same
      // emphasis tokens as the host's own settings navigation so it reads as part of the shell.
      // Savings dashboard: two headline figures, then proportional bars. The bars are the only
      // non-text encoding of magnitude, and each one also prints its own number, so the reading
      // never depends on the fill alone.
      '.tkdsDash{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;min-width:0;align-items:start}',
      '.tkdsKpi{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.tkdsKpiValue{font-size:calc(var(--dsh-content-font-size,14px) + 6px);line-height:calc(34px + var(--dsh-content-font-delta,0px));font-weight:600;color:var(--dsw-alias-label-primary);overflow-wrap:break-word;min-width:0}',
      '.tkdsBars{display:flex;flex-direction:column;gap:8px;grid-column:1/-1;min-width:0}',
      '.tkdsBarRow{display:grid;grid-template-columns:minmax(64px,auto) 1fr auto;gap:10px;align-items:center;min-width:0}',
      '.tkdsBarLabel{font-size:var(--dsh-content-font-size-secondary,13px);color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.tkdsBarTrack{display:block;height:8px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);overflow:hidden;min-width:0}',
      '.tkdsBarFill{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-label-accent-primary);transition:width 240ms ease-out}',
      '.tkdsBarValue{font-size:var(--dsh-content-font-size-secondary,13px);color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}',
      '@media (prefers-reduced-motion:reduce){.tkdsBarFill{transition:none}}',
      // Section intro: the title and its one-line summary sit above the tabs, matching the host's
      // own rhythm — more space above a heading than below it.
      '.tkdsTitle{min-width:0}',
      '.tkdsTitle{margin:0;font-family:inherit;font-size:calc(var(--dsh-content-font-size,14px) + 4px);font-weight:600;line-height:calc(26px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary);overflow-wrap:break-word;min-width:0}',
      '.tkdsHint{margin:0;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);overflow-wrap:break-word;min-width:0}',
      '.tkdsTabs{display:flex;align-items:flex-end;gap:22px;border-bottom:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l2);margin-top:2px;min-width:0;overflow-x:auto;flex-wrap:nowrap;scrollbar-width:thin}',
      // Tabs follow this repository's OWN settings-section convention, measured from
      // `dsh-custom-router`'s `.crSettingsTab` — the class its settings section actually uses,
      // not its in-panel `.crTab`: 13px secondary scale, tight `7px 1px 9px` padding with no pill,
      // and a 2px underline drawn by `::after` on the selected tab rather than a border on the
      // button. That is what makes a contributed section look like part of the settings dialog.
      '.tkdsTab{position:relative;appearance:none;background:0 0;border:0;padding:7px 1px 9px;cursor:pointer;color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:nowrap;flex:0 0 auto}',
      '@media (hover:hover){.tkdsTab:hover{color:var(--dsw-alias-label-primary)}}',
      '.tkdsTab[aria-selected=true]{color:var(--dsw-alias-label-primary)}',
      '.tkdsTab[aria-selected=true]::after,.tkdsTab:focus-visible::after{position:absolute;right:0;bottom:-1px;left:0;height:2px;border-radius:2px 2px 0 0;background:var(--dsw-alias-label-primary);content:""}',
      '.tkdsTab:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px;border-radius:2px;color:var(--dsw-alias-label-primary)}',
      '@media (prefers-reduced-motion:reduce){.tkdsTab{transition:none}}',
      // The section heading is one step above body content, like a DSH settings title.
      '.tkdsHint{margin:0;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);max-width:68ch}',
      '.tkdsMeta{font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}',
      // Card titles sit one level below the section heading.
      '.tkdsCardTitle{margin:0;font-family:inherit;font-size:var(--dsh-content-font-size,14px);font-weight:600;line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary)}',
      // Host rows carry no fill and no radius: a hairline separator and vertical padding are the
      // whole chrome (`CurrentVersionRow.module.css`: `padding: 16px 0`). A bordered card was the
      // second thing that read as a different design system.
      '.tkdsCard{border:0;border-bottom:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l2);background:none;border-radius:0;padding:16px 0;display:flex;flex-direction:column;gap:10px;min-width:0}',
      '.tkdsCard:last-child{border-bottom:none}',
      '.tkdsGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;min-width:0}',
      '.tkdsStat{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.tkdsStatLabel{font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary)}',
      '.tkdsStatValue{font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tkdsControls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.tkdsField{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}',
      // A field label is visible text, not a placeholder: it names the control beside it.
      '.tkdsLabel{font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.tkdsSelect{appearance:none;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;padding:5px 10px;max-width:100%;cursor:pointer;transition:border-color .12s ease,background .12s ease}',
      '@media (hover:hover){.tkdsSelect:hover:not(:disabled){border-color:var(--dsw-alias-border-l4)}}',
      '.tkdsSelect:disabled{opacity:.6;cursor:not-allowed}',
      '.tkdsButton{appearance:none;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-bg-layer-3));border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;padding:5px 14px;transition:background .12s ease,border-color .12s ease}',
      '@media (hover:hover){.tkdsButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}}',
      '.tkdsButton:disabled{opacity:.6;cursor:not-allowed}',
      // One focus ring for every control, from the DSH focus tokens.
      '.tkdsSelect:focus-visible,.tkdsButton:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}',
      // The dense table scrolls inside its own frame, so the header stays readable.
      '.tkdsScroll{max-height:280px;overflow:auto;min-width:0;border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-settings-card-fill)}',
      '.tkdsTable{width:100%;border-collapse:separate;border-spacing:0;font-variant-numeric:tabular-nums}',
      '.tkdsTh{position:sticky;top:0;z-index:1;background:var(--dsw-alias-settings-card-fill);text-align:left;font-weight:500;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));padding:6px 10px;border-bottom:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l2);white-space:nowrap}',
      '.tkdsTd{font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));padding:5px 10px;border-bottom:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l2);white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.tkdsTurnRow{cursor:pointer;background:var(--dsw-alias-bg-layer-1)}',
      '@media (hover:hover){.tkdsTurnRow:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}}',
      '.tkdsStepRow{color:var(--dsw-alias-label-secondary)}',
      '.tkdsScope{padding-left:20px}',
      '.tkdsToolRow{color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}',
      '.tkdsToolCell{padding-left:42px;white-space:normal}',
      '.tkdsBadge{display:inline-block;font-size:var(--dsh-content-font-size-secondary,13px);line-height:18px;padding:0 6px;border-radius:var(--dsw-radius-xs);border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);margin-left:6px}',
      '.tkdsError{color:var(--dsw-alias-state-error-primary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));margin:0}',
      '.tkdsMuted{margin:0;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}',
      // The settings page: one grid of labelled fields, one action row, one result list.
      '.tkdsRows{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;min-width:0}',
      '.tkdsRow{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.tkdsRowHead{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}',
      '.tkdsInput{appearance:textfield;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;padding:5px 10px;width:100%;min-width:0;font-variant-numeric:tabular-nums}',
      '.tkdsInput:disabled{opacity:.6;cursor:not-allowed}',
      '.tkdsInput:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}',
      '.tkdsInputInvalid{border-color:var(--dsw-alias-state-error-primary)}',
      // The override badge reuses `.tkdsBadge`, but an override is a change, not a hint.
      '.tkdsBadgeOverride{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);margin-left:0}',
      '.tkdsBadgeOk{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary);margin-left:0}',
      // The judge banner is an amber strip: unavailable is a real condition, not a footnote.
      '.tkdsWarn{display:flex;flex-direction:column;gap:2px;margin:0;padding:8px 12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-state-warn-tertiary);border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-state-warn-secondary);min-width:0}',
      '.tkdsWarnTitle{margin:0;color:var(--dsw-alias-state-warn-primary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));font-weight:600}',
      '.tkdsWarnReason{margin:0;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));overflow-wrap:anywhere}',
      '.tkdsResults{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none;min-width:0}',
      '.tkdsResult{display:flex;gap:6px;align-items:baseline;min-width:0;overflow-wrap:anywhere;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}',
      '.tkdsResultKey{color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.tkdsResultBad{color:var(--dsw-alias-state-error-primary)}',
      '.tkdsResultGood{color:var(--dsw-alias-state-success-primary)}',
      // Narrow panes: denser cards, a shorter table frame, and a tighter grid.
      '@media (max-width:640px){.tkdsSection{gap:10px}.tkdsCard{padding:10px 12px}.tkdsGrid{grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:8px}.tkdsScroll{max-height:220px}.tkdsTh,.tkdsTd{padding:4px 8px}}',
      // Motion is decorative here, so it is dropped entirely when the user asks for less.
      '@media (prefers-reduced-motion:reduce){.tkdsButton,.tkdsSelect{transition:none}}',
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

    /**
     * Insert the stylesheet once per document.
     *
     * The tag is keyed by `data-plugin-css`, the attribute the host reads to own (and to remove
     * on reload) a plugin's stylesheet, so a re-mount replaces the rules instead of stacking a
     * second copy of them on the page.
     */
    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.head.querySelector('style[data-plugin-css="' + CSS_TAG + '"]') !== null) return
      const tag = document.createElement('style')
      tag.setAttribute('data-plugin-css', CSS_TAG)
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
     * Label one session in the picker.
     *
     * The host route exposes an id and a working directory, never a title: a session title can
     * be derived from prompt text, and this payload carries counts and names only. So the
     * label is the directory the session ran in plus the FULL id — an 8-character prefix of a
     * uuid identifies nothing, and two sessions in one directory would look identical.
     * @param {object} entry - one session summary from the route.
     * @param {boolean} full - when true, spell out the whole working directory.
     * @returns {string} the label.
     */
    function sessionLabel(entry, full) {
      const id = String(entry?.id ?? '')
      const cwd = typeof entry?.cwd === 'string' ? entry.cwd : ''
      const directory = full ? cwd : (cwd === '' ? '' : cwd.split('/').filter(Boolean).pop() ?? '')
      if (directory === '') return id
      return id === '' ? directory : directory + ' · ' + id
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
          h('h2', { className: 'tkdsTitle' }, t('devstats.title')),
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
        h('div', { className: 'tkdsField' },
          h('label', { className: 'tkdsLabel', htmlFor: 'tk-devstats-session' }, t('devstats.session')),
          h('select', {
            id: 'tk-devstats-session',
            className: 'tkdsSelect',
            value: sessionId,
            onChange: (event) => {
              const next = String(event.target.value ?? '')
              setSessionId(next)
              void load(next)
            },
          }, sessions.map((entry) => h('option', {
            key: entry.id,
            value: entry.id,
            title: sessionLabel(entry, true),
          }, sessionLabel(entry, false))))),
        h('span', { className: 'tkdsMeta' }, t('devstats.source')))

      // The savings dashboard leads the page. A column of raw counters answers "what happened",
      // never "did this help" — so the first thing drawn is what the plugin actually removed,
      // where it came from, and what share of the session's context that was.
      const dash = savingsOf(detail, payload, sessionId)
      const savingsBody = dash.totalChars === 0
        ? h('p', { className: 'tkdsMuted' }, t('devstats.noSavings'))
        : h('div', { className: 'tkdsDash' },
          h('div', { className: 'tkdsKpi' },
            h('span', { className: 'tkdsStatLabel' }, t('devstats.savedTotal')),
            h('span', { className: 'tkdsKpiValue' }, fmtInt(dash.totalChars) + ' ' + t('devstats.savedChars')),
            h('span', { className: 'tkdsStatValue' }, '~' + fmtInt(dash.totalTokens) + ' ' + t('devstats.savedTokens'))),
          h('div', { className: 'tkdsKpi' },
            h('span', { className: 'tkdsStatLabel' }, t('devstats.savedRate')),
            h('span', { className: 'tkdsKpiValue' }, fmtPct(dash.rate)),
            h('span', { className: 'tkdsStatValue' }, t('devstats.savedContext'))),
          h('div', { className: 'tkdsBars' }, dash.rows.map((row) => h('div', { className: 'tkdsBarRow', key: row.label },
            h('span', { className: 'tkdsBarLabel' }, row.label),
            h('span', { className: 'tkdsBarTrack' },
              h('span', { className: 'tkdsBarFill', style: { width: row.pct + '%' }, 'data-tk-bar': row.label })),
            h('span', { className: 'tkdsBarValue' }, fmtInt(row.chars) + ' · ' + fmtInt(row.share, 0) + '%')))))

      const savingsCard = h('div', { className: 'tkdsCard', 'data-tk-savings': '1' },
        h('div', { className: 'tkdsHead' },
          h('h3', { className: 'tkdsCardTitle' }, t('devstats.savedTitle')),
          h('span', { className: 'tkdsMeta' }, t('devstats.savedChars') + ' · ' + t('devstats.savedTokens'))),
        savingsBody)

      const activityCard = h('div', { className: 'tkdsCard', 'data-tk-activity': '1' },
        h('h3', { className: 'tkdsCardTitle' }, t('devstats.actionsTitle')),
        h('div', { className: 'tkdsGrid' },
          stat(t('devstats.byDedup') + ' · ' + t('devstats.hits'), fmtInt(dash.dedupHits)),
          stat(t('devstats.byTiering'), fmtInt(dash.tierReplacements)),
          stat(t('devstats.breakerTrips'), fmtInt(dash.breakerTrips)),
          stat(t('devstats.watchdogWarns'), fmtInt(dash.watchdogWarns)),
          stat(t('devstats.watchdogInterrupts'), fmtInt(dash.watchdogInterrupts)),
          stat(t('devstats.toolCalls', { n: fmtInt(dash.toolCalls) }), fmtInt(dash.toolCalls))))

      const totals = detail?.totals ?? payload?.sessions?.find((entry) => entry.id === sessionId)?.totals
      const totalsGrid = totals === undefined ? null : h('div', { className: 'tkdsCard' },
        h('h3', { className: 'tkdsCardTitle' }, t('devstats.totals')),
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
            h('h3', { className: 'tkdsCardTitle' }, t('devstats.dshProjections')),
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
          h('h3', { className: 'tkdsCardTitle' }, t('devstats.tkLedger')),
          h('div', { className: 'tkdsGrid' }, ledgerPairs(ledger).map((pair) => stat(pair.label, pair.value))))

      const truncation = detail?.truncated === true
        ? h('p', { className: 'tkdsMuted' }, t('devstats.truncated', { turns: fmtInt(detail.turns?.length) }))
        : null

      const table = detail === undefined || detail.turns.length === 0
        ? h('p', { className: 'tkdsMuted' }, t('devstats.noDetail'))
        : h('div', { className: 'tkdsScroll' },
          h('table', { className: 'tkdsTable' },
            h('thead', null, h('tr', null,
              h('th', { className: 'tkdsTh', scope: 'col' }, t('devstats.scope')),
              h('th', { className: 'tkdsTh', scope: 'col' }, t('devstats.context')),
              h('th', { className: 'tkdsTh', scope: 'col' }, t('devstats.cache')),
              h('th', { className: 'tkdsTh', scope: 'col' }, t('devstats.input')),
              h('th', { className: 'tkdsTh', scope: 'col' }, t('devstats.output')),
              h('th', { className: 'tkdsTh', scope: 'col' }, t('devstats.reasoning')),
              h('th', { className: 'tkdsTh', scope: 'col' }, t('devstats.model')),
              h('th', { className: 'tkdsTh', scope: 'col' }, t('devstats.tools')),
              h('th', { className: 'tkdsTh', scope: 'col' }, t('devstats.wall')))),
            h('tbody', null, renderTurns(detail.turns, openTurns, toggleTurn))))

      return h('section', { className: 'tkdsSection', 'data-tk-devstats': '1' },
        header, selector, savingsCard, activityCard, totalsGrid, projectionCard, truncation, table)
    }

    /**
     * One labelled value cell.
     * @param {string} label - the label.
     * @param {string} value - the formatted value.
     * @returns {object} the element.
     */
    /**
     * Fold the plugin's own counters into the numbers the dashboard leads with.
     *
     * Every figure here is measured, not modelled. `savedChars` is the exact length of the tool
     * output the plugin replaced with a pointer; `shadowedTokens` is the host token meter's own
     * estimate of the content a tier rewrite removed. The rate is that saving against the session's
     * cumulative context, because "we removed 40k chars" means nothing without the denominator.
     *
     * There is deliberately no invented percentage: the estimated-token figure divides by the
     * measured average characters-per-token the ledger already reports, and is labelled as an
     * estimate everywhere it appears.
     * @param {object} detail - the selected session's detail payload.
     * @param {object} payload - the list payload, for a fallback summary.
     * @param {string} sessionId - the selected session id.
     * @returns {object} the dashboard figures.
     */
    function savingsOf(detail, payload, sessionId) {
      const summary = detail?.session
        ?? (Array.isArray(payload?.sessions) ? payload.sessions.find((entry) => entry.id === sessionId) : undefined)
        ?? {}
      const dedupChars = Number(summary?.dedup?.savedChars) || 0
      const tierTokens = Number(summary?.tiering?.shadowedTokens) || 0
      const contextChars = Number(detail?.totals?.contextCumulative) || 0
      // The host meter prices roughly 3.7 characters per token for this corpus; the ledger reports
      // the real ratio when it has one, and 3.7 is only the fallback.
      const charsPerToken = 3.7
      const tierChars = (tierTokens > 0 ? tierTokens : 0) * charsPerToken
      const totalChars = Math.round(dedupChars + tierChars)
      const totalTokens = Math.round(totalChars / charsPerToken)
      const denominator = contextChars > 0 ? contextChars + totalChars : 0
      const rate = denominator > 0 ? totalChars / denominator : 0
      const rows = [
        { label: t('devstats.byDedup'), chars: Math.round(dedupChars) },
        { label: t('devstats.byTiering'), chars: Math.round(tierChars) },
      ].filter((row) => row.chars > 0).sort((a, b) => b.chars - a.chars)
      const biggest = rows.length > 0 ? rows[0].chars : 1
      return {
        totalChars,
        totalTokens,
        rate,
        rows: rows.map((row) => ({
          label: row.label,
          chars: row.chars,
          pct: Math.max(2, Math.round((row.chars / biggest) * 100)),
          share: totalChars > 0 ? (row.chars / totalChars) * 100 : 0,
        })),
        dedupHits: Number(summary?.dedup?.hits) || 0,
        tierReplacements: Number(summary?.tiering?.replacements) || 0,
        breakerTrips: Number(summary?.loopBreaker?.trips) || 0,
        watchdogWarns: Number(summary?.watchdog?.warnings) || 0,
        watchdogInterrupts: Number(summary?.watchdog?.interrupts) || 0,
        toolCalls: Number(summary?.toolCalls) || 0,
      }
    }

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

    /**
     * Translate one settings key, with `{name}` interpolation.
     * @param {string} key - a dotted `settings.*` dictionary key.
     * @param {object} [vars] - interpolation values.
     * @returns {string} the text.
     */
    function tSettings(key, vars) {
      // Resolve the language at call time, not from the module-level `language` snapshot: the
      // section can paint before `apply()` has run, and a stale `'en'` there rendered the raw key
      // (`settings.summaryIdle`) instead of the sentence. Falling back to the live probe keeps the
      // table honest however early the render happens.
      const active = language === 'ko' ? 'ko' : (language === 'en' ? (currentLang() === 'ko' ? 'ko' : 'en') : currentLang())
      const table = SETTINGS_I18N[active] ?? SETTINGS_I18N.en
      let text = typeof table[key] === 'string' ? table[key] : (SETTINGS_I18N.en[key] ?? key)
      if (vars !== undefined) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.split('{' + name + '}').join(String(value))
        }
      }
      return text
    }

    /**
     * Call one settings route and normalize both the wire and the failure.
     *
     * A rejected write is still an answer: the caller reads `body.results` to render every key's
     * own verdict, so a non-2xx body is returned rather than thrown away.
     * @param {string} url - the route.
     * @param {object} [init] - fetch init.
     * @returns {Promise<{httpOk: boolean, body: object|null, error: string}>} the answer.
     */
    async function settingsFetch(url, init) {
      try {
        const response = await fetch(url, init)
        let body = null
        try {
          body = await response.json()
        } catch (error) {
          body = null
        }
        if (body === null || typeof body !== 'object') {
          return { httpOk: false, body: null, error: 'HTTP ' + String(response.status) }
        }
        return {
          httpOk: response.ok,
          body,
          error: typeof body.error === 'string' ? body.error : '',
        }
      } catch (error) {
        return { httpOk: false, body: null, error: error instanceof Error ? error.message : String(error) }
      }
    }

    /**
     * POST one JSON body to a settings route.
     * @param {string} url - the route.
     * @param {object} [payload] - the JSON body.
     * @returns {Promise<{httpOk: boolean, body: object|null, error: string}>} the answer.
     */
    function settingsPost(url, payload) {
      return settingsFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      })
    }

    /** Wait between import polls. */
    function delay(ms) {
      return new Promise((resolve) => { setTimeout(resolve, ms) })
    }

    /**
     * Resolve the `on` write alias to the concrete value the engine stores.
     *
     * The literal `on` is never sent: the select offers it as a shortcut, and this turns it into
     * the alias target first, exactly as the host route does.
     * @param {string} mode - the mechanism.
     * @param {string} word - the selected word.
     * @returns {string} the value to send.
     */
    function resolveMode(mode, word) {
      const text = String(word)
      return text === 'on' ? SETTINGS_MODE_ALIAS[mode] : text
    }

    /**
     * Check one threshold against its declared type and range, before it is sent.
     * @param {{type: string, min: number|null, max: number|null}} spec - the spec.
     * @param {unknown} raw - the input's text.
     * @returns {{ok: boolean, value?: number}} the coerced value, or a rejection.
     */
    function checkThreshold(spec, raw) {
      const text = String(raw ?? '').trim()
      if (text === '') return { ok: false }
      const numeric = Number(text)
      if (!Number.isFinite(numeric)) return { ok: false }
      if (spec.type === 'int' && !Number.isInteger(numeric)) return { ok: false }
      if (spec.min !== null && numeric < spec.min) return { ok: false }
      if (spec.max !== null && numeric > spec.max) return { ok: false }
      return { ok: true, value: spec.type === 'int' ? Math.trunc(numeric) : numeric }
    }

    /**
     * The one settings page this plugin contributes: an internal tab pair, not two nav entries.
     *
     * Two `settings.section` rows meant two sidebar entries for one product surface, and the
     * settings list already carries the host's own sections. One row with two tabs keeps the
     * navigation clean while leaving each half reachable in one click. The tab state lives here,
     * so switching tabs does not remount a half — a half-written threshold survives a peek at the
     * statistics.
     * @returns {object} the rendered section.
     */
    function TokenEconomizerSection() {
      ensureStyle()
      const [tab, setTab] = React.useState('settings')
      // The headline summary is fetched once for the section head, so the reader sees the value
      // before choosing a tab. A failure leaves it absent rather than blocking the page.
      const [dash, setDash] = React.useState({ totalChars: 0, rate: 0 })
      React.useEffect(() => {
        let alive = true
        const loadHead = async () => {
          const answer = await settingsFetch(SETTINGS_ROUTES.read, { method: 'GET' })
          if (!alive || answer.body?.ok !== true) return
          let saved = 0
          let context = 0
          try {
            const devstats = await devstatsFetch()
            const sessions = Array.isArray(devstats?.sessions) ? devstats.sessions : []
            for (const entry of sessions) {
              saved += Number(entry?.dedup?.savedChars) || 0
              saved += (Number(entry?.tiering?.shadowedTokens) || 0) * 3.7
              context += Number(entry?.totals?.contextCumulative) || 0
            }
          } catch {
            /* the summary is optional; the tabs still render */
          }
          const total = Math.round(saved)
          setDash({ totalChars: total, rate: context + total > 0 ? total / (context + total) : 0 })
        }
        void loadHead()
        return () => { alive = false }
      }, [])
      const [, setTick] = React.useState(0)
      // Follow host locale changes so the tab labels update live, like every other label here.
      React.useEffect(() => {
        if (typeof ctxLocaleSubscribe !== 'function') return undefined
        return ctxLocaleSubscribe(() => setTick((n) => n + 1))
      }, [])
      const tabs = [
        { id: 'settings', label: tSettings('settings.title') },
        { id: 'devstats', label: t('devstats.title') },
      ]
      // A roving tabindex with arrow-key movement is what makes `role="tablist"` honest: without
      // it a keyboard user tabs through every tab and cannot move between them, which is the
      // failure the ARIA pattern exists to prevent. Home/End jump to the ends, as the pattern
      // specifies. Selection follows focus, so a keyboard user does not have to press Enter.
      const onTabKeyDown = (event, index) => {
        const key = event?.key
        let next = null
        if (key === 'ArrowRight') next = (index + 1) % tabs.length
        else if (key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
        else if (key === 'Home') next = 0
        else if (key === 'End') next = tabs.length - 1
        if (next === null) return
        event.preventDefault?.()
        setTab(tabs[next].id)
        const nodes = event.currentTarget?.parentElement?.children
        nodes?.[next]?.focus?.()
      }
      const tabRow = h('div', {
        className: 'tkdsTabs',
        role: 'tablist',
        'data-tk-tabs': '1',
        'aria-label': tSettings('settings.navTitle'),
      }, ...tabs.map((entry, index) => h('button', {
        type: 'button',
        key: entry.id,
        role: 'tab',
        id: 'tkds-tab-' + entry.id,
        'aria-selected': tab === entry.id ? 'true' : 'false',
        'aria-controls': 'tkds-panel-' + entry.id,
        // Only the selected tab is in the tab order; arrow keys move between the rest.
        tabIndex: tab === entry.id ? 0 : -1,
        'data-tk-tab': entry.id,
        className: 'tkdsTab',
        onClick: () => setTab(entry.id),
        onKeyDown: (event) => onTabKeyDown(event, index),
      }, entry.label)))
      // Title, one-line summary, then the sub-tabs. The host's panel has no heading of its own for
      // a contributed section — `settings.header` belongs to the shell — so the section states
      // what it is here, once, and the tabs below it switch the two halves.
      const summary = dash.totalChars > 0
        ? tSettings('settings.summarySaving', {
          chars: fmtInt(dash.totalChars),
          rate: fmtPct(dash.rate),
        })
        : tSettings('settings.summaryIdle')
      // Title and intro are SIBLINGS in the section column, exactly as `dsh-custom-router` lays
      // out `.crSettingsTitle` + `.crSettingsIntro`. Wrapping them in one box added a nesting level
      // the host's rhythm does not have, and the extra 20px gap then spaced the tab strip further
      // from the title than every other section does.
      const heading = [
        h('h2', { className: 'tkdsTitle', key: 'title' }, tSettings('settings.navTitle')),
        h('p', { className: 'tkdsHint', key: 'intro' }, summary),
      ]
      const body = tab === 'settings' ? h(SettingsSection) : h(DevStatsSection)
      return h('section', { className: 'tkdsSection', 'data-tk-token-economizer': '1' }, ...heading, tabRow,
        h('div', {
          role: 'tabpanel',
          id: 'tkds-panel-' + tab,
          'aria-labelledby': 'tkds-tab-' + tab,
          className: 'tkdsPanel',
        }, body))
    }

    /**
     * The settings page: three mode selects, nine thresholds, the actions, and the judge banner.
     *
     * Every value painted here comes from the host's aggregate GET, never from a local guess;
     * a write is followed by a re-read before the page repaints, so the screen never shows a
     * value the engine has not confirmed.
     * @returns {object} the rendered section.
     */
    function SettingsSection() {
      ensureStyle()
      const [state, setState] = React.useState({ status: 'loading', error: null, payload: null })
      const [edits, setEdits] = React.useState({})
      const [phase, setPhase] = React.useState('idle')
      const [results, setResults] = React.useState([])
      const [importState, setImportState] = React.useState({ status: 'idle', jobId: '', error: '' })
      const [, setTick] = React.useState(0)
      const alive = React.useRef(true)

      React.useEffect(() => () => { alive.current = false }, [])

      // Follow host locale changes so every label updates live.
      React.useEffect(() => {
        if (typeof ctxLocaleSubscribe !== 'function') return undefined
        return ctxLocaleSubscribe(() => setTick((n) => n + 1))
      }, [])

      const load = React.useCallback(async () => {
        setState((prev) => ({ status: prev.payload === null ? 'loading' : 'ready', error: null, payload: prev.payload }))
        const answer = await settingsFetch(SETTINGS_ROUTES.read, { method: 'GET' })
        if (answer.body === null || answer.body.ok !== true) {
          setState({ status: 'error', error: answer.error.length > 0 ? answer.error : 'unavailable', payload: null })
          return
        }
        setState({ status: 'ready', error: null, payload: answer.body })
        setEdits({})
      }, [])

      React.useEffect(() => { void load() }, [load])

      const payload = state.payload
      const modes = payload !== null && payload.modes !== null && typeof payload.modes === 'object' ? payload.modes : {}
      const thresholds = payload !== null && payload.thresholds !== null && typeof payload.thresholds === 'object' ? payload.thresholds : {}
      const judge = payload !== null && payload.judge !== null && typeof payload.judge === 'object' ? payload.judge : null

      /** The stored value of one threshold, falling back to the inlined contract default. */
      const currentOf = (spec) => {
        const view = thresholds[spec.label]
        return view !== null && typeof view === 'object' && view.value !== undefined ? view.value : spec.def
      }

      const save = async () => {
        const set = {}
        let invalid = false
        for (const spec of SETTINGS_THRESHOLDS) {
          const raw = edits[spec.label]
          if (raw === undefined) continue
          if (String(raw).trim() === String(currentOf(spec))) continue
          const checked = checkThreshold(spec, raw)
          if (!checked.ok) {
            invalid = true
            continue
          }
          set[spec.label] = checked.value
        }
        for (const mode of SETTINGS_MODES) {
          const raw = edits[mode.key]
          if (raw === undefined) continue
          const selected = resolveMode(mode.key, raw)
          if (selected === String(modes[mode.key] ?? 'off')) continue
          set[mode.key] = selected
        }
        if (invalid) {
          setPhase('invalid')
          return
        }
        if (Object.keys(set).length === 0) {
          setPhase('saved')
          return
        }
        setPhase('saving')
        setResults([])
        const answer = await settingsPost(SETTINGS_ROUTES.config, { set })
        if (!alive.current) return
        const perKey = answer.body !== null && Array.isArray(answer.body.results) ? answer.body.results : []
        setResults(perKey)
        if (perKey.length === 0 && answer.body?.ok !== true) {
          setResults([{ key: '', ok: false, error: answer.error.length > 0 ? answer.error : 'unavailable' }])
        }
        setPhase(perKey.some((entry) => entry.ok === true) ? 'saved' : 'idle')
        // Confirm after write: the re-read paints the engine's value, never the posted one.
        await load()
      }

      const act = async (route) => {
        setPhase('saving')
        setResults([])
        setImportState({ status: 'idle', jobId: '', error: '' })
        const answer = await settingsPost(route, {})
        if (!alive.current) return
        if (answer.body?.ok !== true) {
          setResults([{ key: '', ok: false, error: answer.error.length > 0 ? answer.error : 'unavailable' }])
          setPhase('idle')
          return
        }
        await load()
        if (alive.current) setPhase('saved')
      }

      const startImport = async () => {
        setImportState({ status: 'running', jobId: '', error: '' })
        const started = await settingsPost(SETTINGS_ROUTES.importJob, {})
        const jobId = String(started.body?.jobId ?? '')
        if (started.body?.ok !== true || jobId === '') {
          setImportState({ status: 'failed', jobId: '', error: started.error.length > 0 ? started.error : 'unavailable' })
          return
        }
        setImportState({ status: 'running', jobId, error: '' })
        for (let attempt = 0; attempt < 600; attempt += 1) {
          await delay(1000)
          if (!alive.current) return
          const polled = await settingsFetch(SETTINGS_ROUTES.importJob + '/' + jobId, { method: 'GET' })
          if (!alive.current) return
          if (polled.body === null) {
            setImportState({ status: 'failed', jobId, error: polled.error })
            return
          }
          const status = String(polled.body.status ?? '')
          if (status === 'done') {
            setImportState({ status: 'done', jobId, error: '' })
            return
          }
          if (status === 'failed') {
            setImportState({ status: 'failed', jobId, error: String(polled.body.error ?? '') })
            return
          }
        }
        setImportState({ status: 'failed', jobId, error: 'timed out' })
      }

      const header = h('div', { className: 'tkdsHead' },
        h('div', { style: { minWidth: 0 } },
          h('h2', { className: 'tkdsTitle' }, tSettings('settings.title'))),
        h('div', { className: 'tkdsControls' },
          h('button', {
            type: 'button',
            className: 'tkdsButton',
            disabled: state.status !== 'ready' || phase === 'saving',
            onClick: () => void save(),
            'data-tk-settings-save': '1',
          }, phase === 'saving' ? tSettings('settings.saving') : tSettings('settings.save'))))

      if (state.status === 'loading') {
        return h('section', { className: 'tkdsSection', 'data-tk-settings': '1' },
          header, h('p', { className: 'tkdsMuted' }, tSettings('settings.saving')))
      }
      if (state.status === 'error') {
        return h('section', { className: 'tkdsSection', 'data-tk-settings': '1' },
          header,
          h('p', { className: 'tkdsError' }, String(state.error)),
          h('div', { className: 'tkdsControls' },
            h('button', { type: 'button', className: 'tkdsButton', onClick: () => void load() }, t('devstats.retry'))))
      }

      // The judge probe: unavailable is a fact the page states, never a condition it hides.
      const banner = judge !== null && judge.available === false
        ? h('div', { className: 'tkdsWarn', role: 'status', 'data-tk-settings-judge': 'unavailable' },
          h('p', { className: 'tkdsWarnTitle' }, tSettings('settings.judgeUnavailable')),
          h('p', { className: 'tkdsWarnReason' }, String(judge.reason ?? '')))
        : null

      const modeRows = SETTINGS_MODES.map((mode) => {
        const stored = String(modes[mode.key] ?? 'off')
        const selected = edits[mode.key] === undefined ? stored : String(edits[mode.key])
        const options = mode.values.map((value) => h('option', { key: value, value }, value))
        // `on` is a shortcut only: the change handler resolves it to the alias target first.
        options.push(h('option', { key: 'on', value: 'on' }, tSettings('settings.modeOn')))
        return h('div', { className: 'tkdsRow', key: mode.key },
          h('div', { className: 'tkdsRowHead' },
            h('label', { className: 'tkdsLabel', htmlFor: 'tk-settings-mode-' + mode.key }, mode.key),
            h('span', { className: 'tkdsBadge' }, stored)),
          h('select', {
            id: 'tk-settings-mode-' + mode.key,
            className: 'tkdsSelect',
            value: selected,
            'data-tk-settings-mode': mode.key,
            onChange: (event) => {
              const word = resolveMode(mode.key, event.target.value)
              setEdits((prev) => ({ ...prev, [mode.key]: word }))
            },
          }, options))
      })

      const thresholdRows = SETTINGS_THRESHOLDS.map((spec) => {
        const view = thresholds[spec.label]
        const current = currentOf(spec)
        const def = view !== null && typeof view === 'object' && view.default !== undefined ? view.default : spec.def
        const min = view !== null && typeof view === 'object' && view.min !== undefined ? view.min : spec.min
        const max = view !== null && typeof view === 'object' && view.max !== undefined ? view.max : spec.max
        const raw = edits[spec.label]
        const text = raw === undefined ? String(current) : String(raw)
        const checked = raw === undefined ? { ok: true } : checkThreshold(spec, raw)
        const overridden = String(current) !== String(def)
        return h('div', { className: 'tkdsRow', key: spec.label },
          h('label', { className: 'tkdsLabel', htmlFor: 'tk-settings-threshold-' + spec.label }, spec.label),
          h('div', { className: 'tkdsRowHead' },
            h('input', {
              id: 'tk-settings-threshold-' + spec.label,
              className: checked.ok ? 'tkdsInput' : 'tkdsInput tkdsInputInvalid',
              type: 'text',
              inputMode: spec.type === 'int' ? 'numeric' : 'decimal',
              value: text,
              'data-tk-settings-threshold': spec.label,
              'aria-invalid': checked.ok ? 'false' : 'true',
              onChange: (event) => {
                const next = event.target.value
                setEdits((prev) => ({ ...prev, [spec.label]: next }))
              },
            }),
            overridden
              ? h('span', { className: 'tkdsBadge tkdsBadgeOverride' }, tSettings('settings.override'))
              : h('span', { className: 'tkdsBadge tkdsBadgeOk' }, tSettings('settings.engineDefault'))),
          checked.ok
            ? h('p', { className: 'tkdsMeta' }, tSettings('settings.range', { min: String(min), max: max === null ? '∞' : String(max) }))
            : h('p', { className: 'tkdsError' }, tSettings('settings.invalid')))
      })

      const resultItems = results.map((entry, index) => h('li', {
        className: entry.ok === true ? 'tkdsResult tkdsResultGood' : 'tkdsResult tkdsResultBad',
        key: String(entry.key ?? '') + ':' + String(index),
      },
      h('span', { className: 'tkdsResultKey' }, String(entry.key ?? '') === '' ? '—' : String(entry.key)),
      h('span', null, entry.ok === true
        ? tSettings('settings.saved')
        : tSettings('settings.engineError', { reason: String(entry.error ?? '') }))))

      const importLine = importState.status === 'running'
        ? h('p', { className: 'tkdsMeta' }, tSettings('settings.importRunning') + (importState.jobId === '' ? '' : ' · ' + importState.jobId))
        : (importState.status === 'done'
            ? h('p', { className: 'tkdsMeta' }, tSettings('settings.importDone'))
            : (importState.status === 'failed'
                ? h('p', { className: 'tkdsError' }, String(importState.error))
                : null))

      return h('section', { className: 'tkdsSection', 'data-tk-settings': '1' },
        header,
        banner,
        phase === 'saved' ? h('p', { className: 'tkdsMeta' }, tSettings('settings.saved')) : null,
        phase === 'invalid' ? h('p', { className: 'tkdsError' }, tSettings('settings.invalid')) : null,
        h('div', { className: 'tkdsCard' },
          h('h3', { className: 'tkdsCardTitle' }, tSettings('settings.mode')),
          h('div', { className: 'tkdsRows' }, modeRows)),
        h('div', { className: 'tkdsCard' },
          h('h3', { className: 'tkdsCardTitle' }, tSettings('settings.thresholds')),
          h('div', { className: 'tkdsRows' }, thresholdRows)),
        h('div', { className: 'tkdsCard' },
          h('h3', { className: 'tkdsCardTitle' }, tSettings('settings.actions')),
          h('div', { className: 'tkdsControls' },
            h('button', {
              type: 'button',
              className: 'tkdsButton',
              disabled: phase === 'saving',
              onClick: () => void act(SETTINGS_ROUTES.restore),
              'data-tk-settings-action': 'restore',
            }, tSettings('settings.restore')),
            h('button', {
              type: 'button',
              className: 'tkdsButton',
              disabled: phase === 'saving',
              onClick: () => void act(SETTINGS_ROUTES.reset),
              'data-tk-settings-action': 'reset',
            }, tSettings('settings.resetAll')),
            h('button', {
              type: 'button',
              className: 'tkdsButton',
              disabled: importState.status === 'running',
              onClick: () => void startImport(),
              'data-tk-settings-action': 'import',
            }, tSettings('settings.import'))),
          importLine),
        results.length > 0 ? h('ul', { className: 'tkdsResults' }, resultItems) : null)
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
      // One nav row for the whole plugin. The two halves are internal tabs, so the settings
      // navigation stays the host's own list plus one product surface rather than two fragments
      // of the same one.
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'tokeneconomizer',
        order: 62,
        label: () => tSettings('settings.navTitle'),
      }, TokenEconomizerSection))
    }

    exports.apply = apply
    exports.inject = inject
    exports.TokenEconomizerSection = TokenEconomizerSection
    exports.DevStatsSection = DevStatsSection
    exports.SettingsSection = SettingsSection
    Object.defineProperty(exports, 'default', { value: { apply, inject } })
    return module.exports
  },
})
