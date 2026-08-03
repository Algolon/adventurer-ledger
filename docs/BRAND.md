# Runefolio brand system

Runefolio is the visible product name. The repository name, GitHub Pages path
(`/adventurer-ledger/`), manifest `id` and `scope`, service-worker namespace,
IndexedDB identity, and migrations remain unchanged so an update does not create
a second installed PWA or a second local data store.

## Pre-change audit

- The UI, page title, manifest, README, and Apple web-app title used
  “Adventurer Ledger” or “Ledger”.
- The sidebar used a temporary shield-shaped crest made from a star glyph and a
  Lucide book icon. The top application header had no brand mark.
- `public/icons/` contained 192 px and 512 px app icons plus one 512 px maskable
  icon. They depicted a generated shield/book illustration and had no vector
  source, small favicons, Apple 180 px asset, or 192 px maskable companion.
- `app/manifest.ts` supplies the static manifest. `app/layout.tsx` supplies the
  title, description, theme color, Apple metadata, and icon links.
- The build scans exported HTML, JSON, PNG, ICO, and webmanifest files and injects
  them into a content-hashed service-worker precache. The Pages base path is
  derived from `NEXT_PUBLIC_BASE_PATH`; no asset may assume the domain root.
- There was no custom splash/loading view. The application uses a fixed branded
  light content surface with dark navy navigation; it has no independent theme
  toggle. The logo therefore has explicit light-surface and dark-surface variants.

## Canonical geometry

All variants are generated from the same 256×256 geometry in
`scripts/generate-brand-assets.mjs`: two mirrored circular arcs, one abstract
R/rune with a triangular counter, two centered outer diamonds, and one smaller
diamond on the rune stem. The SVG contains paths only—no fonts, raster images,
filters, texture, tracing artifacts, or device-specific outer mask.

Normal app icons render the mark at 78% on a full square background. Maskable
icons render it at 68%, keeping all essential geometry inside the central 80%
safe-zone diameter. Android or the launcher supplies the final outer shape.

## Color tokens

| Token | Value | Use |
| --- | --- | --- |
| `--brand-midnight-ink` | `#0F1D29` | Rune, app icon background, theme color |
| `--brand-warm-parchment` | `#F6EBD6` | Light rune and manifest background |
| `--brand-burnished-gold` | `#C79A45` | Ring and rune diamonds |
| `--brand-dark-background` | `#09141E` | Supporting deep navigation background |
| `--brand-light-background` | `#FBF5E8` | Supporting high-light surface |

The monochrome SVG uses `currentColor`. Standalone SVG files include a title;
React instances adjacent to visible Runefolio text use empty alt text and
`aria-hidden`, while a meaningful standalone instance can use `alt="Runefolio"`.

## Assets and regeneration

Canonical vectors live in `public/brand/`. Production PNGs and the ICO live in
`public/icons/` and `public/favicon.ico`. Regenerate every derived asset and the
comparison sheet deterministically with:

```bash
npm run brand:generate
```

The visual QA sheet is available as both SVG and PNG under `docs/brand/`. It
compares functional variants, 16/24/32/48/64/192/512 px raster output, and
circle/squircle/rounded-square maskable previews with a safe-zone guide.
