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

## M2.1 delivered

M2.1 turns that foundation into the first working character product, bounded to levels 1 and 2 of one original synthetic class.

Database version 5 adds character drafts, revision-bearing committed characters, immutable versions, restore snapshots, runtime state, a session action log, typed overrides and safe derived snapshots. The version 4 to 5 upgrade splits any legacy character row into durable and runtime state inside Dexie's version-change transaction, leaves content, packs and sources untouched, and reports failures by stable ID and field path only.

Seven application services own every mutation: draft, build/commit, query, derived resolver, runtime, level-up and transfer. Each validates an expected revision inside the same transaction that writes, so a stale command performs no writes and returns a typed outcome rather than an exception string. A record is versioned before it is replaced. Runtime actions write runtime state plus one action entry and never a durable version. The application-layer resolver is the only component that produces authoritative derived values; React components import services, never Dexie.

The synthetic slice supplies Vanguard, Riverborn, Caravan Warden, Guarded Hand, Measured Cut, Longblade, Round Guard, Travel Mail, Longblade Strike and Rallying Breath, level-keyed by stable ID so later levels are a data change. Brammel resolves to 10 maximum hit points and 3 Rallying Breath uses at level 1, and 12 and 4 at level 2, which is the preserve-deficit demonstration the acceptance criteria require.

The product surfaces are mobile first: a real empty library, the exact nine-step builder with one draft behind both guided and flexible modes, an active play sheet with bounded runtime actions and explanations, a level-up preview with a before/after diff and a pre-level restore point, and standard file transfer with Already current, Keep both, Replace and Cancel. Dice support is expression-only; there is no Roll control.

Unknown required inputs render as `—` with a recovery action rather than zero. Overrides accept only typed `replace` and `add` against an allow-listed path and are marked for review rather than discarded when the baseline moves.

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
