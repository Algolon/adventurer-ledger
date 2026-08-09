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
- limited-use resources.

**Item state is not in that list, and the omission is deliberate.** Equipping,
unequipping, attuning, consuming a charge and changing a quantity are all things
a player does during play and should be able to do here — but
`CharacterRuntimeService` has no operation for any of them, and the durable
record stores equipment as the bundle choices that produced it rather than as a
mutable inventory. A control on the sheet would therefore either write nothing or
create a second, private store of item state that no other surface reads. The
Inventory information architecture is built for those controls; the missing
capability is registered as GAP-006 in [`CURRENT.md`](../CURRENT.md) rather than
faked. The same applies to preparation: `alwaysPrepared` is a property of a
grant and is shown as one, and nothing prepares or unprepares a spell (GAP-007).

The boundary is stated as data, not only as prose, in
[`src/ui/sheet-scope.ts`](../../src/ui/sheet-scope.ts):
`SHEET_MANAGED_OPERATIONS` is keyed by `RuntimeOperation["kind"]`, so a new
runtime operation does not compile until somebody has decided where it belongs.

Permanent character data changes through exactly one **Edit character** action,
which opens the builder. The sheet carries no Override control, no Copy
expression control, no manual calculation editing and no ruleset switching. Where
a user might reasonably look for one, the surface says where it lives instead —
"Changing the hit point maximum is part of Edit character."

## Edit character

Edit character opens the builder on the character itself, not on a blank form
that happens to carry its ID. One draft exists per character, and pressing Edit:

- **hydrates** it from the committed record through a single conversion — name,
  nickname, class, level, subclass, species, background, ability scores and the
  origin split they were built from, every choice and equipment selection, manual
  values and actions, and the presentation mode;
- **scopes** it to the character's own ruleset, never the device-wide default;
- **resumes** an unfinished edit rather than replacing it, however many times the
  control is pressed;
- **records** the character revision it read, so a commit that would overwrite
  newer work is refused rather than applied.

Save & close keeps the draft and writes nothing to the character. Discard changes
throws the draft away and writes nothing either; the next Edit press hydrates
from the commit again. Completing Review updates the existing character in place:
the same ID, a new revision and version, no duplicate in the library.

A saved value the installed content can no longer confirm — an uninstalled class,
an option a pack stopped offering — is **kept and reported**, never cleared. The
builder names the step that can confirm it and says the value is still stored.

Play state is untouched by all of this. Opening, saving, discarding and
committing an edit leave hit points, temporary hit points, hit dice, inspiration,
exhaustion, death saves, conditions and spent resources exactly as they were,
except where a changed maximum moves a current value by the same delta.

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

Always visible without scrolling: name and nickname; class, subclass and level;
species; hit points and temporary hit points; armour class; initiative; speed;
proficiency bonus; conditions and exhaustion; inspiration; and death saves when
they apply.

```text
┌──────────────────────────────────┐
│ Brammel Voss “Boss”         [✎]  │
│ Vanguard 1 (Stonevigil) · River… │
│ [♡HP 7/10][AC 18][INIT +2][SPD  │
│  30][PROF +2]                    │
│ (✦ Inspiration)(Winded)(＋Cond.) │
├──────────────────────────────────┤
│ Overview Actions Inventory Char.  │
└──────────────────────────────────┘
```

All five vitals are one row. Hit points keep the widest column, because they are
the number that changes most and the control that is pressed most; the other four
are equal. At 320 px that is a 78 px hit-point tile and four 49 px tiles, every
one of them still a 44 px target.

Three things were removed from this block rather than restyled, and they are
worth naming because each was costing a phone screen:

- the second row of vitals, replaced by the single row above;
- the receipt line's reserved height. It is still a live region and still in the
  document — one that is removed and re-added may not announce — but an empty one
  now occupies no height and no gap;
- the word beside the Edit pencil, which said nothing the icon and its accessible
  name did not.

At 360 × 780 the block went from **265 px to 164 px**, and from 283 px to 164 px
for a level 12 character. `tests/e2e/sheet-ia-evidence.spec.ts` holds the ceiling.

### Density model

A section is **a heading over one bordered group**, not a card carrying its own
heading. The heading sits on the page canvas, the border wraps only the rows, and
the rows own their spacing. The previous model paid for a boundary, a heading row
and padding above and below it — around 60 px of chrome — for each of the five
groups a section routinely has.

Rows lead with a name and the number that name is for. An attack states what it
hits on beside its label rather than only inside its drawer, because that is the
question an attack row exists to answer.

### Primary sections

