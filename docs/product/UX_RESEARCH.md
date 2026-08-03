# Runefolio UX research

Research date: 2026-08-03
Method: live product audit, repository/code/test audit, responsive viewport inspection, and comparative desk research. No protected rules text, assets, or visual trade dress is reproduced.

## Executive findings

1. The current live site is an M1 content-management PWA with a convincing but mostly demonstrative character dashboard and builder.
2. Content packs, sources, compendium filtering, import preview/confirmation, export restrictions, storage status, offline shell state, and update behavior have real service boundaries; the main Characters experience does not yet persist or calculate a character.
3. The live Characters page overflows horizontally at 360, 390, and 412 px. Its effective document width is approximately 480 px, so essential labels and controls clip. It is stable without document overflow at 768, 1024, and 1440 px.
4. Successful products separate guided creation from high-frequency play, but the best ideas are complementary: staged choices, resumable state, visible requirements, compact action rows, contextual rules detail, and reversible mutations.
5. Runefolio cannot copy the cloud assumptions of competitors. Transfer provenance, destination conflict handling, and “this device” state must be core UX.

## Current Runefolio audit

### Repository and architecture

The repository describes a local-first PWA in which IndexedDB/Dexie is authoritative. Domain types already distinguish content definitions, character choices, derived/runtime state, snapshots, overrides, sources, rulesets, imports, and exports. The rules engine is declarative and traceable. M1 owns transactional content CRUD and import/export; M2 is identified as the character build pipeline.

Relevant current documents:

- [`../ARCHITECTURE.md`](../ARCHITECTURE.md)
- [`../CURRENT.md`](../CURRENT.md)
- [`../ROADMAP.md`](../ROADMAP.md)
- [`../../README.md`](../../README.md)

The intended product architecture is sound for this specification: UI must call services/repositories, multi-record mutations must be transactional, and private values must not enter diagnostics.

### Live interfaces

