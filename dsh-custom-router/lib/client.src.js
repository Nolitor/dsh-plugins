/**
 * @nolit/dsh-custom-router -- browser half.
 *
 * ONE settings section (`custom-router`) that owns every provider surface the
 * router mounts. The vendor plugins are mounted as CHILD plugins of the router,
 * so their own settings tabs are gone by design: this section is the single
 * place where the operator sees providers, usage, billing and switches.
 *
 * MODULE FORMAT: served to the browser as-is and evaluated by
 * window.__ModuleLoader__, so it must be a CommonJS factory. ESM import/export
 * statements both fail to load.
 *
 * LOCALE: locale/en.json, locale/ko.json and locale/zh.json are the single
 * source of truth. scripts/gen-locale.mjs bakes them into lib/locale-table.js
 * and scripts/build-client.mjs bakes that table into this file (the I18N
 * assignment placeholder). English is the default; a Korean or Chinese host
 * locale switches every string, and a locale change re-renders the section.
 *
 * DATA: the router's settings namespace is the only source of truth for the
 * switches. It is read through ctx.configForms.get('dsh-custom-router') and
 * written through the same form's atomic mutate(); the full configuration
 * object is never replaced and a secret value is never read back or rendered.
 *
 * USAGE FEED: the namespace may carry a `usage` map keyed by preset id:
 *   { antigravity: { measuredAt, windows: [{id, percent, resetsAt}],
 *                    serving: {modelCount, health} },
 *     deepinfra:   { measuredAt, spend, requests, inputTokens, outputTokens,
 *                    inputRate, outputRate, balance } }
 * A measurement that was not reported stays ABSENT: the surface says so
 * instead of showing a zero nobody measured.
 *
 * STYLE ISOLATION: every colour, border, radius and size is a --dsw-* design
 * token or inherited. One `<style data-plugin-css>` tag, keyed by this package,
 * and no rule targets a bare element selector, so nothing leaks outside the
 * dashboard.
 *
 * COMPONENT SHAPE: every component below is a PURE function of its props (no
 * hooks). Only the container components hold state. That keeps the view model
 * testable without a browser and keeps the re-render boundary obvious.
 */
