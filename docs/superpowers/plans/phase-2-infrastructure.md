# Phase 2: Core Infrastructure (Auth & Database) Implementation Plan

## Background & Motivation
Phase 2 focuses on establishing the secure foundation of the application: Supabase authentication (single-user design) and the PostgreSQL database schema with Row-Level Security (RLS) policies. To avoid a "big bang" implementation, this phase is broken down into small, independently verifiable chunks.

## Scope & Impact
- **Database:** Setting up the schema for `providers`, `tariffs`, and `charging_sessions`, preparing for future analytics.
- **Frontend:** Integrating Supabase Auth, creating an Auth context, and building the initial Login UI.
- Note: PWA assets (favicon, etc.) are explicitly postponed to Phase 6.

## Chunked Implementation Plan

### Chunk 2.1: Database Schema & RLS
*Objective: Define the data structures securely.*
- **Action:** Create `supabase/schema.sql` encompassing:
  - `providers` table (id, name, user_id).
  - `tariffs` table (price rules stored in cents, valid dates, user_id).
  - `charging_sessions` table (with tariff snapshots, user_id).
  - Row-Level Security (RLS) policies enforcing `user_id = auth.uid()` for all tables.
- **Verification:** Review the SQL for correctness and adhere to the single-user/RLS constraints.

### Chunk 2.2: Supabase Client & Environment
*Objective: Connect the React frontend to the Supabase backend.*
- **Action:** Ensure `@supabase/supabase-js` is installed (Already completed).
- **Action:** Create `src/lib/supabase.ts` to export the initialized Supabase client.
- **Action:** Define expected environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) in a `.env.example` file.
- **Verification:** Ensure the app compiles and the client instantiates without runtime errors.

### Chunk 2.3: Auth Provider & Hook
*Objective: Manage user session state globally.*
- **Action:** Create `src/features/auth/hooks/useAuth.tsx`.
- **Action:** Implement an `AuthProvider` that listens to Supabase `onAuthStateChange` events.
- **Action:** Expose a `useAuth` hook providing the current session/user and a `signIn` method.
- **Verification:** Confirm the provider can wrap the main app without breaking existing rendering.

### Chunk 2.4: Login Component & App Integration
*Objective: Build the UI to allow the single user to sign in.*
- **Action:** Create `src/features/auth/components/LoginForm.tsx` (using Tailwind for a simple, mobile-friendly interface).
- **Action:** Update `src/App.tsx` to conditionally render the `LoginForm` if the user is unauthenticated, or the main application layout if authenticated.
- **Verification:** Test the rendering logic (ensure unauthenticated state shows the login form).

### Chunk 2.5: Seed Data Generation
*Objective: Provide realistic data for future frontend development.*
- **Action:** Create `supabase/seed.sql` containing a sample user, realistic providers (Ionity, Elli, EnBW, Tesla), tariffs, and a few sample sessions.
- **Verification:** Review the seed data to ensure it matches the schema and correctly references the sample user ID.

## Verification & Next Steps
- After each chunk, we will review the changes and commit them individually.
- Once all chunks are complete, we will verify the end-to-end authentication flow and schema definition before moving to Phase 3 (Offline Sync Engine).
