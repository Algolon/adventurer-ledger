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

The product surfaces are mobile first: a real empty library, the exact nine-step builder with one draft behind both guided and flexible modes, an active play sheet with bounded runtime actions and explanations, a level-up preview with a before/after diff and a pre-level restore point, and standard file transfer with Already current, Keep both, Replace and Cancel. Dice support is expression-only; there is no Roll control.

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
| Verified in a browser | Chromium, at 360, 390, 412, 768, 1024 and 1440 CSS px, plus offline, reduced motion, forced colours and axe checks. |
| Requires physical Android validation | Not done. Touch targets are verified in CSS pixels only; real-device performance, install behaviour and storage eviction are unverified. Playwright is not evidence of physical-device behaviour. |

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
