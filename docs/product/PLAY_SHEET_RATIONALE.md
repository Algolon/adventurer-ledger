# Play-first character sheet — first iteration

This is the UX rationale for the first play-first Runefolio sheet, with the
screenshot evidence it was reviewed against. It records the decisions and the
reasoning; [`MOBILE_SHEET_SPEC.md`](MOBILE_SHEET_SPEC.md) is the specification
those decisions produced.

## The problem this iteration fixes

The previous sheet was a correct rules console. Every number carried its
provenance, and the interface said so: an Override editor on each value, a
`Copy expression` control on each attack, contributor rows tagged with engine
kinds and source IDs, and a footer reading `Active ruleset … · sources
source:runefolio-synthetic · values calculated locally`.

That is the right amount of rigour and the wrong amount of vocabulary. At the
table nobody needs to be told which pack a number came from; they need to find
the number, and change the small set of things that move during a session. The
console framing also blurred a boundary that matters: durable build data and
transient session state were edited from the same rows, so "take 4 damage" and
"change my maximum" looked like sibling actions.

## What changed

**Play mode is the sheet, and it is bounded.** The sheet writes only session
state — current and temporary hit points, hit dice, death saves, conditions,
exhaustion, inspiration, spell slots and limited-use resources. Everything
permanent goes through one **Edit character** action that opens the builder.
That boundary is now visible rather than implied: the hit-point drawer says
"Changing the hit point maximum is part of Edit character," and Inventory says
the same about equipping items, instead of offering an editor that quietly
rewrites the build.

**Technical presentation is gone from the sheet and the library.** No `Active
ruleset` footer, no pack, source or ruleset IDs, no issue codes, no expressions,
no contributor-kind labels, no calculation-engine terminology. Content
management is unchanged and still lives under Settings, where a user who wants
to think about packs can. The library rows lost their `runefolio-2024-synthetic`
line and their always-on `Automatic` badge; a badge now appears only when
something needs attention — `Manual`, `Incomplete`, `Missing source` — because a
state chip that is always present carries no information.

**Explanations stayed, in plain words.** Every headline value still opens a
details drawer, but the breakdown reads like a person explaining it: `Travel
Mail +14`, `Dexterity modifier (capped at +2) +2`, `Round Guard +2`. Same
resolver, same trace, no engine vocabulary. Unknown values still render `—` with
the action that would resolve them, never a zero.

**Five sections, and Spells only when it is real.** Overview, Actions, Spells,
Inventory, Character. Spells is present only when the installed content declares
spellcasting for one of the character's classes — the Fighter fixture has no
Spells tab at all rather than an empty one, and the tab strip stays four wide
instead of leaving a hole. Sections with nothing trustworthy to show say so;
nothing is filled with an invented value.

## Why this shape

**The glance header answers "what is true right now?" without scrolling.**
Name, class and level, hit points, AC, initiative, speed, proficiency, then
conditions, exhaustion and inspiration as chips. All five vitals are one row:
hit points keep the widest column, because they are the number that changes most
and the control that is pressed most, and the other four are equal because they
are read rather than edited. The chip row is where transient state lives, so a
condition and an exhaustion level are visible in the same glance as the hit
points they are affecting.

That row used to be two, and the block used to be a third of a phone screen
before anything the user opened it for. What replaced it, what it now measures,
and the before-and-after captures are in
[`SHEET_IA_EVIDENCE.md`](SHEET_IA_EVIDENCE.md).

**Session actions are one tap from the value they change.** Tapping hit points
opens a drawer with amount, a live preview of both outcomes, Damage, Heal, Set
temp, hit dice, rests and Undo. Resources and spell slots use inline − / +
steppers, disabled at their bounds instead of clamping silently. Every mutation
posts a short receipt — "Took 4 damage. Now 6 hit points." — with Undo beside
it, so the sheet confirms what happened rather than requiring the user to
re-read the number and infer it.

**Reference material is a row you can open, not a wall.** Actions, spells and
features are rows with a name and the one or two facts you scan for; the rest is
behind the row. That keeps five sections navigable on a phone without the long
section menu the reference products use.

**A character is bigger than a screen, so Character is a set of closed doors.**
Class & subclass, Species, Background, Feats and Proficiencies & training arrive
collapsed, each stating what is inside it. A twelfth-level character has fifteen
features; a flat list of them is the thing a player scrolls past on the way to
Level up rather than the thing they came for. Sizes and reasoning:
[`MOBILE_SHEET_SPEC.md`](MOBILE_SHEET_SPEC.md).

