# Current state

The application is presented as Runefolio. Its deterministic vector identity,
favicon and complete `any`/`maskable` PWA icon sets are documented in
[`BRAND.md`](BRAND.md); technical installation and local-storage identities stay
unchanged.

Runefolio has one theme (dark), one scroll axis (vertical) and one phone
orientation (portrait). Those rules, what enforces each of them and the
accessibility tradeoff portrait-only operation creates are stated in
[`MOBILE_VISUAL_CONTRACT.md`](MOBILE_VISUAL_CONTRACT.md), which also carries the
physical-Android checklist the emulated suite cannot replace.

## Pilot status

`main` represents the current **workable pilot prototype**, not a feature-complete
product. Development has deliberately moved from foundation-first to iterative
physical-device testing: the branch is merged so the pilot can be installed and
used on a real phone, and the gaps below are then found against something that
runs rather than predicted against something that does not.

Read the two lists as a single statement. The first is what a pilot can rely on;
the second is what a pilot will hit, stated so nobody has to discover it by
being surprised. Nothing in the second list is finished, partially finished, or
scheduled here.

### Ready for pilot

- **Private pack import.** A real pack installs through the file input, becomes a
  selectable ruleset in the same confirmation, and is available immediately
  afterwards with no reload and no Settings detour.
- **Direct and sequential creation.** A character can be created straight at a
  target level, or built up one level at a time, with every level's choices
  resolved in one pass.
- **Ruleset selection.** Every installed profile is offered explicitly; nothing
  is chosen by list order, and switching one build's ruleset never silently
  repoints the device default.
- **Mobile creation navigation.** The creation task is operable at 320–412 CSS
  px: the primary navigation is hidden while the task owns the surface rather
  than being covered by it, and the task carries its own Save & close. Step
  changes are page-like — the next step is painted at its top with no visible
  scroll travel — and the mode, discard and exit controls share one compact row.
- **Workspace changes are page changes.** The same rule applies one level up,
  between whole surfaces rather than only between creation steps: committing
  from a part-scrolled Review opens the sheet at the sheet's own top, and moving
  between Characters, Sheet, Compendium and Settings does the same. Nothing
  animates on the way.
- **Compact choices with full-size targets.** An option row is visually about a
  fifth shorter than it was, and its title sits a step below the legend that
  owns it, while the row itself stays a 44 px target. The target contract is
  measured on every control on the screen at 320–412 px, not sampled.
- **Licensed display type, as an enhancement.** Bookmania and Modesto arrive
  from a hosted Adobe Fonts web project and carry the wordmark, page and step
  titles, character names and section headings. Nothing is self-hosted and
  nothing depends on them loading; the fallback is a local serif and the layout
  is specified against it. See [`BRAND.md`](BRAND.md).
- **A character sheet that holds at level 12.** The glance header is 164 px
  rather than 265, Character is a set of closed groups rather than five open
  cards, and a twelve-level character's Character workspace is 794 px of document
  rather than 2314. Every section still fits at 320–412 px with no swipe and no
  control under 44 px, with or without the webfont. Before-and-after evidence is
  in [`product/SHEET_IA_EVIDENCE.md`](./product/SHEET_IA_EVIDENCE.md).
- **Global destinations.** Characters, Sheet, Compendium and Settings are the
  four items of the bottom bar. Entering Settings pushes one history entry, so
  the Android Back gesture returns to the screen it was entered from rather than
  closing the app.
- **Save, close and resume unfinished drafts.** Closing waits for both the
  pending edit and the step-position write, the draft is listed under Unfinished
  builds, and resuming returns to the same step with every value intact.
- **Committed sheet viewing.** A committed character opens to its active sheet
  with derived values resolved from its own ruleset.
- **Hit points and armour class for the validated case.** Per-level Constitution
  application and armour-dependent bonuses are correct and regression-tested for
  the cases in the engine-correctness slice.

### Known pilot limitations

These are **open**, not delivered. A pilot will meet them.

- **Editing a committed character does not hydrate the draft yet.** Choosing to
  edit opens an empty draft rather than one populated from the character.
- **Equipped weapons do not yet fully generate attacks.** Attack entries are not
  derived from what the character is actually carrying.
- **Extra Attack is not represented.** No attack-count progression is applied.
- **Weapon mastery is not shown against attacks.** A mastery may be selected and
  recorded, but it is not surfaced on the attack it modifies. The resolver
  attaches `masteryId` to the action; nothing resolves it to a label.
- **Item state is read-only on the sheet** (`SHEET-GAP-ITEM-STATE`). Equip,
  unequip, attune, consume and charges have no runtime operation and no durable
  store.
- **Spell preparation does not exist** (`SHEET-GAP-SPELL-PREPARATION`). Only a
  grant's own `alwaysPrepared` is shown; nothing prepares or unprepares a spell,
  and creation has no spell-selection step.
- **Play-sheet rapid-tap handling remains open.** Fast repeated taps on runtime
  actions are not yet debounced or coalesced.
- **Physical Android install, offline and storage behaviour remain unverified.**
  Everything above was verified in Chromium at phone widths. Browser emulation is
  not evidence of handset behaviour: install, relaunch, offline operation and
  storage eviction on a real device are untested.

## Creation information architecture

Creation asks one conceptual question per step, and each selectable option
explains itself where it is chosen rather than producing unexplained follow-up
controls on a later screen.

**The sequence.** Basics, Class & level, Species, Background, Abilities, Class
choices, the conditional Spells & resources, Equipment, Identity, Review.
Species and Background were one `Origin` step that combined both decisions and
every choice either of them owned.

