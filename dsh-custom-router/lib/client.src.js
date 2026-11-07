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
      '.crSection{min-width:0;max-width:1100px;padding:16px 0;display:flex;flex-direction:column;gap:16px;font-family:inherit;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary)}',
      '.crHeader{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;min-width:0}',
      '.crHeaderText{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}',
      '.crTitle{margin:0;font-family:inherit;font-size:calc(var(--dsh-content-font-size,14px) + 4px);font-weight:500;line-height:28px;color:var(--dsw-alias-label-primary)}',
      '.crSubtitle{margin:0;font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary)}',
      '.crHeaderSide{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.crUpdatedAt{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.crButton{appearance:none;border:.5px solid var(--dsw-alias-border-l4);background:0 0;border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;padding:5px 12px;cursor:pointer;white-space:nowrap}',
      '@media (hover:hover){.crButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}}',
      '.crButton:disabled{opacity:.55;cursor:default}',
      '.crTabs{display:flex;gap:4px;border-bottom:.5px solid var(--dsw-alias-border-l3);min-width:0}',
      '.crTab{appearance:none;background:0 0;border:0;border-bottom:2px solid transparent;cursor:pointer;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));padding:8px 10px;margin-bottom:-.5px;white-space:nowrap}',
      '.crTab[aria-selected=true]{color:var(--dsw-alias-label-primary);font-weight:500;border-bottom-color:var(--dsw-alias-state-business-primary)}',
      '.crKpiGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;align-items:stretch}',
      '.crKpiCard{border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-xl);padding:12px 14px;display:flex;flex-direction:column;gap:6px;min-width:0}',
      '.crKpiLabelRow{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}',
      '.crKpiLabel{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crJump{appearance:none;background:0 0;border:0;padding:0;cursor:pointer;color:var(--dsw-alias-link);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:nowrap}',
      '.crKpiValue{font-family:inherit;font-size:calc(var(--dsh-content-font-size,14px) + 8px);font-weight:500;line-height:32px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crKpiMeta{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crVendorGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:stretch}',
      '.crVendorCard{border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-xl);padding:14px;display:flex;flex-direction:column;gap:12px;min-width:0}',
      '.crVendorHead{display:flex;align-items:center;gap:12px;min-width:0}',
      '.crAvatar{width:40px;height:40px;border-radius:12px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:var(--dsh-content-font-size,14px);font-weight:500;line-height:1}',
      '.crIdentity{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.crVendorName{font-family:inherit;font-size:var(--dsh-content-font-size,14px);font-weight:500;line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crPlan{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crBadge{flex:0 0 auto;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xs);padding:2px 8px;font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.crBadge[data-state=active]{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
      '.crBadge[data-state=inactive]{border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary)}',
      '.crGear{flex:0 0 auto;appearance:none;background:0 0;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-secondary);cursor:pointer;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-family:inherit;font-size:14px;line-height:1;padding:0}',
      '@media (hover:hover){.crGear:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}}',
      '.crBody{display:flex;flex-direction:column;gap:12px;min-width:0;flex:1}',
      '.crPanel{display:flex;flex-direction:column;gap:16px;min-width:0}',
      '.crSettingsPanelBody{display:flex;flex-direction:column;gap:12px;min-width:0}',
      '.crUsageWindow{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.crUsageRow{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}',
      '.crUsageLabel{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crUsagePct{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.crBar{height:6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover-solid);overflow:hidden}',
      '.crBarFill{height:100%;border-radius:inherit;background:var(--dsw-alias-state-business-primary)}',
      '.crBarFill[data-level=high]{background:var(--dsw-alias-state-error-primary)}',
      '.crUsageReset{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crServing{display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:.5px solid var(--dsw-alias-border-l3);padding-top:8px;min-width:0}',
      '.crServingTitle{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.crServingMeta{display:flex;align-items:center;gap:8px;min-width:0}',
      '.crBillingHero{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.crBillingHeroLabel{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary)}',
      '.crBillingHeroValue{font-family:inherit;font-size:calc(var(--dsh-content-font-size,14px) + 8px);font-weight:500;line-height:32px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
      '.crBillingGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}',
      '.crBillingStat{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.crBillingStatLabel{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crBillingStatValue{font-family:inherit;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crBillingRow{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}',
      '.crBillingRowLabel{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.crBillingRowValue{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crReveal{display:grid;grid-template-rows:0fr;transition:grid-template-rows 180ms ease;min-width:0}',
      '.crReveal[data-open=true]{grid-template-rows:1fr}',
      '.crRevealInner{min-height:0;overflow:hidden;min-width:0}',
      '.crSettingsPanel{display:flex;flex-direction:column;gap:12px;border-top:.5px solid var(--dsw-alias-border-l3);padding-top:12px;min-width:0}',
      '.crSettingsTitle{font-family:inherit;font-size:var(--dsh-content-font-size,14px);font-weight:500;line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary);margin:0}',
      '.crMaster{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}',
      '.crMasterText{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.crMasterLabel{font-family:inherit;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary)}',
      '.crMasterHint{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);margin:0}',
      '.crSwitch{appearance:none;border:.5px solid var(--dsw-alias-border-l4);background:0 0;border-radius:999px;width:36px;height:20px;position:relative;cursor:pointer;flex:0 0 auto;padding:0}',
      '.crSwitch::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-tertiary);transition:transform .15s ease}',
      '.crSwitch[aria-checked=true]{background:var(--dsw-alias-button-ghost-active-fill);border-color:var(--dsw-alias-state-success-primary)}',
      '.crSwitch[aria-checked=true]::after{transform:translateX(16px);background:var(--dsw-alias-state-success-primary)}',
      '.crSwitch:disabled{opacity:.55;cursor:default}',
      '.crLayerGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}',
      '.crLayerCell{display:flex;flex-direction:column;gap:6px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);padding:10px;min-width:0}',
      '.crLayerCell[data-unsupported=true]{opacity:.7}',
      '.crLayerName{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crLayerState{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.crCredential{display:flex;flex-direction:column;gap:8px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);padding:10px;min-width:0}',
      '.crCredentialHead{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}',
      '.crCredentialTitle{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-secondary)}',
      '.crCredentialRow{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}',
      '.crCredentialField{display:flex;align-items:center;gap:8px;min-width:0;flex:1}',
      '.crCredentialName{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.crInput{appearance:none;flex:1;min-width:0;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:0 0;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;padding:4px 8px}',
      '.crState{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.crState[data-state=set]{color:var(--dsw-alias-state-success-primary)}',
      '.crHint{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);margin:0;min-width:0}',
      '.crFooter{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}',
      '.crFooterNote{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);min-width:0}',
      '.crFooterNote[data-state=error]{color:var(--dsw-alias-state-error-primary)}',
      '.crFooterNote[data-state=applied]{color:var(--dsw-alias-state-success-primary)}',
      '.crPickerGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;align-items:stretch}',
      '.crPickerCard{border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-xl);padding:14px;display:flex;flex-direction:column;gap:8px;min-width:0}',
      '.crPickerTitle{font-family:inherit;font-size:var(--dsh-content-font-size,14px);font-weight:500;line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary)}',
      '.crPickerDesc{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-secondary);margin:0;min-width:0}',
      '.crPickerAuth{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);margin:0}',
      '.crPickerActions{display:flex;align-items:center;gap:8px;margin-top:auto;min-width:0}',
      '.crModels{display:flex;flex-direction:column;gap:16px;min-width:0}',
      '.crCategory{display:flex;flex-direction:column;min-width:0;border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill);border:0.5px solid var(--dsw-alias-settings-card-stroke)}',
      '.crCategoryHead{display:flex;align-items:center;gap:12px;flex-wrap:wrap;min-width:0;padding:14px 16px;border-bottom:0.5px solid var(--dsw-alias-border-l2)}',
      '.crCategoryTitle{display:flex;flex-direction:column;min-width:0;flex:1;gap:2px}',
      '.crCategoryName{font-family:inherit;font-size:var(--dsh-content-font-size,14px);font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.crCategoryPlan{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);color:var(--dsw-alias-label-secondary)}',
      '.crCategoryCount{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.crModelFilter{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:0.5px solid var(--dsw-alias-border-l2);min-width:0}',
      '.crModelSearch{flex:1;min-width:0;height:28px;box-sizing:border-box;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;padding:0 8px}',
      '.crModelList{display:flex;flex-direction:column;max-height:420px;overflow:auto}',
      '.crModelRow{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;padding:8px 16px;min-width:0;cursor:pointer}',
      '.crModelRow:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.crModelCheck{width:14px;height:14px;accent-color:var(--dsw-alias-state-business-primary);margin:0}',
      '.crModelText{display:flex;flex-direction:column;min-width:0;gap:2px}',
      '.crModelName{font-family:inherit;font-size:var(--dsh-content-font-size,14px);color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.crModelMeta{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);color:var(--dsw-alias-label-tertiary);display:flex;gap:6px;flex-wrap:wrap}',
      '.crModelPrice{display:flex;flex-direction:column;align-items:flex-end;gap:2px;white-space:nowrap}',
      '.crModelRate{font-family:var(--ds-font-family-code,monospace);font-size:var(--dsh-content-font-size-secondary,13px);color:var(--dsw-alias-label-primary)}',
      '.crModelRateList{font-family:var(--ds-font-family-code,monospace);font-size:var(--dsh-content-font-size-secondary,13px);color:var(--dsw-alias-label-tertiary);text-decoration:line-through}',
      '.crPromoBadge{font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary-alpha,transparent);border-radius:var(--dsw-radius-sm);padding:0 4px}',
      '.crModelEmpty{padding:16px;color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px)}',
      '.crCategoryFoot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:10px 16px;border-top:0.5px solid var(--dsw-alias-border-l2);min-width:0}',
      '@media (max-width:1180px){.crKpiGrid,.crVendorGrid,.crBillingGrid,.crLayerGrid,.crPickerGrid{grid-template-columns:repeat(2,minmax(0,1fr))}}',
      '@media (max-width:720px){.crKpiGrid,.crVendorGrid,.crBillingGrid,.crLayerGrid,.crPickerGrid{grid-template-columns:minmax(0,1fr)}}',
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
          Object.freeze({ field: 'refreshToken' }),
          Object.freeze({ field: 'clientSecret' }),
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
          Object.freeze({ field: 'apiKey' }),
          Object.freeze({ field: 'password' }),
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
          Object.freeze({ field: 'apiKey' }),
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
     * The settings trigger: the gear button that opens one card's panel.
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
      }, '⚙')
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
     * One vendor card: header, usage body and the collapsible settings panel.
     * @param {object} props - component props.
     * @returns {object} the element.
     */
    function VendorCard(props) {
      const provider = props.provider
      const panelId = 'cr-settings-' + provider.id
      return h('article', {
        className: 'crVendorCard',
        id: 'cr-vendor-' + provider.id,
        'data-preset': provider.id,
        'data-connection': provider.connection,
      },
      h('header', { className: 'crVendorHead' },
        h(ProviderAvatar, { name: provider.name }),
        h(ProviderIdentity, { name: provider.name, plan: provider.plan }),
        h(ConnectionBadge, { state: provider.connection }),
        h(SettingsTrigger, {
          open: props.open === true,
          controlsId: panelId,
          label: t('settingsTitle'),
          onToggle: () => props.onToggle(provider.id),
        })),
      provider.usageKind === 'billing'
        ? h(BillingUsage, { billing: provider.billing })
        : h('div', { className: 'crBody' },
          provider.windows.length === 0
            ? h('p', { className: 'crHint' }, t('usageNoData'))
            : provider.windows.map((window) => h(UsageWindow, { key: window.id, window })),
          h(ServingSummary, { serving: provider.serving })),
      h(SettingsReveal, { open: props.open === true, id: panelId },
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
        })))
    }

    /**
     * The collapsible settings shell: a grid-rows reveal with an overflow-hidden
     * inner box, so the panel animates without a fixed height.
     * @param {object} props - component props.
     * @returns {object} the element.
     */
    function SettingsReveal(props) {
      return h('div', { className: 'crReveal', 'data-open': props.open ? 'true' : 'false' },
        h('div', { className: 'crRevealInner' },
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
     * @param {object} props - component props.
     * @returns {object} the element.
     */
    function CredentialSection(props) {
      const rows = props.provider.credentials.map((credential) => h('div', { className: 'crCredentialRow', key: credential.field },
        h('div', { className: 'crCredentialField' },
          h('span', { className: 'crCredentialName' }, credential.field),
          h('input', {
            type: 'password',
            className: 'crInput',
            value: props.draft ?? '',
            placeholder: t('credentialPlaceholder'),
            'aria-label': credential.field,
            'data-secret-field': credential.field,
            onChange: (event) => props.onDraft(credential, event && event.target ? event.target.value : ''),
          })),
        h('span', { className: 'crState', 'data-state': credential.set ? 'set' : 'unset', 'data-secret-set': credential.set ? 'true' : 'false' },
          credential.set ? t('credentialSet') : t('credentialUnset')),
        h('button', {
          type: 'button',
          className: 'crButton',
          onClick: () => props.onCredential(credential),
        }, t('credentialSave')),
        h('button', {
          type: 'button',
          className: 'crButton',
          disabled: !credential.set,
          onClick: () => props.onClearCredential(credential),
        }, t('credentialClear'))))
      return h('div', { className: 'crCredential' },
        h('div', { className: 'crCredentialHead' },
          h('span', { className: 'crCredentialTitle' }, t('credentialTitle')),
          h('span', { className: 'crState' }, t('credentialHint'))),
        rows)
    }

    /**
     * The settings panel: master switch, layer grid, credentials and the
     * save/applied/error footer.
     * @param {object} props - component props.
     * @returns {object} the element.
     */
    function SettingsPanel(props) {
      const status = props.status ?? {}
      return h('div', { className: 'crSettingsPanelBody' },
        h('h4', { className: 'crSettingsTitle' }, t('settingsTitle')),
        h(MasterSwitchRow, { provider: props.provider, onMaster: props.onMaster }),
        h(LayerSwitchGrid, { provider: props.provider, onLayer: props.onLayer }),
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
            className: 'crButton',
            disabled: status.saving === true,
            onClick: () => props.onApplyDrafts(props.provider),
          }, status.saving === true ? t('credentialSaving') : t('credentialSave')),
          status.error
            ? h('span', { className: 'crFooterNote', 'data-state': 'error' }, t('saveError') + ': ' + status.error)
            : status.applied
              ? h('span', { className: 'crFooterNote', 'data-state': 'applied' }, t('applied'))
              : null))
    }

    /**
     * The add-provider tab panel.
     * @param {object} props - component props.
     * @returns {object} the element.
     */
    function ProviderPickerGrid(props) {
      return h('div', { className: 'crPickerGrid' }, props.items.map((item) => h('div', {
        className: 'crPickerCard',
        key: item.id,
        'data-picker': item.id,
      },
      h('span', { className: 'crPickerTitle' }, t(item.nameKey)),
      h('p', { className: 'crPickerDesc' }, t(item.descKey)),
      h('p', { className: 'crPickerAuth' }, t(item.authKey)),
      h('div', { className: 'crPickerActions' },
        h('button', {
          type: 'button',
          className: 'crButton',
          disabled: item.presetId === null || props.enabled[item.presetId] === true,
          onClick: () => props.onAdd(item),
        }, props.enabled[item.presetId] === true ? t('pickerAdded') : item.presetId === null ? t('pickerUnsupported') : t('pickerAdd'))))))
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
    const MODEL_SOURCES = Object.freeze([
      Object.freeze({ id: 'antigravity', row: 'dsh-antigravity', route: '/api/local/dsh-antigravity/models', planKey: 'planSubscription', normalize: normalizeAntigravityModels }),
      Object.freeze({ id: 'opencode', row: 'dsh-opencode-v2-http', route: '/api/local/opencode-v2/model-settings', planKey: 'planOpenCode', normalize: normalizeOpencodeModels }),
      Object.freeze({ id: 'deepinfra', row: 'dsh-deepinfra', route: '/api/local/deepinfra/models', planKey: 'planPayAsYouGo', normalize: normalizeDeepinfraModels }),
    ])

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

    /**
     * Normalize the Antigravity model list (subscription: quota, no per-token price).
     * @param {object} payload - `/models` answer.
     * @returns {object[]} normalized models.
     */
    function normalizeAntigravityModels(payload) {
      const models = Array.isArray(payload?.models) ? payload.models : []
      return models.map((entry) => ({
        id: String(entry?.id ?? ''),
        name: String(entry?.name ?? entry?.id ?? ''),
        meta: [formatContext(entry?.contextWindow), entry?.supportsThinking === true ? t('modelThinking') : ''].filter(Boolean),
        price: null,
        promotion: null,
        enabled: entry?.enabled === true,
      })).filter((model) => model.id !== '')
    }

    /**
     * Normalize the OpenCode route list (plan subscription; no per-token price).
     * @param {object} payload - `/model-settings` answer.
     * @returns {object[]} normalized models.
     */
    function normalizeOpencodeModels(payload) {
      const enabled = Array.isArray(payload?.enabled) ? payload.enabled : []
      const models = Array.isArray(payload?.models) ? payload.models : []
      return models.map((entry) => {
        const id = String(entry?.route ?? '')
        return {
          id,
          name: String(entry?.name ?? id),
          meta: [entry?.plan === 'zen' ? t('planZen') : t('planGo'), entry?.available === false ? t('modelUnavailable') : ''].filter(Boolean),
          price: null,
          promotion: null,
          enabled: enabled.includes(id),
        }
      }).filter((model) => model.id !== '')
    }

    /**
     * Normalize the DeepInfra catalog (pay-per-token: price and promotion per model).
     * @param {object} payload - `/models` answer.
     * @returns {object[]} normalized models.
     */
    function normalizeDeepinfraModels(payload) {
      const models = Array.isArray(payload?.models) ? payload.models : []
      return models.map((entry) => ({
        id: String(entry?.id ?? ''),
        name: String(entry?.id ?? ''),
        meta: [formatContext(entry?.contextWindow), entry?.vision === true ? t('modelVision') : '', entry?.reasoning === true ? t('modelThinking') : ''].filter(Boolean),
        price: entry?.price !== null && typeof entry?.price === 'object' ? entry.price : null,
        promotion: entry?.promotion !== null && typeof entry?.promotion === 'object' ? entry.promotion : null,
        enabled: entry?.enabled === true,
      })).filter((model) => model.id !== '')
    }

    /**
     * Whether a model list carries per-token prices.
     * @param {object[]} models - normalized models.
     * @returns {boolean} true when at least one model has a rate.
     */
    function hasRates(models) {
      return Array.isArray(models) && models.some((model) => model.price !== null && typeof model.price === 'object')
    }

    /**
     * One model row: checkbox, name/meta and the price block.
     * @param {object} props - component props.
     * @returns {object} the element.
     */
    function ModelRow(props) {
      const model = props.model
      const selected = props.selected === true
      // A subscription plan has no per-token rate: say it is included rather
      // than claiming the provider failed to answer.
      const noRateNote = props.priceNote ?? t('priceUnavailable')
      const price = model.price !== null && typeof model.price === 'object' ? model.price : null
      const promotion = model.promotion !== null && typeof model.promotion === 'object' ? model.promotion : null
      const promoPercent = promotion !== null && Number.isFinite(Number(promotion.percentOff)) ? Number(promotion.percentOff) : null
      return h('label', { className: 'crModelRow', 'data-model': model.id },
        h('input', {
          type: 'checkbox',
          className: 'crModelCheck',
          checked: selected,
          'aria-label': model.name,
          onChange: (event) => props.onToggle(model.id, event.target.checked),
        }),
        h('span', { className: 'crModelText' },
          h('span', { className: 'crModelName', title: model.id }, model.name),
          model.meta.length > 0 ? h('span', { className: 'crModelMeta' }, model.meta.join(' · ')) : null),
        h('span', { className: 'crModelPrice' },
          price !== null
            ? h('span', { className: 'crModelRate' }, t('modelRate', { input: formatRate(price.input), output: formatRate(price.output) }))
            : h('span', { className: 'crModelRate' }, noRateNote),
          price !== null && promoPercent !== null
            ? h('span', { className: 'crModelRateList' }, t('modelRate', { input: formatRate(price.listInput), output: formatRate(price.listOutput) }))
            : null,
          promoPercent !== null
            ? h('span', { className: 'crPromoBadge' }, t('promoOff', { percent: promoPercent }))
            : null))
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
     * The settings section: one category per preset with its model-serving list.
     *
     * The user picks the models the prompt picker should offer and saves; the
     * write lands in `vendorConfig.<row>.enabledModels`, the field each vendor
     * already filters its catalog with, and the router reconcile applies it to
     * the running child.
     * @returns {object} the element.
     */
    function CustomRouterModels() {
      ensureStyle()
      const [catalogs, setCatalogs] = React.useState({})
      const [selected, setSelected] = React.useState({})
      const [saved, setSaved] = React.useState({})
      const [status, setStatus] = React.useState({})
      const [queries, setQueries] = React.useState({})
      const [saving, setSaving] = React.useState({})
      const [errors, setErrors] = React.useState({})

      React.useEffect(() => {
        let alive = true
        for (const source of MODEL_SOURCES) {
          // The initial state is already 'loading'; resetting it here would
          // overwrite an answered catalog on every re-render.
          postUsageRoute(globalThis.fetch, source.route)
            .then((payload) => {
              if (!alive) return
              const models = source.normalize(payload)
              const enabled = new Set(models.filter((model) => model.enabled).map((model) => model.id))
              setCatalogs((previous) => ({ ...previous, [source.id]: models }))
              setSelected((previous) => ({ ...previous, [source.id]: enabled }))
              setSaved((previous) => ({ ...previous, [source.id]: new Set(enabled) }))
              setStatus((previous) => ({ ...previous, [source.id]: 'ready' }))
            })
            .catch(() => {
              if (alive) setStatus((previous) => ({ ...previous, [source.id]: 'error' }))
            })
        }
        return () => { alive = false }
      }, [])

      /**
       * Toggle one model's selection in a category.
       * @param {string} sourceId - preset id.
       * @param {string} modelId - model id or route.
       * @param {boolean} next - requested state.
       * @returns {void}
       */
      const toggle = (sourceId, modelId, next) => {
        setSelected((previous) => {
          const set = new Set(previous[sourceId] ?? [])
          if (next) set.add(modelId)
          else set.delete(modelId)
          return { ...previous, [sourceId]: set }
        })
      }

      /**
       * Select every model of a category, or clear it.
       * @param {object} source - model source.
       * @param {boolean} all - true selects all, false clears.
       * @returns {void}
       */
      const setAll = (source, all) => {
        const models = catalogs[source.id] ?? []
        setSelected((previous) => ({ ...previous, [source.id]: all ? new Set(models.map((model) => model.id)) : new Set() }))
      }

      /**
       * Persist one category's selection through the router namespace.
       * @param {object} source - model source.
       * @returns {void}
       */
      const save = (source) => {
        const form = hostCtx && hostCtx.configForms ? hostCtx.configForms.get(NAMESPACE) : null
        if (!form || saving[source.id] === true) return
        const models = catalogs[source.id] ?? []
        const chosen = selected[source.id] ?? new Set()
        const value = models.map((model) => model.id).filter((id) => chosen.has(id))
        setSaving((previous) => ({ ...previous, [source.id]: true }))
        form.mutate([{ op: 'set', path: ['vendorConfig', source.row, 'enabledModels'], value }])
          .then((accepted) => {
            setSaving((previous) => ({ ...previous, [source.id]: false }))
            if (accepted) {
              setSaved((previous) => ({ ...previous, [source.id]: new Set(chosen) }))
              setErrors((previous) => ({ ...previous, [source.id]: '' }))
            } else {
              setErrors((previous) => ({ ...previous, [source.id]: 'refused' }))
            }
          })
          .catch((failure) => {
            setSaving((previous) => ({ ...previous, [source.id]: false }))
            setErrors((previous) => ({ ...previous, [source.id]: failure instanceof Error ? failure.message : String(failure) }))
          })
      }

      return h('div', { className: 'crSection crModels' },
        h('div', { className: 'crHeader' },
          h('div', { className: 'crTitleBlock' },
            h('h2', { className: 'crTitle' }, t('modelsTitle')),
            h('p', { className: 'crSubtitle' }, t('modelsHint')))),
        MODEL_SOURCES.map((source) => {
          const provider = ROUTER_PROVIDERS.find((entry) => entry.id === source.id)
          const models = catalogs[source.id] ?? []
          const chosen = selected[source.id] ?? new Set()
          const initial = saved[source.id]
          const dirty = initial === undefined ? false : !sameSelection(chosen, initial)
          const query = String(queries[source.id] ?? '').trim().toLowerCase()
          const visible = query === ''
            ? models
            : models.filter((model) => model.name.toLowerCase().includes(query) || model.id.toLowerCase().includes(query))
          const state = status[source.id] ?? 'loading'
          return h('section', { className: 'crCategory', 'data-category': source.id, key: source.id },
            h('div', { className: 'crCategoryHead' },
              h(ProviderAvatar, { name: t(provider?.nameKey ?? 'vendorAntigravity') }),
              h('div', { className: 'crCategoryTitle' },
                h('span', { className: 'crCategoryName' }, t(provider?.nameKey ?? 'vendorAntigravity')),
                h('span', { className: 'crCategoryPlan' }, t(source.planKey))),
              h('span', { className: 'crCategoryCount' }, t('modelsCount', { enabled: chosen.size, total: models.length }))),
            h('div', { className: 'crModelFilter' },
              h('input', {
                className: 'crModelSearch',
                type: 'search',
                placeholder: t('modelsSearch'),
                'aria-label': t('modelsSearch'),
                value: queries[source.id] ?? '',
                onChange: (event) => setQueries((previous) => ({ ...previous, [source.id]: event.target.value })),
              }),
              h('button', { type: 'button', className: 'crButton', onClick: () => setAll(source, true) }, t('modelsSelectAll')),
              h('button', { type: 'button', className: 'crButton crButtonGhost', onClick: () => setAll(source, false) }, t('modelsClear'))),
            state === 'error'
              ? h('p', { className: 'crModelEmpty' }, t('modelsLoadFailed'))
              : state === 'loading'
                ? h('p', { className: 'crModelEmpty' }, t('loading'))
                : visible.length === 0
                  ? h('p', { className: 'crModelEmpty' }, t('modelsEmpty'))
                  : h('div', { className: 'crModelList' }, visible.map((model) => h(ModelRow, {
                    key: model.id,
                    model,
                    selected: chosen.has(model.id),
                    priceNote: t(source.planKey === 'planPayAsYouGo' ? 'priceUnavailable' : 'priceIncluded'),
                    onToggle: (id, next) => toggle(source.id, id, next),
                  }))),
            h('div', { className: 'crCategoryFoot' },
              errors[source.id] ? h('span', { className: 'crState', 'data-state': 'error' }, t('saveError')) : null,
              dirty ? h('span', { className: 'crState' }, t('modelsDirty')) : h('span', { className: 'crState', 'data-saved': 'true' }, t('modelsSaved')),
              h('button', {
                type: 'button',
                className: 'crButton crButtonPrimary',
                disabled: !dirty || saving[source.id] === true,
                onClick: () => save(source),
              }, saving[source.id] === true ? t('modelsSaving') : t('modelsSave'))))
        }),
        h('p', { className: 'crHint' }, t('modelsSavedHint')))
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

      return h('section', { className: 'crSection', 'data-router-namespace': NAMESPACE },
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
        h('div', { className: 'crTabs', role: 'tablist' },
          h('button', {
            type: 'button',
            className: 'crTab',
            role: 'tab',
            id: 'cr-tab-usage',
            'aria-controls': 'cr-panel-usage',
            'aria-selected': tab === 'usage' ? 'true' : 'false',
            onClick: () => setTab('usage'),
          }, t('tabUsage')),
          h('button', {
            type: 'button',
            className: 'crTab',
            role: 'tab',
            id: 'cr-tab-add',
            'aria-controls': 'cr-panel-add',
            'aria-selected': tab === 'add' ? 'true' : 'false',
            onClick: () => setTab('add'),
          }, t('tabAddProvider'))),
        h('div', {
          className: 'crPanel',
          role: 'tabpanel',
          id: 'cr-panel-usage',
          'aria-labelledby': 'cr-tab-usage',
          hidden: tab !== 'usage',
        },
        error
          ? h('p', { className: 'crFooterNote', 'data-state': 'error' }, t('loadError') + ': ' + error)
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
        h('div', { className: 'crVendorGrid' },
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
          })))),
        h('div', {
          className: 'crPanel',
          role: 'tabpanel',
          id: 'cr-panel-add',
          'aria-labelledby': 'cr-tab-add',
          hidden: tab !== 'add',
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
    exports.MODEL_SOURCES = MODEL_SOURCES
    exports.normalizeAntigravityModels = normalizeAntigravityModels
    exports.normalizeOpencodeModels = normalizeOpencodeModels
    exports.normalizeDeepinfraModels = normalizeDeepinfraModels
    exports.VendorCard = VendorCard
    exports.KpiCard = KpiCard
    exports.UsageWindow = UsageWindow
    exports.BillingUsage = BillingUsage
    exports.SettingsPanel = SettingsPanel
    exports.ProviderPickerGrid = ProviderPickerGrid
    return module.exports
  },
})
