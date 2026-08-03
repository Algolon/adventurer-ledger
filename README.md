# Adventurer Ledger

Private, local-first D&D 2024/5.5e character builder, library and declarative rules ledger.

This repository contains code, schemas, original test content and empty templates only—no paid rulebook text.

## Run locally

Requires Node.js 22+.

```bash
npm install
npm run dev
```

No account, cloud database, API key or external service is required.

## Foundation

- Next.js/React/TypeScript strict PWA shell
- Dexie/IndexedDB local persistence
- Zod-validated versioned content packs
- declarative, non-executable rules effects with evaluation trace
- source/ruleset separation and Brammel “Boss” Voss fixture
- Vitest unit tests
- private-content deny-list in `.gitignore`

See `docs/ARCHITECTURE.md` for the full architecture, data model, rules engine, storage/encryption strategy, roadmap and risks.

Private content belongs in IndexedDB or ignored `private-content/`; repository visibility is not the content-separation boundary.
