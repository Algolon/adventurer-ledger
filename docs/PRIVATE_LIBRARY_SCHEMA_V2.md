# Private library schema v2

Schema v2 is the content contract for local owned-source libraries. IndexedDB remains authoritative; UI code only uses repositories and import services.

## Boundaries

- Every category is a strict discriminated Zod variant with category-specific `mechanics`.
- `fullText`, `summary`, `mechanics`, declarative `effects`, `sourceLocator`, and `reviewStatus` are separate fields.
- Review status advances monotonically in the editorial workflow: `extracted` → `text-reviewed` → `mechanics-reviewed` → `engine-verified`.
- Effects, values, conditions, choices, and prerequisites are declarative allow-lists. Formula names are allow-listed; HTML event handlers, executable markup, forbidden object keys, and unknown fields are rejected. Nothing evaluates imported code.
- Every allowed effect has a machine-readable runtime disposition: `automatic`, `choice-driven`, or `manual-adjudication`. Manual effects and unresolved choices create visible review issues; no structurally valid effect is silently ignored. See `M1.4_RULES_ENGINE_COVERAGE.md`.
- Typed links describe builder-facing relations. Required targets block an import set; optional links remain resolvable later.
- Pack `dependencies` block when absent. `optionalDependencies` produce warnings. Files are previewed as one namespace and, inside one flat Dexie transaction, revalidated as that same complete namespace against confirmation-time database state before anything is written. A single-file confirmation is revalidated as a one-file set, so it cannot bypass the cross-file guarantees. Stale or newly invalid state returns a typed `ImportConfirmationError` and writes nothing. See `M1.4_RULES_ENGINE_COVERAGE.md`.
- Pack `coverage` is `pilot`, `partial`, or `complete`. Missing metadata defaults to `complete`, except clearly marked legacy pilot/partial identities are inferred conservatively. Bounded packs must declare actual coverage. Import previews always warn for pilot and partial packs, and pilot identities cannot claim complete coverage.
- Stable IDs survive revisions. Prior records are archived before replacement. Replacement and edition edges must resolve.
- Conflict winners are deterministic by source priority, revision, then stable ID. The ruleset still controls whether alternatives may coexist.

## Migration

Content-pack schema 0 and 1 are migrated in memory to v2 before validation. Existing fields, including private text, are retained. Missing v2 metadata receives conservative defaults (`extracted`, unlocated source page, no links/dependencies, category-safe mechanics). Dexie database version 3 applies the same enrichment transactionally to existing local synthetic records and records pack schema version 2.

Defaults make old records lossless and importable; they do not claim editorial accuracy. Migrated records must be mechanics-reviewed before use by the future builder.

## Local PDF ingestion

`npm run ingest:private-pdf -- --pdf /absolute/input.pdf --manifest /absolute/private-manifest.json --output /absolute/name.private.json`

The command accepts only explicit absolute paths, calls local `pdftotext`, writes mode `0600`, refuses repository output, and never prints extracted content. It has no downloader, scraper, OCR service, upload, or network path. The private manifest supplies structured records and explicit PDF page numbers; page text is inserted only into `fullText` in the private output.

Keep both the source directory and generated-output directory outside the repository. Pass their explicit absolute paths only at execution time; do not record personal filesystem locations in repository files or diagnostics.

The bounded local pilot uses ID `private-phb-2024-brammel-pilot` with `coverage: "pilot"`. Eventual complete outputs may use IDs such as `private-phb-2024`; all private outputs match `*.private.json` and must never be committed.

Local production-path validation:

`ADVENTURER_LEDGER_PRIVATE_PACK=/absolute/pack.private.json npm test -- tests/private-ingestion.local.test.ts`

This runs the normal validator, preview, importer, duplicate/revision checks, and isolated Dexie storage without putting private text in test output.

## Coverage and remaining risks

Covered now: class/subclass progression, backgrounds and ASI choices, feats/prerequisites, species/lineage/legacy traits, spells and lists, equipment, monster eligibility, links, dependencies, priorities/conflicts, review state, migration, atomic import sets, revision history, rollback, and sanitized diagnostics.

M1.4 adds dice/roll rules, nested equipment bundles, baseline multiclass semantics, and exhaustive effect-runtime dispositions without changing `schemaVersion: 2`. Remaining risks before full PHB conversion are prepared/known spell merging, pact-slot behavior, every unusual spell scaling/target idiom, free-form monster recharge/action grammar, real errata/reprint conflict pilots, and independent mechanics review. These remain a NO-GO for bulk PHB conversion; the Brammel slice is intentionally bounded to levels 1–5.