window.__ModuleLoader__.load({
  id: '@nolit/dsh-custom-router',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    // Baked from locale/*.json by scripts/gen-locale.mjs + scripts/build-client.mjs.
    const I18N = __CR_I18N__

    /** The router's settings namespace (the loader row id of the plugin). */
    const NAMESPACE = 'dsh-custom-router'

    /** The single settings section id this package registers. */
    const SECTION_ID = 'custom-router'

    /** Nav order: before the legacy vendor sections (Antigravity sits at 62). */
    const SECTION_ORDER = 20

    /** Style tag key, so a reload replaces the stylesheet instead of adding one. */
    const CSS_TAG = '@nolit/dsh-custom-router'

    const CSS = [
      // ------------------------------------------------------------ page shell
      '.crSection{min-width:0;display:flex;flex-direction:column;gap:20px;font-family:inherit;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary);word-break:keep-all;overflow-wrap:break-word}',
      // The dashboard is a PAGE inside the main slot, not a full-bleed surface:
      // it centres itself and stops growing past a readable width instead of
      // stretching across the window.
      '.crPage{width:100%;max-width:1120px;margin:0 auto;padding:20px 24px;box-sizing:border-box}',
      '.crPage.crPageScroll{height:100%;max-height:100%;min-height:0;overflow-y:auto;overflow-x:hidden;padding:20px 24px 40px}',
      '.crPageNarrow{max-width:920px}',
      // A label that only assistive technology reads: the control it names is
      // visible, the label text is not.
      // --------------------------------------------------------------- header
      '.crHeader{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;min-width:0}',
      '.crHeaderText{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 320px}',
      '.crHeaderSide{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:0 0 auto}',
      '.crTitle{margin:0;font-family:inherit;font-size:calc(var(--dsh-content-font-size,14px) + 4px);font-weight:600;line-height:calc(30px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary)}',
      '.crSubtitle{margin:0;font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);max-width:60ch}',
      '.crUpdatedAt{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      // -------------------------------------------------------------- buttons
      '.crButton{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-1);border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));padding:6px 12px;cursor:pointer;white-space:nowrap;transition:background .12s ease,border-color .12s ease,color .12s ease}',
      '@media (hover:hover){.crButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}}',
      '.crButton:disabled{opacity:.5;cursor:not-allowed}',
      '.crButtonGhost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary)}',
      '.crButtonPrimary{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);background:transparent}',
      '@media (hover:hover){.crButtonPrimary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-accent)}}',
      // ----------------------------------------------------------------- tabs
      // The strip scrolls sideways on a narrow surface instead of clipping a
      // control: every tab keeps its own hit area.
      '.crTabs{display:flex;gap:2px;border-bottom:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l3);min-width:0;overflow-x:auto;flex-wrap:nowrap;scrollbar-width:thin}',
      '.crTab{appearance:none;background:0 0;border:0;border-bottom:2px solid transparent;cursor:pointer;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:var(--dsh-content-font-size,14px);font-weight:500;line-height:calc(22px + var(--dsh-content-font-delta,0px));padding:10px 14px;margin-bottom:calc(-1 * var(--dsh-hairline-width,.5px));white-space:nowrap;flex:0 0 auto}',
      '.crTab:hover{color:var(--dsw-alias-label-primary)}',
      '.crTab[aria-selected=true]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-state-business-primary)}',
      // ------------------------------------------------------------- kpi cards
      '.crKpiGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr));gap:16px;align-items:stretch}',
      '.crKpiCard{border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-lg);padding:14px 16px;display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.crKpiLabelRow{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}',
      '.crKpiLabel{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crJump{appearance:none;background:0 0;border:0;padding:2px 4px;cursor:pointer;color:var(--dsw-alias-link);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:nowrap;border-radius:var(--dsw-radius-xs)}',
      '.crKpiValue{font-family:inherit;font-size:calc(var(--dsh-content-font-size,14px) + 10px);font-weight:600;line-height:calc(34px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crKpiMeta{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      // ------------------------------------------------------- provider rows
      // ONE column of compact provider rows: a 3-up grid stretched every row to
      // the width of the widest sibling and squeezed the forms. The detail of
      // one provider renders BELOW the list, full width.
      '.crProviderList{display:flex;flex-direction:column;gap:12px;min-width:0}',
      // One provider: the compact row plus the full-width detail below it.
      '.crProviderItem{display:flex;flex-direction:column;gap:12px;min-width:0}',
      '.crProviderRow{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;padding:12px 14px;border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-lg);min-width:0}',
      '.crProviderHead{display:flex;align-items:center;gap:10px;min-width:0}',
      '.crProviderUsage{display:flex;align-items:center;gap:16px;flex-wrap:wrap;min-width:0}',
      // One inline usage window: label, percent and a slim bar.
      '.crMiniUsage{display:flex;flex-direction:column;gap:4px;flex:1 1 140px;max-width:220px;min-width:0}',
      '.crMiniRow{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0}',
      '.crMiniLabel{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crMiniPct{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.crMiniReset{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crMiniBar{height:4px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover-solid);overflow:hidden}',
      '.crMiniBarFill{height:100%;border-radius:inherit;background:var(--dsw-alias-state-business-primary)}',
      '.crMiniBarFill[data-level=high]{background:var(--dsw-alias-state-error-primary)}',
      '.crProviderDetail{border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-lg);padding:16px;display:flex;flex-direction:column;gap:16px;min-width:0}',
      // The reveal: a grid-rows animation that needs no fixed height.
      '.crReveal{display:grid;grid-template-rows:0fr;transition:grid-template-rows 180ms ease;min-width:0}',
      '.crReveal[data-open=true]{grid-template-rows:1fr}',
      '.crRevealInner{min-height:0;overflow:hidden;min-width:0}',
      '.crAvatar{width:36px;height:36px;border-radius:var(--dsw-radius-sm);flex:0 0 auto;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:var(--dsh-content-font-size,14px);font-weight:600;line-height:1}',
      '.crIdentity{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}',
      '.crVendorName{font-family:inherit;font-size:var(--dsh-content-font-size,14px);font-weight:600;line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crPlan{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crBadge{flex:0 0 auto;border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l3);border-radius:999px;padding:1px 8px;font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.crBadge[data-state=active]{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
      '.crBadge[data-state=inactive]{border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary)}',
      // The icon button that opens one provider's settings.
      '.crGear{flex:0 0 auto;appearance:none;background:transparent;border:var(--dsh-hairline-width,.5px) solid transparent;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-secondary);cursor:pointer;width:28px;height:28px;display:flex;align-items:center;justify-content:center;padding:0;transition:background .12s ease,color .12s ease}',
      '@media (hover:hover){.crGear:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}}',
      // The compact measurement inset inside one provider detail.
      '.crUsageInset{border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);padding:12px;display:flex;flex-direction:column;gap:12px;min-width:0}',
      // The usage windows sit INLINE in one provider row: three slim bars
      // side by side, not a stacked column.
      '.crUsageWindows{display:flex;flex-direction:row;flex-wrap:wrap;gap:16px;min-width:0}',
      '.crBody{display:flex;flex-direction:column;gap:12px;min-width:0;flex:1}',
      '.crPanel{display:flex;flex-direction:column;gap:16px;min-width:0}',
      '.crSettingsPanelBody{display:flex;flex-direction:column;gap:16px;min-width:0}',
      '.crUsageWindow{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.crUsageRow{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}',
      '.crUsageLabel{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crUsagePct{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.crBar{height:6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover-solid);overflow:hidden}',
      '.crBarFill{height:100%;border-radius:inherit;background:var(--dsw-alias-state-business-primary)}',
      '.crBarFill[data-level=high]{background:var(--dsw-alias-state-error-primary)}',
      '.crUsageReset{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crServing{display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l3);padding-top:8px;min-width:0}',
      '.crServingTitle{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.crServingMeta{display:flex;align-items:center;gap:8px;min-width:0}',
      // -------------------------------------------------------------- billing
      '.crBillingHero{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.crBillingHeroLabel{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary)}',
      '.crBillingHeroValue{font-family:inherit;font-size:calc(var(--dsh-content-font-size,14px) + 8px);font-weight:600;line-height:calc(32px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
      '.crBillingGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(160px,100%),1fr));gap:12px}',
      '.crBillingStat{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.crBillingStatLabel{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crBillingStatValue{font-family:inherit;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crBillingRow{display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l3);padding-top:8px;min-width:0}',
      '.crBillingRowLabel{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.crBillingRowValue{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      // ------------------------------------------------------- settings panel
      '.crSettingsPanel{display:flex;flex-direction:column;gap:16px;min-width:0}',
      '.crSettingsTitle{font-family:inherit;font-size:var(--dsh-content-font-size,14px);font-weight:600;line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary);margin:0}',
      // A form section: a labelled block with an optional hint line.
      '.crFormSection{display:flex;flex-direction:column;gap:10px;min-width:0}',
      '.crFormSectionHead{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap;min-width:0}',
      '.crFormSectionTitle{font-family:inherit;font-size:var(--dsh-content-font-size,14px);font-weight:600;line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary);margin:0}',
      '.crFormSectionHint{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);min-width:0}',
      '.crFormSectionBody{display:flex;flex-direction:column;gap:12px;min-width:0}',
      '.crMaster{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0;padding:10px 12px;border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md)}',
      '.crMasterText{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.crMasterLabel{font-family:inherit;font-size:var(--dsh-content-font-size,14px);font-weight:500;line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary)}',
      '.crMasterHint{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);margin:0}',
      '.crSwitch{appearance:none;border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l4);background:0 0;border-radius:999px;width:36px;height:20px;position:relative;cursor:pointer;flex:0 0 auto;padding:0}',
      '.crSwitch::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-tertiary);transition:transform .15s ease}',
      '.crSwitch[aria-checked=true]{background:var(--dsw-alias-button-ghost-active-fill);border-color:var(--dsw-alias-state-success-primary)}',
      '.crSwitch[aria-checked=true]::after{transform:translateX(16px);background:var(--dsw-alias-state-success-primary)}',
      '.crSwitch:disabled{opacity:.55;cursor:default}',
      '.crLayerGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr));gap:12px}',
      '.crLayerCell{display:flex;align-items:center;justify-content:space-between;gap:8px;border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);padding:10px 12px;min-width:0}',
      '.crLayerCell[data-unsupported=true]{opacity:.7}',
      '.crLayerName{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crLayerState{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}',
      // One write-only credential field: label, state, input and its actions.
      '.crField{display:flex;flex-direction:column;gap:6px;min-width:0}',
      '.crFieldHead{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}',
      '.crFieldLabel{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crFieldActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}',
      '.crInput{appearance:none;width:100%;min-width:0;box-sizing:border-box;border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));padding:6px 10px}',
      '.crState{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.crState[data-state=set]{color:var(--dsw-alias-state-success-primary)}',
      '.crState[data-state=error]{color:var(--dsw-alias-state-error-primary)}',
      '.crHint{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);margin:0;min-width:0}',
      '.crFooter{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}',
      '.crFooterNote{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);min-width:0}',
      '.crFooterNote[data-state=error]{color:var(--dsw-alias-state-error-primary)}',
      '.crFooterNote[data-state=applied]{color:var(--dsw-alias-state-success-primary)}',
      // The live region that carries a write result to assistive technology.
      '.crStatusLive{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}',
      // ------------------------------------------------------- provider picker
      '.crPickerGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(240px,100%),1fr));gap:16px;align-items:stretch}',
      '.crPickerCard{border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-lg);padding:16px;display:flex;flex-direction:column;gap:8px;min-width:0}',
      '.crPickerHead{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}',
      '.crPickerTitle{font-family:inherit;font-size:var(--dsh-content-font-size,14px);font-weight:600;line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary)}',
      '.crPickerDesc{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-secondary);margin:0;min-width:0}',
      '.crPickerAuth{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);margin:0}',
      '.crPickerActions{display:flex;align-items:center;gap:8px;margin-top:auto;padding-top:8px;min-width:0}',
      // --------------------------------------------------- settings section
      // The settings section mirrors the built-in plugin section: a readable
      // 760 px column, a heading and a compact tab strip, never a full-bleed
      // page. These classes belong to the settings surface alone; the
      // dashboard keeps its own `.crPage` / `.crTabs` chrome.
      '.crSettingsSection{display:flex;flex-direction:column;gap:12px;max-width:760px;min-width:0}',
      '.crSettingsTitle{margin:0;font-family:inherit;font-size:calc(var(--dsh-content-font-size,14px) + 4px);font-weight:600;line-height:calc(26px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary)}',
      '.crSettingsIntro{margin:0;font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary)}',
      '.crSettingsTabs{display:flex;align-items:flex-end;gap:22px;border-bottom:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l2);margin-top:2px;min-width:0;overflow-x:auto;flex-wrap:nowrap;scrollbar-width:thin}',
      '.crSettingsTab{position:relative;appearance:none;background:0 0;border:0;padding:7px 1px 9px;cursor:pointer;color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:nowrap;flex:0 0 auto}',
      '@media (hover:hover){.crSettingsTab:hover{color:var(--dsw-alias-label-primary)}}',
      '.crSettingsTab[aria-selected=true]{color:var(--dsw-alias-label-primary)}',
      '.crSettingsTab[aria-selected=true]::after,.crSettingsTab:focus-visible::after{position:absolute;right:0;bottom:-1px;left:0;height:2px;border-radius:2px 2px 0 0;background:var(--dsw-alias-label-primary);content:""}',
      '.crSettingsTab:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px;border-radius:2px;color:var(--dsw-alias-label-primary)}',
      // ------------------------------------------------------- model catalogs
      '.crModels{display:flex;flex-direction:column;gap:12px;min-width:0}',
      // One toolbar / card / row layout shared by every preset: the vendor data
      // differs, the list geometry does not.
      '.crToolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;position:sticky;top:0;z-index:1;padding:10px 12px;border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-settings-card-fill)}',
      '.crSearchInput{flex:1 1 180px;min-width:120px;height:calc(30px + var(--dsh-content-font-delta,0px));box-sizing:border-box;border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));padding:0 10px}',
      '.crCards{display:flex;flex-direction:column;gap:12px;min-width:0}',
      '.crGroup{border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-lg);display:flex;flex-direction:column;min-width:0;overflow:hidden}',
      '.crGroupHead{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-bottom:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l3);min-width:0}',
      '.crGroupTitle{margin:0;font-family:inherit;font-size:var(--dsh-content-font-size,14px);font-weight:600;line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crGroupMeta{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}',
      '.crGroupSide{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;min-width:0}',
      // The panel body carries the tabpanel role; it is the ONLY panel rendered,
      // so no `display:flex` rule can resurrect a hidden sibling tab.
      '.crPanelBody{display:flex;flex-direction:column;gap:12px;min-width:0}',
      '.crGroupBody{display:flex;flex-direction:column;min-width:0}',
      '.crList{margin:0;padding:6px;list-style:none;display:flex;flex-direction:column;gap:2px;max-height:420px;overflow:auto;min-width:0}',
      '.crRow{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;padding:8px;border-radius:var(--dsw-radius-sm);min-width:0;cursor:pointer;border:var(--dsh-hairline-width,.5px) solid transparent}',
      '@media (hover:hover){.crRow:hover{background:var(--dsw-alias-interactive-bg-hover)}}',
      '.crRowCheck{width:14px;height:14px;accent-color:var(--dsw-alias-state-business-primary);margin:0;flex:0 0 auto}',
      '.crRowMain{display:flex;flex-direction:column;gap:1px;min-width:0}',
      '.crRowName{font-family:inherit;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.crRowId{font-family:var(--ds-font-family-code,monospace);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.crRowMeta{display:flex;gap:6px;flex-wrap:wrap;align-items:center;color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));font-variant-numeric:tabular-nums;min-width:0}',
      '.crPrice{display:flex;flex-direction:column;align-items:flex-end;gap:1px;min-width:0;text-align:right}',
      '.crPriceRate{font-family:var(--ds-font-family-code,monospace);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.crPriceList{font-family:var(--ds-font-family-code,monospace);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;text-decoration:line-through;white-space:nowrap}',
      '.crPriceNote{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.crBadgeMeta{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));padding:0 6px;border-radius:var(--dsw-radius-xs);border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.crBadgeMeta[data-tone=promo]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}',
      '.crBadgeMeta[data-tone=positive]{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
      '.crBadgeMeta[data-tone=muted]{color:var(--dsw-alias-label-tertiary)}',
      '.crEmpty{padding:24px 16px;margin:0;text-align:center;color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}',
      '.crEmpty[data-state=loading]{color:var(--dsw-alias-label-secondary)}',
      '.crEmpty[data-state=error]{color:var(--dsw-alias-state-error-primary)}',
      // The action bar: it sticks to the bottom of the scroll area so the save
      // button stays reachable in a long model list.
      '.crFooterBar{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:10px 14px;border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-settings-card-fill);min-width:0;flex-wrap:wrap;position:sticky;bottom:0;z-index:1}',
      '.crPlanCard{display:flex;flex-direction:column;gap:10px;border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-lg);padding:12px 14px;min-width:0}',
      '.crPlanHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}',
      '.crPlanTitle{margin:0;font-family:inherit;font-size:var(--dsh-content-font-size,14px);font-weight:600;line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary)}',
      '.crPlanTier{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-secondary)}',
      '.crPlanBadge{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);padding:0 6px}',
      '.crPlanWindows{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(140px,100%),1fr));gap:10px;min-width:0}',
      '.crPlanWindow{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.crPlanWindowHead{display:flex;align-items:center;justify-content:space-between;gap:6px;font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-secondary)}',
      '.crPlanBar{height:6px;border-radius:999px;background:var(--dsw-alias-border-l2);overflow:hidden;min-width:0}',
      '.crPlanBarFill{height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary)}',
      '.crPlanMeta{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);display:flex;gap:10px;flex-wrap:wrap}',
      // A dense data table: it keeps its own scroll instead of stretching the
      // page, so the page itself never scrolls sideways.
      '.crPlanTableWrap{max-height:280px;overflow:auto;border-top:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l2);min-width:0}',
      '.crPlanTable{width:100%;border-collapse:collapse;font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-primary);min-width:0}',
      '.crPlanTable th,.crPlanTable td{padding:6px 6px;text-align:right;white-space:nowrap;border-bottom:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-border-l2);font-weight:inherit}',
      '.crPlanTable th:first-child,.crPlanTable td:first-child{text-align:left}',
      '.crPlanTable thead th{color:var(--dsw-alias-label-tertiary);position:sticky;top:0;background:var(--dsw-alias-settings-card-fill);font-weight:600}',
      '.crPlanCell{font-family:var(--ds-font-family-code,monospace);font-variant-numeric:tabular-nums}',
      '.crPlanModel{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px}',
      '.crPlanNote{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);margin:0}',
      // ------------------------------------------------------- focus and a11y
      // Every interactive control of this surface carries the host focus ring.
      '.crButton:focus-visible,.crTab:focus-visible,.crGear:focus-visible,.crJump:focus-visible,.crSearchInput:focus-visible,.crInput:focus-visible,.crSwitch:focus-visible,.crRowCheck:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}',
      // ---------------------------------------------------------- responsive
      '@media (max-width:640px){.crPage{padding:16px}.crPage.crPageScroll{padding:16px 16px 32px}.crProviderRow{grid-template-columns:minmax(0,1fr)}.crProviderUsage{gap:12px}}',
      // A reduced-motion preference removes every transition this surface owns.
      '@media (prefers-reduced-motion: reduce){.crButton,.crGear,.crTab,.crReveal,.crSwitch,.crSwitch::after{transition:none}}',
    ].join('')

    /** Inject the stylesheet once, keyed so a reload replaces it. */
    function ensureStyle() {
      if (typeof document === 'undefined' || !document.head) return
      if (document.head.querySelector('style[data-plugin-css="' + CSS_TAG + '"]')) return
      const style = document.createElement('style')
      style.setAttribute('data-plugin-css', CSS_TAG)
      style.textContent = CSS
      document.head.appendChild(style)
    }

    // ---------------------------------------------------------------- locale

    let localeReader = () => ''

    /** The active locale code, falling back to English. */
    const currentLang = () => {
      const active = String(localeReader() || '').toLowerCase()
      if (active.startsWith('ko')) return 'ko'
      if (active.startsWith('zh')) return 'zh'
      return 'en'
    }

    /** The dictionary for the active locale. */
    const table = () => I18N[currentLang()] ?? I18N.en

    /**
     * Translate one key for the active locale.
     * @param {string} key - dictionary key.
     * @param {Record<string, unknown>} [vars] - `{name}` placeholders.
     * @returns {string} the translated string.
     */
    const t = (key, vars) => {
      const value = table()[key] ?? I18N.en[key] ?? key
      if (!vars) return value
      return String(value).replace(/\{(\w+)\}/g, (match, name) => String(vars[name] ?? ''))
    }

    // ------------------------------------------------------------- contracts

    /**
     * The declarative provider contract this section renders.
     *
     * Every entry names the settings paths the router writes, so the view has
     * exactly one place where a switch path is spelled out. `lib/presets.js`
     * owns the backend truth; a drift test compares the two.
     */
    const ROUTER_PROVIDERS = Object.freeze([
      Object.freeze({
        id: 'antigravity',
        nameKey: 'vendorAntigravity',
        planKey: 'planSubscription',
        usageKind: 'windows',
        masterPath: Object.freeze(['presets', 'antigravity']),
        credentialRow: 'dsh-antigravity',
        credentials: Object.freeze([
          Object.freeze({ field: 'refreshToken', labelKey: 'credentialRefreshToken' }),
          Object.freeze({ field: 'clientSecret', labelKey: 'credentialClientSecret' }),
        ]),
        layers: Object.freeze([
          Object.freeze({ id: 'modelServing', labelKey: 'layerModelServing', switchName: 'modelServing', path: Object.freeze(['vendorConfig', 'dsh-antigravity', 'modelServing']) }),
          Object.freeze({ id: 'subagent', labelKey: 'layerSubagent', switchName: 'subagent', path: Object.freeze(['vendorConfig', 'dsh-antigravity', 'subagent']) }),
          Object.freeze({
            id: 'cliWorker',
            labelKey: 'layerCliWorker',
            switchName: 'cliWorker',
            path: Object.freeze(['vendorConfig', 'dsh-antigravity', 'cliWorker']),
            pairPath: Object.freeze(['vendorConfig', 'dsh-antigravity', 'workerEnabled']),
          }),
        ]),
      }),
      Object.freeze({
        id: 'opencode',
        nameKey: 'vendorOpenCode',
        planKey: 'planSubscription',
        usageKind: 'windows',
        masterPath: Object.freeze(['presets', 'opencode']),
        credentialRow: 'dsh-opencode-v2',
        credentials: Object.freeze([
          Object.freeze({ field: 'apiKey', labelKey: 'credentialApiKey' }),
          Object.freeze({ field: 'password', labelKey: 'credentialPassword' }),
        ]),
        layers: Object.freeze([
          Object.freeze({ id: 'modelServing', labelKey: 'layerModelServing', switchName: 'modelServing', path: Object.freeze(['vendorConfig', 'dsh-opencode-v2-http', 'modelServing']) }),
          Object.freeze({ id: 'subagent', labelKey: 'layerSubagent', switchName: 'subagent', path: Object.freeze(['vendorConfig', 'dsh-opencode-v2', 'subagent']) }),
          Object.freeze({
            id: 'cliWorker',
            labelKey: 'layerCliWorker',
            switchName: 'cli',
            path: Object.freeze(['vendorConfig', 'dsh-opencode-v2', 'cli']),
            pairPath: Object.freeze(['vendorConfig', 'dsh-opencode-v2', 'workerEnabled']),
          }),
        ]),
      }),
      Object.freeze({
        id: 'deepinfra',
        nameKey: 'vendorDeepInfra',
        planKey: 'planPayAsYouGo',
        usageKind: 'billing',
        masterPath: Object.freeze(['presets', 'deepinfra']),
        // The preset master IS the model router: DeepInfra declares no
        // model-serving switch of its own, so the layer grid shows the master's
        // state instead of inventing a second write path for it.
        masterIsModelServing: true,
        credentialRow: 'dsh-deepinfra',
        credentials: Object.freeze([
          Object.freeze({ field: 'apiKey', labelKey: 'credentialApiKey' }),
        ]),
        // DeepInfra declares no subagent and no CLI surface: the preset master
        // IS the model router. The layer grid renders those two cells as
        // unsupported capabilities instead of inventing a switch for them.
        layers: Object.freeze([]),
      }),
    ])

    /** The provider picker entries (the add-provider tab). */
    const PICKER_ITEMS = Object.freeze([
      Object.freeze({ id: 'antigravity', nameKey: 'vendorAntigravity', descKey: 'pickerAntigravityDesc', authKey: 'pickerAuthWebAuth', presetId: 'antigravity' }),
      Object.freeze({ id: 'opencode', nameKey: 'vendorOpenCode', descKey: 'pickerOpenCodeDesc', authKey: 'pickerAuthWebAuth', presetId: 'opencode' }),
      Object.freeze({ id: 'deepinfra', nameKey: 'vendorDeepInfra', descKey: 'pickerDeepInfraDesc', authKey: 'pickerAuthApiKey', presetId: 'deepinfra' }),
      Object.freeze({ id: 'custom-json', nameKey: 'customJson', descKey: 'pickerCustomDesc', authKey: 'pickerAuthJson', presetId: null }),
    ])

    /**
     * The dashboard's two tabs: the id, the selected value, the label key and
     * the id of the panel the active tab owns.
     */
    const DASHBOARD_TABS = Object.freeze([
      Object.freeze({ id: 'cr-tab-usage', value: 'usage', labelKey: 'tabUsage', panelId: 'cr-panel-usage' }),
      Object.freeze({ id: 'cr-tab-add', value: 'add', labelKey: 'tabAddProvider', panelId: 'cr-panel-add' }),
    ])

    // --------------------------------------------------------------- helpers

    /**
     * Read one value at a settings path.
     * @param {unknown} value - the namespace section.
     * @param {readonly string[]} path - object-key path.
     * @returns {unknown} the value, or undefined.
     */
    function readPath(value, path) {
      let current = value
      for (const key of path) {
        if (current === null || typeof current !== 'object') return undefined
        current = current[key]
      }
      return current
    }

    /**
     * Read one boolean at a settings path.
     * @param {unknown} value - the namespace section.
     * @param {readonly string[]} path - object-key path.
     * @returns {boolean} true only when the stored value is exactly true.
     */
    function readSwitch(value, path) {
      return readPath(value, path) === true
    }

    /** Values a redacted secret may carry instead of the secret itself. */
    const REDACTION_MARKERS = Object.freeze(['', '<redacted>', '[redacted]', '***', '••••••••', 'redacted'])

    /**
     * Whether one credential field holds a value, without ever reading it.
     *
     * The host redacts secret fields, so a read BACK of the value is either
     * absent or a redaction marker. The AUTHORITY is the redacted sidecar the
     * settings service answers beside the namespace view:
     * `ctx.configForms.describe().namespace(ns).secrets` is an ARRAY of
     * `{ path: ['vendorConfig', row, field], set: boolean }` (measured
     * 2026-11-08 in `dsh-api-settings-controller` `namespaceView`). It is NOT a
     * per-row object and it is NOT inside `value`, so a `value.secrets` probe
     * can never answer this question. The value itself is never returned,
     * logged or rendered.
     *
     * @param {unknown} value - the namespace section (fallback only).
     * @param {string} row - the vendor row id.
     * @param {string} field - the secret field name.
     * @param {Array<{path: string[], set: boolean}>|object|undefined} sidecar -
     *   the redacted secret sidecar, when the host answered one.
     * @returns {boolean} true when the field is set.
     */
    function readSecretSet(value, row, field, sidecar) {
      if (Array.isArray(sidecar)) {
        for (const entry of sidecar) {
          const path = entry !== null && typeof entry === 'object' ? entry.path : undefined
          if (!Array.isArray(path) || path.length !== 3) continue
          if (path[0] === 'vendorConfig' && path[1] === row && path[2] === field) return entry.set === true
        }
        return false
      }
      if (sidecar !== null && typeof sidecar === 'object') {
        const perRow = sidecar[row]
        if (perRow !== null && typeof perRow === 'object' && typeof perRow[field] === 'boolean') return perRow[field]
        const flat = sidecar[row + '.' + field]
        if (typeof flat === 'boolean') return flat
      }
      const raw = readPath(value, ['vendorConfig', row, field])
      if (raw === undefined || raw === null) return false
      if (typeof raw !== 'string') return true
      return !REDACTION_MARKERS.includes(raw.trim().toLowerCase())
    }

    /**
     * Read the redacted secret sidecar for the router namespace.
     *
     * The sidecar lives on the settings MIRROR's namespace view, not on the
     * per-namespace form snapshot: `ConfigFormController.getSnapshot()` carries
     * `{ value, base, user, revision, writable, status }` and no secrets. The
     * mirror is reachable through `ctx.configForms.describe()`.
     * @param {object|null} ctx - the injected client context.
     * @returns {Array<{path: string[], set: boolean}>|undefined} the sidecar.
     */
    function readSecretSidecar(ctx) {
      try {
        const forms = ctx && ctx.configForms
        if (!forms || typeof forms.describe !== 'function') return undefined
        const mirror = forms.describe()
        const view = mirror && typeof mirror.namespace === 'function' ? mirror.namespace(NAMESPACE) : undefined
        return Array.isArray(view && view.secrets) ? view.secrets : undefined
      } catch (error) {
        return undefined
      }
    }

    /**
     * Read the usage measurements for one provider.
     *
     * The router's namespace may carry a `usage` map keyed by preset id. A
     * measurement that was not reported stays absent -- never zero.
     * @param {unknown} value - the namespace section.
     * @param {string} presetId - the preset id.
     * @returns {object|undefined} the measurement, if any.
     */
    function readUsage(value, presetId) {
      const usage = value !== null && typeof value === 'object' ? value.usage : undefined
      if (usage === null || typeof usage !== 'object') return undefined
      const entry = usage[presetId]
      if (entry === null || typeof entry !== 'object') return undefined
      return entry
    }

    /**
     * Merge live vendor measurements over the settings-namespace fallback.
     *
     * The settings service stores switches, not usage. When the vendor panel
     * routes are reachable, their normalized readings override the fallback
     * `usage` map (if any) without touching the saved config.
     * @param {unknown} section - the namespace value.
     * @param {object|undefined} runtime - normalized live measurements by preset id.
     * @returns {object} a section-shaped view value.
     */
    function mergeRuntimeUsage(section, runtime) {
      const base = section !== null && typeof section === 'object' ? section : {}
      if (runtime === null || typeof runtime !== 'object' || Object.keys(runtime).length === 0) return base
      return {
        ...base,
        usage: {
          ...(base.usage !== null && typeof base.usage === 'object' ? base.usage : {}),
          ...runtime,
        },
      }
    }

    /**
     * Normalize a reset timestamp to epoch milliseconds.
     * @param {unknown} value - epoch seconds, epoch milliseconds, or date string.
     * @returns {number|null} epoch milliseconds, or null when unusable.
     */
    function resetEpoch(value) {
      if (value === null || value === undefined || value === '') return null
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 0 && value < 1e12 ? Math.round(value * 1000) : Math.round(value)
      }
      const parsed = Date.parse(String(value))
      return Number.isNaN(parsed) ? null : parsed
    }

    /**
     * Map vendor window labels to the three normalized ids this dashboard renders.
     * @param {unknown} label - vendor label.
     * @returns {string} normalized window id.
     */
    function usageWindowId(label) {
      const text = String(label ?? '').toLowerCase()
      if (text === 'rolling' || text === '5h' || text.includes('5-hour') || text.includes('5 hour')) return '5h'
      if (text === 'weekly' || text.includes('week')) return 'weekly'
      if (text === 'monthly' || text.includes('month')) return 'monthly'
      return text
    }

    /**
     * Normalize Antigravity `/models` quota groups.
     * @param {object} payload - the route response.
     * @returns {object} one usage measurement.
     */
    function normalizeAntigravityUsage(payload) {
      const windows = []
      const seen = new Set()
      const groups = Array.isArray(payload?.groups) ? payload.groups : []
      for (const group of groups) {
        for (const limit of Array.isArray(group?.limits) ? group.limits : []) {
          const id = usageWindowId(limit?.window ?? limit?.label)
          if (seen.has(id)) continue
          const remaining = Number(limit?.remainingFraction)
          if (!Number.isFinite(remaining)) continue
          const percent = Math.max(0, Math.min(100, Math.round((1 - remaining) * 100)))
          seen.add(id)
          windows.push({ id, percent, resetsAt: resetEpoch(limit?.resetTime ?? limit?.resetsAt) })
        }
      }
      // The provider reports weekly before 5-hour; the dashboard reads
      // shortest-window-first (5시간 → 주간 → 월간), so order here once.
      const WINDOW_ORDER = ['5h', 'weekly', 'monthly']
      windows.sort((left, right) => WINDOW_ORDER.indexOf(left.id) - WINDOW_ORDER.indexOf(right.id))
      const modelCount = Number.isFinite(Number(payload?.total))
        ? Number(payload.total)
        : groups.reduce((sum, group) => sum + (Array.isArray(group?.models) ? group.models.length : 0), 0)
      return {
        measuredAt: Date.now(),
        windows,
        serving: { modelCount, health: modelCount > 0 ? 'healthy' : 'unknown' },
      }
    }

    /**
     * Normalize OpenCode `/plan-usage` plus `/model-settings`.
     * @param {object} plan - the plan-usage response.
     * @param {object} catalog - the model-settings response.
     * @returns {object} one usage measurement.
     */
    function normalizeOpencodeUsage(plan, catalog) {
      const windows = []
      const source = plan?.windows !== null && typeof plan?.windows === 'object' ? plan.windows : {}
      for (const [key, entry] of Object.entries(source)) {
        if (entry === null || typeof entry !== 'object') continue
        const percent = Number(entry.percent)
        if (!Number.isFinite(percent)) continue
        windows.push({
          id: usageWindowId(key === 'rolling' ? '5h' : key),
          percent: Math.max(0, Math.min(100, Math.round(percent))),
          resetsAt: resetEpoch(entry.resetsAt),
        })
      }
      const models = Array.isArray(catalog?.models) ? catalog.models : []
      return {
        measuredAt: Date.now(),
        windows,
        serving: { modelCount: models.length, health: models.length > 0 ? 'healthy' : 'unknown' },
      }
    }

    /**
     * Normalize DeepInfra's pay-per-token cost ledger.
     * @param {object} summary - `/cost/summary` response.
     * @returns {object} one billing measurement.
     */
    function normalizeDeepinfraUsage(summary) {
      let inputTokens = 0
      let outputTokens = 0
      let hasTokens = false
      for (const session of Array.isArray(summary?.bySession) ? summary.bySession : []) {
        const tokens = session?.tokens
        if (tokens === null || typeof tokens !== 'object') continue
        const input = Number(tokens.input)
        const output = Number(tokens.output)
        if (Number.isFinite(input)) { inputTokens += input; hasTokens = true }
        if (Number.isFinite(output)) { outputTokens += output; hasTokens = true }
      }
      return {
        measuredAt: Date.now(),
        spend: Number.isFinite(Number(summary?.costUsd)) ? Number(summary.costUsd) : null,
        requests: Number.isFinite(Number(summary?.requests)) ? Number(summary.requests) : null,
        ...(hasTokens ? { inputTokens, outputTokens } : {}),
        balance: null,
      }
    }

    /**
     * POST one local vendor route and parse its JSON answer.
     * @param {Function} fetchImpl - fetch implementation.
     * @param {string} path - local API path.
     * @returns {Promise<object>} parsed response.
     */
    async function postUsageRoute(fetchImpl, path) {
      const response = await fetchImpl(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      if (!response || response.ok !== true) throw new Error('usage route unavailable: ' + path)
      return response.json()
    }

    /**
     * Read live usage from the three vendor panel routes.
     *
     * The routes are the same measured seams each vendor's own panel uses.
     * A missing/unmounted route is omitted, not turned into a zero.
     * @param {Function} [fetchImpl] - injectable fetch.
     * @returns {Promise<object>} measurements keyed by preset id.
     */
    async function fetchUsageFeeds(fetchImpl) {
      const doFetch = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch
      if (typeof doFetch !== 'function') return {}
      const jobs = [
        (async () => ['antigravity', normalizeAntigravityUsage(await postUsageRoute(doFetch, '/api/local/dsh-antigravity/models'))])(),
        (async () => {
          const [plan, catalog] = await Promise.all([
            postUsageRoute(doFetch, '/api/local/opencode-v2/plan-usage'),
            postUsageRoute(doFetch, '/api/local/opencode-v2/model-settings'),
          ])
          return ['opencode', normalizeOpencodeUsage(plan, catalog)]
        })(),
        (async () => ['deepinfra', normalizeDeepinfraUsage(await postUsageRoute(doFetch, '/api/local/deepinfra/cost/summary'))])(),
      ]
      const settled = await Promise.allSettled(jobs)
      const output = {}
      for (const result of settled) {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) output[result.value[0]] = result.value[1]
      }
      return output
    }

    /**
     * Format a number for the KPI and billing surfaces.
     * @param {unknown} value - the number.
     * @returns {string} the formatted number.
     */
    function formatNumber(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return '—'
      return number.toLocaleString('en-US')
    }

    /**
     * Format a currency amount.
     * @param {unknown} value - the amount.
     * @returns {string} the formatted amount.
     */
    function formatAmount(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return '—'
      return number.toFixed(2)
    }

    /**
     * Format a reset instant as a clock time for the KPI card.
     *
     * The reference layout puts a TIME in the big KPI slot and the date in the
     * supporting line: a full localized datetime is wider than the third card
     * and was truncated to "2026. 11. 8. ..." (measured 2026-11-08).
     * @param {number|string|null} value - epoch ms or an ISO string.
     * @returns {string} the localized time, or an em dash.
     */
    function formatClock(value) {
      if (value === null || value === undefined || value === '') return '—'
      const date = typeof value === 'number' ? new Date(value) : new Date(String(value))
      if (Number.isNaN(date.getTime())) return '—'
      return date.toLocaleTimeString(currentLang() === 'ko' ? 'ko-KR' : currentLang() === 'zh' ? 'zh-CN' : 'en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
    }

    /**
     * Format a reset instant compactly for a card line: `11. 11. 00:00`.
     *
     * The full localized datetime is wider than a third-width card's reset line
     * and was truncated to "2026. 11. 11. 오전 12:00:55..." (measured 2026-11-08).
     * The full text stays available in the element's title attribute.
     * @param {number|string|null} value - epoch ms or an ISO string.
     * @returns {string} the compact stamp, or an empty string.
     */
    function formatCompactStamp(value) {
      if (value === null || value === undefined || value === '') return ''
      const date = typeof value === 'number' ? new Date(value) : new Date(String(value))
      if (Number.isNaN(date.getTime())) return ''
      const pad = (n) => String(n).padStart(2, '0')
      return `${date.getMonth() + 1}. ${date.getDate()}. ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    /**
     * Format one timestamp for the reset copy.
     * @param {unknown} value - an ISO string or epoch milliseconds.
     * @returns {string} the formatted timestamp, or an empty string.
     */
    function formatTimestamp(value) {
      if (value === null || value === undefined || value === '') return ''
      const date = typeof value === 'number' ? new Date(value) : new Date(String(value))
      if (Number.isNaN(date.getTime())) return ''
      return date.toLocaleString(currentLang() === 'ko' ? 'ko-KR' : currentLang() === 'zh' ? 'zh-CN' : 'en-US')
    }

    /**
     * Describe the distance to one reset time.
     * @param {unknown} resetsAt - an ISO string or epoch milliseconds.
     * @param {number} now - the reference time in epoch milliseconds.
     * @returns {string} the relative description, or an empty string.
     */
    function formatRelative(resetsAt, now) {
      if (resetsAt === null || resetsAt === undefined || resetsAt === '') return ''
      const date = typeof resetsAt === 'number' ? new Date(resetsAt) : new Date(String(resetsAt))
      if (Number.isNaN(date.getTime())) return ''
      const minutes = Math.round((date.getTime() - now) / 60000)
      if (minutes < 60) return t('relativeMinutes', { n: Math.max(minutes, 0) })
      if (minutes < 60 * 24) return t('relativeHours', { n: Math.round(minutes / 60) })
      return t('relativeDays', { n: Math.round(minutes / (60 * 24)) })
    }

    /**
     * The localized label of one usage window.
     * @param {string} id - the window id (`5h`, `weekly`, `monthly`).
     * @returns {string} the label.
     */
    function windowLabel(id) {
      if (id === '5h') return t('window5h')
      if (id === 'weekly') return t('windowWeekly')
      if (id === 'monthly') return t('windowMonthly')
      return String(id)
    }

    /**
     * The tab a keyboard event selects in one tab strip.
     *
     * Arrow keys move to the next/previous tab (wrapping around), Home and
     * End move to the first/last tab. Any other key selects nothing.
     * @param {string} key - the pressed key.
     * @param {Array<{id: string, value: string}>} tabs - the tabs in order.
     * @param {string} currentId - the id of the selected tab.
     * @returns {{id: string, value: string}|null} the next tab, or null.
     */
    function nextTab(key, tabs, currentId) {
      const index = tabs.findIndex((tab) => tab.id === currentId)
      if (index < 0 || tabs.length === 0) return null
      if (key === 'ArrowRight') return tabs[(index + 1) % tabs.length]
      if (key === 'ArrowLeft') return tabs[(index - 1 + tabs.length) % tabs.length]
      if (key === 'Home') return tabs[0]
      if (key === 'End') return tabs[tabs.length - 1]
      return null
    }

    /**
     * Move the DOM focus onto one tab element.
     * @param {string} id - the tab element id.
     * @returns {void}
     */
    function focusTabElement(id) {
      if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return
      const element = document.getElementById(id)
      if (element && typeof element.focus === 'function') element.focus()
    }

    /**
     * The keyboard handler of one tab strip.
     *
     * The handler lives on the tablist, so the keys work from whichever tab
     * holds the focus. It moves the selection AND the focus, so a keyboard
     * user follows the selection instead of losing the tab strip.
     * @param {object} options - `{ tabs, currentId, onSelect }`.
     * @returns {(event: object) => void} the keydown handler.
     */
    function tabStripKeyHandler(options) {
      return (event) => {
        const key = event && typeof event.key === 'string' ? event.key : ''
        const next = nextTab(key, options.tabs, options.currentId)
        if (next === null) return
        if (typeof event.preventDefault === 'function') event.preventDefault()
        options.onSelect(next.value)
        focusTabElement(next.id)
      }
    }

    // ------------------------------------------------------------ view model

    /**
     * Build the provider view model.
     * @param {object} provider - one ROUTER_PROVIDERS entry.
     * @param {unknown} value - the namespace section.
     * @param {number} now - the reference time in epoch milliseconds.
     * @param {Array<{path: string[], set: boolean}>|undefined} secrets - the
     *   redacted secret sidecar.
     * @returns {object} the provider view model.
     */
    function buildProvider(provider, value, now, secrets) {
      const enabled = readSwitch(value, provider.masterPath)
      const measurement = readUsage(value, provider.id)
      const view = {
        id: provider.id,
        name: t(provider.nameKey),
        plan: t(provider.planKey),
        usageKind: provider.usageKind,
        masterIsModelServing: provider.masterIsModelServing === true,
        enabled,
        connection: enabled ? (measurement ? 'active' : 'unknown') : 'inactive',
        windows: [],
        serving: null,
        billing: null,
        layers: provider.layers.map((layer) => ({
          id: layer.id,
          label: t(layer.labelKey),
          state: readSwitch(value, layer.path) ? 'on' : 'off',
          path: layer.path,
        })),
        unsupportedLayers: unsupportedLayers(provider),
        credentials: provider.credentials.map((credential) => ({
          field: credential.field,
          row: provider.credentialRow,
          set: readSecretSet(value, provider.credentialRow, credential.field, secrets),
        })),
        measuredAt: measurement && measurement.measuredAt ? measurement.measuredAt : null,
      }

      if (provider.usageKind === 'billing') {
        view.billing = buildBilling(measurement)
        return view
      }

      const windows = measurement && Array.isArray(measurement.windows) ? measurement.windows : []
      view.windows = windows
        .filter((entry) => entry !== null && typeof entry === 'object')
        .map((entry) => ({
          id: String(entry.id ?? entry.label ?? ''),
          label: windowLabel(String(entry.id ?? entry.label ?? '')),
          percent: typeof entry.percent === 'number' && Number.isFinite(entry.percent) ? entry.percent : null,
          resetsAt: entry.resetsAt ?? null,
          resetsText: formatTimestamp(entry.resetsAt),
          resetsCompact: formatCompactStamp(entry.resetsAt),
          relative: formatRelative(entry.resetsAt, now),
        }))
      view.serving = buildServing(measurement)
      return view
    }

    /**
     * The layer cells a provider does not declare.
     * @param {object} provider - one ROUTER_PROVIDERS entry.
     * @returns {object[]} unsupported capability cells.
     */
    function unsupportedLayers(provider) {
      const declared = new Set(provider.layers.map((layer) => layer.id))
      const cells = []
      if (!declared.has('modelServing') && provider.masterIsModelServing !== true) {
        cells.push({ id: 'modelServing', label: t('layerModelServing'), state: 'unsupported' })
      }
      if (!declared.has('subagent')) {
        cells.push({ id: 'subagent', label: t('layerSubagent'), state: 'unsupported' })
      }
      if (!declared.has('cliWorker')) {
        cells.push({ id: 'cliWorker', label: t('layerCliWorker'), state: 'unsupported' })
      }
      return cells
    }

    /**
     * Build the serving summary.
     * @param {object|undefined} measurement - the provider measurement.
     * @returns {object|null} the serving summary.
     */
    function buildServing(measurement) {
      const serving = measurement && measurement.serving
      if (!serving || typeof serving !== 'object') return null
      const health = serving.health === 'healthy' || serving.health === 'degraded' ? serving.health : 'unknown'
      return {
        modelCount: typeof serving.modelCount === 'number' && Number.isFinite(serving.modelCount) ? serving.modelCount : null,
        health,
      }
    }

    /**
     * Build the pay-per-token billing view model.
     * @param {object|undefined} measurement - the provider measurement.
     * @returns {object|null} the billing view model.
     */
    function buildBilling(measurement) {
      if (!measurement || typeof measurement !== 'object') return null
      const spend = typeof measurement.spend === 'number' && Number.isFinite(measurement.spend) ? measurement.spend : null
      const requests = typeof measurement.requests === 'number' && Number.isFinite(measurement.requests) ? measurement.requests : null
      const inputTokens = typeof measurement.inputTokens === 'number' && Number.isFinite(measurement.inputTokens) ? measurement.inputTokens : null
      const outputTokens = typeof measurement.outputTokens === 'number' && Number.isFinite(measurement.outputTokens) ? measurement.outputTokens : null
      const inputRate = typeof measurement.inputRate === 'number' && Number.isFinite(measurement.inputRate) ? measurement.inputRate : null
      const outputRate = typeof measurement.outputRate === 'number' && Number.isFinite(measurement.outputRate) ? measurement.outputRate : null
      // A balance that was not queried is NOT a zero balance: the sidecar says so
      // explicitly instead of showing a number nobody measured.
      const balanceKnown = measurement.balance !== null && measurement.balance !== undefined
        && typeof measurement.balance === 'number' && Number.isFinite(measurement.balance)
      return {
        spend,
        requests,
        inputTokens,
        outputTokens,
        inputRate,
        outputRate,
        balance: balanceKnown ? measurement.balance : null,
        balanceKnown,
      }
    }

    /**
     * Build the whole dashboard view model.
     * @param {unknown} value - the namespace section.
     * @param {number} [now] - the reference time in epoch milliseconds.
     * @param {Array<{path: string[], set: boolean}>|undefined} [secrets] - the
     *   redacted secret sidecar answered by the settings mirror.
     * @returns {object} the view model.
     */
    function buildViewModel(value, now = Date.now(), secrets) {
      const section = value !== null && typeof value === 'object' ? value : {}
      const providers = ROUTER_PROVIDERS.map((provider) => buildProvider(provider, section, now, secrets))
      const enabledCount = providers.filter((provider) => provider.enabled).length

      let tightest = null
      let nextReset = null
      for (const provider of providers) {
        for (const window of provider.windows) {
          if (typeof window.percent !== 'number') continue
          if (tightest === null || window.percent > tightest.percent) {
            tightest = { provider: provider.name, providerId: provider.id, window: window.label, percent: window.percent }
          }
          if (window.resetsAt === null || window.resetsAt === undefined || window.resetsAt === '') continue
          // `resetEpoch` normalizes vendor timestamps to EPOCH MILLISECONDS, so a
          // numeric value must not be re-parsed as a date string: `new
          // Date('1794111400000')` is Invalid Date and silently blanked the
          // "다음 초기화" KPI while every window above it rendered (measured
          // 2026-11-08).
          const at = typeof window.resetsAt === 'number'
            ? window.resetsAt
            : new Date(String(window.resetsAt)).getTime()
          if (Number.isNaN(at)) continue
          if (nextReset === null || at < nextReset.at) {
            nextReset = { provider: provider.name, providerId: provider.id, window: window.label, at, clock: formatClock(at), resetsText: window.resetsText, relative: window.relative }
          }
        }
      }

      return {
        providers,
        enabledCount,
        totalCount: providers.length,
        tightest,
        nextReset,
        updatedAt: section.updatedAt ?? null,
      }
    }

    // ------------------------------------------------------------ components

    /**
     * One KPI card: a label row with an optional jump link, a large metric and
     * a supporting meta line.
     * @param {object} props - component props.
     * @returns {object} the element.
     */
    function KpiCard(props) {
      return h('div', { className: 'crKpiCard' },
        h('div', { className: 'crKpiLabelRow' },
          h('span', { className: 'crKpiLabel' }, props.label),
          props.jumpHref
            ? h('a', { className: 'crJump', href: props.jumpHref }, props.jumpLabel ?? t('jump'))
            : null),
        h('div', { className: 'crKpiValue' }, props.value),
        h('div', { className: 'crKpiMeta' }, props.meta))
    }

    /**
     * The provider avatar: the vendor's initial on a fixed 40x40 tile.
     * @param {object} props - component props.
     * @returns {object} the element.
     */
    function ProviderAvatar(props) {
      const name = String(props.name ?? '')
      const initial = name.trim().charAt(0).toUpperCase()
      return h('div', { className: 'crAvatar', 'aria-hidden': 'true', 'data-initial': initial }, initial)
    }

    /**
     * The provider identity: vendor name and plan.
     * @param {object} props - component props.
     * @returns {object} the element.
     */
    function ProviderIdentity(props) {
      return h('div', { className: 'crIdentity' },
        h('span', { className: 'crVendorName' }, props.name),
        h('span', { className: 'crPlan' }, props.plan))
    }

    /**
     * The connection badge.
     * @param {object} props - component props.
     * @returns {object} the element.
     */
    function ConnectionBadge(props) {
      const state = props.state ?? 'unknown'
      const label = state === 'active' ? t('connectionActive') : state === 'inactive' ? t('connectionInactive') : t('connectionUnknown')
      return h('span', { className: 'crBadge', 'data-state': state }, label)
    }

    /**
     * The settings trigger: the icon button that opens one card's panel.
     *
     * The glyph is an inline SVG, not an emoji: an emoji renders with the
     * platform emoji font, ignores the DSH colour tokens and looks different
     * on every host.
     * @param {object} props - component props.
     * @returns {object} the element.
     */
    function SettingsTrigger(props) {
      return h('button', {
        type: 'button',
        className: 'crGear',
        'aria-expanded': props.open ? 'true' : 'false',
        'aria-controls': props.controlsId,
        'aria-label': props.label ?? t('settingsTitle'),
        onClick: props.onToggle,
      }, h('svg', {
        width: 16,
        height: 16,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': 'true',
        focusable: 'false',
      },
      h('circle', { cx: 8, cy: 8, r: 2.2, stroke: 'currentColor', 'stroke-width': 1.2 }),
      h('path', {
        d: 'M13.3 8c0-.36-.04-.71-.12-1.04l1.32-.92-1.3-2.25-1.55.58a5.2 5.2 0 0 0-1.8-1.04L9.6 1.9H6.4l-.25 1.43a5.2 5.2 0 0 0-1.8 1.04l-1.55-.58L1.5 6.04l1.32.92a5.2 5.2 0 0 0 0 2.08L1.5 9.96l1.3 2.25 1.55-.58c.52.46 1.13.82 1.8 1.04l.25 1.43h3.2l.25-1.43a5.2 5.2 0 0 0 1.8-1.04l1.55.58 1.3-2.25-1.32-.92c.08-.33.12-.68.12-1.04Z',
        stroke: 'currentColor',
        'stroke-width': 1.2,
        'stroke-linejoin': 'round',
      })))
    }

    /**
     * One usage window: label and percent, a real progress bar, then the reset
     * copy. The bar is a DOM element with the progressbar role -- never a
     * block character.
     * @param {object} props - component props.
     * @returns {object} the element.
     */
    function UsageWindow(props) {
      const window = props.window
      const measured = typeof window.percent === 'number'
      const percent = measured ? Math.max(0, Math.min(100, window.percent)) : 0
      return h('div', { className: 'crUsageWindow', 'data-window': window.id },
        h('div', { className: 'crUsageRow' },
          h('span', { className: 'crUsageLabel' }, window.label),
          measured
            ? h('span', { className: 'crUsagePct' }, Math.round(percent) + '%')
            : h('span', { className: 'crUsagePct' }, t('usageUnavailable'))),
        measured
          ? h('div', {
            className: 'crBar',
            role: 'progressbar',
            'aria-valuenow': Math.round(percent),
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-label': t('windowLabel', { window: window.label }),
            'aria-valuetext': t('windowLabel', { window: window.label }) + ' ' + (percent >= 100 ? t('planLimited') : Math.round(percent) + '%'),
          }, h('div', {
            className: 'crBarFill',
            'data-level': percent >= 90 ? 'high' : 'normal',
            style: { width: percent + '%' },
          }))
          : null,
        h('div', {
          className: 'crUsageReset',
          title: window.resetsText || undefined,
        },
          window.resetsCompact || window.resetsText
            ? t('resetAt', { at: window.resetsCompact || window.resetsText }) + (window.relative ? ' · ' + window.relative : '')
            : t('usageNoData')))
    }

    /**
     * The compact serving summary: serving model count and health.
     * @param {object} props - component props.
     * @returns {object} the element.
     */
    function ServingSummary(props) {
      const serving = props.serving
      if (!serving) return null
      const health = serving.health === 'healthy' ? t('servingHealthy') : serving.health === 'degraded' ? t('servingDegraded') : t('servingUnknown')
      return h('div', { className: 'crServing' },
        h('span', { className: 'crServingTitle' }, t('servingTitle')),
        h('span', { className: 'crServingMeta' },
          h('span', { className: 'crUsageLabel' }, serving.modelCount === null ? '—' : t('servingModels', { n: formatNumber(serving.modelCount) })),
          h('span', { className: 'crBadge', 'data-state': serving.health === 'healthy' ? 'active' : 'inactive' }, health)))
    }

    /**
     * The pay-per-token billing body of a vendor card.
     * @param {object} props - component props.
     * @returns {object} the element.
     */
    function BillingUsage(props) {
      const billing = props.billing
      if (!billing) {
        return h('div', { className: 'crBody' }, h('p', { className: 'crHint' }, t('usageNoData')))
      }
      const rateText = billing.inputRate === null && billing.outputRate === null
        ? t('billingRatesUnknown')
        : t('billingRates', {
          input: billing.inputRate === null ? '—' : formatAmount(billing.inputRate),
          output: billing.outputRate === null ? '—' : formatAmount(billing.outputRate),
        })
      return h('div', { className: 'crBody' },
        h('div', { className: 'crBillingHero' },
          h('span', { className: 'crBillingHeroLabel' }, t('billingSpend')),
          h('span', { className: 'crBillingHeroValue' }, billing.spend === null ? t('kpiUnavailable') : t('billingSpendValue', { amount: formatAmount(billing.spend) }))),
        h('div', { className: 'crBillingGrid' },
          h('div', { className: 'crBillingStat' },
            h('span', { className: 'crBillingStatLabel' }, t('billingRequests')),
            h('span', { className: 'crBillingStatValue' }, billing.requests === null ? '—' : formatNumber(billing.requests))),
          h('div', { className: 'crBillingStat' },
            h('span', { className: 'crBillingStatLabel' }, t('billingInputTokens')),
            h('span', { className: 'crBillingStatValue' }, billing.inputTokens === null ? '—' : formatNumber(billing.inputTokens))),
          h('div', { className: 'crBillingStat' },
            h('span', { className: 'crBillingStatLabel' }, t('billingOutputTokens')),
            h('span', { className: 'crBillingStatValue' }, billing.outputTokens === null ? '—' : formatNumber(billing.outputTokens)))),
        h('div', { className: 'crBillingRow' },
          h('span', { className: 'crBillingRowLabel' }, t('servingTitle')),
          h('span', { className: 'crBillingRowValue' }, rateText)),
        h('div', { className: 'crBillingRow' },
          h('span', { className: 'crBillingRowLabel' }, t('billingBalance')),
          h('span', { className: 'crBillingRowValue' }, billing.balanceKnown ? formatAmount(billing.balance) : t('balanceUnavailable'))))
    }

    /**
     * The compact measurement of one provider: the tightest window of a
     * quota provider, the spend of a pay-per-token provider.
     *
     * The full measurement lives in the detail below the row; the row carries
     * the one number a reader scans for.
     * @param {object} props - component props.
     * @returns {object} the element.
     */
    function MiniUsage(props) {
      const provider = props.provider
      if (provider.usageKind === 'billing') {
        const billing = provider.billing
        return h('div', { className: 'crMiniUsage' },
          h('div', { className: 'crMiniRow' },
            h('span', { className: 'crMiniLabel' }, t('billingSpend')),
            h('span', { className: 'crMiniPct' }, billing && billing.spend !== null ? formatAmount(billing.spend) : t('kpiUnavailable'))),
          billing && billing.balanceKnown
            ? h('div', { className: 'crMiniRow' },
              h('span', { className: 'crMiniLabel' }, t('billingBalance')),
              h('span', { className: 'crMiniReset' }, formatAmount(billing.balance)))
            : null)
      }
      const measured = provider.windows.filter((window) => typeof window.percent === 'number')
      if (measured.length === 0) {
        return h('div', { className: 'crMiniUsage' },
          h('div', { className: 'crMiniRow' },
            provider.windows.length > 0
              ? h('span', { className: 'crMiniLabel' }, provider.windows[0].label)
              : null,
            h('span', { className: 'crMiniReset' }, t('usageUnavailable'))))
      }
      const tightest = measured.reduce((worst, window) => (window.percent > worst.percent ? window : worst))
      const percent = Math.max(0, Math.min(100, tightest.percent))
      return h('div', { className: 'crMiniUsage' },
        h('div', { className: 'crMiniRow' },
          h('span', { className: 'crMiniLabel' }, tightest.label),
          h('span', { className: 'crMiniPct' }, Math.round(percent) + '%')),
        h('div', {
          className: 'crMiniBar',
          // The bar repeats the percentage printed above it: it is decoration,
          // and the window bar in the detail below carries the accessible
          // value.
          'aria-hidden': 'true',
        }, h('div', {
          className: 'crMiniBarFill',
          'data-level': percent >= 90 ? 'high' : 'normal',
          style: { width: percent + '%' },
        })),
        h('div', { className: 'crMiniReset', title: tightest.resetsText || undefined },
          tightest.resetsCompact || tightest.resetsText
            ? t('resetAt', { at: tightest.resetsCompact || tightest.resetsText }) + (tightest.relative ? ' · ' + tightest.relative : '')
            : t('usageNoData')))
    }

    /**
     * One provider: a compact row, and the full-width detail below it.
     *
     * The row carries the identity, the compact measurement and the settings
     * trigger. The detail carries the full measurement and the settings form,
     * and it spans the whole width of the list instead of one column of it.
     * @param {object} props - component props.
     * @returns {object} the element.
     */
    function VendorCard(props) {
      const provider = props.provider
      const panelId = 'cr-settings-' + provider.id
      return h('div', {
        className: 'crProviderItem',
        id: 'cr-vendor-' + provider.id,
        'data-preset': provider.id,
        'data-connection': provider.connection,
      },
      h('div', { className: 'crProviderRow' },
        h('div', { className: 'crProviderHead' },
          h(ProviderAvatar, { name: provider.name }),
          h(ProviderIdentity, { name: provider.name, plan: provider.plan }),
          h(ConnectionBadge, { state: provider.connection })),
        h('div', { className: 'crProviderUsage' },
          h(MiniUsage, { provider })),
        h(SettingsTrigger, {
          open: props.open === true,
          controlsId: panelId,
          label: t('settingsTitle'),
          onToggle: () => props.onToggle(provider.id),
        })),
      h(SettingsReveal, { open: props.open === true, id: panelId },
        h('div', { className: 'crProviderDetail' },
          h('div', { className: 'crUsageInset' },
            provider.usageKind === 'billing'
              ? h(BillingUsage, { billing: provider.billing })
              : h('div', { className: 'crBody' },
                provider.windows.length === 0
                  ? h('p', { className: 'crHint' }, t('usageNoData'))
                  : h('div', { className: 'crUsageWindows' }, provider.windows.map((window) => h(UsageWindow, { key: window.id, window }))),
                h(ServingSummary, { serving: provider.serving }))),
          h(SettingsPanel, {
            provider,
            status: props.status,
            drafts: props.drafts ?? {},
            onMaster: (next) => props.onMaster(provider, next),
            onLayer: (layer, next) => props.onLayer(provider, layer, next),
            onDraft: (credential, value) => props.onDraft(provider, credential, value),
            onCredential: (credential) => props.onCredential(provider, credential),
            onClearCredential: (credential) => props.onClearCredential(provider, credential),
            onApplyDrafts: () => props.onApplyDrafts(provider),
          }))))
    }

    /**
     * The collapsible settings shell: a grid-rows reveal with an overflow-hidden
     * inner box, so the panel animates without a fixed height.
     *
     * A COLLAPSED panel keeps its DOM (the reveal animates), so the controls it
     * hides must leave the tab order and the accessibility tree: `inert` makes
     * them unfocusable and `aria-hidden` hides them from the reader. Without
     * both, `aria-expanded="false"` on the trigger would be a lie.
     * @param {object} props - component props.
     * @returns {object} the element.
     */
    function SettingsReveal(props) {
      const open = props.open === true
      return h('div', { className: 'crReveal', 'data-open': open ? 'true' : 'false' },
        h('div', {
          className: 'crRevealInner',
          inert: open ? undefined : true,
          'aria-hidden': open ? undefined : 'true',
        },
        h('div', { className: 'crSettingsPanel', id: props.id }, props.children)))
    }

    /**
     * The master switch row: the preset's own enable toggle.
     * @param {object} props - component props.
     * @returns {object} the element.
     */
    function MasterSwitchRow(props) {
      return h('div', { className: 'crMaster' },
        h('div', { className: 'crMasterText' },
          h('span', { className: 'crMasterLabel' }, t('masterLabel', { vendor: props.provider.name })),
          h('p', { className: 'crMasterHint' }, t('masterHint'))),
        h('button', {
          type: 'button',
          className: 'crSwitch',
          role: 'switch',
          'aria-checked': props.provider.enabled ? 'true' : 'false',
          'aria-label': t('masterLabel', { vendor: props.provider.name }),
          onClick: () => props.onMaster(!props.provider.enabled),
        }))
    }

    /**
     * The layer switch grid: one cell per declared layer, plus the capability
     * cells a provider does not support.
     * @param {object} props - component props.
     * @returns {object} the element.
     */
    function LayerSwitchGrid(props) {
      const cells = []
      for (const layer of props.provider.layers) {
        cells.push(h('div', { className: 'crLayerCell', key: layer.id, 'data-layer': layer.id },
          h('span', { className: 'crLayerName' }, layer.label),
          h('button', {
            type: 'button',
            className: 'crSwitch',
            role: 'switch',
            'aria-checked': layer.state === 'on' ? 'true' : 'false',
            'aria-label': layer.label,
            onClick: () => props.onLayer(layer, layer.state !== 'on'),
          })))
      }
      // A provider whose preset master IS the model router (DeepInfra) shows
      // that state as a capability cell instead of a second switch: one value,
      // one control.
      if (props.provider.masterIsModelServing === true) {
        cells.push(h('div', { className: 'crLayerCell', key: 'modelServing', 'data-layer': 'modelServing' },
          h('span', { className: 'crLayerName' }, t('layerModelServing')),
          h('span', { className: 'crLayerState' }, props.provider.enabled ? t('switchOn') : t('switchOff'))))
      }
      for (const cell of props.provider.unsupportedLayers) {
        cells.push(h('div', {
          className: 'crLayerCell',
          key: cell.id,
          'data-layer': cell.id,
          'data-unsupported': 'true',
        },
        h('span', { className: 'crLayerName' }, cell.label),
        h('span', { className: 'crLayerState' }, t('layerUnsupported'), ' · ', t('layerUnsupportedHint'))))
      }
      return h('div', { className: 'crLayerGrid' }, cells)
    }

    /**
     * The credential section: write-only masked inputs plus the set/unset state
     * read from the redacted sidecar. No secret value is ever in the DOM.
     *
     * One field per credential, laid out as a form row: the field name and its
     * state on one line, the masked input below it, the actions beside it.
     * @param {object} props - component props.
     * @returns {object} the element.
     */
    function CredentialSection(props) {
      const rows = props.provider.credentials.map((credential) => {
        const inputId = 'cr-cred-' + props.provider.id + '-' + credential.field
        return h('div', { className: 'crField', key: credential.field, 'data-credential': credential.field },
          h('div', { className: 'crFieldHead' },
            // A REAL label: the input is named by this element, not by an
            // aria-label that would hide the field name from the reader.
            h('label', { className: 'crFieldLabel', htmlFor: inputId }, credential.field),
            h('span', { className: 'crState', 'data-state': credential.set ? 'set' : 'unset', 'data-secret-set': credential.set ? 'true' : 'false' },
              credential.set ? t('credentialSet') : t('credentialUnset'))),
          h('input', {
            id: inputId,
            type: 'password',
            className: 'crInput',
            value: props.draft ?? '',
            placeholder: t('credentialPlaceholder'),
            // A stored secret is never offered to the browser's autofill.
            autoComplete: 'new-password',
            'data-secret-field': credential.field,
            onChange: (event) => props.onDraft(credential, event && event.target ? event.target.value : ''),
          }),
          h('div', { className: 'crFieldActions' },
            h('button', {
              type: 'button',
              className: 'crButton crButtonPrimary',
              'data-credential-action': 'save',
              onClick: () => props.onCredential(credential),
            }, t('credentialSave')),
            h('button', {
              type: 'button',
              className: 'crButton crButtonGhost',
              'data-credential-action': 'clear',
              disabled: !credential.set,
              onClick: () => props.onClearCredential(credential),
            }, t('credentialClear'))))
      })
      return h('div', { className: 'crFormSection' },
        h('div', { className: 'crFormSectionHead' },
          h('span', { className: 'crFormSectionTitle' }, t('credentialTitle')),
          h('span', { className: 'crFormSectionHint' }, t('credentialHint'))),
        h('div', { className: 'crFormSectionBody' }, rows))
    }

    /**
     * The settings panel: the master switch, the layer grid, the credentials
     * and the save/applied/error footer.
     * @param {object} props - component props.
     * @returns {object} the element.
     */
    function SettingsPanel(props) {
      const status = props.status ?? {}
      return h('div', { className: 'crSettingsPanelBody' },
        h('div', { className: 'crFormSection' },
          h('div', { className: 'crFormSectionHead' },
            h('h4', { className: 'crFormSectionTitle' }, t('settingsTitle'))),
          h(MasterSwitchRow, { provider: props.provider, onMaster: props.onMaster }),
          h(LayerSwitchGrid, { provider: props.provider, onLayer: props.onLayer })),
        h(CredentialSection, {
          provider: props.provider,
          drafts: props.drafts ?? {},
          onDraft: props.onDraft,
          onCredential: props.onCredential,
          onClearCredential: props.onClearCredential,
          onApplyDrafts: props.onApplyDrafts,
        }),
        h('div', { className: 'crFooter' },
          h('button', {
            type: 'button',
            className: 'crButton crButtonPrimary',
            'data-credential-action': 'apply-all',
            disabled: status.saving === true,
            onClick: () => props.onApplyDrafts(props.provider),
          }, status.saving === true ? t('credentialSaving') : t('credentialSave')),
          // The live region is ALWAYS mounted: a region that appears together
          // with its text is not announced.
          h('span', { className: 'crStatusLive', role: 'status', 'aria-live': 'polite' },
            status.error
              ? h('span', { className: 'crFooterNote', 'data-state': 'error' }, t('saveError') + ': ' + status.error)
              : null,
            status.applied
              ? h('span', { className: 'crFooterNote', 'data-state': 'applied' }, t('applied'))
              : null)))
    }

    /**
     * The add-provider tab panel.
     * @param {object} props - component props.
     * @returns {object} the element.
     */
    function ProviderPickerGrid(props) {
      return h('div', { className: 'crPickerGrid' }, props.items.map((item) => {
        const added = item.presetId !== null && props.enabled[item.presetId] === true
        return h('div', {
          className: 'crPickerCard',
          key: item.id,
          'data-picker': item.id,
        },
        h('div', { className: 'crPickerHead' },
          h('span', { className: 'crPickerTitle' }, t(item.nameKey)),
          added ? h('span', { className: 'crBadge', 'data-state': 'active' }, t('pickerAdded')) : null),
        h('p', { className: 'crPickerDesc' }, t(item.descKey)),
        h('p', { className: 'crPickerAuth' }, t(item.authKey)),
        h('div', { className: 'crPickerActions' },
          h('button', {
            type: 'button',
            className: 'crButton crButtonPrimary',
            'data-picker-action': 'add',
            disabled: item.presetId === null || added,
            onClick: () => props.onAdd(item),
          }, added ? t('pickerAdded') : item.presetId === null ? t('pickerUnsupported') : t('pickerAdd'))))
      }))
    }

    // ------------------------------------------------------- model catalogs

    /**
     * Model-serving catalogs the settings page manages, one per preset.
     *
     * `row` is the loader row whose `enabledModels` carries the selection (the
     * same field the vendor's own panel writes) and `route` is the measured
     * local panel route that lists the models. The write goes through the
     * router namespace; the router's reconcile remounts that child, so the
     * prompt model picker reflects the selection without a restart.
     */
    /**
     * ONE descriptor per preset. Everything the presets share — the tablist,
     * the toolbar, the group card, the row, the footer, the save state and the
     * `form.mutate` write — lives below in a single implementation; a preset
     * only declares what nobody else can know:
     *
     *   id, labelKey        the tab id and its label key
     *   row, route          the loader row that carries `enabledModels`, and
     *                       the local panel route that lists the catalog
     *   planKey             the plan/vendor label key
     *   metered             true for a pay-per-token preset (price block)
     *   load(payload)       -> `{ groups }`, the preset's own catalog shape
     *   saveValue(chosen, groups)
     *                       -> string[] written to `enabledModels`
     *                       (optional; defaults to the flattened row order)
     *   renderRowExtras(row, { note })
     *                       -> the row's trailing cell (optional; defaults to
     *                       the subscription note)
     *
     * A group is `{ key, titleKey|title, quota?, quotaTitle?, rows }`; a row is
     * `{ key, name, id, variants, enabled, badges, price?, note? }`, where
     * `badges` entries are a string (muted chip) or `{ label, tone }` and
     * `price` is `{ input, output, listInput, listOutput, promoPercent? }`.
     * Adding a fourth preset is one entry here, not a new JSX branch.
     */
    const MODEL_PRESETS = Object.freeze([
      Object.freeze({
        id: 'antigravity',
        labelKey: 'vendorAntigravity',
        row: 'dsh-antigravity',
        route: '/api/local/dsh-antigravity/models',
        planKey: 'planSubscription',
        // FAMILY groups: `groups[].limits[]` becomes the card's quota badge and
        // one row owns every reasoning-effort variant of one base model.
        load: (payload) => ({ groups: antigravityGroups(payload) }),
        // One row owns its variants: the saved value is their flatten.
        saveValue: flattenVariants,
      }),
      Object.freeze({
        id: 'opencode',
        labelKey: 'vendorOpenCode',
        row: 'dsh-opencode-v2-http',
        route: '/api/local/opencode-v2/model-settings',
        planKey: 'planOpenCode',
        // PLAN groups (`go` / `zen`), seeded from the route's `enabled` list.
        load: (payload) => ({ groups: opencodeGroups(payload) }),
      }),
      Object.freeze({
        id: 'deepinfra',
        labelKey: 'vendorDeepInfra',
        row: 'dsh-deepinfra',
        route: '/api/local/deepinfra/models',
        planKey: 'planPayAsYouGo',
        // The only preset billed per token: `metered` is what turns on the price
        // block and the promotion count, never a hardcoded vendor id.
        metered: true,
        // ONE flat card; the only preset whose rows carry a rate, a struck list
        // price and a promotion badge.
        load: (payload) => ({ groups: deepinfraGroups(payload) }),
        renderRowExtras: (row, ctx) => h(PriceBlock, { price: row.price, note: ctx.note }),
      }),
    ])

    /**
     * The models tab strip: one tab per preset, in descriptor order.
     */
    const MODEL_TABS = Object.freeze(MODEL_PRESETS.map((preset) => Object.freeze({ id: 'cr-models-tab-' + preset.id, value: preset.id })))

    /**
     * Format a context window for a model meta chip.
     * @param {unknown} value - token count.
     * @returns {string} the localized chip, or an empty string.
     */
    function formatContext(value) {
      const number = Number(value)
      if (!Number.isFinite(number) || number <= 0) return ''
      const text = number >= 1e6
        ? (number / 1e6).toFixed(Number.isInteger(number / 1e6) ? 0 : 1) + 'M'
        : Math.round(number / 1e3) + 'K'
      return t('modelContext', { n: text })
    }

    /**
     * Format a per-1M token rate without rounding it to cents.
     * @param {unknown} value - USD per 1M tokens.
     * @returns {string} the amount, or an em dash.
     */
    function formatRate(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return '—'
      const digits = number < 0.01 ? 4 : number < 1 ? 3 : 2
      return number.toFixed(digits)
    }

    /** Antigravity family labels, keyed by the route's `groups[].kind`. */
    const FAMILY_LABELS = Object.freeze({
      gemini: 'groupGemini',
      'claude-gpt': 'groupClaudeGpt',
      argon: 'groupArgon',
      other: 'groupOther',
    })

    /** The label key for a normalized usage-window id. */
    function windowLabelKey(id) {
      if (id === 'weekly') return 'windowWeekly'
      if (id === '5h') return 'window5h'
      if (id === 'monthly') return 'windowMonthly'
      return 'windowWeekly'
    }

    /**
     * The remaining quota of one Antigravity family, as "<window> <pct>% left".
     *
     * The route reports `limits[].remainingFraction` (1 = full). A group with no
     * limits falls back to `quotaRemaining`; a group with neither reports an
     * empty string rather than a fabricated 100%.
     * @param {object} group - one normalized group.
     * @returns {string} the quota text, or an empty string.
     */
    function groupQuotaText(group) {
      const parts = []
      for (const limit of Array.isArray(group?.limits) ? group.limits : []) {
        const remaining = Number(limit?.remainingFraction)
        if (!Number.isFinite(remaining)) continue
        const percent = Math.round(Math.max(0, Math.min(1, remaining)) * 100)
        parts.push(t(windowLabelKey(usageWindowId(limit?.window))) + ' ' + t('quotaLeft', { pct: percent }))
      }
      if (parts.length > 0) return parts.join(' · ')
      const fallback = Number(group?.quotaRemaining)
      if (!Number.isFinite(fallback)) return ''
      return t('quotaLeft', { pct: Math.round(Math.max(0, Math.min(1, fallback)) * 100) })
    }

    /**
     * Build one model row of the shared list layout.
     *
     * A row is data only: the id set it owns (`variants`), its `enabled` seed
     * and display fields. Nothing here knows which preset produced it.
     * @param {object} fields - row fields.
     * @returns {object} the normalized row.
     */
    function modelRow(fields) {
      const badges = Array.isArray(fields.badges) ? fields.badges : []
      return {
        key: String(fields.key ?? fields.id),
        id: String(fields.id),
        name: String(fields.name ?? fields.id),
        variants: Array.isArray(fields.variants) && fields.variants.length > 0 ? fields.variants.map((id) => String(id)) : [String(fields.id)],
        enabled: fields.enabled === true,
        badges: badges.map((badge) => (typeof badge === 'string' ? { label: badge, tone: 'muted' } : { label: String(badge.label), tone: badge.tone ?? 'muted' })),
        price: fields.price !== null && typeof fields.price === 'object' ? {
          input: fields.price.input,
          output: fields.price.output,
          listInput: fields.price.listInput,
          listOutput: fields.price.listOutput,
          promoPercent: fields.price.promoPercent === null || fields.price.promoPercent === undefined ? null : Number(fields.price.promoPercent),
        } : null,
        note: typeof fields.note === 'string' ? fields.note : undefined,
      }
    }

    /** Muted "supports thinking" chip, shared by the presets that report it. */
    function thinkingBadge(entry) {
      return entry?.supportsThinking === true ? [{ label: t('modelThinking'), tone: 'muted' }] : []
    }

    /** Context-window chip, shared by the presets that report one. */
    function contextBadge(entry) {
      return formatContext(entry?.contextWindow) ? [{ label: formatContext(entry?.contextWindow), tone: 'muted' }] : []
    }

    /**
     * Antigravity catalog -> FAMILY groups (one row per base model).
     *
     * The route collapses the reasoning-effort ids into one BASE row per model
     * (`groups[].models[]` with `variants`), which is exactly the shape this
     * settings list renders: one checkbox owns every variant id. A payload
     * without `groups` still renders: the flat `models` list becomes one
     * "other" card of single-id rows.
     * @param {object} payload - `/models` answer.
     * @returns {object[]} groups.
     */
    function antigravityGroups(payload) {
      const groups = Array.isArray(payload?.groups) ? payload.groups : []
      if (groups.length > 0) {
        return groups.map((group, index) => {
          const rows = (Array.isArray(group?.models) ? group.models : []).map((entry) => modelRow({
            key: String(entry?.id ?? ''),
            id: String(entry?.id ?? ''),
            name: String(entry?.name ?? entry?.id ?? ''),
            variants: Array.isArray(entry?.variants) ? entry.variants : [],
            enabled: entry?.enabled === true,
            badges: thinkingBadge(entry),
          })).filter((row) => row.id !== '')
          return {
            key: String(group?.kind ?? 'group-' + index),
            titleKey: FAMILY_LABELS[group?.kind] ?? 'groupOther',
            quota: groupQuotaText(group),
            quotaTitle: (Array.isArray(group?.limits) ? group.limits : []).map((limit) => limit?.description).filter(Boolean).join(' / '),
            rows,
          }
        }).filter((group) => group.rows.length > 0)
      }
      const models = Array.isArray(payload?.models) ? payload.models : []
      const rows = models.map((entry) => modelRow({
        key: String(entry?.id ?? ''),
        id: String(entry?.id ?? ''),
        name: String(entry?.name ?? entry?.id ?? ''),
        enabled: entry?.enabled === true,
        badges: [...contextBadge(entry), ...thinkingBadge(entry)],
      })).filter((row) => row.id !== '')
      return rows.length === 0 ? [] : [{ key: 'other', titleKey: 'groupOther', rows }]
    }

    /**
     * OpenCode catalog -> PLAN groups (`go` / `zen`), seeded from `enabled`.
     *
     * A subscription route has no per-token rate: the row carries no price and
     * the shared row falls back to the "included in plan" note.
     * @param {object} payload - `/model-settings` answer.
     * @returns {object[]} groups.
     */
    function opencodeGroups(payload) {
      const enabled = Array.isArray(payload?.enabled) ? payload.enabled : []
      const models = Array.isArray(payload?.models) ? payload.models : []
      const groups = new Map()
      const titleKeys = { go: 'planGo', zen: 'planZen', other: 'planOther' }
      for (const entry of models) {
        const id = String(entry?.route ?? '')
        if (id === '') continue
        const plan = String(entry?.plan ?? '')
        const key = plan === 'go' || plan === 'zen' ? plan : 'other'
        if (!groups.has(key)) groups.set(key, { key, titleKey: titleKeys[key], rows: [] })
        groups.get(key).rows.push(modelRow({
          key: id,
          id,
          name: String(entry?.name ?? id),
          enabled: enabled.includes(id),
          badges: [
            ...contextBadge(entry),
            ...(entry?.available === false ? [{ label: t('modelUnavailable'), tone: 'muted' }] : []),
          ],
        }))
      }
      return Array.from(groups.values())
    }

    /**
     * DeepInfra catalog -> ONE flat card (pay-per-token).
     *
     * The only preset whose rows carry a rate and a promotion, so its rows are
     * the only ones that render the price block.
     * @param {object} payload - `/models` answer.
     * @returns {object[]} groups.
     */
    function deepinfraGroups(payload) {
      const models = Array.isArray(payload?.models) ? payload.models : []
      const rows = models.map((entry) => modelRow({
        key: String(entry?.id ?? ''),
        id: String(entry?.id ?? ''),
        name: String(entry?.id ?? ''),
        enabled: entry?.enabled === true,
        badges: [
          ...contextBadge(entry),
          ...(entry?.vision === true ? [{ label: t('modelVision'), tone: 'positive' }] : []),
          ...(entry?.reasoning === true ? [{ label: t('modelThinking'), tone: 'muted' }] : []),
        ],
        price: entry?.price === null || typeof entry?.price !== 'object' ? null : {
          ...entry.price,
          promoPercent: entry?.promotion !== null && typeof entry?.promotion === 'object' ? entry.promotion.percentOff : null,
        },
      })).filter((row) => row.id !== '')
      return rows.length === 0 ? [] : [{ key: 'deepinfra', titleKey: 'vendorDeepInfra', rows }]
    }

    /**
     * Save projection: the selected ids, in row order.
     *
     * Every preset can leave `saveValue` out: the shared default writes the
     * flattened variant order, which is what both the family and the plan tabs
     * need because their row ids are their own id sets.
     * @param {Set<string>} chosen - the selected id set.
     * @param {object[]} groups - the preset's groups.
     * @returns {string[]} the value for `enabledModels`.
     */
    function flattenVariants(chosen, groups) {
      return allIds(groups).filter((id) => chosen.has(id))
    }

    /**
     * Whether a model row is selected: EVERY variant id of the row is chosen.
     *
     * Antigravity rows own the reasoning-effort variants, so a row is only
     * "on" when the whole variant set is written; a partial set would leave the
     * prompt picker offering a subset of one base model.
     * @param {object} row - the row.
     * @param {Set<string>} chosen - the selected id set.
     * @returns {boolean} true when the row is fully selected.
     */
    function rowSelected(row, chosen) {
      return row.variants.every((id) => chosen.has(id))
    }

    /**
     * Every id a full selection of these groups would carry.
     * @param {object[]} groups - normalized groups.
     * @returns {string[]} the ids.
     */
    function allIds(groups) {
      const value = []
      for (const group of groups) for (const row of group.rows) value.push(...row.variants)
      return value
    }

    /**
     * The price block of a metered row: rate, sideways promo, struck list price.
     *
     * Shared by every preset that renders it — the descriptor decides WHICH
     * rows carry a price, never how one looks.
     * @param {object} props - `{ price, note }`.
     * @returns {object} the element.
     */
    function PriceBlock(props) {
      const price = props.price
      const promoPercent = price !== null && Number.isFinite(Number(price.promoPercent)) ? Number(price.promoPercent) : null
      const hasListPrice = price !== null && Number.isFinite(Number(price.listInput)) && Number.isFinite(Number(price.listOutput))
      return h('span', { className: 'crPrice' },
        price !== null
          ? h('span', { className: 'crPriceRate' }, t('modelRate', { input: formatRate(price.input), output: formatRate(price.output) }))
          : h('span', { className: 'crPriceNote' }, props.note),
        price !== null && promoPercent !== null && hasListPrice
          ? h('span', { className: 'crPriceList' }, t('modelRate', { input: formatRate(price.listInput), output: formatRate(price.listOutput) }))
          : null,
        promoPercent !== null
          ? h('span', { className: 'crBadgeMeta', 'data-tone': 'promo' }, t('promoOff', { percent: promoPercent }))
          : null)
    }

    /**
     * One model row: checkbox, name/id, meta badges and the trailing cell.
     *
     * The trailing cell is the preset's `renderRowExtras` or, without one, the
     * shared subscription note (a plan row has no rate to render).
     * @param {object} props - component props.
     * @returns {object} the element.
     */
    function ModelRow(props) {
      const row = props.row
      const note = row.note ?? t(props.priceIncluded === true ? 'priceIncluded' : 'priceUnavailable')
      return h('label', { className: 'crRow', 'data-model': row.id },
        h('input', {
          type: 'checkbox',
          className: 'crRowCheck',
          checked: props.selected === true,
          'aria-label': row.name,
          onChange: (event) => props.onToggle(row.key, event.target.checked),
        }),
        h('span', { className: 'crRowMain' },
          h('span', { className: 'crRowName', title: row.id }, row.name),
          row.name !== row.id ? h('span', { className: 'crRowId', title: row.id }, row.id) : null,
          row.badges.length > 0
            ? h('span', { className: 'crRowMeta' }, row.badges.map((entry, index) => h('span', {
              className: 'crBadgeMeta',
              'data-tone': entry.tone,
              key: entry.label + ':' + index,
            }, entry.label)))
            : null),
        props.renderRowExtras
          ? props.renderRowExtras(row, { note })
          : h(PriceBlock, { price: row.price, note }))
    }

    /**
     * One group card: title, optional remaining quota, row count and the rows.
     * @param {object} props - component props.
     * @returns {object} the element.
     */
    function ModelGroup(props) {
      const group = props.group
      return h('section', { className: 'crGroup', 'data-group': group.key, key: props.groupId },
        h('div', { className: 'crGroupHead' },
          h('h4', { className: 'crGroupTitle' }, group.title ?? t(group.titleKey)),
          h('div', { className: 'crGroupSide' },
            group.quota
              ? h('span', { className: 'crBadgeMeta', 'data-tone': 'muted', title: group.quotaTitle || undefined }, group.quota)
              : null,
            h('span', { className: 'crGroupMeta' }, t('modelsSelectedTotal', { enabled: props.selectedCount, total: group.rows.length })))),
        h('div', { className: 'crGroupBody' }, h('div', { className: 'crList' }, group.rows.map((row) => h(ModelRow, {
          key: row.key,
          row,
          selected: rowSelected(row, props.chosen),
          priceIncluded: props.priceIncluded,
          renderRowExtras: props.renderRowExtras,
          onToggle: props.onToggle,
        })))))
    }

    /**
     * Whether two id sets hold the same members.
     * @param {Set<string>|undefined} left - one set.
     * @param {Set<string>|undefined} right - another set.
     * @returns {boolean} true when equal.
     */
    function sameSelection(left, right) {
      if (left === undefined || right === undefined) return left === right
      if (left.size !== right.size) return false
      for (const id of left) if (!right.has(id)) return false
      return true
    }

    /**
     * The settings section: ONE tab per preset, only the active tab renders.
     *
     * ONE implementation serves every preset. The descriptor supplies the tab
     * label, the catalog (`load`), the save projection (`saveValue`) and the
     * optional row extras; the tablist, toolbar, group card, row, footer, dirty
     * tracking, `form.mutate` write and the empty-selection guard are shared
     * and know nothing about a vendor name.
     *
     * The user picks the models the prompt picker should offer and saves; the
     * write lands in `vendorConfig.<row>.enabledModels`, the field each vendor
     * already filters its catalog with, and the router reconcile applies it to
     * the running child. An empty value means ALL to every vendor, so an empty
     * selection is refused rather than silently inverted.
     * @returns {object} the element.
     */
    /** Documented OpenCode per-model monthly USD limits (docs 2026-11-07). */
    const OPENCODE_DOC_LIMITS = Object.freeze({
      'glm-5.3-flash': Object.freeze([60, 180, 65]),
      'glm-5.3': Object.freeze([15, 120, 20]),
      'glm-5.2': Object.freeze([60, 180, 65]),
      'kimi-k3.1-pro': Object.freeze([15, 60, 20]),
      'kimi-k3': Object.freeze([15, 60, 20]),
      'kimi-k2.7-code': Object.freeze([60, 180, 65]),
      'longcat-2.0': Object.freeze([60, 240, 65]),
      'step-5-preview': Object.freeze([15, 60, 20]),
      'mimo-v2.6-flash': Object.freeze([60, 120, 65]),
      'mimo-v2.6-pro': Object.freeze([15, 60, 20]),
      'mimo-v2.5': Object.freeze([60, 120, 65]),
      'mimo-v2.5-pro': Object.freeze([15, 60, 20]),
      'minimax-m3.1-flash': Object.freeze([20, 80, 25]),
      'minimax-m3': Object.freeze([60, 180, 65]),
      'muse-spark-1.3-contributor': Object.freeze([60, 120, 65]),
      'muse-spark-1.2-contributor': Object.freeze([60, 120, 65]),
      'qwen3.8-max': Object.freeze([15, 60, 20]),
      'qwen3.8-flash': Object.freeze([30, 90, 35]),
      'qwen3.7-plus': Object.freeze([60, 180, 65]),
      'deepseek-v4.1-flash': Object.freeze([100, 200, 105]),
      'deepseek-v4-pro': Object.freeze([15, 60, 20]),
      'hy4': Object.freeze([60, 240, 65]),
      'hy4-preview': Object.freeze([30, 120, 35]),
      'hy3': Object.freeze([60, 240, 65]),
      'grok-4.7': Object.freeze([15, 60, 20]),
      'gpt-6-luna': Object.freeze([15, 60, 20]),
      'gpt-5.6-luna': Object.freeze([15, 60, 20]),
      'claude-haiku-5.5': Object.freeze([15, 60, 20]),
      'gemini-4-argon': Object.freeze([30, 120, 35]),
      'crouton-alpha-free-/-beam-free-/-iceman-contributor-free': Object.freeze([null, null, null]),
    })

    /** The published plan page the limits come from. */
    const OPENCODE_DOCS_URL = 'https://opencode.ai/docs/console/go#privacy'

    /**
     * Normalize a model name onto the documented-limit key.
     * @param {string} name - route or display name.
     * @returns {string} the key used by OPENCODE_DOC_LIMITS.
     */
    function opencodeLimitKey(name) {
      return String(name ?? '')
        .replace(/^opencode-(go|zen)\//, '')
        .replace(/\([^)]*\)/g, '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
    }

    /**
     * The documented monthly limit for one model under a tier.
     * @param {string} name - route or display name.
     * @param {string|null} tier - `go` / `go-plus` / `go-teams` / null.
     * @returns {number|null} the USD limit, or null when unknown.
     */
    function documentedLimit(name, tier) {
      const row = OPENCODE_DOC_LIMITS[opencodeLimitKey(name)]
      if (row === undefined) return null
      if (tier === 'go') return row[0]
      if (tier === 'go-teams') return row[2]
      if (tier === 'go-plus') return row[1]
      return null
    }

    /**
     * The plan tier the local ledger proves, and the sources it counted.
     *
     * `bySource` is PARTIAL (some requests carry no source), so this is
     * evidence, not proof: an empty tally answers `null` and the UI says
     * "미확인" instead of guessing `go`.
     * @param {object|null} cost - the `cost` block of `/model-settings`.
     * @returns {object} `{ tier, counts }`.
     */
    function detectOpencodeTier(cost) {
      const counts = {}
      for (const session of Array.isArray(cost?.bySession) ? cost.bySession : []) {
        const bySource = session?.bySource
        if (bySource === null || typeof bySource !== 'object') continue
        for (const [source, value] of Object.entries(bySource)) {
          counts[source] = (counts[source] ?? 0) + (Number(value) || 0)
        }
      }
      if (counts['go-plus'] > 0) return { tier: 'go-plus', counts }
      if (counts.go > 0) return { tier: 'go', counts }
      return { tier: null, counts }
    }

    /**
     * Aggregate the local per-model ledger across sessions.
     * @param {object|null} cost - the `cost` block of `/model-settings`.
     * @returns {object[]} rows sorted by allowance burn.
     */
    function opencodeCostByModel(cost) {
      const totals = new Map()
      for (const session of Array.isArray(cost?.bySession) ? cost.bySession : []) {
        const byModel = session?.byModel
        if (byModel === null || typeof byModel !== 'object') continue
        for (const [route, entry] of Object.entries(byModel)) {
          if (entry === null || typeof entry !== 'object') continue
          const row = totals.get(route) ?? { route, requests: 0, costUsd: 0, listCostUsd: 0, allowanceUsd: 0, tokens: 0 }
          row.requests += Number(entry.requests) || 0
          row.costUsd += Number(entry.costUsd) || 0
          row.listCostUsd += Number(entry.listCostUsd) || 0
          row.allowanceUsd += Number(entry.allowanceUsd) || 0
          const tokens = entry.tokens ?? {}
          row.tokens += (Number(tokens.input) || 0) + (Number(tokens.output) || 0)
          totals.set(route, row)
        }
      }
      return [...totals.values()].sort((left, right) => right.allowanceUsd - left.allowanceUsd)
    }

    /**
     * The OpenCode plan/usage card: plan evidence, windows, allowance and the
     * per-model table with the documented monthly limit beside the measured
     * local usage (never a fabricated ratio).
     * @param {object} props - `{ usage }`.
     * @returns {object} the element.
     */
    function PlanUsageCard(props) {
      const usage = props.usage ?? { status: 'loading' }
      const cost = usage.cost ?? null
      const tier = detectOpencodeTier(cost)
      const tierLabel = tier.tier === 'go-plus'
        ? 'Go Plus'
        : tier.tier === 'go'
          ? 'Go'
          : t('planUnknown')
      const windows = usage.windows ?? null
      const windowEntries = windows === null
        ? []
        : [
          { id: 'rolling', label: t('windowRolling'), entry: windows.rolling },
          { id: 'weekly', label: t('windowWeekly'), entry: windows.weekly },
          { id: 'monthly', label: t('windowMonthly'), entry: windows.monthly },
        ].filter((item) => item.entry !== null && typeof item.entry === 'object')
      const allowance = Number(cost?.allowanceUsd)
      const spent = Number(cost?.listCostUsd)
      const hasAllowance = Number.isFinite(allowance) && allowance > 0
      const burn = hasAllowance && Number.isFinite(spent) ? Math.min(100, Math.max(0, Math.round((spent / allowance) * 100))) : null
      const rows = opencodeCostByModel(cost)

      return h('section', { className: 'crPlanCard', 'data-plan-card': tier.tier ?? 'unknown' },
        h('div', { className: 'crPlanHead' },
          h('h4', { className: 'crPlanTitle' }, t('planTitle')),
          h('span', { className: 'crPlanTier' }, tierLabel),
          h('span', { className: 'crPlanBadge' }, t(tier.tier === null ? 'planEvidenceNone' : 'planEvidenceLedger')),
          h('a', { className: 'crJump', href: OPENCODE_DOCS_URL, target: '_blank', rel: 'noreferrer' }, t('planDocs'))),
        windowEntries.length > 0
          ? h('div', { className: 'crPlanWindows' }, windowEntries.map((item) => {
            const percent = Number.isFinite(Number(item.entry.percent)) ? Math.max(0, Math.min(100, Math.round(Number(item.entry.percent)))) : null
            return h('div', { className: 'crPlanWindow', 'data-window': item.id },
              h('div', { className: 'crPlanWindowHead' },
                h('span', null, item.label),
                percent === null ? h('span', null, t('usageUnavailable')) : h('span', null, item.entry.limited === true || percent >= 100 ? t('planLimited') : percent + '%')),
              percent === null
                ? null
                : h('div', {
                  className: 'crPlanBar',
                  role: 'progressbar',
                  'aria-valuenow': percent,
                  'aria-valuemin': 0,
                  'aria-valuemax': 100,
                  'aria-label': item.label,
                  'aria-valuetext': item.label + ' ' + (item.entry.limited === true || percent >= 100 ? t('planLimited') : percent + '%'),
                }, h('div', { className: 'crPlanBarFill', style: { width: percent + '%' } }))
            )
          }))
          : h('p', { className: 'crPlanNote' }, t('planNoWindows')),
        h('div', { className: 'crPlanMeta' },
          hasAllowance && burn !== null
            ? h('span', null, t('planAllowance', { spent: formatAmount(spent), allowance: formatAmount(allowance), percent: burn }))
            : h('span', null, t('planAllowanceUnknown')),
          h('span', null, t('planRequests', { n: formatNumber(cost?.requests ?? 0) }))),
        rows.length > 0
          ? h('div', { className: 'crPlanTableWrap' },
            h('table', { className: 'crPlanTable', 'aria-label': t('planTitle') },
              h('thead', null,
                h('tr', null,
                  h('th', { scope: 'col' }, t('planModel')),
                  h('th', { scope: 'col', className: 'crPlanCell' }, t('planRequestsShort')),
                  h('th', { scope: 'col', className: 'crPlanCell' }, t('planSpentShort')),
                  h('th', { scope: 'col', className: 'crPlanCell' }, t('planAllowanceShort')),
                  h('th', { scope: 'col', className: 'crPlanCell' }, t('planDocLimit')))),
              h('tbody', null,
                rows.map((row) => h('tr', { key: row.route },
                  h('td', { className: 'crPlanModel', title: row.route }, row.route.replace(/^opencode-(go|zen)\//, '')),
                  h('td', { className: 'crPlanCell' }, formatNumber(row.requests)),
                  h('td', { className: 'crPlanCell' }, '$' + formatAmount(row.listCostUsd)),
                  h('td', { className: 'crPlanCell' }, row.allowanceUsd > 0 ? '$' + formatAmount(row.allowanceUsd) : '—'),
                  h('td', { className: 'crPlanCell' }, documentedLimit(row.route, tier.tier) === null ? '—' : '$' + documentedLimit(row.route, tier.tier)))))))
          : h('p', { className: 'crPlanNote' }, t('planNoUsage')),
        h('p', { className: 'crPlanNote' }, t('planLocalNote')))
    }

    function CustomRouterModels() {
      ensureStyle()
      const [tab, setTab] = React.useState(MODEL_PRESETS[0].id)
      const [catalogs, setCatalogs] = React.useState({})
      const [selected, setSelected] = React.useState({})
      const [saved, setSaved] = React.useState({})
      const [status, setStatus] = React.useState({})
      const [queries, setQueries] = React.useState({})
      const [saving, setSaving] = React.useState({})
      const [errors, setErrors] = React.useState({})

      React.useEffect(() => {
        let alive = true
        for (const preset of MODEL_PRESETS) {
          // The initial state is already 'loading'; resetting it here would
          // overwrite an answered catalog on every re-render.
          postUsageRoute(globalThis.fetch, preset.route)
            .then((payload) => {
              if (!alive) return
              const groups = preset.load(payload).groups
              const enabled = new Set()
              for (const group of groups) {
                for (const row of group.rows) if (row.enabled) for (const id of row.variants) enabled.add(id)
              }
              setCatalogs((previous) => ({ ...previous, [preset.id]: groups }))
              setSelected((previous) => ({ ...previous, [preset.id]: enabled }))
              setSaved((previous) => ({ ...previous, [preset.id]: new Set(enabled) }))
              setStatus((previous) => ({ ...previous, [preset.id]: 'ready' }))
            })
            .catch(() => {
              if (alive) setStatus((previous) => ({ ...previous, [preset.id]: 'error' }))
            })
        }
        return () => { alive = false }
      }, [])

      /**
       * Toggle one row: every variant id of the row moves together.
       * @param {string} presetId - preset id.
       * @param {string[]} variants - the row's variant ids.
       * @param {boolean} next - requested state.
       * @returns {void}
       */
      const toggle = (presetId, variants, next) => {
        setSelected((previous) => {
          const set = new Set(previous[presetId] ?? [])
          for (const id of variants) {
            if (next) set.add(id)
            else set.delete(id)
          }
          return { ...previous, [presetId]: set }
        })
      }

      /**
       * Select every id of a preset, or clear it.
       * @param {string} presetId - preset id.
       * @param {boolean} all - true selects all, false clears.
       * @returns {void}
       */
      const setAll = (presetId, all) => {
        const ids = all ? allIds(catalogs[presetId] ?? []) : []
        setSelected((previous) => ({ ...previous, [presetId]: new Set(ids) }))
      }

      /**
       * Persist one preset's selection through the router namespace.
       * @param {object} preset - the active descriptor.
       * @returns {void}
       */
      const save = (preset) => {
        const form = hostCtx && hostCtx.configForms ? hostCtx.configForms.get(NAMESPACE) : null
        if (!form || saving[preset.id] === true) return
        const groups = catalogs[preset.id] ?? []
        const chosen = selected[preset.id] ?? new Set()
        // The descriptor owns the projection: a row that owns variants writes
        // the flatten, a row that owns its own route writes the route id.
        const value = (preset.saveValue ?? flattenVariants)(chosen, groups)
        if (value.length === 0) return
        setSaving((previous) => ({ ...previous, [preset.id]: true }))
        form.mutate([{ op: 'set', path: ['vendorConfig', preset.row, 'enabledModels'], value }])
          .then((accepted) => {
            setSaving((previous) => ({ ...previous, [preset.id]: false }))
            if (accepted) {
              setSaved((previous) => ({ ...previous, [preset.id]: new Set(chosen) }))
              setErrors((previous) => ({ ...previous, [preset.id]: '' }))
            } else {
              setErrors((previous) => ({ ...previous, [preset.id]: 'refused' }))
            }
          })
          .catch((failure) => {
            setSaving((previous) => ({ ...previous, [preset.id]: false }))
            setErrors((previous) => ({ ...previous, [preset.id]: failure instanceof Error ? failure.message : String(failure) }))
          })
      }

      const active = MODEL_PRESETS.find((preset) => preset.id === tab) ?? MODEL_PRESETS[0]
      const groups = catalogs[active.id] ?? []
      const chosen = selected[active.id] ?? new Set()
      const initial = saved[active.id]
      const dirty = initial === undefined ? false : !sameSelection(chosen, initial)
      const query = String(queries[active.id] ?? '').trim().toLowerCase()
      const priceIncluded = active.metered !== true
      const visibleGroups = query === ''
        ? groups
        : groups
          .map((group) => ({
            ...group,
            rows: group.rows.filter((row) => row.id.toLowerCase().includes(query) || row.name.toLowerCase().includes(query)),
          }))
          .filter((group) => group.rows.length > 0)
      const state = status[active.id] ?? 'loading'
      const selectedRows = groups.reduce((sum, group) => sum + group.rows.filter((row) => rowSelected(row, chosen)).length, 0)
      const promoCount = groups.reduce((sum, group) => sum + group.rows.filter((row) => row.price !== null && row.price.promoPercent !== null && Number.isFinite(row.price.promoPercent)).length, 0)
      const emptyGroups = groups.length === 0 || visibleGroups.length === 0

      return h('div', { className: 'crSection crSettingsSection crModels', 'data-models-tab': active.id },
        h('h2', { className: 'crSettingsTitle' }, t('modelsTitle')),
        h('p', { className: 'crSettingsIntro' }, t('modelsHint')),
        h('div', {
          className: 'crSettingsTabs',
          role: 'tablist',
          'aria-label': t('modelsTitle'),
          onKeyDown: tabStripKeyHandler({ tabs: MODEL_TABS, currentId: 'cr-models-tab-' + active.id, onSelect: setTab }),
        },
          MODEL_PRESETS.map((preset) => h('button', {
            key: preset.id,
            type: 'button',
            className: 'crSettingsTab',
            role: 'tab',
            id: 'cr-models-tab-' + preset.id,
            // Only the active panel exists, so only the active tab points at it:
            // an aria-controls on an unmounted id would be a dangling IDREF.
            'aria-controls': active.id === preset.id ? 'cr-models-panel-' + preset.id : undefined,
            'aria-selected': active.id === preset.id ? 'true' : 'false',
            tabIndex: active.id === preset.id ? 0 : -1,
            onClick: () => setTab(preset.id),
          }, t(preset.labelKey)))),
        // Only the active panel is rendered: the host layout must never show two
        // tabs' content at once, and an unmounted panel cannot be un-hidden.
        h('div', {
          className: 'crPanelBody',
          role: 'tabpanel',
          id: 'cr-models-panel-' + active.id,
          'aria-labelledby': 'cr-models-tab-' + active.id,
          tabIndex: 0,
          'data-category': active.id,
        },
        h('div', { className: 'crToolbar' },
          h('input', {
            className: 'crSearchInput',
            type: 'search',
            placeholder: t('modelsSearch'),
            'aria-label': t('modelsSearch'),
            value: queries[active.id] ?? '',
            onChange: (event) => setQueries((previous) => ({ ...previous, [active.id]: event.target.value })),
          }),
          h('button', { type: 'button', className: 'crButton', onClick: () => setAll(active.id, true) }, t('modelsSelectAll')),
          h('button', { type: 'button', className: 'crButton crButtonGhost', onClick: () => setAll(active.id, false) }, t('modelsClear'))),
        state === 'error'
          ? h('p', { className: 'crEmpty', 'data-state': 'error' }, t('modelsLoadFailed'))
          : state === 'loading'
            ? h('p', { className: 'crEmpty', 'data-state': 'loading' }, t('loading'))
            : emptyGroups
              ? h('p', { className: 'crEmpty', 'data-state': 'empty' }, t('modelsEmpty'))
              : h('div', { className: 'crCards' }, visibleGroups.map((group) => h(ModelGroup, {
                key: active.id + ':' + group.key,
                groupId: active.id + ':' + group.key,
                group,
                chosen,
                selectedCount: group.rows.filter((row) => rowSelected(row, chosen)).length,
                priceIncluded,
                renderRowExtras: active.renderRowExtras,
                onToggle: (rowKey, next) => {
                  const row = group.rows.find((entry) => entry.key === rowKey)
                  if (row) toggle(active.id, row.variants, next)
                },
              }))),
        h('p', { className: 'crHint' }, t('modelsSavedHint')),
        h('div', { className: 'crFooterBar' },
          h('span', { className: 'crState' }, t('modelsSelectedTotal', { enabled: selectedRows, total: groups.reduce((sum, group) => sum + group.rows.length, 0) })),
          active.metered === true && promoCount > 0
            ? h('span', { className: 'crBadgeMeta', 'data-tone': 'promo' }, t('promoCount', { n: promoCount }))
            : null,
          // The write result lives in a live region, so a screen reader hears
          // "Saved" / "Unsaved changes" / the failure.
          h('span', { className: 'crStatusLive', role: 'status', 'aria-live': 'polite' },
            errors[active.id] ? h('span', { className: 'crState', 'data-state': 'error' }, t('saveError')) : null,
            chosen.size === 0
              ? h('span', { className: 'crState', 'data-state': 'empty' }, t('modelsNeedOne'))
              : dirty
                ? h('span', { className: 'crState' }, t('modelsDirty'))
                : h('span', { className: 'crState', 'data-state': 'set', 'data-saved': 'true' }, t('modelsSaved'))),
          h('button', {
            type: 'button',
            className: 'crButton crButtonPrimary',
            // An empty `enabledModels` means ALL to every vendor, so an
            // empty selection cannot be expressed: refuse it instead of
            // silently turning "clear" into "select everything".
            disabled: !dirty || chosen.size === 0 || saving[active.id] === true,
            onClick: () => save(active),
          }, saving[active.id] === true ? t('modelsSaving') : t('modelsSave'))))
      )
    }

    /**
     * Sidebar glyph for the dashboard panel (16/18 px, inherits currentColor).
     * @param {object} props - `{size, active}` from the sidebar.
     * @returns {object} the element.
     */
    function RouterPanelGlyph(props) {
      const size = Number(props?.size) || 16
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', focusable: 'false' },
        h('rect', { x: 1.5, y: 3, width: 4.5, height: 4, rx: 1, stroke: 'currentColor', 'stroke-width': 1.3 }),
        h('rect', { x: 10, y: 9, width: 4.5, height: 4, rx: 1, stroke: 'currentColor', 'stroke-width': 1.3 }),
        h('path', { d: 'M6 5h2.5a1.5 1.5 0 0 1 1.5 1.5V9', stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linecap': 'round' }))
    }

    // ------------------------------------------------------------- container

    /** The context the host injected, set by apply(). */
    let hostCtx = null

    /**
     * The settings section.
     * @returns {object} the element.
     */
    function CustomRouterDashboard() {
      ensureStyle()
      const [tab, setTab] = React.useState('usage')
      const [openCards, setOpenCards] = React.useState({})
      const [section, setSection] = React.useState(undefined)
      const [secrets, setSecrets] = React.useState(undefined)
      const [status, setStatus] = React.useState('loading')
      const [error, setError] = React.useState('')
      const [saveState, setSaveState] = React.useState({})
      const [drafts, setDrafts] = React.useState({})
      const [updatedAt, setUpdatedAt] = React.useState(null)
      const [runtimeUsage, setRuntimeUsage] = React.useState(undefined)
      const [refreshTick, setRefreshTick] = React.useState(0)
      const [reload, setReload] = React.useState(() => () => {})
      const [, forceRender] = React.useReducer((n) => n + 1, 0)

      React.useEffect(() => {
        const form = hostCtx && hostCtx.configForms ? hostCtx.configForms.get(NAMESPACE) : null
        if (!form) {
          setStatus('unavailable')
          return undefined
        }
        const read = () => {
          const snapshot = form.getSnapshot()
          setSection(snapshot.value)
          // The sidecar is NOT part of the form snapshot; read it from the
          // settings mirror on every change so a credential write repaints the
          // "설정됨 / 미설정" state without a reload.
          setSecrets(readSecretSidecar(hostCtx))
          setStatus(snapshot.status)
          setUpdatedAt(Date.now())
          if (snapshot.status === 'error') setError('unavailable')
        }
        read()
        setReload(read)
        const unsubscribe = form.subscribe(read)
        const locale = hostCtx && hostCtx.locale ? hostCtx.locale : null
        const offLocale = locale && typeof locale.subscribe === 'function' ? locale.subscribe(() => forceRender()) : undefined
        return () => {
          unsubscribe()
          if (typeof offLocale === 'function') offLocale()
        }
      }, [])

      React.useEffect(() => {
        if (status !== 'ready') return undefined
        let alive = true
        void fetchUsageFeeds(globalThis.fetch).then((next) => {
          if (!alive) return
          setRuntimeUsage(next)
          setUpdatedAt(Date.now())
        }).catch(() => { /* keep settings fallback; never invent usage */ })
        return () => { alive = false }
      }, [status, refreshTick])

      /**
       * Queue one settings write.
       * @param {string} key - the save-state key.
       * @param {Array<object>} ops - the atomic operations.
       * @returns {Promise<void>} settlement.
       */
      const write = React.useCallback((key, ops) => {
        const form = hostCtx && hostCtx.configForms ? hostCtx.configForms.get(NAMESPACE) : null
        if (!form) return Promise.resolve()
        setSaveState((previous) => ({ ...previous, [key]: { saving: true, applied: false, error: '' } }))
        return form.mutate(ops)
          .then((accepted) => {
            setSaveState((previous) => ({
              ...previous,
              [key]: accepted
                ? { saving: false, applied: true, error: '' }
                : { saving: false, applied: false, error: 'refused' },
            }))
          })
          .catch((failure) => {
            setSaveState((previous) => ({
              ...previous,
              [key]: { saving: false, applied: false, error: failure instanceof Error ? failure.message : String(failure) },
            }))
          })
      }, [])

      // Merge the LIVE vendor readings over the namespace fallback: the fetch
      // above updates state, but without this call the cards keep rendering the
      // settings document (which carries no measurements) and every window
      // shows "사용량 미제공" while the routes answer 200 (measured 2026-11-08).
      const view = buildViewModel(mergeRuntimeUsage(section, runtimeUsage), Date.now(), secrets)

      /**
       * Toggle one card's settings panel.
       * @param {string} presetId - the preset id.
       * @returns {void}
       */
      const onToggle = (presetId) => {
        setOpenCards((previous) => ({ ...previous, [presetId]: previous[presetId] !== true }))
      }

      /**
       * Write the preset master switch.
       * @param {object} provider - the provider view model.
       * @param {boolean} next - the requested state.
       * @returns {void}
       */
      const onMaster = (provider, next) => {
        const declared = ROUTER_PROVIDERS.find((entry) => entry.id === provider.id)
        if (!declared) return
        void write(provider.id, [{ op: 'set', path: [...declared.masterPath], value: next }])
      }

      /**
       * Write one layer switch. A CLI worker switch is an ATOMIC PAIR: the
       * worker flag and the mode flag move together or not at all.
       * @param {object} provider - the provider view model.
       * @param {object} layer - the layer view model.
       * @param {boolean} next - the requested state.
       * @returns {void}
       */
      const onLayer = (provider, layer, next) => {
        const declared = ROUTER_PROVIDERS.find((entry) => entry.id === provider.id)
        const source = declared && declared.layers.find((entry) => entry.id === layer.id)
        if (!source) return
        const ops = [{ op: 'set', path: [...source.path], value: next }]
        if (source.pairPath) ops.push({ op: 'set', path: [...source.pairPath], value: next })
        void write(provider.id + ':' + layer.id, ops)
      }

      /**
       * Keep the typed secret in the container: the credential input is a
       * write-only field, and the value is never read back from the host.
       * @param {object} provider - the provider view model.
       * @param {object} credential - the credential view model.
       * @param {string} value - the typed value.
       * @returns {void}
       */
      const onDraft = (provider, credential, value) => {
        setDrafts((previous) => ({ ...previous, [provider.id + ':' + credential.field]: value }))
      }

      /**
       * Write one credential field. The value is write-only.
       * @param {object} provider - the provider view model.
       * @param {object} credential - the credential view model.
       * @returns {void}
       */
      const onCredential = (provider, credential) => {
        const key = provider.id + ':' + credential.field
        const typed = drafts[key] ?? ''
        if (typed === '') return
        void write(provider.id + ':secret:' + credential.field, [{
          op: 'set',
          path: ['vendorConfig', credential.row, credential.field],
          value: typed,
        }]).then(() => {
          setDrafts((previous) => {
            const next = { ...previous }
            delete next[key]
            return next
          })
        })
      }

      /**
       * Clear one credential field.
       * @param {object} provider - the provider view model.
       * @param {object} credential - the credential view model.
       * @returns {void}
       */
      const onClearCredential = (provider, credential) => {
        void write(provider.id + ':secret:' + credential.field, [{
          op: 'unset',
          path: ['vendorConfig', credential.row, credential.field],
        }])
      }

      /**
       * Apply every typed credential draft of one provider in ONE atomic
       * write, so a provider never ends up half-updated.
       * @param {object} provider - the provider view model.
       * @returns {void}
       */
      const onApplyDrafts = (provider) => {
        const ops = []
        for (const credential of provider.credentials) {
          const key = provider.id + ':' + credential.field
          const typed = drafts[key]
          if (typeof typed !== 'string' || typed === '') continue
          ops.push({ op: 'set', path: ['vendorConfig', credential.row, credential.field], value: typed })
        }
        if (ops.length === 0) return
        void write(provider.id + ':secret', ops).then(() => {
          setDrafts((previous) => {
            const next = { ...previous }
            for (const credential of provider.credentials) delete next[provider.id + ':' + credential.field]
            return next
          })
        })
      }

      /**
       * Add one provider: enable its preset, go back to the usage tab and open
       * that provider's settings.
       * @param {object} item - the picker item.
       * @returns {void}
       */
      const onAdd = (item) => {
        if (!item.presetId) return
        const declared = ROUTER_PROVIDERS.find((entry) => entry.id === item.presetId)
        if (!declared) return
        void write(item.presetId, [{ op: 'set', path: [...declared.masterPath], value: true }])
        setTab('usage')
        setOpenCards((previous) => ({ ...previous, [item.presetId]: true }))
      }

      const updatedText = formatTimestamp(updatedAt ?? Date.now())
      const pickerEnabled = {}
      for (const provider of view.providers) pickerEnabled[provider.id] = provider.enabled

      /**
       * The aggregated save status of one provider: its master write plus every
       * layer and credential write under the same provider id.
       * @param {string} id - the preset id.
       * @returns {object} the status.
       */
      const providerStatus = (id) => {
        let saving = false
        let applied = false
        let failure = ''
        for (const [key, entry] of Object.entries(saveState)) {
          if (key !== id && !key.startsWith(id + ':')) continue
          if (entry.saving) saving = true
          if (entry.applied) applied = true
          if (entry.error) failure = entry.error
        }
        return { saving, applied, error: failure }
      }

      // ONE container: the dashboard is a page in the main slot, so it centres
      // and stops at a readable width instead of stretching across the window.
      return h('div', { className: 'crSection crPage crPageScroll', 'data-router-namespace': NAMESPACE },
        h('header', { className: 'crHeader' },
          h('div', { className: 'crHeaderText' },
            h('h3', { className: 'crTitle' }, t('metaTitle')),
            h('p', { className: 'crSubtitle' }, t('metaDescription'))),
          h('div', { className: 'crHeaderSide' },
            updatedText ? h('span', { className: 'crUpdatedAt' }, t('headerUpdated', { at: updatedText })) : null,
            h('button', {
              type: 'button',
              className: 'crButton',
              disabled: status === 'loading',
              onClick: () => {
                reload()
                setRefreshTick((previous) => Number(previous || 0) + 1)
              },
            }, t('refresh')))),
        h('div', {
          className: 'crTabs',
          role: 'tablist',
          'aria-label': t('sectionTitle'),
          onKeyDown: tabStripKeyHandler({ tabs: DASHBOARD_TABS, currentId: 'cr-tab-' + tab, onSelect: setTab }),
        },
          DASHBOARD_TABS.map((entry) => h('button', {
            key: entry.value,
            type: 'button',
            className: 'crTab',
            role: 'tab',
            id: entry.id,
            // Only the active panel is mounted, so only the active tab names it.
            'aria-controls': tab === entry.value ? entry.panelId : undefined,
            'aria-selected': tab === entry.value ? 'true' : 'false',
            tabIndex: tab === entry.value ? 0 : -1,
            onClick: () => setTab(entry.value),
          }, t(entry.labelKey)))),
        // ONLY the active panel is rendered. Previously both panels were in the
        // DOM and the `hidden` attribute was overridden by `.crPanel{display:flex}`,
        // so the add-provider content rendered underneath the dashboard
        // (measured 2026-11-08). A conditional render cannot be un-hidden by CSS.
        tab === 'usage'
          ? h('div', {
            className: 'crPanel',
            role: 'tabpanel',
            id: 'cr-panel-usage',
            'aria-labelledby': 'cr-tab-usage',
            tabIndex: 0,
          },
          error
            ? h('p', { className: 'crFooterNote', 'data-state': 'error', role: 'status', 'aria-live': 'polite' }, t('loadError') + ': ' + error)
            : null,
          h('div', { className: 'crKpiGrid' },
            h(KpiCard, {
              label: t('kpiProviders'),
              value: view.enabledCount + ' / ' + view.totalCount,
              meta: t('kpiProvidersMeta', { enabled: view.enabledCount, total: view.totalCount }),
            }),
            h(KpiCard, {
              label: t('kpiTightest'),
              value: view.tightest ? Math.round(view.tightest.percent) + '%' : t('kpiUnavailable'),
              meta: view.tightest ? t('kpiTightestMeta', { provider: view.tightest.provider, window: view.tightest.window }) : t('usageUnavailable'),
              jumpHref: view.tightest ? '#cr-vendor-' + view.tightest.providerId : undefined,
            }),
            h(KpiCard, {
              label: t('kpiNextReset'),
              value: view.nextReset ? view.nextReset.clock : t('kpiUnavailable'),
              meta: view.nextReset ? t('kpiNextResetMeta', { provider: view.nextReset.provider, window: view.nextReset.window }) + (view.nextReset.relative ? ' · ' + view.nextReset.relative : '') : t('usageUnavailable'),
              jumpHref: view.nextReset ? '#cr-vendor-' + view.nextReset.providerId : undefined,
            })),
          h('div', { className: 'crProviderList' },
            view.providers.map((provider) => h(VendorCard, {
              key: provider.id,
              provider,
              open: openCards[provider.id] === true,
              status: providerStatus(provider.id),
              drafts,
              onToggle,
              onMaster,
              onLayer,
              onDraft,
              onCredential,
              onClearCredential,
              onApplyDrafts,
            }))))
          : h('div', {
            className: 'crPanel',
            role: 'tabpanel',
            id: 'cr-panel-add',
            'aria-labelledby': 'cr-tab-add',
            tabIndex: 0,
          },
          h('h4', { className: 'crSettingsTitle' }, t('addProviderTitle')),
          h('p', { className: 'crHint' }, t('addProviderHint')),
          h(ProviderPickerGrid, { items: PICKER_ITEMS, enabled: pickerEnabled, onAdd })))
    }

    // ----------------------------------------------------------------- wiring

    /**
     * Services this factory needs before `apply` may run.
     *
     * MANDATORY and EXPORTED: the loader injects only what
     * `module.exports.inject` lists. `ctx.slots`, `ctx.locale` and
     * `ctx.configForms` come back undefined otherwise.
     */
    const inject = ['slots', 'locale', 'configForms']

    /**
     * Register the single settings section.
     * @param {object} ctx - the injected host context.
     * @returns {() => void} the disposer.
     */
    function apply(ctx) {
      hostCtx = ctx
      localeReader = () => String(ctx && ctx.locale && ctx.locale.getSnapshot ? ctx.locale.getSnapshot().active ?? '' : '')
      const releases = []
      // 1. Settings section: per-preset model serving lists and selection.
      releases.push(ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: SECTION_ID,
            order: SECTION_ORDER,
            label: () => t('sectionTitle'),
          },
          CustomRouterModels,
        )))
      // 2. Sidebar panel: the usage/billing/switches dashboard, opened from the
      //    sidebar's panel list (the `더 보기` menu lists every panel). The
      //    sidebar row renders this glyph; `main` keys the page content to it.
      releases.push(ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: SECTION_ID,
            order: 40,
            label: () => t('panelLabel'),
          },
          RouterPanelGlyph,
        )))
      releases.push(ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: SECTION_ID,
          },
          CustomRouterDashboard,
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
    exports.CSS = CSS
    exports.NAMESPACE = NAMESPACE
    exports.SECTION_ID = SECTION_ID
    exports.ROUTER_PROVIDERS = ROUTER_PROVIDERS
    exports.PICKER_ITEMS = PICKER_ITEMS
    exports.buildViewModel = buildViewModel
    exports.mergeRuntimeUsage = mergeRuntimeUsage
    exports.normalizeAntigravityUsage = normalizeAntigravityUsage
    exports.normalizeOpencodeUsage = normalizeOpencodeUsage
    exports.normalizeDeepinfraUsage = normalizeDeepinfraUsage
    exports.fetchUsageFeeds = fetchUsageFeeds
    exports.readSecretSet = readSecretSet
    exports.readSwitch = readSwitch
    exports.CustomRouterDashboard = CustomRouterDashboard
    exports.CustomRouterModels = CustomRouterModels
    exports.RouterPanelGlyph = RouterPanelGlyph
    exports.MODEL_PRESETS = MODEL_PRESETS
    exports.PlanUsageCard = PlanUsageCard
    exports.detectOpencodeTier = detectOpencodeTier
    exports.opencodeCostByModel = opencodeCostByModel
    exports.documentedLimit = documentedLimit
    exports.flattenVariants = flattenVariants
    exports.VendorCard = VendorCard
    exports.KpiCard = KpiCard
    exports.UsageWindow = UsageWindow
    exports.BillingUsage = BillingUsage
    exports.SettingsPanel = SettingsPanel
    exports.ProviderPickerGrid = ProviderPickerGrid
    return module.exports
  },
})