**Draft compatibility.** The species step keeps the storage ID `origin`. IDs are
storage identities and labels are presentation, so relabelling `origin` to
Species and adding a new `background` ID after it is not a migration: a draft
written before the split holds `lastStepId: "origin"` and resumes on Species
untouched. A draft that has never seen `background` has simply not reached it,
which is how every unvisited step already behaves.

**Ownership is typed, never nominal.** A decision belongs to Species because a
species, species-trait or lineage-trait activation route reached the entry that
declares it, and to Background because a background or background-feat route
did. An entry activated by a selected option inherits its owner's step, which is
what keeps a lineage's own follow-up decision on Species. Nothing is matched by
display name, and lineage replacement stays governed by `replacesTraitIds`.

**Progressive disclosure.** Class, Species and Background share one selection
component. Before selection each option is a compact row — name, its own
summary, and at most four at-a-glance facts read from typed mechanics. On
selection it expands in place with What you get, Choices to make, At your
starting level and a More details disclosure; empty sections are omitted
entirely, so an option with nothing to decide shows no empty Choices heading.
Exactly one option is expanded, because exactly one can be selected. The row that
was pressed is held at its viewport position while the panel grows, including the
second growth when the plan supplies the nested decisions. Facts are omitted
rather than invented when mechanics do not parse, and no raw ID, effect
expression or issue code reaches the screen.

**Automatic and manual benefits are distinguished** from the entry's own typed
effect dispositions, so a trait carrying `manualAdjudication` is labelled for the
table rather than listed beside the ones the engine applies.

**Review names the two origins separately** and states each ability as base, the
increase the background authorised, and the total — the same three concepts the
Abilities step presents, in the same order, and taken from the planner so they
are the numbers the commit will actually write. No identifier, issue code or
effect name reaches the screen: an unmapped diagnostic renders as a plain
sentence, and a selection whose content is no longer installed says so rather
than printing its stored ID.

**Species and Background remain in the sequence for a manual sheet**, and raise
no issue there. They are not empty in manual mode — they offer the same real
content, and a hand-built character may legitimately record an origin — so
dropping them would remove a capability and would require deciding that a manual
sheet has no origin at all. That is a manual-sheet IA decision rather than a
consequence of splitting the origin step, and it is deferred.

**The chosen increase distribution is derived, not stored.** With nothing placed
every distribution fits equally and the inference settles on the declared
default, so choosing a shape and reloading before allocating anything shows the
default again. No allocation is lost, because none was made; storing the shape
would create a second source of truth that could disagree with the increases
beside it.

### Alternative ability-increase distributions (GAP-003)

`abilityScoreChoices` gains an optional `increasePatterns`, a list of legal
distributions such as `+2/+1` across two abilities or `+1/+1/+1` across three.
It is additive: `increasePattern` remains required and still means the default,
consumers read `increasePatterns ?? [increasePattern]`, and every pack and draft
written before it behaves exactly as it did. Which distribution a draft is in is
inferred from the allocation itself rather than stored, so no separate field can
disagree with the increases beside it; ties resolve deterministically by
declaration order. An unoffered ability, a `+2/+2`, or an amount the chosen
distribution has no slot for is reported and excluded from the final scores.
Base scores stay separate from origin increases throughout. Abilities presents
the alternatives as plain shapes — "+1 to three abilities" — and addresses
increase slots by position, so a distribution with repeated amounts works.

### Stale background-owned state (GAP-005)

Replacing a background removes what the outgoing one owned instead of leaving it
unreachable in the draft: its nested answers, the equipment choices inside the
kits it granted, and any increase the incoming background does not authorise.
Ownership is computed by walking the same typed structure the activation planner
walks. An ID both backgrounds own is left alone, because that answer is still
authorised. Species, class, base ability scores, identity and everything else are
untouched. The prune is deterministic and idempotent, and it runs at the draft
service boundary that performs the write, so every route to a background change
gets it. Grants are not pruned because grants are not stored — they are derived
on every read.

## Second physical-device corrective pass

Everything in this section comes from a Samsung Galaxy S23 session after PR #18.
Each item is a defect a real handset showed and Chromium at the same width did
not.

**Step transitions are page-like.** The previous pass reset the scroll position
between steps but animated it, so Continue read as the *old* step scrolling away
rather than as navigation. The reset now runs in a layout effect — after React
swaps the step in and before the browser paints, so the new step's first painted
frame is already at its top — and it is instant rather than smooth. Focus still
moves to the step heading with `preventScroll`, and a validation failure still
keeps focus on the error summary. `tests/e2e/step-scroll-focus.spec.ts` records
every scroll position the viewport visits and fails if any of them is between
the old offset and the top; before the change it visited nineteen.

**Guidance no longer changes the shape of what it guides.** The "Recommended"
badge was a third column in the option row's grid, so guided mode gave the
at-a-glance facts about 110 px less width than flexible mode and labels such as
"Saves" and "Primary" wrapped. The badge has moved out of the row's layout
entirely, into the meta line guided mode was already adding for "Why this?"; the
card carries a non-flow brass edge so the recommendation stays scannable, and
the option announces it through `aria-describedby`. Guided and flexible now
measure identically, which is what `tests/e2e/guidance-stability.spec.ts`
asserts — box by box, not by screenshot.

**The builder's utility row is one compact row.** `Guided|Flexible`, `Discard`
and `Save & close` at 13 px with 44 px targets intact. The mode control is two
segments rather than one button whose label was the mode it was in: both labels
are always rendered, so the control is a fixed width and changing mode moves
nothing. At 320 px an editing session's three controls wrap rather than
overflowing.

