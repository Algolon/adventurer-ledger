# Runefolio active mobile character sheet

## Purpose

The active sheet is an instrument panel for play, not a paper sheet squeezed onto a phone. It prioritizes “what can I do now?” and “what changed?” while keeping every number explainable.

## Sheet navigation

Five destinations are available inside a character:

1. **Play** — headline state, defenses, checks, favorite actions, resources;
2. **Actions** — attacks, actions, bonus actions, reactions, other;
3. **Spells** — prepared/known spells, slots and casting details when relevant;
4. **Inventory** — equipped state, items, currency, carrying information;
5. **More** — features, proficiencies, conditions, notes, build, history, export.

On compact phones, use a bottom tab bar with Play, Actions, Spells (conditional), Inventory, and More. If Spells is not relevant, keep four evenly spaced destinations; do not leave an empty slot. On desktop these become sections in a left/secondary rail and can compose into a dashboard.

## Play home

```text
┌──────────────────────────────────┐
│ ‹ Characters       Brammel   ⋯  │
│ Fighter 1 · 2024      Offline ✓ │
│                                  │
│  AC 16    Speed 30    Init +2   │
│                                  │
│ Hit points                       │
│  11 / 11   [Damage] [Heal]       │
│                                  │
│ Saves & checks                   │
│ STR +5  DEX +2  CON +4  [All ›] │
│                                  │
│ Favorite actions                 │
│ Longsword       +5 · 1d8+3   ›  │
│ Second Wind     1 / 1         ›  │
│                                  │
│ Conditions                  [＋] │
├──────────────────────────────────┤
│ Play  Actions  Inventory  More   │
└──────────────────────────────────┘
```

The top app bar remains compact. Offline-ready is a quiet icon/label, not a persistent toast. Missing-source or save-risk banners replace the secondary metadata row because they are more important.

## High-frequency interactions

### Checks, saves, initiative, and attacks

Tapping a rollable row opens a bottom sheet with:

- roll label and expression;
- advantage/normal/disadvantage segmented choice if relevant;
- situational modifiers;
- Roll and Copy expression actions;
- compact breakdown and source link.

The Brammel slice may omit animated dice, but the roll expression and result behavior must be specified and accessible. If random rolling is not implemented, the primary action is “Show roll” or “Copy expression,” never an inert Roll button.

### Hit points

Damage and Heal open numeric keypads with amount, optional note, and preview. Damage previews temporary HP consumption before current HP loss. Confirm shows the resulting value and an Undo snackbar. Raw Edit current/max HP is under Manage, not beside Damage.

At 0 HP, the play home replaces normal HP actions with death-save controls and Stabilize, according to the active ruleset. This is beyond the first Brammel implementation but the information architecture must reserve the state.

### Resources

Resource rows show name, current/maximum, reset cadence, and spend/recover buttons. Tapping the row opens description and history. A spend action that would go below zero asks for explicit override; it does not clamp silently.

### Rest

Rest is opened from the More/action menu. Choose Short rest or Long rest, review affected resources/HP/hit dice, then Apply. The preview lists changes and exceptions. Completion offers Undo. A rest is one transaction.

### Conditions

Add condition opens a searchable local list. Active conditions show source/ruleset and optional duration/note. Missing full text does not prevent tracking the condition label. Removing a condition is immediate with Undo.

## Action list

Group by action economy in the current ruleset. Each row contains:

- action name;
- attack/check/save expression;
- damage/effect summary;
- range/reach;
- resource or ammunition cost;
- source/manual/override indicator only when useful.

Default row tap opens detail; a dedicated roll/use button performs the high-frequency action. This avoids accidental resource expenditure when seeking rules text. Spending a limited resource is a separate confirmable step or an explicit combined “Use and spend” action.

Favorite actions can be pinned to Play. Pinning changes presentation only, not character mechanics.

## Spells

When relevant, the Spells tab contains:

