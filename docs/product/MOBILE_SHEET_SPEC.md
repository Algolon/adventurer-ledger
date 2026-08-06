# Runefolio play-first character sheet

The reasoning behind this specification, with screenshot evidence, is in
[`PLAY_SHEET_RATIONALE.md`](PLAY_SHEET_RATIONALE.md). Runtime, dice-expression
and renderability decisions follow [`M2_DECISIONS.md`](M2_DECISIONS.md).

## Purpose

The sheet is a clean, flexible paper sheet for play, not a rules-engine console.
It answers "what is true right now?" and "what can I change this session?" while
keeping every number explainable in plain words.

D&D Beyond is reference for **information grouping only**. Minimal Character
Sheet is reference for **restraint and glanceability only**. Neither is imitated
visually; the visual language is the existing Runefolio identity, simplified for
phone use.

## The interaction boundary

The sheet is **Play mode**. It may directly change only transient session state:

- current and temporary hit points;
- hit dice;
- death saves;
- conditions and exhaustion;
- inspiration;
- spell slots;
- limited-use resources;
- item quantities, where the runtime service supports them.

Permanent character data changes through exactly one **Edit character** action,
which opens the builder. The sheet carries no Override control, no Copy
expression control, no manual calculation editing and no ruleset switching. Where
a user might reasonably look for one, the surface says where it lives instead —
"Changing the hit point maximum is part of Edit character."

## Technical presentation

The character library and the sheet never display an active ruleset, an internal
ruleset, source or pack ID, an issue code, a raw expression,
calculation-engine terminology, or a technical provenance string. Content
management stays available under Settings.

Human-readable calculation breakdowns are shown in the details drawer: named
inputs with signed amounts, never console output.

A state badge appears on a library row only when it carries information —
`Manual`, `Incomplete`, `Missing source`. The nominal automatic state is
unlabelled.

## Structure

### Glance header

Always visible without scrolling: name; class, subclass and level; hit points
and temporary hit points; armour class; initiative; speed; proficiency bonus;
conditions and exhaustion; inspiration.

```text
┌──────────────────────────────────┐
│ Brammel Voss              [Edit] │
│ Vanguard 1 · Riverborn           │
│ ♡ HIT POINTS   7 / 10            │
│ [AC 18][INIT +2][SPEED 30][+2]   │
│ (✦ Inspiration)(Winded)(＋Cond.) │
│ Inspiration gained.       [Undo]  │
├──────────────────────────────────┤
│ Overview Actions Inventory Char.  │
└──────────────────────────────────┘
```

Hit points take a full-width tile and the largest numeral on the sheet. The
other four values sit in one row of equal tiles. Transient state is a chip row
below them, so a condition is read in the same glance as the hit points it
affects.

### Primary sections

The section count stays small. There is no long section menu.

1. **Overview** — abilities, saving throws, skills, and (when content models
   them) senses and defences.
2. **Actions** — attacks, actions, bonus actions, reactions, and limited-use
   resources.
3. **Spells** — present only when installed content declares spellcasting for one
   of the character's classes. When absent, the strip is four sections wide; no
   empty slot is left.
4. **Inventory** — equipped gear first, then carried, and (when stored) currency
   and attunement.
5. **Character** — identity, features, traits, proficiencies, restore points,
   and the Edit character and Level up actions. Notes and creatures join this
   section when durable fields exist for them.

The strip is a tab list: arrow keys, Home and End move between sections, and
each panel is labelled by its tab.

## High-frequency interactions

### Hit points

Tapping hit points opens a drawer with an amount stepper, a live preview of both
outcomes, and Damage, Heal and Set temp. Damage consumes temporary hit points
before current. Hit dice spend and recover from the same drawer, as do Short rest
and Long rest. Undo sits beside them. Editing the maximum is not here; it is
Edit character.

At 0 hit points the sheet grows a Death saves card with three-pip success and
failure tallies and a Reset control. Regaining hit points above 0 clears the
tally in the same transaction.

### Resources and spell slots

Rows show name, current over maximum, and recharge cadence in words ("Back on a
long rest"). A − / + stepper spends and recovers one at a time and is disabled at
its bound rather than clamping silently. Slot resources declared by the
spellcasting content render in Spells; everything else renders in Actions.

### Conditions, exhaustion and inspiration

Inspiration is a toggle chip in the header carrying `aria-pressed`. Active
conditions are chips that open their description and a Remove control.
`＋ Condition` opens a drawer listing exhaustion with a stepper and the
conditions the ruleset can track. Missing full text never prevents tracking a
condition label.

### Rollable values

Tapping a value or an action opens its details drawer. M2.1 shows no random
result, no roll history and no roll expression, and therefore no control
labelled Roll and no Copy expression control. The drawer explains the number.

## Details drawer

Every headline value opens the same structure — a bottom sheet on phone, a
centred modal from 960 px:

```text
Armour class            18
Travel Mail                            +14
Dexterity modifier (capped at +2)       +2
Round Guard                             +2
```

Named inputs, signed amounts, no IDs, no ruleset, no paths. Drawers trap focus,
close on Escape, and restore focus to the invoker. Unknown values render `—`
with the action that would resolve them.

Full private text may be rendered to the user but must not be echoed into URLs,
diagnostics, or accessibility labels beyond the visible user-authored title.

## Save receipts and undo

A session mutation updates the display only after the local transaction
succeeds, then posts a short receipt — "Took 4 damage. Now 6 hit points." — with
Undo beside it. If the write fails, the prior display is restored and the failure
is announced. History records action type and timestamp; user notes stay private
and are never copied into diagnostics.

## Incomplete and missing-source sheets

An incomplete but renderable character opens with a banner in plain words and
`—` for what cannot be calculated, never zero. A missing-source character uses
its last safe resolved snapshot where available, says that affected values are
uncertain, and points to Settings. No alternate source is matched by display name
alone, and nothing is substituted silently.

## Responsive behaviour

| Width | Composition |
| ---: | --- |
| 360 / 390 / 412 | One column; abilities three-across; sticky section strip; drawers as bottom sheets; no horizontal document scroll |
| 600+ | Abilities six-across; hit points and the four tiles share one row |
| 960+ | Section strip static; drawers become centred modals; primary navigation becomes a side rail |

All widths preserve the same task order. Long names wrap or truncate with an
accessible full name; numeric values never shrink below readable size. Cards and
grid children use `min-width: 0`.

## Keyboard, screen reader and colour

- Every action names its verb and target: "Apply 4 damage to Brammel Voss", not
  "−".
- Resource controls announce current and maximum before the action.
- Proficiency is a filled dot *and* part of the accessible name, so it survives
  forced-colors mode.
- Receipts use a polite live region; missing-source and incomplete banners use
  `role="alert"`.
- Touch targets are at least 44 CSS px; play actions and steppers are 48.
- Tab order follows visual task order. Keyboard users can perform every touch
  action; hover is never required.
- The sheet ships a real dark scheme. All sheet colour resolves through
  sheet-scoped custom properties, and the dark block restates every one, so no
  dark surface inherits a light-assuming foreground.

## Offline behaviour

The sheet, local details, session state and local history work offline after
shell readiness. Global state reads as **Ready offline**, **Offline**, or **Not
ready offline**. Network loss during play is informational; no interaction shows
an offline error unless it truly requires the network.
