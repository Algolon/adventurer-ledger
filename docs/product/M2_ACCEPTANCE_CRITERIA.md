# M2.1 Brammel vertical-slice acceptance criteria

## Purpose and scope

The first working slice proves that Runefolio can take one original synthetic character, Brammel “Boss” Voss, through mobile-first creation, active play, one single-class level-up, explainable editing/overrides, and manual device transfer while preserving the existing local-first/privacy architecture.

This specification is an implementation gate, not authorization to add production code in this branch.

## Slice boundaries

### In scope

- `ruleset:runefolio-2024-synthetic` and the original fixtures enumerated in [M2_DECISIONS.md](M2_DECISIONS.md);
- the Vanguard class path for exactly levels 1–2, structured for later extension to level 20;
- Riverborn species, Caravan Warden background/origin, languages, proficiency choices, ability method, Guarded Hand, Measured Cut, Longblade, Round Guard, and Travel Mail;
- guided and flexible level-1 creation using the nine-step flow;
- persisted draft, resume, autosave receipts, review, version 1 on initial commit, and restore points only at the agreed recovery boundaries;
- active mobile sheet with headline stats, HP, at least one attack/action, one limited resource, checks/saves, equipment summary, explanations, and offline use;
- one level-up transaction with before/after diff and undo/restore;
- manual entry and at least one explicit override with baseline/reason;
- standard file-transfer preview/import with safe summaries and restricted/private exclusions;
- incomplete, missing-source, conflict, offline, loading, empty, and local-save-failure states;
- responsive, keyboard, screen-reader, and touch coverage.

### Out of scope

- official non-SRD book content;
- broad class/species/background support or any spells;
- level 3–5, subclass choice, and Champion-like progression;
- multiclassing;
- automatic cross-device transfer, QR, accounts, campaigns, or VTT integration;
- random dice results, dice animation, or roll history;
- schema/database/content-pipeline changes made as part of this documentation task;
- visual trade dress from any researched product.

## Product acceptance criteria

### AC-01 — Character library truth

Given a fresh local database, when Characters opens, then the library shows a real empty state with New character and Import/Transfer actions and no fake persisted character.

Given an incomplete Brammel draft, when the library opens, then its card shows Incomplete, issue count, last local edit, and Resume at the last unresolved step.

Given a renderable automatic Brammel, when its primary row is activated, then the active sheet opens; Edit, Level up, Duplicate, Export/Transfer, and Archive remain secondary actions.

### AC-02 — Draft creation and recovery

Given the user chooses New character and starts guided or flexible creation, then a stable draft is persisted on this device.

When the user makes an accepted choice, reloads, closes/reopens the PWA, or goes offline, then the last committed choice and step resume without private values appearing in logs or errors.

When a local save fails, then the current edit remains recoverable in memory, prior persisted state remains intact, and Retry is offered with a sanitized message.

### AC-03 — Recommended flow

The step list is exactly:

1. Start / ruleset
2. Class
3. Origin
4. Abilities
5. Class choices
6. Spells & resources when relevant
7. Equipment
8. Identity
9. Review

The conditional step is visibly marked “Not needed” rather than disappearing after the user has visited it.

At 360 px, the user can discover current step, total steps, issue count, Back, Steps, and Continue without horizontally scrolling the document.

### AC-04 — Guided mode

Given guided mode, option lists rank at least one context-valid recommendation and provide “Why this?” copy without auto-selecting it.

Given a missing required choice, Continue takes the user to or keeps them at the next dependency-relevant unresolved group and the issue is announced accessibly.

Given an incompatible option, the UI explains the consequence and compatible repair before offering a flexible override.

### AC-05 — Flexible mode

Given flexible mode, the user can skip steps, save incomplete state, enter a manual value/choice, and preserve an invalid or incompatible choice with visible issue/override provenance.

When the user switches between guided and flexible, no saved or buffered data is reset and the same draft ID/revision history remains in use.

Flexible mode never labels manual state as automatically rules-valid.

### AC-06 — Explainable derivation

For ability modifier, AC, max HP, proficiency bonus, one save/check, one attack, and the limited resource, the sheet exposes base inputs, applied contributors, source IDs/labels, active ruleset, and override if present.

Unknown or blocked calculations display `—` plus a recovery action, never zero or a guessed value.

The explanation trace and errors do not include private `fullText`, notes, imported JSON values, or owned-source metadata values.

### AC-07 — Review and commit

