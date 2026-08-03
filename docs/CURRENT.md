# Current state

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

## Device and installation behavior

- Every phone, desktop browser, browser profile, and installed PWA has its own IndexedDB.
- Desktop data does not automatically synchronize to a phone. No account, sync API, or server database exists.
- Packs and characters must be exported and imported manually between devices. Restricted definitions require the separate explicit export confirmation.
- Initial installation and application updates require HTTPS, except browser-recognized localhost development.
- After one successful online load and service-worker installation, the cached application shell can reload and operate offline. Local compendium reads, edits, search, and JSON export require no network.
- Persistent storage may reduce browser eviction risk, but browsers can refuse it and it never replaces a backup.

## Next milestone

M2 is the character build pipeline: persisted drafts, source/ruleset selection, an original synthetic single-class level 1–20 path, deterministic derived values, overrides, autosave, and restore points.

Deferred risks include browser-profile storage security, unencrypted JSON exports, resumable imports, durable backup/recovery, richer per-effect schema validation, browser-specific storage eviction behavior, and performance profiling on low-end physical phones.

## Working conventions

See [`../AGENTS.md`](../AGENTS.md). Update this file when the implemented state or next milestone changes.
