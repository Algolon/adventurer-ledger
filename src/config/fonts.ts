/**
 * Runefolio's licensed Adobe Fonts web project.
 *
 * One string, in one place, because three different things have to agree about
 * it: the document that links it, the tests that block it to prove the app
 * survives without it, and anything that has to account for the single external
 * host this otherwise entirely local-first application reaches.
 *
 * Adobe hosts the fonts. Nothing in this repository downloads, converts,
 * self-hosts, caches or commits a font binary, and the service worker's
 * precache is built from this project's own build output, so an installed
 * Runefolio has no copy of them either. The families this supplies —
 * `bookmania`, `modesto-condensed` and `modesto-text` — are declared in
 * `app/theme.css` at the front of stacks that are already on the device, and
 * every size and measure in the app is set against those fallbacks. If this
 * stylesheet never arrives, Runefolio renders in a local serif and behaves
 * identically.
 */
export const ADOBE_FONTS_STYLESHEET = "https://use.typekit.net/xlu6nmm.css";

/** The origin of the above, for request-level allowances and assertions. */
export const ADOBE_FONTS_ORIGIN = new URL(ADOBE_FONTS_STYLESHEET).origin;

/**
 * The families the web project supplies, as they are named in `theme.css`.
 *
 * Used by the typography tests to tell "the enhancement loaded" from "the
 * fallback is in play" without hard-coding family names in two places.
 */
export const ADOBE_FONT_FAMILIES = ["bookmania", "modesto-condensed", "modesto-text"] as const;