Review groups character summary, choices by step, and issues by severity.

Given guided completion criteria are met, Finish and open sheet creates the character, version 1, runtime state, issues, and overrides in one safe transaction. Initial creation does not create a redundant restore point.

Given a flexible draft, it opens as an automatic sheet only when every automatic minimum resolves, or as a visibly Manual character sheet only when all six abilities, current/max HP, AC, initiative, name/fallback, and at least one action are explicitly present. Otherwise it remains incomplete.

Given the commit fails, no partial durable character/version state exists and the draft remains editable.

### AC-08 — Active mobile sheet

At 360, 390, and 412 px, Brammel’s Play view shows name, level/class, AC, HP, initiative, key checks/saves, favorite attack, limited resource, and condition entry without document-level horizontal overflow.

Applying damage or healing previews the result, commits one runtime mutation, updates the visible value, and offers Undo. Editing max HP is a separate Manage action.

Spending/recovering the limited resource cannot silently exceed its bounds. An override path is explicit.

Opening an action or value detail preserves return focus and scroll position.

### AC-09 — Offline session use

After the shell reports Ready offline and Brammel exists locally, when the browser goes offline and reloads, then the library, active sheet, explanations backed by local content, damage/heal, resource tracking, conditions, and local history remain usable.

Network state is shown as a compact status and does not disable local controls or produce repeated error toasts.

### AC-10 — Edit and override

Given an automatic value, when the user chooses Override, then the UI retains the automatic baseline and records target, semantics, timestamp, and optional reason.

M2.1 accepts only typed `replace` and numeric `add` operations with stable target/path, typed value, automatic baseline, scope, timestamp, affected character, and optional reason/source provenance. Conditional, multiplicative, formula, script, and expression operations are rejected without evaluation.

When upstream choices change, then the baseline recalculates and the override remains visible or is marked for review; it is never silently discarded.

Removing the override previews the automatic replacement and is undoable/versioned as appropriate.

### AC-11 — Level up

Given renderable automatic level-1 Brammel, when Level up begins, then a pre-level restore point is identified before edits.

The flow shows automatic gains, only newly required choices, resource/equipment impacts, and a before/after diff. It demonstrates `5/10 HP → 7/12` for a +2 maximum and `1/3 uses → 2/4` for a +1 maximum, naming the preserve-deficit/expenditure policy.

Confirm commits level, choices, version, and derived state atomically. Cancel leaves level 1 unchanged. Undo restores the pre-level snapshot without deleting history.

### AC-12 — Missing source

Given Brammel references a disabled or removed source, when the character opens, then the character record and last safe resolved snapshot remain available.

Affected values are marked Missing source/uncertain, and the UI offers re-enable/import, preserve as manual snapshot, replace choice, or continue read-only as appropriate.

No display-name or nearest-match substitution occurs.

### AC-13 — PC-to-mobile transfer

Given a desktop export, before creation the user sees character identity, updated timestamp, ruleset, dependency counts, restriction status, format version, and fingerprint.

Private full text, notes, and restricted packs/sources/entries are excluded from the standard file. A self-contained restricted export is a separate deferred or explicitly confirmed export-boundary mode.

Given no destination match, import is atomic. Given identical ID/fingerprint, the phone reports Already current. Given same ID/different fingerprint, choices are Keep both, Replace local with restore point, or Cancel.

No product path implies automatic device replication, no network is required for file transfer, and cancellation leaves local records unchanged.

### AC-14 — Settings IA

Mobile primary navigation contains Characters, Sheet, and Compendium. Packs, Sources, Rulesets, Imports, Exports, Transfer, Backups, Storage, Offline, and Updates are grouped under Settings as specified in `INFORMATION_ARCHITECTURE.md`.

Desktop exposes the same labels/state through a persistent rail and may provide richer editors without making them required for creation or play.

At an effective 1024 CSS px viewport, a compact persistent rail appears when the remaining content width is usable. At 200% zoom or equivalent width pressure, it falls back to the tablet/off-canvas pattern without changing task order.

### AC-15 — State coverage

Automated component/integration or browser tests cover empty, loading, incomplete, missing-source, conflict, offline, and save-failure presentations.

Each state has a named next action, accessible announcement behavior, and a no-data-loss assertion. Tests use synthetic content only.

### AC-16 — Responsive coverage

At 360, 390, 412, 768, 1024, and 1440 px:

