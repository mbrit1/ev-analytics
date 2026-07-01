# EV Charging Analytics PWA

[![CI](https://github.com/mbrit1/ev-analytics/actions/workflows/ci.yml/badge.svg)](https://github.com/mbrit1/ev-analytics/actions/workflows/ci.yml)
[![CodeQL](https://github.com/mbrit1/ev-analytics/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/mbrit1/ev-analytics/actions/workflows/codeql-analysis.yml)

Private, offline-first EV charging analytics as a mobile-focused PWA.

## Overview

This app replaces spreadsheet workflows with structured EV charging session tracking, tariff-aware cost calculations, and personal charging analytics. The core product promise is offline-first behavior: users can create and edit charging data without connectivity, then sync safely when back online.

## Current Capabilities

- Offline-first charging session entry and editing
- Local persistence with Dexie and queued sync via the outbox pattern
- Private, single-user Supabase backend with default-deny RLS
- Tariff, provider, and charging plan modeling
- Monthly charging-session spend analytics
- PWA installability and mobile-first UX

## Tech Stack

- React 19 + TypeScript + Vite
- Tailwind CSS 4
- Dexie + Supabase
- TanStack Query v5
- react-hook-form + zod
- Vitest + React Testing Library + MSW + fake-indexeddb
- vite-plugin-pwa + Wrangler

## Project Structure

Application code lives in `src/` and is organized by app shell, feature domains, shared building blocks, and infrastructure adapters.

```text
src/
  app/
  features/
    analytics/
    auth/
    charging-plans/
    charging-sessions/
    offline-sync/
  shared/
    ui/
    lib/
  infra/
    db/
    supabase/
    mocks/
  test/
  mocks/
```

### Layer Responsibilities

- `src/app/`: app composition, top-level shell, and provider wiring
- `src/features/<domain>/`: domain workflows with local `components/`, `hooks/`, `services/`, and `model/`
- `src/shared/ui/`: reusable, domain-agnostic UI primitives
- `src/shared/lib/`: pure shared helpers without infrastructure dependencies
- `src/infra/`: technical adapters and integrations

### Import Boundary Rules

- `features` may depend on `shared` and approved `infra` interfaces
- `shared` must remain domain-agnostic and never import from `features`
- `infra` contains implementation details and must not import from `features`
- Cross-feature imports must go through `src/features/<domain>/index.ts`

## Architecture Rules

These rules are central to the product and should be treated as non-negotiable unless an ADR says otherwise:

- Data entry must remain offline-first and must not require connectivity
- Local writes should go through Dexie with optimistic UI and later sync
- Sync should follow the outbox pattern
- Supabase stays private and single-user with authenticated, default-deny access
- Money is stored as integer cents
- Dates are stored in UTC
- Charging sessions must preserve tariff snapshots

### Analytics Data Semantics

The first Analytics slice reports Monthly Session Spend from the local charging-session
store, so it remains available offline and reacts to local changes immediately. It sums
each active session's snapshotted `total_cost` in integer cents, excludes soft-deleted
sessions, and assigns UTC session timestamps to the user's local calendar month.

## Quick Start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local` from `.env.example`:

   ```env
   VITE_SUPABASE_URL=your-project-url
   VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   ```

3. Start the app:

   ```bash
   npm run dev
   ```

For manual infrastructure setup, see [HUMAN_SETUP.md](./HUMAN_SETUP.md).

## Scripts

- `npm run dev`: start Vite locally
- `npm run build`: type-check and build production assets
- `npm run build:analyze`: build with bundle analysis output in `dist/bundle-stats.json`
- `npm run lint`: run ESLint
- `npm run test`: run Vitest in watch mode
- `npm run test -- --run`: run the test suite once
- `npm run preview`: build and serve locally with Wrangler
- `npm run deploy`: build and deploy via Wrangler

## Development Best Practices

### Code and Architecture

- Prefer feature-local code before extracting shared abstractions
- Keep UI primitives in `shared/ui` and domain logic inside the relevant feature
- Use strict TypeScript and React function components
- Add concise JSDoc to exported interfaces, props types, and components
- For structural refactors, use a "move first, behavior unchanged" sequence before behavioral edits
- Significant architecture changes should be recorded in `docs/adr/`

### Testing

- Keep tests close to the code they cover
- Use Vitest, React Testing Library, jsdom, MSW, and fake IndexedDB
- Include a suite-level JSDoc block above each main `describe`
- Use `// Arrange`, `// Act`, and `// Assert` comments inside tests
- Cover offline sync, idempotency, tariff snapshots, and changed user workflows
- Sync and mutation flows should expose queue length, retry count, and last sync attempt

### UI and Design Governance

- Use `docs/superpowers/specs/2026-05-16-Design-System-Sandbox-v2.0.html` as the default UI baseline
- Apply `docs/superpowers/specs/2026-05-29-design-governance-checklist.md` to UI changes
- If a screen intentionally deviates and improves UX, note it in handoff notes as `local exception` or `promote to master`

### Verification

Before proposing a push or PR, run:

```bash
npm run lint && npm run test -- --run && npm run build
```

For performance-sensitive changes such as new dependencies, major UI work, or bundling/runtime updates, also run:

```bash
npm run build:analyze
```

## Contributing

- Keep changes small and scoped
- Avoid unrelated refactors
- Use Conventional Commits: `type(scope): description`
- Document trade-offs in commit bodies when they matter
- Include verification results, linked issues or ADRs, and screenshots for UI changes

## Documentation

- [AGENTS.md](./AGENTS.md): source of truth for repository workflow and architecture rules
- [GEMINI.md](./GEMINI.md): legacy/reference guidance
- [HUMAN_SETUP.md](./HUMAN_SETUP.md): manual setup steps
- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md): roadmap and planning notes
- [docs/adr/](./docs/adr/): architecture decision records
- [docs/superpowers/specs/](./docs/superpowers/specs/): design and feature specs
- [docs/superpowers/plans/](./docs/superpowers/plans/): implementation plans
