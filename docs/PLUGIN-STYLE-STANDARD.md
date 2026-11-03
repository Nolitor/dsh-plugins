# DSH Plugin Style Standard — Typography

<!-- skeleton:
version: 1.0
kind: rule
status: active
updated: 2026-11-03
summary: Mandatory typography rules for DSH plugin surfaces, measured from DSH 0.2.2-alpha.3 — DSH ships no font-size token and sets none on body, so every plugin surface must state 14px/22px itself.
-->

> Status: **mandatory** · Measured against DSH `0.2.2-alpha.3` · Applies to every `dsh-*` track
> Read together with [DSH-HARNESS-POLICY.md](DSH-HARNESS-POLICY.md) §3 and
> [RULES.md](RULES.md) §3 (single writer).

## 1. The rule in one line

**A plugin surface must state `font-size: 14px; line-height: 22px` on its own root.** Do not rely
on inheritance.

## 2. Why — measured facts

| Fact | Evidence |
|---|---|
| DSH defines **no** font-size token | the only size-ish token is `--dsw-font-xs-13`; there is no scale |
| DSH sets **no** `font-size` on `body` | the body rule declares font-family, colour, background only |
| So `body` computes to the **UA default 16px** | measured `body font-size: 16px` in a live boot |
| Every native surface states its size itself | 12 × `font-size:14px` in the shipped sheet; the native Settings dialog measures **14px × 20 / 12px × 11** |

**Consequence:** a plugin that omits `font-size` inherits **16px** and renders visibly larger than
everything around it. That is exactly what happened here — measured before the fix:

| Surface | Root computed | Native baseline |
|---|---|---|
| Sidebar Manager panel | **16px** (inputs 16px, plain buttons 16px) | 14px |
| Notify settings section | **16px** (buttons 12px) | 14px |

## 3. What to write

```js
// Panel/section root — inherit nothing.
section: { fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' }

// Row title — same as the native settings row.
title: { fontSize: 14, lineHeight: '22px' }

// Description / hint — the native secondary size.
description: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' }

// Small control (button, input, select) — the native control size.
button: { fontSize: 13, lineHeight: '20px' }
```

## 4. What *not* to do

| Don't | Why |
|---|---|
| Omit `font-size` and "let it inherit" | inherits the UA 16px, not 14px |
| Use `color-mix(in srgb, currentColor N%)` for surfaces/borders | ignores theme tokens; DSH uses `--dsw-alias-*` |
| Fill a control with `--dsw-alias-brand-primary` | resolves near-white in dark mode (measured `#f9fafb`), so the control is invisible |
| Use `--dsw-alias-bg-layer-4` | declared in the sheet but **unset at runtime** |
| Target `body` / `html` / `:root` with a `font-size` from a plugin | it leaks into every surface, including other plugins |

## 5. Font family is a separate, scoped concern

The Korean pack sets **family only**, never size, and scopes it to the active locale:
`html:lang(ko)`, `html[lang^="ko" i]`, plus the form-control selector list.

Verified in a live boot: the Korean sheet declares **no** `font-size`, does **not** touch the code
seat (`--ds-font-family-code` / terminal), and `body` resolves to the Pretendard/SUIT stack only
while `lang="ko"`. Code and terminal keep their monospace seats.

## 6. Enforcement

| Track | Test | Covers |
|---|---|---|
| `dsh-sidebar-manager` | `test/typography-contract.test.mjs` | root 14/22, controls 13, no literal 16px |
| `dsh-notify` | `test/typography.test.mjs` | section root 14/22, titles 14, descriptions 12, no 16px |

A new plugin track should copy one of these two files and point it at its own stylesheet.