**Mobile density.** Secondary text is one step below body (16 → 14 px), the step
title is 21 px rather than 26, and card padding and stack gaps are tighter
throughout the creation surfaces. Nothing else shrank: headings, values and
every control keep their size and their 44 px minimum. At 360 px the Class step
went from 1268 px of document to 1028, and its first option card from 203 px to
124. `tests/e2e/mobile-density.spec.ts` holds the ceilings and re-measures every
control on the step.

**Large class choices are tasks, not walls.** A generic class choice used to
render every option it had, which made Weapon Mastery and the level-based
ability-score improvement hard to scan. A choice offering more than
`LARGE_CHOICE_OPTION_THRESHOLD` options now collapses to a summary — what is
being decided, what is chosen, how many remain, and one control to open it — and
exactly one picker is open at a time. **The rule is the option count and nothing
else.** No public UI logic reads a choice's name, its class or its source, so a
ruleset that names these decisions differently gets the same treatment and this
product learns nothing about any particular book. Small decisions are unchanged,
including every decision the shipped synthetic ruleset contains. The Background
`increasePatterns` ability UI is untouched: it is already a shape-first compact
selector.

**Review answers one question.** Review exists to tell a player whether this is
the character they meant to make, so the parts that explained how the app
arrives at an answer are gone: the "Automatic values come from…" paragraph, the
per-proficiency "automatic" and "chosen in …" annotations, and the grouping by
granting entry. "Choices by source" is "Your choices" and "Issues by severity"
is "Still to resolve". The decisions themselves, the unmade ones, the resulting
proficiencies, the equipment and the outstanding issues all remain.

**Settings is a global destination with history behind it.** It was a large gear
in the top-right of the app bar, which read as settings for whatever screen it
sat above, and it had no history entry — so on an installed phone, where the
system Back gesture is the only Back there is, leaving Settings left Runefolio.
It is now the fourth item in the bottom bar beside Characters, Sheet and
Compendium, and the gear in the header is gone. The history model is small and
whole: root destinations push nothing, because tabs are not pages; entering
Settings pushes exactly one entry recording where it was entered from; leaving
it — by the Back gesture, by tapping another destination, or by opening a
character from inside it — unwinds that one entry; entering Settings while
already there does nothing. A reload replaces any Settings marker on the current
entry, because the app always restarts at Characters and an entry claiming
otherwise would leave a Back press with nothing behind it.

**The app bar states the wordmark and nothing else.** It also carried an
offline-readiness indicator on its trailing edge, whose label did not fit below
600 px and was hidden — so on every phone it was a small unlabelled dot in the
top-right, and once the gear moved to the bottom bar it was the only thing left
up there. Physical testing read it as a visual artefact, which with its label
removed is what it had become. Offline readiness is still reported, in full and
in words, under Settings · Offline beside the paragraph explaining what offline
means here. Anything that needs to *wait* for the shell to be cached, including
the tests, reads `data-offline-state` on the document element rather than the
text of a piece of interface.

## Character management

**Deleting a character** is available from the row overflow menu. It removes the
character and every record whose lifecycle it owns, in one transaction: version
history, snapshots, the character-bound edit draft, runtime state, the action
log, typed overrides, derived snapshots, validation issues and override
decisions. That list is exactly the tables the schema keys by `characterId`,
plus drafts naming it in `editingCharacterId`. Content packs, sources, entries,
ruleset profiles, app preferences and other characters are shared and are never
touched. Deleting an already-deleted character reports `not-found` and writes
nothing.

The menu item opens a confirmation and never deletes on its own. The dialog is an
`alertdialog` that names the character, states the deletion is permanent and
local, separates Cancel from the destructive action, and opens focus on Cancel;
Cancel or Escape returns focus to the control the menu was opened from, and a
successful delete returns to the library.

**Menu containment** is handled by a shared `AnchoredMenu` primitive rather than
by an offset on the Characters screen. The surface is measured after it renders
and translated the minimum distance that brings it inside the viewport, flipping
above the trigger when there is not enough room below and the space above is
better. It never exceeds the viewport width whatever the character is called,
opening it shifts nothing else on the page, and Escape or a press outside closes
it.

## Play-first character sheet, first iteration

The character sheet is now **Play mode**, not a rules console. Its rationale and
phone screenshots are in
[`product/PLAY_SHEET_RATIONALE.md`](product/PLAY_SHEET_RATIONALE.md); the
specification it produced is
[`product/MOBILE_SHEET_SPEC.md`](product/MOBILE_SHEET_SPEC.md).

The sheet writes only session state — current and temporary hit points, hit
dice, death saves, conditions, exhaustion, inspiration, spell slots and
limited-use resources — and every permanent change goes through one **Edit
character** action that opens the builder. The Override editor, the
`Copy expression` control, the roll expressions, the `Active ruleset` footer and
the contributor rows tagged with engine kinds and source IDs are gone from the
sheet and from the library. Content management is unchanged under Settings.
Explanations remain, as plain-words breakdowns in a details drawer.

The information architecture is a glance header over five sections — Overview,
Actions, Spells, Inventory, Character — with Spells present only when installed
content declares spellcasting for one of the character's classes. Runtime state
gained inspiration, exhaustion, death saves and hit-dice spend/recover, each with
exact undo.

A second synthetic fixture, the **Runecaller** caster (Sereth Marsh), joins
Vanguard so the Spells section and the conditional builder step are exercised by
something real. Both fixtures are original synthetic content.

### The Edit character boundary

Making the sheet Play mode put every permanent change behind one route, so that
route has to be complete. It now is.

