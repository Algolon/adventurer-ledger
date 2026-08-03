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
    orientation: "any",
    background_color: "#F6EBD6",
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
