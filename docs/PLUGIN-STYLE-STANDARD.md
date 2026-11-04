# DSH Plugin Style Standard — Typography

<!-- skeleton:
version: 2.0
kind: rule
status: active
updated: 2026-11-05
summary: Typography rules for DSH plugin surfaces, CORRECTED 2026-11-05 — DSH does define live content font-size tokens (--dsh-content-font-size and its derived secondaries) and sets them on body at runtime from the user's Settings > font-size. Plugins must consume those tokens, never hardcode 14px.
-->

> Status: **mandatory** · Corrected against DSH `0.2.2-alpha.3` on 2026-11-05
> Applies to every `dsh-*` track
> Read together with [DSH-HARNESS-POLICY.md](DSH-HARNESS-POLICY.md) §3 and
> [RULES.md](RULES.md) §3 (single writer).

> **Correction notice (2026-11-05).** Version 1.0 of this document said DSH "defines **no**
> font-size token" and therefore told every plugin to hardcode `font-size: 14px`. **That was
> wrong**, and following it makes a plugin ignore the user's font-size setting. The measurement
> below supersedes §1–§4 of v1.0. Three plugins were written against the wrong rule before this
> was caught; see §7 for the audit.

## 1. The rule in one line

**Consume DSH's live content-size tokens; never hardcode a pixel size.**

```css
/* surface root and primary text */
font-size: var(--dsh-content-font-size, 14px);
line-height: calc(22px + var(--dsh-content-font-delta, 0px));

/* hints, captions, secondary rows */
font-size: var(--dsh-content-font-size-secondary, 13px);
line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
```

## 2. Why — measured facts (2026-11-05)

Taken from the shipped stylesheet
`@deepseek-ai/dsh-web-frontend/dist/assets/index-*.css` and
`@deepseek-ai/dsh-client-ui-theme/lib/client.js`.

| Fact | Evidence |
|---|---|
| DSH **does** define a live content-size variable | `body{--dsh-content-font-delta:calc(var(--dsh-content-font-size,14px) - 14px); …}` |
| DSH derives the secondary sizes from it | `--dsh-content-font-size-secondary:min(calc(var(--dsh-content-font-size,14px) - 1px), max(13px, calc(var(--dsh-content-font-size,14px) - 2px)))` |
| The value is **user-configurable at runtime** | `FONT_SIZE_SPECS.text = { variable: '--dsh-content-font-size', min: 10, max: 22, default: 14 }` |
| The user's choice reaches the DOM | `dsh-client-ui-theme` writes the role variable onto `body.style`; `bootstrapFontSizes()` reads it for first paint |
| This profile sets it to **13px** | `profiles/web/cordis.patch.yml` → `ui-theme: { fontSize: 13 }` |
| Native components already do this | `._bubble_…{font-size:var(--dsh-content-font-size,14px); line-height:calc(22px + var(--dsh-content-font-delta,0px))}` |

**Consequence:** a plugin that hardcodes `14px` renders one step larger than everything around it
whenever the user is not on the default. With this profile at 13px, a hardcoded 14px surface is
visibly wrong.

**The v1.0 claim "body computes to the UA default 16px" was a real observation with the wrong
explanation:** `body` has no static `font-size` in the sheet, so *before* the theme client runs
it computes to 16px. The theme client then sets the variable and native components consume it.
Inheritance is still not the answer — **the token is.**

## 3. What to write

```css
/* Panel/section root */
.agSection{font-family:inherit;font-size:var(--dsh-content-font-size,14px);
           line-height:calc(22px + var(--dsh-content-font-delta,0px));
           color:var(--dsw-alias-label-primary)}

/* Row title — same size as body content */
.agRowLabel{font-size:var(--dsh-content-font-size,14px)}

/* Hint / description — the derived secondary */
.agHint{font-size:var(--dsh-content-font-size-secondary,13px);
        line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));
        color:var(--dsw-alias-label-tertiary)}

/* Small control */
.agButton{font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px}

/* Heading — one step above content, still relative */
.agHeading{font-size:calc(var(--dsh-content-font-size,14px) + 2px);line-height:24px}
```

Always keep the fallback inside `var()` so the surface still renders when the variable is absent
(a documentless test run, or a boot without the theme client).

## 4. What *not* to do

| Don't | Why |
|---|---|
| Hardcode `font-size:14px` | ignores the user's font-size setting; wrong at any non-default value |
| Omit `font-size` entirely | inherits the UA 16px before the theme client runs, and inherits whatever the parent set after |
| Set `font-size` on `body`/`html`/`:root` from a plugin | leaks into every surface, including other plugins |
| Use `color-mix(in srgb, currentColor N%)` | ignores theme tokens; DSH uses `--dsw-alias-*` |
| Fill a control with `--dsw-alias-brand-primary` | resolves near-white in dark mode (measured `#f9fafb`), so the control is invisible |
| Use `--dsw-alias-bg-layer-4` | declared in the sheet but **unset at runtime** |
| Replace `font-family` with a concrete stack | the Korean pack owns family, scoped to `html:lang(ko)`; use `font-family:inherit` |

## 5. Font family is a separate, scoped concern

The Korean pack sets **family only**, never size, scoped to the active locale:
`html:lang(ko)`, `html[lang^="ko" i]`, plus the form-control selector list. Verified in a live
boot: the Korean sheet declares no `font-size`, does not touch the code seat
(`--ds-font-family-code` / terminal), and `body` resolves to the Pretendard/SUIT stack only while
`lang="ko"`.

## 6. Enforcement

| Track | Test | Covers |
|---|---|---|
| `dsh-sidebar-manager` | `test/typography-contract.test.mjs` | root 14/22, controls 13, no literal 16px |
| `dsh-notify` | `test/typography.test.mjs` | section root 14/22, titles 14, descriptions 12, no 16px |
| `dsh-antigravity` | `test/typography.test.mjs` | **token form only**: every `font-size` is a `var()`/`calc()`; no literal px; no bare selectors; family inherited |

A new plugin track must assert the **token form**, not a pixel value:

```js
const literals = [...css.matchAll(/font-size:(?!var\(|calc\()([^;}]+)/g)]
assert.deepEqual(literals, [], 'every size must be a var()/calc() with the DSH fallback')
```

The older two tests assert the v1.0 pixel rule and are **stale**; convert them when their track is
next touched.

## 7. Audit of plugins written against v1.0

| Track | Status |
|---|---|
| `dsh-sidebar-manager` | asserts 14/22 literally — stale, needs conversion |
| `dsh-notify` | asserts 14/22 literally — stale, needs conversion |
| `dsh-antigravity` | **corrected** to token form on 2026-11-05 |

A hardcoded 14px surface is not a crash; it is a silent mismatch that only appears when the user
changes the setting, which is why it survived review twice.