Audited at [the GitHub Pages deployment](https://algolon.github.io/adventurer-ledger/).

| Surface | What is present | Assessment |
| --- | --- | --- |
| Characters | Active Brammel card, sources, build progress, compatibility warning, one library row | Static sample content; no real library repository or character persistence |
| Builder | Six-step modal: Basics, Class, Origin, Abilities, Equipment, Review | Step navigation and close/advance work in React state; options are demonstrative and do not change a character |
| Compendium | Local entry filter, cards, full-text/effect details | Functional against IndexedDB |
| Content packs | Pack/entry form, separate full text/effects, restricted flag, edit/delete | Functional through services/repositories with history behavior |
| Sources | Create, edit, delete source metadata | Functional through a repository |
| Rulesets | One active-profile summary | Demonstrative; Edit profile has no handler |
| Imports & exports | File/paste input, validation preview, atomic confirmation, restricted-export confirmation | Functional through import/export services |
| Settings | Storage estimate, quota, persistence state/request | Functional browser storage integration |
| PWA status | Offline-ready/update state | Functional service-worker state |

### Button and control audit

“Functional” here means the control produces its named durable or navigational outcome. “Demonstrative” means it is clickable but has no corresponding product effect.

| Control | Status | Evidence / behavior |
| --- | --- | --- |
| Sidebar navigation | Functional | Switches current surface; mobile menu closes after selection |
| Mobile navigation toggle | Functional | Opens/closes off-canvas sidebar |
| Global Search | Demonstrative | Input has no state, query, or results behavior |
| Local vault icon | Demonstrative | No handler |
| Continue character | Prototype-only | Opens builder modal at hard-coded Equipment step |
| Character library row | Prototype-only | Opens the same builder modal |
| Open sheet | Demonstrative | No handler |
| Compatibility warning / Review | Demonstrative | No handler |
| Builder step buttons | Prototype-only | Change local modal step |
| Builder option cards | Demonstrative | No handlers; selected state is fixed |
| Builder Continue / Finish review | Prototype-only | Advances local step or closes modal; no persistence |
| Builder close/backdrop | Functional for modal | Closes without save/discard model |
| Compendium filter/details | Functional | Filters local records; details disclose content in the UI only |
| Source save/edit/delete | Functional | Repository-backed local mutations |
| Pack save/edit/delete | Functional | Service/repository-backed local mutations |
| Preview / confirm / cancel import | Functional | Preview, atomic commit, or no-op cancellation |
| Create local export | Functional | Deny-by-default restricted export with explicit confirmation |
| Edit ruleset profile | Demonstrative | No handler |
| Request persistent storage | Functional when supported | Calls browser storage API and reports result |

### Responsive audit

Viewport height was held at 900 px; widths were tested after CSS transitions settled.

| Width | Observed layout | Result |
| ---: | --- | --- |
| 360 | Mobile header/search, hidden off-canvas nav; hero/source/progress cards render about 466 px wide; document about 480 px | **Fail:** horizontal overflow clips name, buttons, sources, progress, and library row |
| 390 | Same mobile layout and 480 px effective document width | **Fail:** horizontal overflow |
| 412 | Same mobile layout and 480 px effective document width | **Fail:** horizontal overflow |
| 768 | Single-column content, 712 px cards, 400 px search, off-canvas nav | Pass for document width; content is tall but coherent |
| 1024 | Still uses tablet/off-canvas navigation because breakpoint includes 1024 px | Pass; large single column underuses width and hides persistent navigation |
| 1440 | Persistent 240 px sidebar, two-column dashboard, 1,144 px content grid | Pass; strongest current composition |

Likely cause of narrow-screen overflow: grid children retain intrinsic minimum width. The M2 design must require `min-width: 0` at layout boundaries, wrapping/truncation rules for long names, and automated `scrollWidth <= innerWidth` assertions at all requested widths.

Other mobile observations:

- the global search consumes a second header row even though it is nonfunctional;
- the fixed privacy toast occupies scarce play space and can cover content;
- the six-step modal becomes a horizontally scrolling tab strip, which hides later steps and completion state;
- the page is a desktop dashboard stacked vertically, not a task-prioritized mobile home;
- source management and JSON editing remain possible on mobile but are not optimized for it, which is acceptable if Settings explains desktop preference.

## Comparative research

### D&D Beyond

Current official material describes Standard, Quick Build, and guided help. The Standard builder exposes preferences/sources first, then class, background, species, abilities, and equipment; requirements are called out within a step. Spell selection appears when relevant. Its digital sheet supports direct rolls and tracks hit points, spells, features, and inventory across mobile and web.

Useful patterns:

- creation methods match experience and time available;
- optional help text makes guidance progressive;
- source visibility is configured before option lists expand;
- class choice reveals dependent choices instead of exposing every section up front;
- the sheet puts rolls on the displayed number and keeps full detail contextual;
- character creation and the active sheet are distinct modes.

Risks to avoid:

- numerous top-level preferences before the user has context;
- content-entitlement and account assumptions leaking into Runefolio;
- a “complete enough to open the sheet” icon without an explicit explanation of remaining issues.

Sources: [official character builder overview](https://www.dndbeyond.com/en/players), [official Standard builder walkthrough](https://www.dndbeyond.com/posts/1059-how-to-create-your-first-dungeons-dragons), [official mobile sheet guidance](https://www.dndbeyond.com/posts/1003-how-to-customize-your-character-sheet-on-d-d/1000), and [official 2024/legacy source explanation](https://www.dndbeyond.com/changelog).

### Roll20 Charactermancer

Charactermancer uses named “slides,” permits navigation through the top step bar, and saves progress when navigating. Cancel explicitly distinguishes discard, save-and-exit, and continue. Review lists missing requirements and gates Apply Changes. The character sheet remains directly editable, and Compendium operations are additive rather than silently replacing manual data.

Useful patterns:

- save-and-exit is an explicit recovery path;
- review is the commit boundary rather than every intermediate control;
- custom ability input supports transfer and table-specific generation;
- creation and level-up reuse a recognizable workflow;
- additive behavior protects manual work.

Risks to avoid:

- unsaved edits on the current slide can be lost despite broader saved progress;
- applying the builder overwrites existing sheet data;
- long slide sequences and a top bar are awkward on narrow mobile screens;
- blocking Apply until all required fields are complete conflicts with Runefolio’s flexible mode.

Sources: [official Charactermancer guide](https://help.roll20.net/hc/en-us/articles/360039644133-D-D-5e-Charactermancer) and [official D&D 5E sheet guide](https://help.roll20.net/hc/en-us/articles/360037773573-D-D-5E-by-Roll20).

### Demiplane / NEXUS

Demiplane combines builder, interactive sheet, searchable listings, and cross-linked digital rules. Its “click-to-know” pattern uses tooltips and linked detail so a player can learn while building or playing. The sheet supports in-sheet rolling and contextual rules references across desktop, tablet, and mobile.

Useful patterns:

- rules explanation lives at the point of choice or play;
- a shared compendium vocabulary connects builder and sheet;
- pregenerated characters provide an immediate learning route;
- detail is layered rather than permanently expanded.

Risks to avoid:

- deep cross-linking can pull attention away from the active task;
- library, account, sharing, and purchased-content concepts do not translate to a device-local product;
- responsive availability alone does not establish thumb-first task priority.

Sources: [official getting-started guide](https://support.demiplane.com/hc/en-us/articles/33046325857815-Getting-Started-on-Demiplane-Your-Official-Digital-Companion), [Pathfinder NEXUS FAQ](https://support.demiplane.com/hc/en-us/articles/25811633557399-Pathfinder-2nd-Edition-NEXUS-Frequently-Asked-Questions), and [official character-tools overview](https://forums.demiplane.com/t/welcome-to-the-pathfinder-nexus-character-tools-open-beta/1809).

### Pathbuilder

Pathbuilder presents itself as both a character planner and a usable sheet, with PDF export. The Android product is explicitly mobile; the web product states that it targets desktop and larger tablets. The planner model makes future levels and their consequences a first-class activity rather than treating level-up as a one-off form.

Useful patterns:

- planning and active sheet are two views of one character;
- dense rules choices can remain efficient for experienced users;
- export is part of normal character ownership;
- mobile and large-screen surfaces may specialize without becoming different products.

Risks to avoid:

- high density and abbreviated controls can become opaque to new players;
- future-level planning can obscure the currently active level;
- platform-specific purchase/state distinctions would be unacceptable for local transfer.

Sources: [official Pathbuilder site](https://pathbuilder2e.com/) and [official Google Play listing](https://play.google.com/store/apps/details?id=com.redrazors.pathbuilder2e).

### Fight Club 5th Edition

Fight Club is a strong mobile-first reference because it treats the phone as the primary character sheet. It supports free-form character input, automatic calculations, manual bonuses/penalties, spell preparation and slot tracking, equip/unequip behavior, tap-to-roll, a customizable compendium, PDF output, and PC-authored content files imported to mobile.

Useful patterns:

- fast play controls and free-form correction coexist;
- equipment state directly affects derived values;
- spell preparation and slot expenditure are separate concepts;
- PC-to-mobile compendium transfer is an established user mental model;
- backup/export belongs near character ownership.

Risks to avoid:

- free-form creation can leave the user solely responsible for legality;
- import/export without a dependency preview can produce partial characters;
- a mobile-first UI still needs clear level-up and provenance explanations.

Source: [official App Store listing](https://apps.apple.com/us/app/fight-club-5th-edition/id901057473).

## Pattern synthesis

| Need | Adopt | Adapt for Runefolio | Reject |
| --- | --- | --- | --- |
| Onboarding | Guided help and recommendations | Toggle per choice; remember locally; never hide flexible mode | Mandatory tutorial |
| Step flow | Dependency-aware staged creation | Nine recommended steps with resumable issues | Unscrollable desktop tab strip on mobile |
| Validation | Inline requirements plus Review summary | Errors do not prevent saving; only unsafe transitions are blocked | One global valid/invalid flag |
| Recovery | Save-and-exit and explicit review/commit | Autosave every accepted edit; version before apply; show undo | Silent overwrite |
| Detail | Click/tap for rules context | Compact summary → drawer/detail route; preserve position | Full rules text in every option card |
| Play | Tap values/actions, track resources | Separate intent (“take damage”) from raw field edit | Making edit mode the default play surface |
| Flexibility | Custom/manual fields | Require provenance and optional reason; show automatic baseline | Reducing custom values to generic errors |
| Transfer | Export/import as user ownership | Manifest, dependencies, fingerprint, preview, conflict choice | Automatic-device wording or blind replace |
| Sources | Pre-filter option catalog | Ruleset preset first, advanced source controls in Settings | Mixing legacy/private without badges |

## Research limitations

- Competitor research used current publicly available vendor documentation and live public surfaces; authenticated/paid choices were not exhaustively tested.
- Vendor descriptions establish supported workflows, not usability quality. Recommendations are design inferences, not claims of measured competitor performance.
- No user interviews or physical-device session tests have yet been run. Those are prerequisites before broad M2 implementation, but not blockers for a narrow Brammel prototype.
