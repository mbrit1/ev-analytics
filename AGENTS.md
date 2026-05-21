# Repository Guidelines

## Project Structure & Module Organization

This is a React 19, TypeScript, Vite PWA for offline-first EV charging analytics. Application code lives in `src/`. Feature work belongs under `src/features/<domain>/`, such as `auth`, `charging-sessions`, `offline-sync`, and `tariffs`. Shared infrastructure is in `src/lib/`, reusable UI in `src/components/ui/`, and tests/mocks in `src/test/` and `src/mocks/`. Assets belong in `public/` or `src/assets/`. Supabase files are in `supabase/`; ADRs are in `docs/adr/`.

## Build, Test, and Development Commands

- `npm run dev`: start Vite locally.
- `npm run build`: type-check and build `dist/`.
- `npm run lint`: run ESLint.
- `npm run test`: start Vitest watch mode.
- `npm run test -- --run`: run Vitest once.
- `npm run preview`: build and serve via Wrangler.
- `npm run deploy`: build and deploy with Wrangler.

## Coding Style & Naming Conventions

Use strict TypeScript and React function components. Prefer feature-local code before shared abstractions. Components use `PascalCase.tsx`, hooks `useName.ts`, services `nameService.ts`, and tests `*.test.ts(x)`.

Document exported interfaces, props types, and components with standard JSDoc (`/** ... */`). Keep comments concise and focused on why the code exists, important layout or domain behavior, and brief prop intent; rely on TypeScript for exact type details. No emojis in source, comments, or config unless intentionally rendered in UI.

## Architecture & Domain Rules

Data entry must remain offline-first: never require connectivity to create or edit charging data. Use Dexie plus the outbox pattern for local writes, optimistic UI, and later Supabase sync. Keep Supabase private and single-user with default-deny RLS. Store money as integer cents, render EUR with European decimals, keep storage dates in UTC, and preserve tariff snapshots on sessions. Significant architecture decisions require an ADR.

## Testing Guidelines

Vitest, React Testing Library, jsdom, MSW, and fake IndexedDB are used for tests. Keep tests near covered code, as in `src/features/tariffs/services/tariffService.test.ts`.

Every test file should include a suite-level JSDoc block above the main `describe` explaining the file's focus. Use Arrange, Act, Assert comments inside test blocks (`// Arrange: ...`, `// Act: ...`, `// Assert: ...`) so setup, behavior, and expectations stay clear. Cover domain logic, offline sync, idempotency, tariff snapshots, and changed UI workflows. Sync/data mutations should expose queue length, retry count, and last sync attempt.

## Commit & Pull Request Guidelines

Use small, scoped changes and avoid unrelated refactors. Create a feature branch before code changes, for example `feat/phase-2-auth`. Use Conventional Commits: `type(scope): description`, such as `feat(sync): implement offline outbox queue`. Commit bodies explain why and note trade-offs. Before proposing a push or PR, run:

```bash
npm run lint && npm run test -- --run && npm run build
```

PRs need a summary, verification results, linked issues/ADRs, and screenshots for UI changes. Agents must not push, create PRs, or merge without explicit human authorization.

## Agent Workflow Notes

`AGENTS.md` is Codex’s source of truth. `GEMINI.md` remains legacy/reference guidance. Superpowers artifacts live in `docs/superpowers/specs/` and `docs/superpowers/plans/`; use them for planned work, but rely on the installed plugin for workflow mechanics. On handoff, summarize changed files, verification, risks, and a suggested commit message.

## Security & Configuration Tips

Do not commit secrets. Local Supabase credentials belong in `.env.local`; `.env.example` documents required keys. Preserve the private, single-user posture: default-deny RLS, authenticated access only, and offline entry without active connectivity.
