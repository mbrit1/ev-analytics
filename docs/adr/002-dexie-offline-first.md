# ADR 002: Dexie.js for Offline-First Storage

## Status
Accepted

## Context
EV charging often happens in locations with poor connectivity. The "Outbox Pattern" requires a reliable local storage mechanism to queue mutations before they are synced to a remote database (Supabase).

## Decision
We will use **Dexie.js** as the primary local storage engine and abstraction over IndexedDB.

## Rationale
*   **Performance:** IndexedDB is the standard for large-scale client-side storage, offering much higher capacity and better performance than `localStorage`.
*   **Developer Experience:** Dexie.js provides a clean, Promise-based API for IndexedDB, which is notoriously difficult to work with directly.
*   **Reactive Hooks:** `dexie-react-hooks` allows the UI to automatically update when local data changes, simplifying the "Optimistic UI" implementation.
*   **Schema Management:** Dexie handles database versioning and migrations gracefully.

## Consequences
*   We must maintain a local schema that mirrors or complements the remote Supabase schema.
*   Data must be manually synced between Dexie and Supabase using a sync engine.