`CharacterDraftService.openForCharacter` is the single entry point, and
`draftBuildFromCharacter` is the single conversion from a committed character to
an editable build — used by the service and by nothing else, so the page cannot
reconstruct its own partial version. It hydrates every persisted permanent field,
scopes the draft to the character's own ruleset, resumes an unfinished edit
rather than replacing it, and records the character revision it read as the
compare-and-swap token the commit must send. `CreateDraftCommand` no longer
accepts an `editingCharacterId`, so an unhydrated edit draft cannot be created at
all.

A saved value the installed content can no longer confirm is kept and reported,
never cleared: the hydration returns typed repair notes, and a choice is
"resolved" only when every stored option is still offered — counting selections
alone had let an unresolvable build pass Review and commit.

Committing an edit re-synchronises runtime state through the existing D-08
policy and touches nothing else. Hit points, temporary hit points, hit dice,
inspiration, exhaustion, death saves, conditions and spent resources survive
opening, saving, discarding and committing an edit.

This iteration deliberately does not close attack derivation from carried
equipment, Extra Attack, prepared-versus-known spells, upcasting, concentration
tracking, currency, attunement, senses, defences, notes or creatures. Sections
without trustworthy data are hidden rather than filled with invented values; the
full list is at the end of the rationale.

## Baseline before M1

- Next.js 16/React 19 PWA shell with responsive navigation;
- strict TypeScript domain types for content, characters, rules, and operations;
- Dexie v1 tables, but no repository or transactional import implementation;
- strict Zod schema and basic size/key/depth validation;
- declarative rules engine and small Vitest/Playwright smoke suite;
- synthetic private-pack example and `.gitignore` content boundary.

## M1 delivered

M1 now owns source, content-pack, and content-entry CRUD; immutable Dexie v2 pack/entry history; v0→v1 in-memory migration; safe import preview and atomic revalidated confirmation; stale-state, schema, duplicate, reference, pack-version, and entry-revision checks; restricted export consent; separate full-text/effects editing; and compendium browsing. Unit/integration tests and desktop/mobile Playwright flows cover success, rollback, stale state, forged previews, sanitized diagnostics, and offline use.

M1.1 adds a fully static Next.js production export and first-party offline worker. Build output creates a content-derived cache version and precaches the complete local app shell. Updates wait for explicit user action, old shell caches are removed on activation, and Settings exposes storage estimates, quota pressure, persistence status, and `navigator.storage.persist()` where supported.

M1.2 makes that static PWA portable between domain-root hosting and the temporary GitHub Pages project URL. Manifest, Next.js assets, service-worker scope, precache and fallback derive from one build-time base path. A real two-build browser regression proves that the active shell remains internally consistent until update consent. The header status now reflects actual worker/cache readiness.

M1.3 adds private-library schema v2, typed content progressions and relations, dependency-set imports, deterministic conflict metadata, coverage labels, local-only ingestion boundaries, and the controlled external Brammel pilot.

M1.4 adds exhaustive effect-runtime dispositions, typed action-economy grants, declarative dice/roll rules, first-class nested equipment bundles, choice resolution, pure species/lineage/background relation activation, baseline multiclass progression and spell-slot contribution, derived character state, an atomic import-set confirmation boundary, and visible unsupported/review-required states. These are additive schema-v2 capabilities; no private content is committed and no character table changed.

M1.4 is a rules-engine and content-resolution foundation, not the M2.1 product slice: it contains no character persistence, character service, play sheet, level-up workflow, or transfer workflow. The private Brammel pilot was not rerun for M1.4; its local regression test stays skipped unless the pack path is supplied. See [M1.4_RULES_ENGINE_COVERAGE.md](M1.4_RULES_ENGINE_COVERAGE.md) for the gate.

## M2.1 implemented, pending certification

M2.1 turns that foundation into the first working character product, bounded to levels 1 and 2 of one original synthetic class.

Database version 5 adds character drafts, revision-bearing committed characters, immutable versions, restore snapshots, runtime state, a session action log, typed overrides and safe derived snapshots. The version 4 to 5 upgrade splits any legacy character row into durable and runtime state inside Dexie's version-change transaction, leaves content, packs and sources untouched, and reports failures by stable ID and field path only.

Seven application services own every mutation: draft, build/commit, query, derived resolver, runtime, level-up and transfer. Each validates an expected revision inside the same transaction that writes, so a stale command performs no writes and returns a typed outcome rather than an exception string. A record is versioned before it is replaced. Runtime actions write runtime state plus one action entry and never a durable version. The application-layer resolver is the only component that produces authoritative derived values; React components import services, never Dexie.

The synthetic slice supplies Vanguard, Riverborn, Caravan Warden, Guarded Hand, Measured Cut, Longblade, Round Guard, Travel Mail, Longblade Strike and Rallying Breath, level-keyed by stable ID so later levels are a data change. Brammel resolves to 10 maximum hit points and 3 Rallying Breath uses at level 1, and 14 and 4 at level 2, which is the preserve-deficit demonstration the acceptance criteria require. The level 2 maximum is class base 10 plus the Constitution modifier applied to each of the two levels; it read 12 before the per-level hit-point correction below.

The product surfaces are mobile first: a real empty library, a builder over the ten-step catalogue that presents only the steps applicable to the build — a step with nothing to decide is omitted and reported on Review instead — with one draft behind both guided and flexible modes, an active play sheet with bounded runtime actions and explanations, a level-up preview with a before/after diff and a pre-level restore point, and standard file transfer with Already current, Keep both, Replace and Cancel. Dice support is expression-only; there is no Roll control.

Unknown required inputs render as `—` with a recovery action rather than zero. Overrides accept only typed `replace` and `add` against a target the resolver genuinely applies; an unsupported target is refused rather than stored inert, and a moved baseline marks the override for review rather than discarding it.

