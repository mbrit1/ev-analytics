# Phase 3: Offline Sync Engine & Storage - TDD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **MANDATORY:** Follow the `test-driven-development` skill for every task. Write the test first, watch it fail, then implement.

**Goal:** Build a reliable, testable offline sync engine using Dexie.js and TanStack Query, verified by Vitest.

**Architecture:** Transactional "Write-Through" Outbox pattern. The UI writes to Dexie; a background process syncs to Supabase. All reads are local-first.

**Tech Stack:** Vitest, Dexie.js, TanStack Query v5, fake-indexeddb.

---

## File Structure
- `src/lib/db.ts`: Dexie database definition and schema.
- `src/features/offline-sync/services/syncEngine.ts`: Logic for processing the outbox.
- `src/features/offline-sync/hooks/useSyncStatus.ts`: Global sync state hook.
- `src/features/charging-sessions/services/sessionService.ts`: TDD-wrapped CRUD for sessions.

---

### Task 1: Setup Testing Environment

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`

- [ ] **Step 1: Install dependencies**
Run: `npm install -D vitest @vitest/ui fake-indexeddb`
- [ ] **Step 2: Create Vitest config**
- [ ] **Step 3: Create setup file to mock IndexedDB globally**
- [ ] **Step 4: Write a smoke test**
- [ ] **Step 5: Commit**

---

### Task 2: Dexie Schema & Initialization (TDD)

**Files:**
- Create: `src/lib/db.ts`
- Test: `src/lib/db.test.ts`

- [ ] **Step 1: Write failing test (Check DB exists)**
- [ ] **Step 2: Implement minimal Dexie class**
- [ ] **Step 3: Write failing test (Check tables: providers, tariffs, sessions, sync_outbox)**
- [ ] **Step 4: Define Dexie schema**
- [ ] **Step 5: Commit**

---

### Task 3: Atomic Session Mutation (TDD)

**Files:**
- Create: `src/features/charging-sessions/services/sessionService.ts`
- Test: `src/features/charging-sessions/services/sessionService.test.ts`

- [ ] **Step 1: Write failing test (Save session and check outbox entry exists)**
- [ ] **Step 2: Implement `saveSession` with a transaction**
- [ ] **Step 3: Write failing test (Rollback: if outbox write fails, session is not saved)**
- [ ] **Step 4: Refine transaction logic**
- [ ] **Step 5: Commit**

---

### Task 4: Sync Engine - Outbox Processing (TDD)

**Files:**
- Create: `src/features/offline-sync/services/syncEngine.ts`
- Test: `src/features/offline-sync/services/syncEngine.test.ts`

- [ ] **Step 1: Write failing test (Process outbox items in order)**
- [ ] **Step 2: Implement `processOutbox` (mock Supabase call)**
- [ ] **Step 3: Write failing test (Delete item from outbox on success)**
- [ ] **Step 4: Implement success cleanup**
- [ ] **Step 5: Write failing test (Exponential backoff on network error)**
- [ ] **Step 6: Implement retry logic**
- [ ] **Step 7: Commit**

---

### Task 5: Initial Data Sync (TDD)

- [ ] **Step 1: Write failing test (Pull all Supabase data into Dexie)**
- [ ] **Step 2: Implement `initialSync` logic**
- [ ] **Step 3: Commit**