**Dying is a state, not a negative number.** At 0 hit points the sheet grows a
Death saves card with three-pip success and failure tallies, and healing above 0
clears the tally in the same transaction rather than leaving it to reappear.

## References, and what we did not take

D&D Beyond was read for *information grouping* only: which facts belong
together, and roughly in what order a player looks for them. Its long section
menu, its density and its visual language were not taken. Minimal Character
Sheet was read for *restraint* — how few controls a sheet can carry and stay
useful, and how much can be deferred to a detail view. Neither product's look
was imitated. The visual language is the existing Runefolio identity —
midnight ink, warm parchment, burnished gold, Georgia display type — simplified
for a phone: fewer borders, larger numerals, more space between groups.

## Accessibility and responsiveness

- Tap targets are at least 44 CSS px; play actions and steppers are 48.
- The section strip is a real tab list: arrow keys, Home and End move between
  sections, `aria-selected` tracks the active one, and each panel is labelled by
  its tab.
- Every control names its verb and its target: "Apply 4 damage to Brammel Voss",
  "Spend one Rune slots, 2 of 2 left" — never a bare "+".
- Proficiency is a filled dot *and* part of the accessible name, so it survives
  forced-colors mode where the dot's colour does not.
- Drawers trap focus, close on Escape, and restore focus to the control that
  opened them.
- Receipts announce through a polite live region; the missing-source and
  incomplete banners use `role="alert"`.
- The sheet ships a real dark scheme rather than inheriting a light one. Sheet
  colour is read only through sheet-scoped variables, and the dark block
  restates every one, so no dark surface can end up with a light-assuming
  foreground — the failure mode that once made typed text invisible.
- Verified at 360, 390 and 412 px with no horizontal document scroll; abilities
  go three-across on a phone and six-across from 600 px, and the tab strip stops
  being sticky once the layout has room.

## Evidence

Captured by `node scripts/capture-sheet-screens.mjs` against a running dev
server, driving the real builder to create both fixtures — no seeded state.

Six screens are captured at each of four review contexts — 360 px light, 390 px
light, 390 px dark and 412 px dark — as `<screen>-<theme>-<width>.png`. The same
two characters and the same mid-session state run through every one, so a
difference between two files is a difference in the surface and not in the data.

| Screen | What it shows |
| --- | --- |
| `fighter-overview-<theme>-<width>.png` | Fighter fixture mid-session: 7/10 hit points, Winded, inspiration held, Overview |
| `fighter-actions-<theme>-<width>.png` | Attacks and the limited-use resource with its steppers |
| `fighter-hp-drawer-<theme>-<width>.png` | The hit-point drawer: amount, preview, hit dice, rests, Undo |
| `fighter-character-<theme>-<width>.png` | Features, proficiencies, and Edit character beside Level up |
| `caster-spells-<theme>-<width>.png` | Casting facts, rune slots after one is spent, spells by level |
| `edit-character-<theme>-<width>.png` | Edit character opened from the sheet: the committed name prefilled, the character's own ruleset selected, **0 issues** |
| [`library-light-360.png`](play-sheet/library-light-360.png) | The library with no ruleset ID and no always-on state badge |

The Edit character screens are the evidence for this iteration's fix. They are
reached by pressing the real control on a character that was built through the
builder minutes earlier, so a prefilled field in them is prefilling actually
happening — not a fixture drawn to look like it.

The two fixtures are original synthetic content written for this repository: a
martial **Vanguard** (Brammel Voss) and a **Runecaller** caster (Sereth Marsh).
Their reference numbers are recorded in `src/content/runefolio-synthetic.ts` and
asserted end to end.

## Deliberately still open

This iteration fixes the information architecture and renders what the engine
can already be trusted for. It does not close:

- **Attack derivation from carried equipment**, Extra Attack, or attack counts.
- **Casting behaviour beyond slots and a declared summary.** Prepared-versus-
  known, upcasting and concentration tracking are not modelled; concentration is
  shown as a property of a spell, not as a state the sheet holds.
- **Currency and attunement in Inventory.** Both are named in the specification
  and neither is stored yet, so neither is displayed — a currency row reading 0
  gp would be an invented value.
- **Senses and damage defences in Overview.** Same reason: no content models
  them yet.
- **Notes and creatures under Character.** No durable field exists for either.
- **Item quantity editing from the sheet.** Quantities render, and changing them
  stays in Edit character until the runtime service owns that mutation.
