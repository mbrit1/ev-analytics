# Design Spec: Phase 3 - Offline Sync Engine & Storage (Refined)

**Status:** Draft
**Date:** 2026-05-14
**Topic:** Offline-First Strategy & Testing Infrastructure

## 1. Overview
Phase 3 establishes the "heart" of the EV Analytics PWA: a robust, testable offline sync engine. It ensures zero-latency data entry and full functionality in no-signal areas by using a local-first architecture where the UI only ever interacts with the local device storage (Dexie.js), with a background "Outbox" syncing data to Supabase.

## 2. Testing Infrastructure
To ensure the sync engine is 100% reliable, we will establish a Test-Driven Development (TDD) environment.
- **Framework:** Vitest (Vite-native testing).
- **Storage Mocking:** `fake-indexeddb` to simulate the local browser database in a Node.js test environment.
- **Goals:** 
    - Verify atomic transactions (data + outbox task).
    - Verify conflict resolution logic (Last Write Wins).
    - Verify "Sync Success" and "Sync Failure" (Retry) cycles.

## 3. Storage Architecture

### 3.1. Local Storage (Dexie.js)
- **Primary Source of Truth:** All UI reads and writes are performed against the local Dexie database.
- **Domain-Optimized Schema:** Local tables are structured for UI performance rather than raw normalization.
    - *Example:* `charging_sessions` might store the `provider_name` and `tariff_name` directly to avoid expensive joins during UI rendering.
- **Outbox Table (`sync_outbox`):**
    - `id`: Auto-incrementing integer (Primary Key).
    - `table_name`: String ('providers', 'tariffs', 'charging_sessions').
    - `action`: String ('INSERT', 'UPDATE', 'DELETE').
    - `payload`: JSON object (The domain-optimized data).
    - `timestamp`: Date (Ensures sequential processing).

### 3.2. Data Observation (TanStack Query + Dexie)
- **The Observer Pattern:** TanStack Query (v5) will be used to observe Dexie tables. 
- **The Result:** The UI updates automatically and instantly the moment Dexie is modified, providing a "near-instant" feel regardless of sync status.

## 4. Sync Engine Design

### 4.1. Transactional Write Path
Every user action (e.g., adding a session) must follow this atomic transaction:
1. **Open Dexie Transaction.**
2. **Write Domain Object:** Update the local table (optimized for UI).
3. **Queue Outbox Task:** Add the mutation to `sync_outbox`.
4. **Close Transaction.**
5. **Sync Trigger:** Notify the background process to start syncing if a connection is available.

### 4.2. Background Sync Engine
- **Transformation Layer:** Converts "Domain-Optimized" objects into the normalized PostgreSQL format required by Supabase.
- **Conflict Handling:** Implements "Last Write Wins" (LWW) using `updated_at` timestamps.
- **Retry Logic:** Implements exponential backoff for network-related failures.

## 5. UI/UX Elements
- **Sync Status:** 
    - Global indicator in header (Cloud icon).
    - Per-item "Pending" indicator for items in the `sync_outbox`.
- **Initial Sync:** Blocking loader screen on first login to populate Dexie from Supabase.

## 6. Success Criteria
1. **Verifiable:** All core sync and outbox logic covered by Vitest suites.
2. **Reliable:** Zero data loss during simulated offline -> online transitions.
3. **Responsive:** Dashboard and list views load in <100ms by reading only from the local-optimized schema.
