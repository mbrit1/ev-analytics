# ADR 005: Outbox Pattern and Sync Strategy

## Status

Accepted

## Date

2026-05-14

## Last updated

2026-07-03

## Context

The application must allow charging data to be created and edited without connectivity. Local changes must survive reloads and eventually reach Supabase without making the UI wait for a network request. Remote data must also hydrate the local store after authentication.

## Decision

Use Dexie as the local source for domain data and a transactional outbox for remote synchronization.

### Local mutations

- A synchronizable mutation writes the domain row and a full replay payload to `sync_outbox` in the same Dexie transaction.
- The outbox supports `providers`, `charging_plans`, `provider_plan_selections`, and local `sessions`. Local sessions map to the remote `charging_sessions` table.
- Outbox actions are recorded as `INSERT`, `UPDATE`, or `DELETE` for intent and diagnostics. Remote replay uses idempotent Supabase `upsert` operations for every action.
- Deletions use a `deleted_at` soft-delete marker and replay the complete row so the deletion state reaches Supabase.
- Domain UI reads local Dexie state, including unsynchronized changes, instead of waiting for Supabase.

### Authenticated sync runtime

- Synchronization runs only while a user is authenticated.
- On authenticated startup, the runtime performs initial hydration once and then processes the outbox.
- Browser `online` events and committed outbox insertions request another run.
- Only one run may execute at a time. Triggers received during a run are coalesced into one subsequent pass.
- Disposing the authenticated runtime removes its listeners and prevents future triggered runs; an already in-flight operation may finish.

### Initial hydration

- Initial hydration pulls `providers`, `charging_plans`, and `charging_sessions` from Supabase and upserts them into Dexie.
- Hydration is additive: it does not clear local tables or pending outbox entries first.
- A failed table pull is logged and does not prevent the remaining tables from hydrating.
- `provider_plan_selections` are synchronized through the outbox but are not part of the current initial pull. Sessions preserve the selected plan and price snapshots required for historical display.

### Outbox replay and failures

- Ready items are considered oldest-first by their original timestamp.
- Items whose `next_attempt_at` is still in the future are skipped so later ready work is not starved.
- A successful item is removed from the outbox only after Supabase accepts it.
- Retryable failures remain queued with `retry_count`, `last_attempt_at`, `next_attempt_at`, and `last_error`. Retry delay grows exponentially from one minute and is capped at fifteen minutes.
- A retryable failure stops the current pass because later writes may depend on it. A future runtime trigger starts another eligible pass; there is no dedicated wake-up timer for `next_attempt_at`.
- Database check and exclusion-constraint failures are marked non-retryable with no next retry time. Charging-plan validity overlap conflicts are item-local and allow later ready items to continue; other failures stop the pass.

## Consequences

- **Offline resilience:** Data entry remains available without a network connection, and pending writes persist across reloads.
- **Responsive UI:** User workflows observe local state immediately rather than waiting on Supabase.
- **Idempotent replay:** Stable row identifiers and remote upserts make repeated delivery safe from duplicate rows.
- **Observable failure state:** Retry timing and error metadata can be surfaced by sync-status UI and used for diagnosis.
- **Eventual consistency:** Remote state may lag local state until a qualifying runtime trigger processes eligible work.
- **Ordering trade-off:** Replay preserves dependency order for ready work while allowing delayed items and explicitly item-local overlap conflicts not to block unrelated ready mutations.
- **Conflict limitations:** The strategy does not provide a general multi-writer merge algorithm; the product remains private and single-user, and constraint conflicts require explicit resolution.
- **Hydration limitation:** Initial pull does not currently hydrate `provider_plan_selections`; adding it requires corresponding remote selection, normalization, and tests.