- document scroll width does not exceed viewport width;
- navigation, dialogs, bottom sheets, sticky controls, and toasts do not overlap essential actions;
- long character/option names and badges wrap or truncate safely;
- builder, library, sheet, level-up review, Settings, and transfer preview remain operable;
- intentional inner scrollers are labelled, keyboard accessible, and not used for the primary step list.

### AC-17 — Accessibility and touch

- axe-equivalent automated checks report no serious/critical violations on slice routes;
- all flows complete with keyboard only;
- screen-reader names describe action and target, not only numeric value/icon;
- focus is trapped/restored for modal surfaces and moves to a submitted error summary;
- touch targets are at least 44 × 44 CSS px, 48 px preferred for play actions;
- 200% text zoom, reduced motion, and forced-colors preserve meaning and operation;
- color is never the sole state indicator.

### AC-18 — Privacy and architecture

- React UI does not write Dexie tables directly;
- character, version, snapshot, level-up, transfer, and multi-record changes use the appropriate service/repository boundary and transactions;
- a record is versioned before replacement;
- public, private, legacy, homebrew, character, and runtime state remain distinguishable;
- tests, snapshots, logs, validation issues, and errors contain synthetic data and do not echo sensitive fields;
- imported data is declarative and never evaluated as code.

The service and transaction contracts in [M2_SERVICE_BOUNDARIES.md](M2_SERVICE_BOUNDARIES.md) are acceptance requirements: UI never writes Dexie directly, only the resolver calculates authoritative derived values, runtime actions update runtime state plus action log without a full version, and every stale-state or transaction failure produces no partial writes.

### AC-19 — Expression-only dice scope

Attack and check details display an accessible expression and an actionable Copy expression control. M2.1 has no control labelled Roll, no random result, no dice animation, and no roll history.

## Verification matrix

| Layer | Minimum evidence |
| --- | --- |
| Pure unit | step planning, recommendation ranking, renderable classification, typed override validation, derived explanations, transfer conflict plan, level-up/current-value diff |
| Dexie integration | draft autosave, service stale-state, every transaction rollback boundary, version-before-replace, runtime/action-log atomicity, missing source, duplicate/conflict, restricted export |
| Component/a11y | all named states, focus behavior, live regions, mode switch, overrides |
| E2E mobile | blank → Brammel → sheet; reload resume; offline play; level-up and undo; transfer conflict at 360/390/412 |
| E2E responsive | library/builder/sheet/Settings at 768/1024/1440 plus overflow assertion at all six widths |
| Privacy regression | diagnostics and test output exclude private fields/values |

## Required repository verification

Before M2.1 implementation is declared complete, all contributor-guide commands must pass:

```bash
npm run typecheck
npm test
npm run test:e2e
npm run build
```

For this documentation-only branch, the same commands are still run as a regression check even though no production files change.

## Definition of Ready for M2.1

M2.1 production implementation is ready to start because this branch supplies the required gate evidence:

- [M2_DECISIONS.md](M2_DECISIONS.md) closes every prior design question and records explicit deferrals;
- the original synthetic fixture inventory is enumerated, with “Boss” restricted to identity and levels 1–2 bounded;
- automatic and Manual renderable contracts are distinct and testable;
- typed `replace`/`add` overrides, history separation, level-up current-value policy, file-transfer scope, expression-only behavior, and 1024 px fallback are fixed;
- [M2_SERVICE_BOUNDARIES.md](M2_SERVICE_BOUNDARIES.md) defines inputs, outputs, reads/writes, stale checks, transaction boundaries, rollback, privacy, and calculation ownership;
- [prototype/FINDINGS.md](prototype/FINDINGS.md) validates the nine-step shell, mode preservation, representative choices, Review, Play, override, and transfer at 360 px first and all six required widths;
- prototype and documentation contain only original synthetic text and no external dependencies;
- repository regression checks and documentation/prototype checks pass before this branch is proposed for merge.

Implementation must still submit any required persistence schema change as reviewed M2.1 code with migrations and rollback/privacy tests. That is implementation work, not an unresolved product decision.

## GO / NO-GO gate

**GO for a bounded M2.1 production implementation. NO-GO for any work outside the exact in-scope list above.**

Recommended next branch: `codex/m2.1-brammel-character-slice`. It implements level 1→2 only, the named original fixtures, the agreed services/repositories, automatic and Manual renderable contracts, runtime/action-log separation, typed overrides, standard file transfer, expression copying, and the responsive character surfaces. All explicit deferrals remain out of scope.
