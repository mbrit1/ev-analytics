# EV Analytics Architectural Rules & Constraints

## Tech Stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, lucide-react.
- **Forms & Validation:** react-hook-form, zod (strict schema validation).
- **PWA:** vite-plugin-pwa (Service Worker, iOS support).
- **Offline-first:** Dexie.js (IndexedDB), Outbox Pattern architecture.
- **State/Data:** TanStack Query (v5).
- **Backend:** Supabase (Auth, PostgreSQL, RLS).
- **Hosting:** Cloudflare Pages.
- **Analytics:** PostgreSQL Views / Materialized Views.
- **UI:** Tremor, Apache ECharts.

## Core Mandates
- **Single-User:** App is private. Authenticated users only. Default-deny RLS policies.
- **Offline-First:** Active connectivity MUST NEVER be required for data entry.
- **Outbox Pattern:** Submit -> Dexie (pending_sync) -> Optimistic UI -> Sync Engine -> Supabase.
- **Analytics Strategy:** Compute analytics primarily in PostgreSQL Views/Materialized Views. Avoid logic duplication in frontend.
- **European Localization:**
  - Store monetary values as **integers (cents)** in DB.
  - UI renders EUR format (e.g., 15,50 €).
  - Handle comma (,) as decimal separator in inputs.
  - Dates in UTC (DB), Local Timezone (UI).
- **Mobile-First UX:**
  - Numpad for numeric inputs (`inputmode="decimal"` or `"numeric"`).
  - Min hit area 44x44pt.
  - Standalone PWA mode for iOS.
- **Data Integrity:**
  - Tariff snapshots (AC/DC price, session fee) stored directly on `charging_sessions` rows.
  - Odometer readings are nullable (handle gracefully in analytics).

## Offline & Sync Resilience
**Failure Scenarios to Handle:**
- Duplicate sync attempts (idempotency).
- Auth expiration while offline.
- Partial sync failures and retry exhaustion.
- Stale local data vs. remote updates.
- Corrupted IndexedDB entries.
- Race conditions during reconnect.
- Tariff updates while offline.

**Sync Triggers:**
- Browser online/offline events.
- App startup, resume, and focus.
- Periodic retry timers (exponential backoff).

## UX & Mobile-First Constraints
- **Physical Context:** User may be standing in a garage, one-handed, with no signal.
- **Input Strategy:** Large hit areas (min 44x44pt), numeric numpads for all data entry.
- **Transparency:** Clear indicators for offline state, pending sync queue, and sync status.

## Folder Structure


- `src/features/`: Feature-based architecture (auth, charging-sessions, tariffs, dashboard, offline-sync, csv-import, csv-export).
- Avoid: Unnecessary abstractions, generic repositories, enterprise complexity.

## Code Standards
- Strict TypeScript types.
- Prettier/ESLint for formatting.
- Explicit domain logic utilities (no duplication across UI/SQL/Sync).
- **No Emojis:** Do not use emojis in source code, comments, or configuration files. Emojis are only permitted in the frontend UI if they are intended to be displayed to the user.

## Decision Recording (ADRs)
- **Just-in-Time Documentation:** Create an Architecture Decision Record (ADR) file in `/docs/adr/` at the moment a significant architectural choice is made.
- **Mandatory Topics:** Tech stack selection, Outbox Pattern & Sync Strategy, SQL-Heavy Analytics strategy, Tariff Snapshot strategy, and Auth strategy.

## Observability & Diagnostics (Always-On)
- **Mandatory Instrumentation:** Every feature, sync operation, and data mutation must include lightweight local logging and diagnostic state (e.g., `lastSyncAttempt`, `retryCount`, `queueLength`).
- **Developer Diagnostics:** Provide a centralized service or hook that aggregates this state for the "Diagnostics Panel."

## Performance & Resource Constraints
- **Bundle Size:** Minimize dependencies; optimize for fast startup and <2s TTI on mobile.
- **Resource Usage:** Low mobile memory and battery impact; efficient IndexedDB queries via Dexie.

## Testing Mandates
- **Domain Logic:** Tariff application and snapshot generation.
- **Resilience:** Reconnect retry logic, idempotency (duplicate prevention), and partial sync recovery.
- **Integrity:** Verification that historical pricing snapshots remain stable and unchanged after tariff updates.
- **CSV:** Schema validation and duplicate handling during import/export.

## Engineering Philosophy & Output Expectations
**Expected Deliverables:**
- Complete project structure with all required config files.
- Strongly typed TypeScript code with reusable components.
- Complete SQL schema, migrations, and seed data.
- Comprehensive documentation and deployment instructions.
- Tests covering domain logic, offline sync, and data integrity.

**Core Values (Favor):**
- Reliability and offline resilience.
- Maintainability for long-term personal use.
- Clarity and explicit domain logic.
- Simplicity in architecture.

**Anti-Patterns (Avoid):**
- "Cleverness" or premature optimization.
- Unnecessary abstractions or generic repositories.
- Enterprise complexity (e.g., over-engineered patterns for a single-user app).

## Observability & Data Ownership
- **Diagnostics:** Lightweight local logs for sync attempts, failures, and queue state.
- **Local-First Logs:** Diagnostics remain on-device; exportable for debugging.
- **Data Ownership:** Human-readable CSV exports/imports; migration-friendly schema.
- **Longevity:** Design for multi-year use; minimal coupling to proprietary vendor logic.

## Development & Modification Standards
- **Incremental Progress:** Work in small, scoped steps strictly aligned with the current phase.
- **No Side Effects:** Avoid unrelated refactors or modifying files outside the immediate task's scope.
- **Code Preservation:** Never silently overwrite or delete functionality. Preserve working code unless explicitly instructed otherwise.
- **Proactive Communication:** Before starting large or risky changes (e.g., schema migrations, sync engine logic), explain the rationale and potential risks.
- **Small over Large:** Prefer small, reviewable changes over massive rewrites.

## Git & Commit Standards
- **Conventional Commits:** Follow the `type(scope): description` format.
- **Workflow:**
  - **Feature Branches Required:** ALWAYS create a new feature branch for any code modification or new feature (e.g., `feat/phase-2-auth`).
  - **Remote Operations (Human-in-the-Loop):** AI agents are authorized to commit changes locally. However, agents MUST NOT push to remote branches or create Pull Requests autonomously. 
  - **Post-Task Handoff:** Upon completing a task locally, the agent must:
    1. Summarize the local commits.
    2. Propose the exact `git push` and `gh pr create` commands (or offer to run them) and wait for explicit authorization.
    3. Look at `IMPLEMENTATION_PLAN.md` and propose the next logical task to maintain momentum.
  - **Human Review Gate:** NEVER merge back to `main` without explicit human approval after a code review.
  - **Merge Strategy:** 
    - **Fast-Forward Preferred:** If the feature branch has a clean, logical commit history, prefer a fast-forward merge to `main`.
    - **Squash with Purpose:** Squash ONLY if the individual commits do not represent distinct, valuable logical steps (e.g., "fix typo", "re-run test").
    - **Conflict Resolution:** If a fast-forward is not possible, consult the user to decide between a standard merge commit or a rebase.
- **Examples:**
  - `feat(sync): implement offline outbox queue`
  - `fix(pwa): resolve offline cache invalidation`

## Review Mode Requirements
After each phase, the agent must:
1. Summarize implemented functionality.
2. List changed files.
3. Explain architectural decisions.
4. Suggest commit message(s).
5. Identify potential risks.
6. Wait for review before continuing.

