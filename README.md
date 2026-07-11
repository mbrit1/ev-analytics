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
- Monthly charging-session spend and provider-billed energy analytics
- PWA service worker and mobile-first UX

## Tech Stack

- React 19 + TypeScript + Vite
- Tailwind CSS 4
- Dexie + Supabase
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

For the implemented data flows, synchronization limits, data model, and analytics semantics, see the [current architecture guide](./docs/architecture.md).

## Quick Start

1. Use Node.js 22.20.0 or later.

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create `.env.local` from `.env.example`:

   ```env
   VITE_SUPABASE_URL=your-project-url
   VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   ```

4. Start the app:

   ```bash
   npm run dev
   ```

For environment provisioning and deployment, see the [infrastructure runbook](./docs/infrastructure-runbook.md).

## Scripts

- `npm run dev`: start Vite locally
- `npm run build`: type-check and build production assets
- `npm run build:analyze`: build with bundle analysis output in `dist/bundle-stats.json`
- `npm run lint`: run ESLint
- `npm run test`: run Vitest in watch mode
- `npm run test -- --run`: run the test suite once
- `npm run preview`: build and serve locally with Wrangler
- `npm run deploy`: build and deploy via Wrangler
- `npm run docs:check`: validate active documentation links, anchors, and stale references

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development conventions, architecture boundaries, testing requirements, design governance, and the Git and pull-request workflow.

## Documentation

- [CONTRIBUTING.md](./CONTRIBUTING.md): canonical engineering workflow for human contributors
- [AGENTS.md](./AGENTS.md): repository-wide instructions for coding agents
- [Infrastructure runbook](./docs/infrastructure-runbook.md): local setup, Supabase provisioning, and Cloudflare deployment
- [Current architecture](./docs/architecture.md): implemented layers, data flow, persistence, synchronization, and analytics semantics
- [docs/adr/](./docs/adr/): architecture decision records
- [UI design governance](./docs/design/): current design-system baseline and UI review checklist