Undo is exact: every reversible action stores the prior values of the fields it changed, so clamped healing and temporary-hit-point absorption reverse correctly. A resource fragment records values and absences separately, because a missing `resourceUses` key means "starts full" and reversing an action that introduced one requires deleting it again. An action is labelled reversible only when its stored fragment is proved to reproduce the prior runtime state, so the label cannot drift from the property it claims. Undo offers the most recent actions rather than unbounded history; deeper history stays readable but is not offered for reversal. The character fingerprint is a canonical recursive hash over an explicit field list plus the override set, so a nested change cannot be missed. Transfer, Replace and restore all carry the complete aggregate, including typed overrides.

The authoritative services are generic: they discover hit dice, saves, skills, masteries, equipment choices and ability-generation methods from content, and resolve each character only against its own ruleset's active sources. A second synthetic ruleset in the test suite proves it, and a repository-wide check keeps first-slice IDs out of the product layer.

### Verification ladder

M2.1 is **not** marked complete. Each claim below is recorded at the level it has actually reached.

| Level | Status |
| --- | --- |
| Implemented | Every mandatory M2.1 acceptance criterion has code behind it. |
| Verified locally | `npm ci`, typecheck, unit and integration tests, both builds, Pages verification, the full browser matrix, audit and privacy scan all pass from a clean worktree. |
| Verified by GitHub CI | A Verify workflow runs the same clean sequence on the pushed head. Its result is reported on the pull request; do not treat a local run as CI evidence. |
| Verified in a browser | Chromium, at 320, 360, 375, 390, 412, 768, 1024 and 1440 CSS px, plus 200% zoom, offline, reduced motion, forced colours, an emulated **light** OS preference, and axe checks. |
| Reviewed by the owner in a desktop browser | Done on 2026-08-04 against the production build. It found the dark-preference contrast defect and the builder UX corrections now applied. It was explicitly not a physical-device run. |
| Requires physical Android validation | Not done. Touch targets are verified in CSS pixels only; real-device performance, install behaviour, PWA installation, offline relaunch and storage eviction are unverified. **Orientation lock and the dark splash screen are also unverified**: viewport emulation neither installs the app nor exercises the Screen Orientation API, so the manifest's `orientation` and the runtime lock have no CI evidence at all. The checklist is in [`MOBILE_VISUAL_CONTRACT.md`](MOBILE_VISUAL_CONTRACT.md). Playwright is not evidence of physical-device behaviour. |

### Content status

M2.1 validates the technical vertical slice against **public-original synthetic content** — Vanguard, Riverborn, Caravan Warden and the rest of the named fixtures. That content is neither official material nor temporary placeholder: it is the licensed-clean validation set this repository is permitted to carry, and `privacy:scan` enforces that boundary in CI.

Consequently M2.1 can demonstrate that the engine, services and surfaces are correct, but it cannot settle content-density or real-rulebook interaction questions — option counts, name lengths, description volume and cross-reference depth all differ from real material. Final content UX validation depends on the later private PHB pack, imported locally through the M1.3 private-library schema and never committed here.

## M2.1a implemented, pending certification

M2.1a is the first public real-content creation foundation. It is stacked on the
M2.1 slice and changes no private content: everything committed here is
public-original synthetic material.

**Imported content is reachable.** The pilot's blocking defect was that a pack
could be imported and then be invisible: every builder and resolver read is
scoped to a ruleset profile, and importing created none. `ContentInstallService`
now proposes the profile a pack would produce, derives its ID from the pack ID,
and writes it inside the import's own transaction, so a failed or cancelled
import leaves neither content nor a partial profile. Installed packs that still
have no profile are offered one from Settings, Rulesets. Selection is explicit:
an activated profile, or a single usable profile, is an answer; anything else is
reported as ambiguous and asked. Nothing is ever chosen from list order.

**Creation is name-first and level-targeted.** The first step holds the name,
the ruleset and the intended starting level. The maximum level offered is
derived from content. Creating at level 5 accumulates levels 1 to 5 in one pass,
exposes every reachable choice, honours subclass and feat timing, blocks the
commit while any remain, and writes level 5 directly.

**Choice discovery is generic.** `choice-planner` walks activated entries —
class, subclass, their progression-granted features, species and its traits,
background and its feat, and anything a selected option activates — and returns
each choice once, keyed by its own stable ID, with its declaring entry and level
retained. A choice is discovered only when the entry that owns it is genuinely
active, so no diagnostic can name a decision the builder never rendered. The
duplicate unresolved-choice diagnostic is fixed at its source: an empty required
choice is one fact, and both the planner and the resolver collapse issues on
identity.

**The subclass is a typed identity.** It is offered at the level the class
declares, persisted on the class level, activates its own progression and
choices, appears in Review and on the sheet, and blocks completion when required
and unresolved.

**Ability entry keeps one model.** Base scores plus origin increases give the
final scores in both methods; the manual inputs edit base scores, the origin
interface stays visible, and switching methods preserves the allocation.

**Equipment is legible.** Class and background grants are both shown, each
package lists its contents before it is chosen, Review shows the resulting
equipment, and the step is omitted only when a build genuinely grants and offers
nothing.

**Proficiencies carry provenance.** Every proficiency names its source entry and
whether it was automatic or chosen, and Review groups them by source. An option
that only grants something already granted is labelled with the source that
grants it and is not offered as a live choice; a build that already stores such a
selection is blocked with a named repair rather than silently producing one
proficiency fewer.

**Level-up stays one level at a time**, and now refuses a level the class
progression does not define, naming the highest level the content reaches
instead of showing an empty confirmation. The preview lists the features,
actions and resources the level adds, and says outright when a level adds none.

