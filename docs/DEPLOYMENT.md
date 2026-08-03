# Deployment

## Temporary GitHub Pages test

The M1.2 test target is `https://algolon.github.io/adventurer-ledger/`. The canonical build-time setting is:

```bash
NEXT_PUBLIC_BASE_PATH=/adventurer-ledger
```

`npm run build:pages` creates a static `out/` artifact with scoped Next.js assets, manifest metadata, public icons, service worker, offline fallback, and `.nojekyll`. `npm run verify:pages` rejects root-path leakage in the generated HTML, manifest, or worker precache.

`.github/workflows/pages-test.yml` runs only after pushes to `codex/m1-private-content-pipeline`. It tests root hosting, Pages-project hosting, and a real two-build controlled update before uploading only `out/`. After the physical-phone test, change its sole `on.push.branches` entry to `main` in a separately reviewed change; do not add `main` while this temporary deployment is active.

Repository **Settings → Pages → Build and deployment → Source** must be set to **GitHub Actions**. The workflow cannot change that repository setting.

## Root/self-hosted build

Leave `NEXT_PUBLIC_BASE_PATH` empty and run `npm run build`. The app then uses `/`, `/sw.js`, and `/manifest.webmanifest`. `public/_headers` is a reference for compatible self-hosting platforms only.

GitHub Pages does not interpret `public/_headers`. Its worker lives at `/adventurer-ledger/sw.js` with scope `/adventurer-ledger/`, so a `Service-Worker-Allowed: /` response header is neither available nor required. Pages also offers no project-controlled CSP or other custom response headers; this limits defense in depth but does not block the temporary test deployment.
