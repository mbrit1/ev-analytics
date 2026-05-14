# Implementation Plan - EV Charging Analytics PWA

## Phase 0: Context Initialization (Current)

- [x] Create `GEMINI.md` (Architectural Rules)
- [x] Create `IMPLEMENTATION_PLAN.md` (Roadmap)
- [x] Create `README.md` (Project Overview)
- [x] Create `HUMAN_SETUP.md` (Manual Steps)

## Phase 1: Foundation & Scaffolding

- [x] Scaffold Vite React + TypeScript project
- [x] Install and configure tailwindcss, lucide-react, and vite-plugin-pwa
- [x] Set up project structure (features folder)
- [x] Basic configuration (Vite, Tailwind, PWA manifest)
- [x] Create ADRs: `001-react-spa.md`, `002-dexie-offline-first.md`, `003-cloudflare-pages.md`
- [x] Type check and verification

## Phase 2: Core Infrastructure (Auth & Database)

- [x] Install `@supabase/supabase-js`
- [x] Supabase SQL Schema
  - **Table `providers`:** `id`, `name`, `created_at`
  - **Table `tariffs`:** `id`, `provider_id`, `tariff_name`, `ac_price_per_kwh`, `dc_price_per_kwh`, `session_fee`, `valid_from`, `valid_to`
  - **Table `charging_sessions`:** `id`, `session_timestamp`, `provider_id`, `tariff_id`, `charging_type` (AC/DC), `kwh_billed`, `total_cost`, `odometer_km` (nullable), `start_soc_percentage`, `end_soc_percentage`, `notes`
  - **Snapshots on `charging_sessions`:** `applied_ac_price_per_kwh`, `applied_dc_price_per_kwh`, `applied_session_fee`
- [x] Create ADR: `004-supabase-auth-and-rls.md`
- [x] Supabase Client & Auth Hook
- [x] Login Page (Single-user, sign-in only)
- [ ] Seed Data script (Ionity, Elli, EnBW, Tesla; include AC/DC and legacy sessions)

## Phase 3: Offline Sync Engine & Storage

- [ ] Install `dexie`, `dexie-react-hooks`, and `@tanstack/react-query`
- [ ] Dexie.js Schema & Store initialization
- [ ] Outbox Sync Engine implementation (Background sync triggers)
- [ ] Offline-aware API wrapper for Supabase
- [ ] Create ADR: `005-outbox-sync-strategy.md`

## Phase 4: Tariff & Session Management

- [ ] Install `react-hook-form`, `@hookform/resolvers`, and `zod`
- [ ] Tariff CRUD (Local-first)
- [ ] Charging Session Entry Form (Mobile optimized, numpads, 44pt hit areas)
- [ ] Charging History list with sync status indicators
- [ ] Tariff snapshot logic on session creation
- [ ] Create ADR: `006-tariff-snapshots.md`

## Phase 5: Dashboard & Analytics

- [ ] Install `@tremor/react`, `echarts`, and `echarts-for-react`
- [ ] SQL Views for Analytics
  - `average_cost_per_kwh`, `provider_cost_comparison`, `monthly_spending`, `charging_frequency`, `AC_vs_DC_breakdown`, `rolling_30_day_average`, `provider_rankings`, `cost_per_100km` (handle NULL odometer)
- [ ] KPI Cards & Charts (Tremor/ECharts)
- [ ] Desktop dashboard optimizations
- [ ] Create ADR: `007-sql-heavy-analytics.md`

## Phase 6: Data Portability & Polish

- [ ] CSV Export
- [ ] CSV Import (Validation, Previews, Duplicates)
- [ ] Offline Queue Monitor & Developer Diagnostics Panel
- [ ] Error handling & Observability (Local logs)
- [ ] Final PWA testing (iOS/Android simulators)

## Phase 7: Deployment & Documentation

- [ ] Cloudflare Pages setup
- [ ] CI/CD via GitHub Actions
- [ ] Final documentation update