Database version 6 is additive: one preference record holding the explicitly
activated ruleset. No existing record is read or rewritten.

### Corrective pass

A merge-readiness review of the above found eight defects. They are corrected in
place rather than deferred, because each one is a case where the product was
confidently wrong rather than merely incomplete.

**Changing the ruleset is previewed before it is written, and decided per
value.** Selecting another ruleset produces a non-writing preview — what would be
cleared, what stays, what is recalculated, and what would be left needing repair
— and offers `Keep current ruleset` and `Switch ruleset`. Keeping writes nothing.
Confirmation sends the revision the preview was computed at, so an autosave
landing in between makes the confirmation stale instead of reviving a value the
change had cleared.

A ruleset ID changing is not by itself a reason to discard a selection. Two
profiles can scope the same entries, so `resolveRulesetChange` checks each value
against the content the *target* ruleset actually resolves: the entry has to be
present, under a category its field can mean, and a stored choice's options have
to still be offered by a choice the target build reaches. A class the incoming
ruleset still defines survives; one it does not is cleared and named. The preview
and the write are one pass over the same inputs, so what was read and what is
written cannot differ. A target level the incoming content cannot reach is
reported as a conflict to repair rather than silently lowered.

Switching *this* build's ruleset no longer repoints the device-wide default for
future characters. That default is changed only from Settings, with
`Use this ruleset for new characters`, where it is the subject of the action
rather than an unannounced side effect of an unrelated one.

**Origin ability increases cannot outlive the origin that authorised them.**
`reconcileAbilityAllocation` validates the stored allocation against the pattern
the active origin declares, excludes anything it does not authorise from the
final scores, and reports `ORIGIN_INCREASE_NOT_AVAILABLE`. Changing the origin or
the ruleset repairs the allocation in the same write, and the commit writes the
recomputed finals rather than the draft's stored ones.

**Level coverage is one contract in both modes.** `LEVEL_NOT_COVERED_BY_CLASS`
now reaches the commit boundary in guided *and* flexible mode and cannot be
acknowledged away, because a level the class does not define produces a sheet
whose hit dice and maximum hit points come from different levels. The level
selector offers only supported levels rather than `max(supported, stored)`, an
unsupported stored level is a named conflict with a one-click repair, and a build
with no class reports that its level is unverified rather than fine.

**A profile activates its own pack's entries, not its source's.** Membership is
now the explicit `allowedEntryIds` set taken from the imported pack; declared
dependencies join it only through a typed mechanism. Reusing an installed source
ID can no longer widen an existing profile. Profiles written earlier keep source
scoping and resolve exactly as they did.

**That membership follows the pack when the pack is updated.** `allowedEntryIds`
used to be written once, at install, so updating a pack from 3 entries to 5 left
its profile scoped to the original 3: the new entries were installed and no
ruleset reached them. The import transaction now advances the existing profile
for every written pack — same profile ID, same `createdAt`, same name, same
policies and exclusions, `updatedAt` moved only when the membership genuinely
changed — and reports it as `updatedRulesetIds` rather than creating a second
ruleset. Because it runs inside the import's own transaction, a rolled-back
import rolls the membership back with the content.

**A device that already took the newer pack repairs itself.**
`reconcileInstalledRulesets` compares each installed pack with the profile that
pack owns and replaces only stale pack-owned membership; `inspectInstalledRulesets`
runs it when Settings → Rulesets loads. Nothing is reinstalled, downgraded or
deleted, no character reference moves, and the active ruleset is untouched. It is
deliberately narrow: only a profile with an explicit membership that exactly one
installed pack can claim is touched, membership comes from that pack's own
entries plus its resolved declared dependencies, and a second run is a no-op.

**Profile IDs keep the whole pack ID.** `rulesetIdForPack` stripped a leading
`pack:`, so `pack:x` and `x` collided on one profile. It no longer strips;
`legacyRulesetIdsForPack` reports the earlier derivation and the install boundary
checks every candidate, so a pack installed under the old scheme is recognised
rather than duplicated or overwritten. Existing IDs are deliberately not migrated.

**Activation follows typed links and lineages.** `ContentLink` activation honours
`required` and `level`, never activates above the build level, terminates on
cycles and retains provenance. A lineage activates its own traits and suppresses
the ones its `replacesTraitIds` names, so a character never holds both the
replaced and the replacement trait. The legacy `race` origin category activates
its traits by the same rules and is offered in the builder.

**Equipment reads once.** One view per bundle with every granting entry listed,
and the resulting item list totalled per item and status — so a bundle two
entries grant appears once with both sources named, while two different bundles
holding the same item report the genuine larger quantity.

**A ruleset says what kind of content it reaches.** A classification derived from
record metadata — public-only, restricted, or mixed — shown in the builder's
ruleset picker and in Settings, Rulesets. It quotes no content, and nothing
prefers a private profile.

Planning cost is also now bounded: one activation walk and one proficiency walk
per planning pass, asserted by an instrumented density test rather than a clock.

### Engine-correctness pass

Three generic contracts that real-content validation showed the engine breaking.
Each has one authoritative implementation, used by planning, diagnostics,
Review, commit, the level-up preview, the level-up commit and the derived sheet
alike — there is deliberately no creation-only or level-up-only variant.

**Maximum hit points apply Constitution once per level.**
`maximumHitPointsFor` in `src/rules/hit-points.ts` is the one calculation:
`classBase(level) + constitutionModifier × level`, where `classBase` is whatever
the content declares for that level. Level 1 is unchanged; every level above it
had been dropping its Constitution contribution, so a level `N` character was
short by `(N − 1) × modifier`. Direct creation at level `N` and a sequential
climb to level `N` now produce the same maximum, and the preview promises what
the commit writes.

