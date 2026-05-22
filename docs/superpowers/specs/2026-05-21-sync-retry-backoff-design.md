# Sync Retry Backoff Design

## Goal

Finish the Phase 3 resilience gap by making failed outbox sync attempts retryable without hammering Supabase or repeatedly replaying the same failing mutation on every sync trigger.

The app already preserves failed outbox items. This design adds lightweight retry metadata and deterministic backoff scheduling so the sync engine knows when an item should be attempted again.

## Scope

In scope:

- Add retry metadata to `SyncOutbox`.
- Upgrade the Dexie schema to store retry metadata.
- Update new outbox writes so retry metadata starts in a known state.
- Update `processOutbox()` so failed items keep their payload, record failure details, and schedule their next retry.
- Preserve oldest-first ordering and stop-at-first-failure semantics.
- Add focused tests for retry count, last attempt, next attempt, last error, and future-scheduled items.

Out of scope:

- Manual "sync now" controls.
- Background timer orchestration beyond existing sync triggers.
- User-facing diagnostics panel.
- Supabase schema changes.
- Conflict resolution or remote merge policy changes.

## Data Model

Extend `SyncOutbox` with optional retry metadata:

```ts
retry_count?: number;
last_attempt_at?: Date;
next_attempt_at?: Date;
last_error?: string;
```

New outbox entries should initialize these fields as:

```ts
retry_count: 0;
last_attempt_at: undefined;
next_attempt_at: undefined;
last_error: undefined;
```

Dexie schema should add indexes that support retry scheduling:

```ts
sync_outbox: '++id, table_name, action, timestamp, next_attempt_at'
```

Existing outbox rows without retry metadata remain valid. Code must treat missing `retry_count` as `0` and missing `next_attempt_at` as immediately eligible.

## Backoff Policy

Use a small deterministic schedule:

```ts
const RETRY_BACKOFF_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
];
```

Failure number maps to backoff by index:

- first failure: 1 minute
- second failure: 5 minutes
- third failure: 15 minutes
- fourth and later failures: 1 hour

This is intentionally conservative and simple. There is no jitter in Phase 3 because this is a single-user app and deterministic tests are more valuable than distributed-load smoothing.

## Sync Engine Behavior

`processOutbox()` should:

1. Load outbox items ordered by `timestamp`.
2. For each item, skip processing if `next_attempt_at` exists and is in the future.
3. Attempt eligible items by routing to the same Supabase table logic used today.
4. On success:
   - Delete the outbox item.
5. On Supabase error or thrown exception:
   - Increment `retry_count`.
   - Set `last_attempt_at` to the current time.
   - Set `next_attempt_at` using the backoff schedule.
   - Set `last_error` to a concise message.
   - Stop processing later items.

Skipping a future-scheduled item should also stop processing later items. This preserves chronological dependency guarantees: later writes may depend on earlier writes.

## Time Injection

To keep tests deterministic, `processOutbox()` should accept an optional clock:

```ts
export interface ProcessOutboxOptions {
  now?: () => Date;
}

export async function processOutbox(options: ProcessOutboxOptions = {}): Promise<void>
```

Production calls keep using `processOutbox()` with no arguments. Tests can pass `now: () => fixedDate`.

## Error Handling

Supabase errors should use `error.message` when present. Thrown errors should use the thrown `Error.message`; non-Error throws should fall back to `String(err)`.

`last_error` should be short enough for diagnostics and not include full stack traces.

## Hook Compatibility

`useSyncStatus()` does not need a UI behavior change in this step. It can continue deriving queue length, table counts, and oldest pending timestamp from `sync_outbox`.

The new retry fields are intentionally part of `SyncOutbox` so a later Diagnostics Panel can expose:

- retry count
- last failure
- next scheduled retry

## Migration Compatibility

Because this app is still early and local-first, a Dexie version bump is enough:

- Keep version 1 for existing stores.
- Add version 2 with the updated `sync_outbox` index.

No destructive migration is required. Existing rows remain usable because the new fields are optional.

## Testing

Use TDD.

Add or update tests for:

- Failed Supabase response increments `retry_count`, records `last_attempt_at`, schedules `next_attempt_at`, and records `last_error`.
- Thrown upload failure records the thrown message and schedules retry metadata.
- A future `next_attempt_at` prevents processing and leaves the item queued.
- A future-scheduled first item prevents later items from processing.
- A later eligible item is processed only when all earlier items are either already synced or eligible.
- Successful sync deletes the item as before.
- Existing outbox rows without retry metadata are treated as retry count `0`.

Existing tests for ordering, table routing, soft-delete payloads, initial sync, and pending outbox preservation must remain green.

## Acceptance Criteria

- Failed sync attempts no longer retry immediately on every `processOutbox()` call.
- Retry metadata is persisted in Dexie.
- Oldest-first and stop-at-first-blocked-item behavior remains intact.
- `npm run lint -- --max-warnings=0`, `npm run test -- --run`, and `npm run build` pass.
