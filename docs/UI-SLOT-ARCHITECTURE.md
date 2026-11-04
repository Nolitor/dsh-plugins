# UI Slot Architecture — three tiers for DSH plugin surfaces

<!-- skeleton:
version: 1.0
kind: design
status: active
updated: 2026-11-05
summary: Owner-approved placement rule for token/usage surfaces — global header for the tk system ledger, conversation.input.right for per-provider composer chips, sidebar/settings for management — with the measured slot seats and the migration that removes the tk/deepinfra single-slot collision.
-->

> Status: **recorded 2026-11-05; not implemented yet.** This is the standard for the
> upcoming UI slot cleanup/advancement. It does not change any registration by itself.

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
| `tk` (token-economizer) | `conversation.input.activity` | single | owns the seat |
| `@nolit/dsh-deepinfra` | `conversation.input.activity` | single | attempts a second registration → pageerror |
| `@nolit/dsh-opencode-v2` | `conversation.input.activity` | single | attempts a second registration |
| `@nolit/dsh-antigravity` | `conversation.input.right` | list | already migrated; additive |

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

Do **not** solve this by giving `tk` and `deepinfra` different priorities in the single
`conversation.input.activity` seat: the slot contract says a single seat renders one occupant, so
the other becomes invisible. That is a workaround, not the layout.

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

1. Measure and, if needed, add the host global-header list slot.
2. Move `tk` to the global header; remove its `conversation.input.activity` registration; verify the
   ledger still updates.
3. Move DeepInfra and OpenCode v2 chips to `conversation.input.right`; remove their
   `activity` registrations.
4. Re-run the browser boot check and assert the single-slot pageerror is gone.
5. Keep Antigravity on `input.right`; it is the reference implementation.

No step is applied in this round. The live collision remains until steps 2–3 run; the S5 browser
checks document it as a pre-existing, non-Antigravity error.

## 7. Related documents

- [PLUGIN-STYLE-STANDARD.md](PLUGIN-STYLE-STANDARD.md) — typography tokens.
- [ANTIGRAVITY-STAGE-PLAN.md](ANTIGRAVITY-STAGE-PLAN.md) — stage-1 gate for the first migrated chip.
- [OPENCODE-V2-STAGE-PLAN.md](OPENCODE-V2-STAGE-PLAN.md) — stage 2/3 work; this slot rule applies to
  the chip surface, not to the parser.
