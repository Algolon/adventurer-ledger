# Current state

The application is presented as Runefolio. Its deterministic vector identity,
favicon and complete `any`/`maskable` PWA icon sets are documented in
[`BRAND.md`](BRAND.md); technical installation and local-storage identities stay
unchanged.

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

The synthetic slice supplies Vanguard, Riverborn, Caravan Warden, Guarded Hand, Measured Cut, Longblade, Round Guard, Travel Mail, Longblade Strike and Rallying Breath, level-keyed by stable ID so later levels are a data change. Brammel resolves to 10 maximum hit points and 3 Rallying Breath uses at level 1, and 12 and 4 at level 2, which is the preserve-deficit demonstration the acceptance criteria require.

The product surfaces are mobile first: a real empty library, a builder over the nine-step catalogue that presents only the steps applicable to the build — a step with nothing to decide is omitted and reported on Review instead — with one draft behind both guided and flexible modes, an active play sheet with bounded runtime actions and explanations, a level-up preview with a before/after diff and a pre-level restore point, and standard file transfer with Already current, Keep both, Replace and Cancel. Dice support is expression-only; there is no Roll control.

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
| Verified in a browser | Chromium, at 320, 360, 390, 412, 768, 1024 and 1440 CSS px, plus offline, reduced motion, forced colours, dark colour preference and axe checks. |
| Reviewed by the owner in a desktop browser | Done on 2026-08-04 against the production build. It found the dark-preference contrast defect and the builder UX corrections now applied. It was explicitly not a physical-device run. |
| Requires physical Android validation | Not done. Touch targets are verified in CSS pixels only; real-device performance, install behaviour, PWA installation, offline relaunch and storage eviction are unverified. Playwright is not evidence of physical-device behaviour. |

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

### Deferred, and depended on by later work

These are recorded as follow-up dependencies and are deliberately absent here:

- the per-level Constitution hit-point correction;
- current-hit-point finalisation during creation;
- the armour-context correction;
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

## Device and installation behavior

- Every phone, desktop browser, browser profile, and installed PWA has its own IndexedDB.
- Desktop data does not automatically synchronize to a phone. No account, sync API, or server database exists.
- Packs and characters must be exported and imported manually between devices. Restricted definitions require the separate explicit export confirmation.
- Initial installation and application updates require HTTPS, except browser-recognized localhost development.
- After one successful online load and service-worker installation, the cached application shell can reload and operate offline. Local compendium reads, edits, search, and JSON export require no network.
- Persistent storage may reduce browser eviction risk, but browsers can refuse it and it never replaces a backup.

## Next milestone

M2.2 extends the same contracts to levels 3–20 of the synthetic path, adds subclass selection and subclass-feature progression, and broadens content coverage. Multiclassing, spells, QR transfer and random dice results remain deferred.

Deferred risks include browser-profile storage security, unencrypted JSON exports, resumable imports, durable backup/recovery, prepared/known spell merging, pact-slot derivation, unusual spell and monster grammars, real errata pilots, browser-specific storage eviction behavior, and performance profiling on low-end physical phones.

## Working conventions

See [`../AGENTS.md`](../AGENTS.md). Update this file when the implemented state or next milestone changes.