- casting summary and save DC/attack modifier;
- slot/resource trackers;
- prepared/known filter;
- search and filters for level, casting time/action, concentration, ritual, and source;
- spell rows with essential play summary;
- detail drawer with full locally available text and provenance.

Prepared state is a build/session configuration distinct from slot expenditure. Changing prepared spells uses Edit mode and may create a character version according to ruleset policy. Casting a spell may spend a slot/resource but never toggles preparation.

## Inventory

Inventory prioritizes equipped items and consumables. Equip/unequip previews affected AC, attacks, speed, or other derived values. Quantity changes have Undo. Custom items remain usable when their source entry is absent; show the saved manual/snapshot fields and missing-source state.

## Details and explanations

Every headline value supports “Why this value?” with the same structure:

```text
Initiative +2
Base                    Dexterity modifier +2
Other modifiers                            +0
Override                                    —
Calculated under                   2024 core
```

Use a bottom sheet on phone and a dockable side panel on desktop. The browser Back action closes detail and returns to the prior scroll position. Full private text may be rendered to the user but must not be echoed into URLs, diagnostics, or accessibility labels beyond the visible user-authored title.

## Play versus edit affordances

| Intent | Play surface | Edit surface |
| --- | --- | --- |
| Take damage | Damage action | Edit current/max HP |
| Spend Second Wind | Spend/use | Change resource definition/override maximum |
| Equip shield | Equip toggle with preview | Add/delete/edit inventory item |
| Use an attack | Roll/use action | Edit manual attack or build choice |
| Read feature | Detail | Replace/manual/override feature choice |

Edit mode has a persistent “Editing character” indicator and exits through Review changes or Cancel. Runtime actions never open the full builder.

## Offline behavior

The active sheet, local details, mutable play state, and local history work offline after shell readiness. If a referenced full-text asset is not cached or a source is missing, show the compact saved summary and a Missing source state. Network loss during play is informational unless a requested action truly requires network.

Do not display an “Offline” error on every interaction. The global state should read:

- **Ready offline** — shell and local records available;
- **Offline** — currently disconnected, local functions active;
- **Not ready offline** — user should keep the app open online before relying on it.

## Save receipts and undo

Session mutations optimistically update only after the local transaction succeeds. The user sees a brief, non-obscuring receipt such as “3 damage applied · Undo.” If the write fails, restore the prior display, keep the intended mutation available for Retry, and announce the failure.

History records action type and timestamp without copying sensitive notes or full text into diagnostics. User-entered action notes remain private content.

## Incomplete and missing-source sheet

An incomplete but renderable character opens in Play with an issue banner and clearly unknown values. Unknown is displayed as `—`, not zero. Tapping it opens the missing inputs and Resume build action.

A missing-source character uses its last safe resolved snapshot where available and marks affected fields. It offers:

- Find/import source;
- Re-enable installed source;
- Preserve snapshot as manual value;
- Replace choice in Edit;
- Continue read-only where calculation safety is unknown.

No alternate source is matched by display name alone.

## Responsive behavior

| Width | Sheet composition |
| ---: | --- |
| 360 / 390 / 412 | One column; bottom tabs; full-width sheets; no horizontal document scroll |
| 768 | One or two columns by content; bottom tabs or compact rail; detail sheet up to readable width |
| 1024 | Two-column play dashboard; persistent secondary navigation optional |
| 1440 | Three-region composition possible: nav, sheet dashboard, docked detail |

All widths preserve the same task order. Long names wrap to two lines or truncate with accessible full name; numeric values never shrink below readable size. Cards and grid children use `min-width: 0`.

## Keyboard and screen-reader behavior

- Each roll/use control has an explicit verb and target, e.g. “Roll Longsword attack,” not “+5.”
- Resource controls announce current and maximum before the action.
- Changes use polite live regions; urgent save failure uses `role="alert"`.
- Bottom sheets trap focus, have a labelled heading, close on Escape, and restore focus to the invoker.
- Tab order follows visual task order; roving tab patterns are used only for true composite widgets.
- Keyboard users can perform every touch action; hover is never required.
