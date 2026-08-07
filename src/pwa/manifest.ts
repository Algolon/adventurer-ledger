import type { MetadataRoute } from "next";
import { APP_ROOT, withBasePath } from "@/src/config/base-path";

export function createManifest(): MetadataRoute.Manifest {
  return {
    id: APP_ROOT,
    name: "Runefolio",
    short_name: "Runefolio",
    description: "Private local-first adventurer library and character ledger",
    start_url: APP_ROOT,
    scope: APP_ROOT,
    display: "standalone",
    /*
     * Portrait is the shape of the product on a phone.
     *
     * `"any"` let Android rotate the installed app into a landscape layout that
     * was never designed: the sheet's vitals row, the bottom bar and the app bar
     * together left about a hundred pixels of content between them. The manifest
     * states the intent for the installed app; `src/pwa/orientation.ts` asks the
     * Screen Orientation API to honour it at runtime, and the portrait guard
     * covers the case where neither is available.
     */
    orientation: "portrait-primary",
    /*
     * The splash screen and the shell behind it. This was warm parchment, so an
     * install launched light and then repainted dark on first frame — the flash
     * this pass exists to remove. Both values now match the shipped shell.
     */
    background_color: "#08121B",
    theme_color: "#0F1D29",
    categories: ["productivity", "games"],
    icons: [
      { src: withBasePath("/icons/runefolio-icon-192.png"), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: withBasePath("/icons/runefolio-icon-512.png"), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: withBasePath("/icons/runefolio-maskable-192.png"), sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: withBasePath("/icons/runefolio-maskable-512.png"), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
