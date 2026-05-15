# EV Charging Analytics PWA

[![CI](https://github.com/mbrit1/ev-analytics/actions/workflows/ci.yml/badge.svg)](https://github.com/mbrit1/ev-analytics/actions/workflows/ci.yml)
[![CodeQL](https://github.com/mbrit1/ev-analytics/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/mbrit1/ev-analytics/actions/workflows/codeql-analysis.yml)

A production-quality, private, offline-first mobile application for tracking EV charging sessions, specifically optimized for the Skoda Enyaq 80x.

## 🚀 Overview

This application replaces traditional spreadsheet workflows with a mobile-optimized PWA that works even in underground garages with no connectivity. It provides deep analytics into charging costs, provider performance, and vehicle efficiency.

### Key Features
- **Offline-First:** Data entry works without internet; syncs automatically when reconnected.
- **Precise Analytics:** Cost per kWh, AC/DC breakdown, provider rankings, and more.
- **Single-User Privacy:** Hosted on Supabase with strict RLS; no public signup.
- **PWA Excellence:** Optimized for iOS Home Screen (Standalone mode).
- **Data Ownership:** Easy CSV import/export.

## 🛠 Tech Stack
- **Frontend:** React, TypeScript, Vite, Tailwind CSS
- **Forms & Validation:** react-hook-form, zod
- **Storage:** Dexie.js (IndexedDB) + Supabase (PostgreSQL)
- **State Management:** TanStack Query v5
- **Icons/Charts:** Lucide-React, Tremor, ECharts
- **PWA:** vite-plugin-pwa

## 🏃 Quick Start (Development)

1. **Clone and Install:**
   ```bash
   git clone <repo-url>
   cd ev-analytics
   npm install
   ```

2. **Environment Setup:**
   Create a `.env.local` file with your Supabase credentials:
   ```env
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
   ```

3. **Run Locally:**
   ```bash
   npm run dev
   ```

4. **Production Build:**
   ```bash
   npm run build
   ```

## 📖 Documentation
- [GEMINI.md](./GEMINI.md) - Architectural rules and constraints.
- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) - Project roadmap and current progress.
- [HUMAN_SETUP.md](./HUMAN_SETUP.md) - Manual configuration steps.
- [Architecture Decisions (ADRs)](./docs/adr/) - Detailed history of architectural choices.
- [Design Specs](./docs/specs/) - Feature-specific design documents.
