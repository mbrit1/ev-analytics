# EV Charging Analytics PWA

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
- **Storage:** Dexie.js (IndexedDB) + Supabase (PostgreSQL)
- **State Management:** TanStack Query v5
- **Icons/Charts:** Lucide-React, Tremor, ECharts
- **PWA:** vite-plugin-pwa

## 🏃 Quick Start (Development)

*Detailed instructions will be added in Phase 1.*

## Restart AI Coding

Use following prompt:
```
Read GEMINI.md to understand the project architecture and rules. Then, read IMPLEMENTATION_PLAN.md and the recent Git commit history to figure out where we left off. Tell me what phase/task we are on, what the next logical step is, and wait for my approval to begin coding.
```

## 📖 Documentation
- [GEMINI.md](./GEMINI.md) - Architectural rules and constraints.
- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) - Project roadmap.
- [HUMAN_SETUP.md](./HUMAN_SETUP.md) - Manual configuration steps.
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Deep dive into sync and data strategy (Phase 1+).
