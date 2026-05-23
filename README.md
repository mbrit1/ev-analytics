# EV Charging Analytics PWA

[![CI](https://github.com/mbrit1/ev-analytics/actions/workflows/ci.yml/badge.svg)](https://github.com/mbrit1/ev-analytics/actions/workflows/ci.yml)
[![CodeQL](https://github.com/mbrit1/ev-analytics/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/mbrit1/ev-analytics/actions/workflows/codeql-analysis.yml)

Private, offline-first EV charging analytics as a mobile-focused PWA.

## Overview

The app replaces spreadsheet workflows with structured EV charging session tracking and analytics. Core behavior is offline-first: users can create and edit charging data without connectivity, then sync safely when back online.

## Key Features

- Offline-first data entry and editing
- Local persistence with queued sync (outbox pattern)
- Private single-user Supabase backend with strict RLS
- Cost and efficiency analytics for charging sessions
- PWA installability and mobile-first UX

## Tech Stack

- React 19 + TypeScript + Vite
- Tailwind CSS 4
- Dexie (IndexedDB) + Supabase
- TanStack Query v5
- react-hook-form + zod
- Vitest + React Testing Library + MSW + fake-indexeddb
- vite-plugin-pwa + Wrangler

## Project Structure

Code is organized by layer and feature domain.

```text
src/
  app/
  features/
    auth/
    charging-sessions/
    offline-sync/
    tariffs/
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

## Architecture

- `app`: app composition and shell wiring.
- `features`: domain workflows and UI by business area.
- `shared`: domain-agnostic UI primitives and pure helpers.
- `infra`: technical adapters (Dexie, Supabase, mock/runtime integrations).

Offline-first data flow:

1. Local write in feature service
2. Outbox entry queued in local storage
3. Sync runtime processes queue when connectivity/auth permit

Import rules:

- Cross-feature imports must go through `features/<domain>/index.ts`.
- `shared` may not import from `features`.
- `infra` may not import from `features`.

## Quick Start

1. Clone and install:
   ```bash
   git clone <repo-url>
   cd ev-analytics
   npm install
   ```
2. Configure environment variables in `.env.local` (see `.env.example`):
   ```env
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
   ```
3. Start local development:
   ```bash
   npm run dev
   ```

## Scripts

- `npm run dev`: start Vite locally
- `npm run build`: type-check and build production assets
- `npm run lint`: run ESLint
- `npm run test`: run Vitest in watch mode
- `npm run test -- --run`: run tests once
- `npm run preview`: build and serve with Wrangler
- `npm run deploy`: build and deploy via Wrangler

## Contributing

Before proposing a push or PR, run:

```bash
npm run lint && npm run test -- --run && npm run build
```

Refactor rules:

- Move files first while keeping behavior unchanged.
- Apply behavioral changes in follow-up commits.
- Keep feature boundaries explicit and avoid deep cross-feature imports.

## Documentation

- [AGENTS.md](./AGENTS.md): repository source of truth for coding workflow and architecture rules
- [GEMINI.md](./GEMINI.md): legacy/reference guidance
- [HUMAN_SETUP.md](./HUMAN_SETUP.md): local setup steps
- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md): implementation roadmap
- [Architecture Decisions (ADRs)](./docs/adr/): architectural decisions and rationale
- [Superpowers Specs](./docs/superpowers/specs/): feature/system specs used in planning
- [Superpowers Plans](./docs/superpowers/plans/): implementation plans