Two cases are named rather than guessed at. No schema, decision record or
content mechanism in this repository declares a **minimum hit-point gain per
level**, so a negative modifier is applied as written and a maximum of zero or
less is reported as `HIT_POINTS_MAXIMUM_NOT_POSITIVE` instead of being clamped
to an invented floor. `hitPoints.classBase` is a single scalar path, so a
**multiclass** base cannot be composed from two classes; that is reported as
`HIT_POINTS_MULTICLASS_UNRESOLVED`.

**The armour context is resolved, not asserted.** `armorContextFor` in
`src/rules/armor-context.ts` derives it from typed item mechanics and the
equipment model's own `equipped` marker; it never reads a name, label, slug or
ID. The derivation and the planning paths both hard-coded `worn: false`, so every
`wearingArmor` condition evaluated false however the build was equipped. Body
armour and shields are now separate facts — a shield alone cannot satisfy a
body-armour condition — and weapons, tools and ordinary gear contribute nothing.
Equipment reaches a character through effects while conditions are evaluated
during those same effects, so the two are resolved to a bounded fixed point
rather than assumed. Two worn body armours is a state the public equipment model
cannot decide between; it is reported as `ARMOUR_SELECTION_AMBIGUOUS` rather than
resolved by array order or by name.

**One subclass decision is one decision.** `reconcileSubclassChoices` in
`src/rules/subclass-reconciliation.ts` decides structurally when a generic choice
is the class's typed subclass decision written a second time: declared by the
class, offering exactly its declared subclasses, a single non-repeatable pick, at
the same decision point, carrying nothing of its own. A pack that declared it
both ways produced two disconnected surfaces — the typed panel wrote
`subclassId`, the generic choice expected a `choiceSelections` entry, neither
satisfied the other, and the sheet stayed uncommittable behind a
`CHOICE_UNRESOLVED` the typed decision could not clear. The duplicate is now
unified away, with the choice it absorbed recorded on the requirement as
provenance. An overlap that is only partial is never discarded: it stays exactly
as declared and is reported as `SUBCLASS_CHOICE_OVERLAP_AMBIGUOUS`, which is a
warning rather than a block, so the build stays answerable.

### Deferred, and depended on by later work

These are recorded as follow-up dependencies and are deliberately absent here:

- current-hit-point finalisation during creation;
- automatic attacks derived from equipped weapons;
- custom or durable inventory, and removal of granted equipment;
- resource-recovery redesign;
- the broader character-sheet redesign;
- spellcasting;
- any additional official content;
- rolled ability scores, and origin patterns that place two increases on the
  *same* ability (part of G-5; a `+1/+1/+1` across three different abilities is
  supported and tested — the slots are consumed as a multiset);
- hydrating an edit draft from the character it edits, which today starts empty;
- migrating profiles created under the earlier profile-ID derivation, or
  narrowing an existing source-scoped profile to an explicit entry set.

The reasoning for the last three, and for the inventory-provenance and
hit-point-finalisation items above, is recorded in
[`docs/product/M2.1A_DEFERRED_DESIGN_NOTES.md`](./product/M2.1A_DEFERRED_DESIGN_NOTES.md).

## Character management and the sheet's information architecture

The sheet is the primary play and character-management workspace, and the
problem this pass addressed is **scale**: a level 1 martial, a level 12 martial
and a high-level full caster have to stay understandable and fast to operate on a
phone. The shapes that only appear at that size are not producible from the
content this repository ships — the seeded synthetic slice stops at level 2 with
four spells and one resource — so they are built as original public material in
[`tests/fixtures/sheet-scale-ruleset.ts`](../tests/fixtures/sheet-scale-ruleset.ts)
and imported through the ordinary pipeline: a twelve-level martial with fifteen
features, four resource pools recharging four different ways and a fourteen-line
kit, and a nine-level caster with five slot pools and thirty spells over six
spell levels.

**The top-level split is unchanged**, because nothing in the repository
contradicted it: Overview · Actions · Inventory · Character, with Spells inserted
only when installed content declares spellcasting for one of the character's
classes. The strip stays a fixed grid of exactly that many columns, so no section
is ever behind a swipe.

**A section is now a heading over one bordered group** rather than a card
carrying its own heading. The old model paid for a boundary, a heading row and
padding above and below it — around 60 px of chrome — for every group, on screens
that routinely have five.

**Character is progressive disclosure.** Class & subclass, Species, Background,
Feats, Features & traits and Proficiencies & training arrive as closed rows that
state what is inside them, one open at a time, with Edit character and Level up
under them. A feat is filed under Background only when the background entry's own
`featId` names it; every other active feat is its own group. The full structure
is in [`product/MOBILE_SHEET_SPEC.md`](./product/MOBILE_SHEET_SPEC.md).

**The management boundary is data, not prose.**
[`src/ui/sheet-scope.ts`](../src/ui/sheet-scope.ts) classifies every runtime
operation, keyed by `RuntimeOperation["kind"]`, so a new operation does not
compile until somebody has decided whether the sheet owns it.

Measured at 360 × 780, against the baseline at `9b09605`:

| | before | after |
| --- | --- | --- |
| Glance header | 265 px (283 at level 12) | 164 px |
| First screen that is section content | 44–46% | 50–59% |
| Action row | 57 px | 50 px |
| Inventory row | 48 px | 48 px, description moved to the drawer |
| Character, level 12 | 2314 px, five open cards | 794 px, four closed groups |
| Character, level 1 | 1636 px | 798 px |
| Spells, level 9 caster | 2870 px | 2384 px, with a filter |
| Tab strip | fits at 4 and 5 | unchanged |

