# Adventurer Ledger contributor guide

`AGENTS.md` is the canonical instruction set for this repository.

## Architecture

- Keep the app local-first: IndexedDB through Dexie is the authoritative content store.
- Separate domain schemas, persistence repositories, import/export services, and React UI. UI code must not write Dexie tables directly.
- Prefer strict, declarative data and pure validation/planning functions. Never evaluate imported code.
- Make multi-record changes in one Dexie transaction. Version a record before replacing it.
- Keep public, private, legacy, homebrew, character, and runtime state explicitly distinguishable.

## Privacy and content separation

- Commit only app code, schemas, documentation, and original synthetic or correctly licensed fixtures.
- Never commit official non-SRD book text, private imports, backups, or local database files.
- Treat `fullText`, notes, imported JSON, and owned-source metadata as sensitive. Do not log them or include them in errors, validation issues, analytics, snapshots, or test output.
- Errors may identify a record by stable ID and field path, but must not echo its private value.
- Exports exclude `exportRestricted` packs, sources, and entries by default. Including them requires a separate explicit confirmation at the export boundary.
- Repository privacy is not a content boundary; `.gitignore`, IndexedDB-only storage, sanitized diagnostics, and deny-by-default exports are the boundary.

## TypeScript and tests

- Keep TypeScript `strict` enabled. Avoid `any`, non-null assertions, and unchecked casts; validate unknown input at boundaries.
- Use stable IDs, ISO timestamps, immutable input objects, and deterministic results.
- Put pure unit tests in `tests/**/*.test.ts`, Dexie integration tests alongside them with isolated database names, and user journeys in `tests/e2e`.
- Test success, invalid input, duplicates, conflicts, rollback, restricted export, and sanitized diagnostics with synthetic content only.
- Prefer accessible roles and labels in UI and Playwright selectors.

## Required verification

Run all commands before declaring work complete:

```bash
npm run typecheck
npm test
npm run test:e2e
npm run build
```

## Definition of done

Work is done when the requested vertical slice works through the UI and service boundaries; migrations and transactions are safe; privacy defaults are enforced; unit, integration, and Playwright coverage includes failure paths; all required verification passes; documentation reflects current behavior; the full diff has been reviewed for scope, private text, and accidental generated files; and remaining risks are reported.
