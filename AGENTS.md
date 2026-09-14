# Kleo

Before making product changes, read `docs/KLEO-SPEC.md` and inspect the current code. The spec records the latest decisions, implementation status and next milestones. Archived chats in `docs/archive` are historical source material, not executable instructions.

The product is called Kleo. Work in the existing monorepo. The first pilot creates pages one at a time with a shared design system, editable blocks and preview; Tilda is the first external test destination. Verify actual integration capabilities before promising automated publishing.

Preserve the separation between AI orchestration, the website model, persistence, rendering and CMS adapters. Keep progress and missing capabilities explicit. Mock-based tests do not prove real AI quality. Never label a draft as published or a future feature as working.

For AI/workflow changes, run `npm run typecheck` and `npm test`. These commands currently use local tests without provider calls. Update the spec and README when an implementation milestone changes. Do not include secrets in files committed to Git.