### Inventory item state is read-only (SHEET-GAP-ITEM-STATE)

Equip, unequip, attune, unattune, consume a quantity and spend a charge are all
reversible day-to-day state that belongs on the sheet by the boundary above.
None of them is implemented, and none is faked. `CharacterRuntimeService` has no
operation for item state; `CharacterRecord` stores `equipmentSelections` — the
bundle choices that produced the kit — rather than a mutable inventory; and the
sheet's equipment list is derived from those choices on every read. A control
here would either write nothing or create a second, private store of item state
that no other surface reads.

What this pass did instead: the Inventory information architecture is built for
those controls, and the read-only facts the item schema already carries are
surfaced — armour contribution, attunement requirement, rarity, weight, quantity
and the item's own summary. Weight is shown as the number the content declares
and with no unit, because the schema declares none; a unit, a carrying capacity
and an encumbrance rule are all part of the same missing model. Closing the gap is an engine change: a typed
`item-equip` / `item-attune` / `item-quantity` family on the runtime service, a
durable per-character item-state record keyed by item ID, and a resolver that
composes it over the derived bundle. Charges additionally need an item-owned
resource, which the item schema already declares (`resourceIds`) and nothing
reads. Character currency has no model at all and is part of the same change.

### Spell preparation is a property of a grant (SHEET-GAP-SPELL-PREPARATION)

The generic model can state exactly one preparation fact truthfully: an
`addSpell` effect may mark a spell `alwaysPrepared`, and the sheet now shows
that. There is no preparation mechanic behind it — nothing prepares or unprepares
a spell, and creation has no spell *selection* step, so a character knows exactly
what its content granted. `addSpellList` deliberately does not make a spell
known.

The sheet therefore marks the always-prepared spells and does not imply the rest
are unprepared. A real prepared/known distinction needs a durable per-character
spell-state record and a preparation-capacity rule, neither of which exists.

### Senses and movement modes are not modelled (SHEET-GAP-SENSES-MOVEMENT)

Overview would show senses and alternative movement modes if the engine
projected them. It projects one scalar `speed`, which is already in the glance
header, and no sense at all: `RuleContext` has no senses map and no content
schema declares one. Nothing is invented to fill the space — the Overview groups
that exist are the ones with data behind them.

### The Character workspace has no Notes or Companions (SHEET-GAP-NOTES-COMPANIONS)

`CharacterRecord` has no notes field and no companion, summon or familiar
relation. `CharacterActionRecord` carries an optional private per-action note,
which is history rather than a character field. Both groups are absent rather
than empty, and the progressive-disclosure structure has room for them when the
records exist.

### Gap identifiers

Two naming schemes appear above, and the difference between them matters.

`GAP-003` and `GAP-005` are historical numeric entries in this repository. They
keep their numbers; nothing renumbers them.

The four gaps this pass recorded — `SHEET-GAP-ITEM-STATE`,
`SHEET-GAP-SPELL-PREPARATION`, `SHEET-GAP-SENSES-MOVEMENT` and
`SHEET-GAP-NOTES-COMPANIONS` — use a descriptive, Sheet-scoped namespace instead
of the next free numbers. **`GAP-###` numbers are allocated across the wider
Runefolio programme, not within this repository**, and several of them are
already reserved for engine gaps that have never appeared in this public tree —
level-scaled choice capacity, unarmoured armour-class formulae, full
spellcasting automation and roll-rule projection among them. Taking the next
numbers that looked free from inside this repository would have given four
different things the same names.

**Do not allocate a new numeric `GAP-###` identifier from this repository
without first checking the project-wide gap registry.** A gap found here takes a
descriptive namespaced label — `SHEET-GAP-…` for the character sheet, and the
same shape for any other surface — which cannot collide with a number allocated
elsewhere and says what it is without a lookup.

## Device and installation behavior

- Every phone, desktop browser, browser profile, and installed PWA has its own IndexedDB.
- Desktop data does not automatically synchronize to a phone. No account, sync API, or server database exists.
- Packs and characters must be exported and imported manually between devices. Restricted definitions require the separate explicit export confirmation.
- Initial installation and application updates require HTTPS, except browser-recognized localhost development.
- After one successful online load and service-worker installation, the cached application shell can reload and operate offline. Local compendium reads, edits, search, and JSON export require no network.
- Persistent storage may reduce browser eviction risk, but browsers can refuse it and it never replaces a backup.

### Recorded follow-ups

**The local end-to-end suite can pass against a stale build.** `playwright.config.ts`
sets `reuseExistingServer: !process.env.CI`, so a local `npm run test:e2e` reuses
whatever preview server is already listening — which may have been built before
the changes under test. During the creation IA work this produced a local run
reporting 407 passing while CI, which builds fresh, failed 64 of the same tests.
Until it is addressed, a local run is only evidence when the build output is
wiped and `CI=1` is set. Deliberately not fixed inside the creation IA change:
it is a change to how every suite in the repository is verified, and it should
not ride along with a product branch.

## Next milestone

M2.2 extends the same contracts to levels 3–20 of the synthetic path, adds subclass selection and subclass-feature progression, and broadens content coverage. Multiclassing, spells, QR transfer and random dice results remain deferred.

Deferred risks include browser-profile storage security, unencrypted JSON exports, resumable imports, durable backup/recovery, prepared/known spell merging, pact-slot derivation, unusual spell and monster grammars, real errata pilots, browser-specific storage eviction behavior, and performance profiling on low-end physical phones.

## Working conventions

See [`../AGENTS.md`](../AGENTS.md). Update this file when the implemented state or next milestone changes.
