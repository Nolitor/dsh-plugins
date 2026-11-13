# UI Slot Architecture — three tiers for DSH plugin surfaces

<!-- skeleton:
version: 1.1
kind: design
status: active
updated: 2026-11-05
summary: Owner-approved placement rule for token/usage surfaces — global header for the tk system ledger, conversation.input.right for per-provider composer chips — with the measured slot seats; opencode-v2 migrated in 0.0.2-rc.4, DeepInfra and tk still pending.
-->

> Status: **partly implemented.** opencode-v2 moved its cost chip to
> `conversation.input.right` in `0.0.2-rc.4` (2026-11-05) and Antigravity was already on that
> seat. DeepInfra (still a second registration in the single `activity` slot) and the tk
> header move are **not implemented**; steps 1, 2 and the DeepInfra half of step 3 remain.

## 1. The placement rule (owner instruction)

| Tier | Seat | Belongs here | Does not belong here |
| :--- | :--- | :--- | :--- |
| 1 | **Global header/status bar** | `tk` — global token ledger, project/session cumulative cost, cache-hit savings monitoring | per-turn or per-provider figures |
| 2 | **Composer right multi-slot** (`conversation.input.right`, list) | Antigravity, DeepInfra, OpenCode **real-time per-turn usage chips** | global totals, cross-session monitoring |
| 3 | **Sidebar / Settings** | project-management harness, model catalog, per-plugin settings | transient turn feedback |

The decisive rule: **a single-slot seat is never shared.** `conversation.input.activity` is a
`single` slot; `conversation.input.right` is a `list` slot. Per-provider chips must use the list
seat, and the global monitor must not live in the composer at all.

## 2. Measured current registrations (2026-11-05)

| Plugin | Slot | Kind | Current effect |
| :--- | :--- | :--- | :--- |
| `tk` (token-economizer) | none | — | **correction 2026-11-05**: the track has no browser half at all (`HEAD` has no `lib/client.js`), so the earlier "tk owns the activity seat" pageerror was a transient working-tree state, not this package. Its new rc.1 dev-stats card uses `settings.section` only. |
| `@nolit/dsh-deepinfra` | `conversation.input.right` | list | **migrated 2026-11-05** (`0.0.1-rc.8`): was the only remaining `activity` registration; now label+value chip beside the selector, provider-id gate, no seat without a measured figure |
| `@nolit/dsh-opencode-v2` | `conversation.input.right` | list | migrated (`0.0.2-rc.4`, renumbered `0.0.1-rc.1` in the version normalization); label+value chip, provider-id gate |
| `@nolit/dsh-antigravity` | `conversation.input.right` | list | migrated; additive; route-gated (`0.0.1-rc.6`, renumbered rc.7 by the rc.1 round) |

Observed live pageerror:

```
single slot "conversation.input.activity" already has a registration at priority 0
(registered by tk) — register at a different priority to shadow it (lowest renders)
```

This is the tk ↔ deepinfra collision the new layout resolves. Antigravity is already on the correct
seat; DeepInfra and OpenCode v2 still need the migration.

## 3. The global-header seat does not exist yet

Measured in `@deepseek-ai/dsh-cordis-client-runner` (2026-11-05):

| Slot | Kind | Summary |
| :--- | :--- | :--- |
| `shell.leading` | single | window-chrome seat at the frame's top-left |
| `shell.overlay` | list | frame-wide floating layer above every column |
| `shell.bottom` | single | full-width bottom content below all three columns |

There is **no list slot at the top of the frame**. Before moving `tk` to a global header, one of these
must happen:

1. **Preferred — add a host list slot** (working name `shell.header` or `shell.statusbar`) that is
   full-width, list-kind, and always present. Then `tk` registers one entry there.
2. Use `shell.overlay` (list) with a top anchor and a reserved inset. Works without a host change,
   but floats over content and must not intercept pointer events outside itself.
3. Use `shell.bottom` (single) only if exactly one global monitor will ever occupy it. This does not
   scale and is not the recommended shape.

Do **not** solve a chip conflict by giving two plugins different priorities in the single
`conversation.input.activity` seat: the slot contract says a single seat renders one occupant, so
the other becomes invisible. That is a workaround, not the layout. (Measured correction: the
token-economizer has no browser half in this repository, so it never occupied that seat; the
pageerror recorded on 2026-11-05 came from a transient working tree.)

## 4. Composer chips — the shape

- Register in `conversation.input.right` with a provider-owned id.
- Gate rendering on the **provider id this package registers**, never on a model-id prefix.
- Render nothing when the provider has no usage in the current turn; leave no empty node.
- One chip per provider; the list slot is additive, so Antigravity + DeepInfra + OpenCode can coexist
  without priority tricks.

## 5. Sidebar / Settings

- Settings pages use `settings.section` (list) with a stable id and a locale-aware label.
- Model catalog/selection belongs in that settings page, not in the composer.
- Project-management surfaces use the sidebar/footer list seats (`sidebar.footer.action`,
  `sidebar.panellist.actions`) rather than a conversation slot.

## 6. Migration order (future work)

1. Measure and, if needed, add the host global-header list slot. — **pending; no longer urgent
   for a tk composer chip, because tk registers no composer surface** (its new developer-stats card
   uses `settings.section`).
2. Move `tk` to the global header; remove its `conversation.input.activity` registration; verify the
   ledger still updates. — **not applicable as written**: measured 2026-11-05, tk has no browser
   half and registers no slot. Re-scope this step only if tk ever adds a global monitor.
3. Move DeepInfra and OpenCode v2 chips to `conversation.input.right`; remove their `activity`
   registrations. — **done**: OpenCode v2 (verified in an isolated browser boot) and DeepInfra
   `0.0.1-rc.8` (isolated rc.1 boot: chip immediately left of the selector, 0 page errors, absent
   off-route). No track registers `conversation.input.activity` any more (measured).
4. Re-run the browser boot check and assert the single-slot pageerror is gone. — **done**: rc.1
   isolated boots report 0 page errors and no single-slot registration error.
5. Keep Antigravity on `input.right`; it is the reference implementation. — **done**

The composer migration is complete for every chip this workspace owns. The remaining "global header"
idea (step 1/2) is a tk design question, not a collision; it is parked until tk has a second
composer surface.

## 7. Related documents

- [PLUGIN-STYLE-STANDARD.md](PLUGIN-STYLE-STANDARD.md) — typography tokens.
- [dsh-antigravity/docs/ANTIGRAVITY-STAGE-PLAN.md](../dsh-custom-router/vendor/antigravity/docs/ANTIGRAVITY-STAGE-PLAN.md) — stage-1 gate for the first migrated chip.
- [dsh-opencode-v2/docs/OPENCODE-V2-STAGE-PLAN.md](../archive/dsh-opencode-v2/docs/OPENCODE-V2-STAGE-PLAN.md) — stage 2/3 work; this slot rule applies to
  the chip surface, not to the parser.
