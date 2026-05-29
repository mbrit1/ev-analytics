# Repository Guidelines

## Project Structure & Module Organization

This is a React 19, TypeScript, Vite PWA for offline-first EV charging analytics. Application code lives in `src/` and is layered as:

- `src/app/`: app composition, top-level shell, and provider wiring.
- `src/features/<domain>/`: domain workflows (for example `auth`, `charging-sessions`, `offline-sync`, `tariffs`) with `components/`, `hooks/`, `services/`, `model/`, and `index.ts`.
- `src/shared/ui/`: reusable, domain-agnostic UI primitives.
- `src/shared/lib/`: pure shared helpers without infrastructure dependencies.
- `src/infra/`: technical adapters and integrations (`db`, `supabase`, `mocks`).
- `src/test/` and `src/mocks/`: shared testing and mock infrastructure.

Assets belong in `public/` or `src/assets/`. Supabase files are in `supabase/`; ADRs are in `docs/adr/`.

Boundary rules:
- `features` may depend on `shared` and approved `infra` interfaces.
- `shared` must remain domain-agnostic and never import from `features`.
- `infra` contains implementation details and must not import from `features`.
- Cross-feature imports must use `src/features/<domain>/index.ts` rather than deep paths.

## Build, Test, and Development Commands

- `npm run dev`: start Vite locally.
- `npm run build`: type-check and build `dist/`.
- `npm run build:analyze`: build with bundle analysis output (`dist/bundle-stats.json`) for size/performance investigations.
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

For structural refactors, use a `move first, behavior unchanged` sequence, then separate behavioral changes into follow-up commits with targeted tests.

## Commit & Pull Request Guidelines

Use small, scoped changes and avoid unrelated refactors. Create a feature branch before code changes, for example `feat/phase-2-auth`. Use Conventional Commits: `type(scope): description`, such as `feat(sync): implement offline outbox queue`. Commit bodies explain why and note trade-offs. Before proposing a push or PR, run:

```bash
npm run lint && npm run test -- --run && npm run build
```

PRs need a summary, verification results, linked issues/ADRs, and screenshots for UI changes. Agents must not push, create PRs, or merge without explicit human authorization.

## Agent Workflow Notes

`AGENTS.md` is Codex’s source of truth. `GEMINI.md` remains legacy/reference guidance. Superpowers artifacts live in `docs/superpowers/specs/` and `docs/superpowers/plans/`; use them for planned work, but rely on the installed plugin for workflow mechanics.

Design governance baseline:
- `docs/superpowers/specs/2026-05-16-Design-System-Sandbox-v2.0.html` is the default UI baseline for tokens and component patterns.
- Apply the checklist in `docs/superpowers/specs/2026-05-29-design-governance-checklist.md` for UI changes.
- If a screen-specific change intentionally deviates and improves UX, note the deviation in handoff notes and classify it as `local exception` or `promote to master`.

When changing project structure:
- verify import boundary rules with lint checks,
- verify behavior with tests/build,
- and include `moved paths + boundary impact` explicitly in handoff notes.

For performance-sensitive work (new dependencies, major UI additions, bundling/runtime changes), run `npm run build:analyze` and include notable bundle-size deltas or top chunk drivers in handoff notes.

On handoff, summarize changed files, verification, risks, and a suggested commit message.

## Security & Configuration Tips

Do not commit secrets. Local Supabase credentials belong in `.env.local`; `.env.example` documents required keys. Preserve the private, single-user posture: default-deny RLS, authenticated access only, and offline entry without active connectivity.
