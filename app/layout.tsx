import type { Metadata, Viewport } from "next";
import "./theme.css";
import "./globals.css";
import "./m1.css";
import { PwaProvider } from "@/src/ui/pwa-status";
import { withBasePath } from "@/src/config/base-path";

export const INSTALL_METADATA_VERSION = "runefolio-2";

/** The shell colour, repeated in the manifest and in the first paint below. */
const SHELL_BACKGROUND = "#08121B";
/** The app bar colour, which is what the OS tints browser chrome with. */
const SHELL_THEME = "#0F1D29";

export const metadata: Metadata = {
  title: "Runefolio",
  description: "Private local-first adventurer library and character ledger",
  applicationName: "Runefolio",
  icons: {
    icon: [
      { url: withBasePath("/brand/runefolio-favicon.svg"), type: "image/svg+xml" },
      { url: withBasePath("/icons/runefolio-favicon-32.png"), sizes: "32x32", type: "image/png" },
      { url: withBasePath("/icons/runefolio-favicon-16.png"), sizes: "16x16", type: "image/png" },
    ],
    shortcut: withBasePath("/runefolio-favicon.ico"),
    apple: { url: withBasePath("/icons/runefolio-apple-touch-icon.png"), sizes: "180x180", type: "image/png" },
  },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Runefolio" },
};

/*
 * `colorScheme` emits <meta name="color-scheme">, which is what tells the
 * browser which user-agent palette to use for form controls, scrollbars and the
 * overscroll canvas. Runefolio has one theme, so it says "dark" unconditionally
 * — not "light dark", which would hand the choice back to the operating system.
 * A phone set to light renders Runefolio dark.
 */
export const viewport: Viewport = {
  themeColor: SHELL_THEME,
  colorScheme: "dark",
  /*
   * `viewport-fit=cover` is what makes `env(safe-area-inset-*)` report real
   * values on a notched phone. Without it the insets are all zero and the app
   * bar sits under the status bar.
   */
  viewportFit: "cover",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    /*
     * The shell colour is stated inline on <html> as well as in `theme.css`.
     *
     * The stylesheet is render-blocking, so in practice it always wins, but the
     * inline value is what paints if the document is shown before any
     * stylesheet resolves — a cold install on a slow connection, or the frame
     * between the splash screen and first paint on Android. It is the
     * difference between a dark app and a white flash on every launch.
     */
    <html lang="en" style={{ colorScheme: "dark", background: SHELL_BACKGROUND }}>
      <head>
        <link rel="manifest" href={`${withBasePath("/manifest.webmanifest")}?v=${INSTALL_METADATA_VERSION}`} />
      </head>
      <body data-app-build={process.env.NEXT_PUBLIC_BUILD_LABEL ?? "production"}>
        <PwaProvider>{children}</PwaProvider>
      </body>
    </html>
  );
}
