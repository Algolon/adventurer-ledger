# Caster spell selection

The vertical slice from `content → availability → owed choice → picker → persisted
selection → committed character → reopen/edit`. It is not a spellcasting engine:
nothing here casts, spends a slot, upcasts, scales a cantrip or enforces
concentration.

## What the audit found

The spell foundation stops one hop short of a decision. `BuildPlan.spellAvailability`
answers *what can this build reach*, and deliberately refuses to answer *what does
it have* — `known` and `alwaysPrepared` come from the grant side alone. Nothing
between those two facts existed: no content could say how many spells a caster
owes, no store held the player's answer, and the derived sheet listed granted
spells only.

Four things were missing, and one thing was already there.

**Already there.** The public schema can express the declaration. A `rule` entry
with `mechanics.kind === "spellcasting"` is parsed by the derived resolver through
a `.passthrough()` boundary schema keyed by `classId`, and `rule` mechanics are
`{ kind, data: Record<string, unknown> }`. So the counts fit inside content that
already validates. **No content-pack schema change is required**, and none is made.
What was missing was a *typed reading* of that data, shared by the planner and the
resolver so both cannot drift.

**Missing 1 — owed counts.** Class `progression` rows carry
`{ level, proficiencyBonus, featureIds, choiceIds, resourceChanges }`. There is no
row field for cantrips or spells known, so no activated content could state an
obligation. `multiclass.spellSlotProgression` exists (`none|full|half|third|pact`)
but describes slots, not selections.

**Missing 2 — a choice shape that fits.** `ChoiceDefinition` enumerates its
`options` explicitly, capped at 500. Expressing "choose 2 from the class list"
would mean authoring one option per spell per choice, it cannot express a spell-level
band, and it has no place to record whether the result is *known* or *prepared*.
Reusing it would also break every existing consumer: `edit-draft.offeredOptionIds`
and `ruleset-change.survivingSelections` validate stored values against enumerated
option IDs, so spell IDs stored there would be reported as no longer offered on
every reopen.

**Missing 3 — storage.** Neither `CharacterDraftBuild` nor `CharacterRecord` had a
field for player spell selections.

**Missing 4 — derived classification.** `DerivedSpell` had no state field, and
`DerivedSpellcasting.spells` was built from `ruleResult.spells` — granted only.

## The declaration

The existing `spellcasting` rule gains a `selections` array. Typed at the boundary
in `src/services/spell-selection.ts`, read by the planner and the derived resolver
from that one module.

```
{ kind: "spellcasting", data: {
    classId, ability, attackProficient, saveDcBase, slotResourceIds,
    selections: [{
      id,                       // stable; the key selections are stored under
      model: "known" | "prepared",
      label,                    // user-facing, from content
      spellListIds?,            // subset of reachable lists; absent = all reachable
      spellLevels?: { min?, max? },
      progression: [{ level, count, maxSpellLevel? }],
      grantedConsumesAllowance? // default false
    }]
} }
```

`progression` is cumulative and read as "the highest row at or below the character's
level". That is what makes a level 5 start owe its whole accumulated obligation in
one place instead of walking the user through four wizard pages, and what makes a
level decrease reduce the obligation without a second rule.

`maxSpellLevel` on a row is how a spell level becomes reachable. There is no slot
table in the engine and none is inferred: what the content does not say a character
can reach, it cannot reach. A row that omits it falls back to `spellLevels.max`, and
then to unrestricted.

Nothing in the engine or the UI branches on a class name, a source name or a
selection ID. A pack drives the whole behaviour through this declaration.

## Two generic casting models

**known-from-list.** `model: "known"`. The chosen spells enter the character's known
set. Proven by a fixture caster that owes cantrips and known spells on separate
progressions.

**prepared-from-list.** `model: "prepared"`. The chosen spells are currently
prepared. Proven by a second fixture caster whose prepared count changes with level.

**learned collection → prepared subset** is *not* implemented. It needs a durable
learned layer distinct from both availability and preparation, plus the rules that
move a spell between them. That is a subsystem, not a field, so it is documented
here as the next slice rather than forced into this one.

