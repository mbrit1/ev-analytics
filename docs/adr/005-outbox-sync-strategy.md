# ADR 005: Outbox Pattern & Sync Strategy

## Status
Accepted

## Context
The application must work offline, allowing users to log charging sessions without a network connection. Data must eventually be synchronized with Supabase (PostgreSQL) when connectivity is restored.

## Decision
We will implement the **Transactional Outbox Pattern** using Dexie.js as the local store.

1.  **Atomic Writes:** Every write operation (e.g., `saveSession`) will use a Dexie transaction to simultaneously update the local domain table (e.g., `sessions`) and a `sync_outbox` table.
2.  **Local-First Reads:** The UI will read exclusively from Dexie using `dexie-react-hooks`.
3.  **Sync Engine:** A dedicated `syncEngine` will process the `sync_outbox` in chronological order.
4.  **Idempotency:** Supabase `.upsert()` will be used to ensure that duplicate sync attempts do not create duplicate records.
5.  **Soft Deletes:** Deletions will be handled via a `deleted_at` timestamp to ensure the deletion event can be synchronized to the server.

## Consequences
- **Reliability:** Data is never lost if the app is closed before syncing.
- **Complexity:** Requires careful transaction management and error handling in the sync engine.
- **Performance:** UI remains highly responsive as all direct user interactions are local.
- **Integrity:** Chronological processing of the outbox prevents race conditions and ensures eventual consistency.
