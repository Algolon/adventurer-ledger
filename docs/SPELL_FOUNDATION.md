# Spell foundation

Three capabilities the engine needed before spell content can be authored in
bulk. Everything else about spells — casting, preparation, scaling, slots,
saves, damage, concentration — is deliberately out of scope and unimplemented.

## A. Category reachability

**The defect.** `RulesetProfile.allowedCategories` is a filter applied on top of
membership, in `scopeEntriesToRuleset`. It is written when a profile is created,
from the categories the pack shipped that day. A pack that later starts shipping
a category it never had installs entries the profile's membership matches and
its category list rejects: the import reports success, the entries are on the
device, and nothing can reach them.

Two kinds of profile exist, and only one was already handled:

| Profile | Membership | Categories before | Categories now |
| --- | --- | --- | --- |
| Explicit (`allowedEntryIds` set) | Advanced on update | Replaced with the pack's | Unchanged, plus `addedCategories` reporting |
| Source-scoped (no `allowedEntryIds`) | Already covers new entries | **Never advanced** | Union with the pack's |

**The fix.** `reconcileRulesetMembership` no longer declines a source-scoped
profile. It advances the two fields a source scope does not already cover, by
union and never by replacement:

- `allowedCategories` gains what the pack now ships and loses nothing, because
  such a profile reaches more than its own pack and a category it drops may be
  the only route to some other installed entry;
- `activeSourceIds` gains any source the pack has grown into, so the same bug
  cannot recur one level up.

An empty `allowedCategories` means *no filter* and is left empty. No
`allowedEntryIds` is ever written, because converting a source scope into a
snapshot would drop everything the profile reaches outside this pack.

Nothing names a pack, a source or a category. Writing the contract surfaced an
instance of the same defect in the repository's own seed: `SYNTHETIC_RULESET`
omitted `lineage` while the pack it seeds ships a lineage entry, so that entry
had been unreachable since the seed was written. The seed is now correct, and a
test compares its declared list against what the pack actually ships.

**Not addressed.** A profile that two installed packs could both claim is still
left alone, by the existing ownership rule — see
`docs/product/M2.1A_DEFERRED_DESIGN_NOTES.md`.

## B. Spell-list expansion

Content could already say `class → addSpellList → spell-list → spellIds`, and
the rules engine already collected granted list IDs into `RuleResult.spellLists`.
Nothing read the last hop, so making a spell offerable meant one `addSpell`
effect per spell — roughly a thousand redundant grants for a real catalogue.

**The seam.** Two new modules, both pure:

- `src/services/spell-list-index.ts` — the membership relation, built once per
  pass. It reads *both* directions the schema allows (`spell-list.spellIds` and
  `spell.spellListIds`), because both are legal and reading one silently loses
  whatever the other declares. It lives in its own module behind a factory for
  the same reason `planning-context` does: "built once per pass" is then a
  contract a test can hold.
- `src/services/spell-availability.ts` — the projection. `SpellAccess` is
  structurally satisfied by the engine's own `RuleResult`, so the engine stays
  the single place that decides whether a level-gated or conditional effect
  applied.

`planSpellAvailability` is the builder's entry point and appears on `BuildPlan`
as `spellAvailability`. Content with no spell-shaped effect in the activated set
pays for one scan of those effects and nothing else — no evaluation, no index.

**Three facts kept apart.**

| Fact | Established by | Where it shows |
| --- | --- | --- |
| Access to a list | `addSpellList` | `SpellAvailability.listIds` |
| Membership of a spell in a list | Content declaration | `AvailableSpell.viaListIds` |
| Knowing a spell | `addSpell`, or a later selection | `AvailableSpell.known` |

`known` and `alwaysPrepared` are taken from the grant side alone. Reaching a
list can never set either, and `DerivedCharacterSheet.spellcasting.spells` — the
answer to "what does this character have" — is unchanged and still lists only
granted spells.

A spell a reachable list names but the ruleset does not define is reported in
`missingSpellIds` rather than dropped, so a pack that references content it does
not ship is visible as a defect instead of a short list.

## C. Ritual metadata

`SpellDefinition.mechanics` gains `ritual: z.boolean().default(false)`. Typed and
defaulted rather than optional, so the answer is never "the record does not
say": a record written before the field existed keeps validating and reads as
`false`. Surfaced on `DerivedSpell.ritual` and `AvailableSpell.ritual`, and read
at boundaries through `spellIsRitual`.

It is metadata. No ritual-casting rule and no ritual UI is implemented.

**Not `material`.** No generic `material: boolean` is introduced here. Two
distinct concepts exist — a spell having any material component, and a class
table specially marking a narrower subset of material requirements — and
collapsing them into one boolean would bake a guess into stored content. The
richer component model belongs to later spell-authoring work.

## Complexity

`tests/spell-expansion-complexity.test.ts` counts one index build and one effect
evaluation per planning pass, holds both counts identical between a four-spell
and a four-hundred-spell ruleset, and asserts that content without spell effects
builds no index at all.

## Out of scope, and unimplemented

Spell-owned `effects[]` execution, `scaling` runtime consumption, cantrip
scaling, slot-level upcasting, attack rolls, saving throws, damage, healing,
temporary hit points, conditions, target and area templates, concentration
enforcement, casting-action enforcement, detailed material-component mechanics,
costly or consumed material inventory, summons, bestiary, preparation limits,
and any caster UI redesign.
