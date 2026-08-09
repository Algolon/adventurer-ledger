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
- There was no custom splash/loading view. The application used a fixed branded
  light content surface with dark navy navigation, so the logo was drawn with
  explicit light-surface and dark-surface variants.

  **This is no longer current.** Runefolio has one theme and it is dark; see
  [`MOBILE_VISUAL_CONTRACT.md`](./MOBILE_VISUAL_CONTRACT.md). There is still no
  theme toggle, and there is no longer anything for one to toggle. The inverse
  (light-on-dark) variant is the one the app renders; the default and monochrome
  variants remain for export, print and forced-colours use.

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
| `--brand-midnight-ink` | `#0F1D29` | Rune, app icon background, app bar, manifest `theme_color` |
| `--brand-warm-parchment` | `#F6EBD6` | Light rune, and the app's primary text colour |
| `--brand-burnished-gold` | `#C79A45` | Ring and rune diamonds, and the app's accent and borders |

These three are the identity and are declared in
[`app/theme.css`](../app/theme.css), which derives every application surface,
text and line token from them. The former `--brand-dark-background` and
`--brand-light-background` are gone: they described the two backgrounds of a
two-theme app. The single dark canvas is `--paper` (`#08121B`), and the shade
behind it, which an overscroll bounce exposes, is `--deep` (`#060D14`).

The monochrome SVG uses `currentColor`. Standalone SVG files include a title;
React instances adjacent to visible Runefolio text use empty alt text and
`aria-hidden`, while a meaningful standalone instance can use `alt="Runefolio"`.

## Typography

Runefolio licenses an Adobe Fonts web project. Adobe hosts the files. This
repository contains no font binary, declares no `@font-face`, and the service
worker never precaches anything from Adobe's host — `tests/typography.test.ts`
fails if any of those three stops being true. The project is linked once, from
the document head, using the URL exported by
[`src/config/fonts.ts`](../src/config/fonts.ts):

```html
<link rel="stylesheet" href="https://use.typekit.net/xlu6nmm.css">
```

Type is used as hierarchy, not as decoration. Each family is a token in
[`app/theme.css`](../app/theme.css) and nothing outside that file names a family
directly.

| Token | Family | Weight | Where it is used |
| --- | --- | --- | --- |
| `--wordmark` | Bookmania | 700 | The Runefolio wordmark, and nothing else |
| `--title` | Bookmania | 600 | Page titles, creation step titles, character names |
| `--accent` | Modesto Light Condensed | 300 | Section and category headings, in creation and on the sheet; never below 14 px |
| `--display-text` | Modesto Light | 300 | Empty-state headings and the sheet's details-drawer titles |
| `--display` | Georgia | 600/700 | Stat values, resource counts and other numeric display |
| `--ui` | Inter / system UI | — | Body copy, controls, options, equipment, numbers, dense lists |

### The wordmark's size is measured, not chosen

The mark sits centred in the app bar as one unit — the logo and the word, with
equal space either side of the pair and no trailing spacer holding it there —
at 20 px over a 33 px logo.

Twenty is a ceiling rather than a preference. Bookmania Bold sets about 5%
smaller than the Georgia it falls back to: 14.3 px of cap height at 20 px
against Georgia's 15.1 px, measured on the running app rather than assumed. So
it needs those extra pixels to carry the presence a phone wordmark wants. It
cannot have more of them, because the smallest title in this application is a
21 px creation step heading in the same family, and a wordmark that matches or
outgrows the title of the screen underneath it has stopped being a label and
become a masthead. `tests/e2e/sheet-ia-evidence.spec.ts` reads both sizes off
the painted page and fails if the wordmark ever reaches the step title, so the
rule is checked rather than remembered.

### Where Modesto Light Text was, and was not, adopted

`--display-text` is deliberately narrow. It carries the sheet's details-drawer
titles — a short, prominent, entirely non-interactive heading naming one thing —
and the empty-state headings it already had.

It was evaluated and rejected for three other places, for reasons worth keeping:
feature and spell row titles (a 300 weight at 15 px on a dark surface reads
lighter than the muted line under it, which inverts the row); long descriptions
(a light serif at body size costs measurable reading comfort in dark mode for no
hierarchy gain); and any control label (a control's text has to hold at the
weight the control is drawn at). Density was the constraint in each case, and
this pass was not willing to spend it on flavour.

### The webfont is an enhancement, not a dependency

Every token above ends in a stack that is already on the device, and every size,
line height and measure in the app is chosen against that fallback. An installed
Runefolio that has never reached the network renders in a local serif and
behaves identically: `tests/e2e/typography.spec.ts` loads the app with Adobe's
host refused, proves nothing loaded, and then asserts the same contract as
the rest of the suite — no sideways scroll at 320/360/375/390/412 px, no
navigation label trimmed to fit, every control still a 44 px target, and every
heading still outranking the options beneath it.

The one cost is that the stylesheet is render-blocking while the browser
resolves it, which is what the ordinary Adobe integration does. With no route to
the host the request fails immediately and the app paints in its fallback; the
offline suite asserts that this is the *only* request allowed to fail with the
network off.

## Assets and regeneration

Canonical vectors live in `public/brand/`. Production PNGs and the ICO live in
`public/icons/` and `public/runefolio-favicon.ico`. Their filenames are
Runefolio-prefixed so browsers cannot reuse pre-rebrand installation icons at
the former generic URLs. The HTML references the manifest as
`manifest.webmanifest?v=runefolio-1`; bump that explicit version only when
installation metadata requires another deliberate cache invalidation.

Regenerate every derived asset and the comparison sheet deterministically with:

```bash
npm run brand:generate
```

The visual QA sheet is available as both SVG and PNG under `docs/brand/`. It
compares functional variants, 16/24/32/48/64/192/512 px raster output, and
circle/squircle/rounded-square maskable previews with a safe-zone guide.
