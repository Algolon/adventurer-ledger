# Runefolio

Private, local-first D&D 2024/5.5e character builder, library and declarative rules ledger.

The visible product is Runefolio; the repository and stable PWA/storage identity
remain `adventurer-ledger`. See [`docs/BRAND.md`](docs/BRAND.md) for the canonical
logo geometry, color tokens, production assets, and regeneration workflow.

This repository contains code, schemas, original test content and empty templates only—no paid rulebook text.

## Run locally

Requires Node.js 22+.

```bash
npm install
npm run dev
```

No account, cloud database, API key or external service is required.

### Reviewing a real build

`npm run dev` is for development. To review what actually ships — the static export, served
from its real base path — use:

```bash
npm run review:local
```

It builds the Pages artifact, serves it at `http://127.0.0.1:4180/adventurer-ledger/`, prints
that URL and the commit being reviewed, and keeps running until you stop it with Ctrl+C.

Open the URL **exactly as printed**. The browser treats `http://localhost:4180` and
`http://127.0.0.1:4180` as different origins, and characters, drafts and imported rulesets are
stored per origin, so the other spelling looks like a brand-new device. The port is fixed for
the same reason: the origin stays stable across restarts, so stopping and starting the command
keeps everything you have already created.

To review on a clean device without touching any other browser data, either open the URL in a
private window, or run it on a different port — which is a different origin and therefore starts
empty:

```bash
REVIEW_PORT=4181 npm run review:local
```

Development only. It reads no private content and contacts no external service.

### Building

`npm run build` produces the complete static site in `out/`, including a content-versioned `sw.js`. Serve it over HTTPS and reproduce the service-worker headers in `public/_headers`. Each device has independent IndexedDB storage; transfer data manually with confirmed exports/imports.

For the temporary GitHub Pages project deployment, use `npm run build:pages`; see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the scoped URL, workflow, and host limitations.

## Foundation

- Next.js/React/TypeScript strict PWA shell
- Dexie/IndexedDB local persistence
- Zod-validated versioned content packs
- declarative, non-executable rules effects with evaluation trace
- source/ruleset separation and Brammel “Boss” Voss fixture
- Vitest unit tests
- private-content deny-list in `.gitignore`
- M1 private content pipeline with transactional preview/import, version history, restricted-export consent, local editors and compendium browsing
- installable static PWA with controlled offline shell updates and device-local storage monitoring

See `docs/ARCHITECTURE.md` for the full architecture, data model, rules engine, storage/encryption strategy, roadmap and risks.

Private content belongs in IndexedDB or ignored `private-content/`; repository visibility is not the content-separation boundary.