## Six facts kept apart

| Fact | Established by | Where it shows |
| --- | --- | --- |
| Available | reachable list membership | `SpellAvailability.spells` |
| Granted | `addSpell` | `AvailableSpell.known`, `DerivedSpell.granted` |
| Always prepared | `addSpell` with `alwaysPrepared` | `DerivedSpell.alwaysPrepared` |
| Player selected | a builder-owned selection | `build.spellSelections[selectionId]` |
| Known | selection with `model: "known"`, or a grant | `DerivedSpell.known` |
| Prepared | selection with `model: "prepared"`, or always-prepared | `DerivedSpell.prepared` |

Availability is never ownership. The derived sheet lists granted and selected
spells; a spell that is merely reachable is not on the character.

One canonical identity: a spell that is both granted and on a reachable list is one
row carrying both annotations, never two rows.

## Storage

`spellSelections: Record<selectionId, spellId[]>` on `CharacterDraftBuild` and
`CharacterRecord`. Its own field rather than a second meaning for `choiceSelections`,
for the consumer reason above, and keyed by selection ID so the model that governs
each answer travels with it.

Additive and non-indexed on both the `characters` and `characterDrafts` stores, so
no Dexie version bump and no migration: a record written before the field reads as
absent and normalises to `{}`.

The commit writes the *planner's* surviving selections rather than the draft's raw
store, so a spell the build can no longer justify cannot reach a durable record —
the same discipline `abilityScores` already follows.

It also crosses the transfer boundary: the field is on the export schema (optional,
so an older export still imports), participates in the character fingerprint (two
characters alike but for their spells are genuinely different), is compared as a set
rather than a sequence, and its spell IDs join the referenced-content set so a
transfer landing without them reports the gap instead of importing a shrunken
repertoire.

## Ownership and pruning

Selections are owned by the class whose declaration defines them, which is the same
ownership rule `background-change` already uses — *hiding is not removing*.

- **Class change** removes selections the outgoing class owned and the incoming one
  does not, deterministically and idempotently, leaving unrelated draft state alone.
- **Ruleset change** prunes through the existing two-phase preview, reporting each
  selection as retained or cleared alongside the choice and equipment verdicts.
- **Level change** is reported, not silently rewritten, matching the planner's
  existing treatment of a stored answer that stopped being legal: an obligation that
  shrinks, or a spell whose level is no longer reachable, becomes an unresolved
  selection the user repairs on the step that owns it.

## Validation

`fewer than N` is incomplete, `exactly N` satisfied, `more than N` rejected. The
issue is `SPELL_SELECTION_UNRESOLVED` against `spells-resources`; the user-facing
sentence is built from counts by the UI — *Choose 2 more cantrips* — never a code.

A granted spell does not consume the allowance unless the declaration says
`grantedConsumesAllowance`. An always-prepared spell cannot be deselected.

Flexible mode keeps its existing meaning: the step is optional for a flexible save,
exactly as every other step is.

## Cost

Selection planning reuses the `spellAvailability` the pass already computed. No
second index build, no second effect evaluation, and eligibility is resolved through
sets rather than a per-row scan of the catalogue. Search filters an already-planned
projection; it does not re-enter the rules engine.

## Out of scope, and unimplemented

Casting, slot expenditure, attack rolls, saving throws, damage, healing, conditions,
concentration, ritual casting behaviour, upcasting, cantrip scaling, target and area
templates, material-component inventory, summons, bestiary, GAP-014, complete
multiclass slot progression, Character Sheet redesign, spell Compendium redesign.

**Multiclass.** Selections carry their owning class, so a second caster class would
add its own obligations without disturbing the first. Combined multiclass slot
progression is not implemented and is not needed for selection to be correct.

**Dead record.** `CharacterSpell` in `src/domain/model.ts` belongs to the legacy
M1.4 `Character` model and is referenced nowhere. It is left untouched rather than
repurposed, so the M2.1 record stays the single durable shape.