The section count stays small. There is no long section menu, and no section is
behind a swipe: the strip is a fixed grid of exactly as many equal columns as
there are sections.

1. **Overview** — abilities, saving throws and skills, each group stating how
   many of it the character is proficient in. Senses and movement modes join it
   when the generic model represents them; today it represents one Speed, which
   is already in the glance (GAP-008).
2. **Actions** — attacks, actions, bonus actions, reactions, and limited-use
   resources. Every group is present only if it has something in it.
3. **Spells** — present only when installed content declares spellcasting for one
   of the character's classes. When absent, the strip is four sections wide; no
   empty slot is left.
4. **Inventory** — equipped gear first, then carried. A row carries the facts
   that change how an item is used — armour contribution, attunement, rarity,
   quantity — and its description is one tap away in the item's own drawer rather
   than three lines deep on the row.
5. **Character** — progressive disclosure, described below.

The strip is a tab list: arrow keys, Home and End move between sections, and each
panel is labelled by its tab. Changing section is a page change: if the new
panel's first row would sit behind the app bar and the sticky strip, the page
scrolls up by exactly the amount that puts it below them, instantly and in a
layout effect. Somebody already at the top of a section is not moved, because for
them nothing is wrong.

### Spells at scale

A caster's repertoire is the part of a sheet that grows without limit. The
workspace is: casting ability, spell attack and save DC as three compact facts;
then the slot pools, one row each with a stepper; then the known spells grouped
by level.

Two rules keep that readable at thirty spells across six levels:

- **A shared recharge is said once.** When every resource in a group recharges
  the same way — which is exactly what a set of spell slots is — the cadence sits
  above the group instead of on all five rows.
- **A filter appears above a size, and on nothing else.** The rule is the spell
  count and nothing more: no public behaviour reads a class, a school or a
  spell's name. Below the threshold a filter would be a control with nothing to
  do.

Ritual, concentration and always-prepared are markers on the row when the content
declares them. Always prepared is read from the grant that gave the spell; being
on a reachable list is never a way to acquire it.

### The Character workspace

Everything durable about the build lives here, grouped by the thing that owns it
and **closed until asked for**. A level 12 character has fifteen features, and a
flat list of them is what a player has to scroll past to reach Level up.

Groups, each rendered only when it has content:

| Group | Contains | Collapsed summary |
| --- | --- | --- |
| Class & subclass | Class, subclass, level, hit dice, class features | `Bastionward 12 · Shieldwall · 15 entries` |
| Species | The origin and its traits | The species name |
| Background | The background and the feat it declares | The background name |
| Feats | Feats no background declared | A count |
| Features & traits | Anything granted that fits no clearer owner | A count |
| Proficiencies & training | Armour, weapons, tools and languages | A count |

A feat belongs to Background only when the background entry's own `featId` names
it. Every other active feat — a class boon, a level selection — is its own thing
and says so; filing them all under Background put class-owned choices under an
origin that did not grant them.

Each group header is a heading *and* a button, so it is both a landmark to
navigate by and a control to operate, and `aria-controls` names its panel only
while that panel exists. One group is open at a time. Below the groups sit
**Manage** — Edit character and Level up, with the one sentence that states the
boundary — and Restore points when the character has any.

At 360 px a closed Character workspace is **794 px of document for a level 12
character, down from 2314 px**.

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

### Rests

This is the whole rest contract. It is written down because "what a rest does"
is the sort of thing that otherwise gets filled in from memory of a published
edition, and the sheet applies only what this document states.

A **short rest** restores every resource whose content declares a `short-rest`
recharge, to its maximum. It changes nothing else: not hit points, not hit dice,
not exhaustion, not the death-save tally.

A **long rest**:

- restores every resource whose declared recharge is anything other than `none`;
- sets current hit points to the maximum and temporary hit points to zero;
- restores hit dice to the character's level;
- reduces exhaustion by exactly one level, never below zero;
- clears the death-save tally.

Both are one runtime action with an exact undo, so a rest taken by accident is
reversed to the state before it rather than approximated.

A **permanent edit is not a rest.** Committing a build change re-synchronises
runtime state against the new maxima using the preserve-expenditure policy in
D-08: current values move by the same delta as their maxima, and hit dice are
clamped to the character's level rather than refilled or emptied.

**Level up and Edit character treat hit dice differently, on purpose.** Level up
grants one hit die (`hitDiceRemaining + 1`) — D-08's preserve-expenditure policy
applied to the pool, matching how it moves hit points and resources when their
maxima rise. Edit character grants none: a build correction is not advancement,
so it only clamps. Neither path refills a spent pool, and neither empties one.

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
