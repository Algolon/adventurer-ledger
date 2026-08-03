# Security and private-content boundary

## Threat model

M1 protects against accidental import mutation, partial writes, unsafe object keys, private text in diagnostics, and accidental restricted exports. It does not claim browser-profile encryption, protection from a compromised device or extension, or durable backup/recovery.

## Controls

- Imported data is size-limited, parsed as inert JSON, depth/key inspected, migrated in memory, strictly validated, and previewed before writes.
- Duplicate IDs, missing source references, schema problems, pack revisions, and entry revisions are reported without field values.
- Confirmation writes sources, packs, entries, and their prior versions in one Dexie transaction; any failure rolls everything back.
- Confirmation revalidates the original in-memory JSON inside that transaction and compares source, pack, and entry observations with the preview. Forged, mutated, or stale previews cannot commit.
- Normal export omits restricted packs and entries. Restricted export is a distinct operation requiring explicit confirmation.
- Application code must not log import bodies, full text, notes, validation payloads, or export documents.
- React renders stored text as text; the app has no `dangerouslySetInnerHTML`, imported scripts, `eval`, or executable HTML path.
- Private content paths and common local database/export extensions remain ignored by Git.

## Reporting and handling

Do not open a public issue containing private content. Reproduce with synthetic data and report the affected version, operation, stable IDs if safe, and sanitized error code. Remove exposed local exports and rotate any unrelated secrets stored with them.

## Known limitations

IndexedDB is only as protected as the browser profile. M1 exports are plain JSON. Encrypted backup and guided recovery remain future work. Closing a tab during import aborts the open IndexedDB transaction; the prior committed state remains authoritative, but no resumable import job is retained.

## PWA and offline security

- The service worker caches only build-produced application shell assets, icons, the manifest, and same-origin GET responses. IndexedDB content and generated exports are never placed in Cache Storage.
- Service-worker installation and updates require HTTPS in normal deployments. Localhost is the browser-defined development exception.
- New workers wait until the user selects **Update now**. The reload then lets Dexie run database migrations before content repositories are used.
- Self-hosted `sw.js` should use JavaScript content type, `no-cache`, `nosniff`, and a same-origin worker CSP. [`../public/_headers`](../public/_headers) is a reference for hosts that support this format.
- GitHub Pages does not apply `_headers` files or expose project-controlled custom response headers. The Pages worker is therefore deployed inside `/adventurer-ledger/` and uses that natural scope without `Service-Worker-Allowed`. Missing custom CSP and response hardening are accepted host limitations for the temporary test deployment.
- A content hash versions each shell cache. Activation deletes only older Adventurer Ledger shell caches and the known pre-M1 `ledger-v1` cache.
- The active worker serves navigation and shell assets only from its own versioned cache. A waiting worker's completed cache cannot mix new HTML or chunks into the active shell.

## Dependency overrides

Next 16.2.12 is the latest stable 16.2.x release, but every published 16.2.x package pins `postcss@8.4.31` and requests `sharp@^0.34.5`. Those ranges contain current advisories. Because a normal Next update cannot change either path, npm overrides select `postcss@8.5.25` and `sharp@0.35.3`. Both retain compatible Node support; typecheck, unit/integration tests, static production build, dependency resolution, and Playwright flows verify the override. Do not replace this with `npm audit fix --force` or downgrade Next.
