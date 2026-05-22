# Sync Retry Backoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist retry metadata for failed outbox sync attempts and prevent immediate repeated retries until the scheduled backoff time.

**Architecture:** Extend the Dexie `SyncOutbox` model with optional retry fields and a `next_attempt_at` index. Initialize new outbox entries with retry metadata. Update `processOutbox()` to use a deterministic clock-injected backoff policy while preserving oldest-first and stop-at-first-blocked-item behavior.

**Tech Stack:** TypeScript, Dexie, Supabase client mock, Vitest, fake-indexeddb.

---

## File Structure

- Modify: `src/lib/db.ts`
  - Add retry metadata fields to `SyncOutbox`.
  - Add Dexie version 2 schema with `next_attempt_at` index.
- Modify: `src/features/charging-sessions/services/sessionService.ts`
  - Initialize retry metadata for session outbox entries.
- Modify: `src/features/tariffs/services/tariffService.ts`
  - Initialize retry metadata for tariff insert/update/delete outbox entries.
- Modify: `src/features/tariffs/services/providerService.ts`
  - Initialize retry metadata for provider outbox entries.
- Modify: `src/features/offline-sync/services/syncEngine.ts`
  - Add deterministic backoff behavior, retry metadata updates, and optional clock injection.
- Modify: `src/features/offline-sync/services/syncEngine.test.ts`
  - Add focused retry/backoff tests and adjust existing failure expectations.

---

### Task 1: Add Retry Metadata To Outbox Writes

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `src/features/charging-sessions/services/sessionService.ts`
- Modify: `src/features/tariffs/services/tariffService.ts`
- Modify: `src/features/tariffs/services/providerService.ts`
- Test: existing service tests that create outbox entries.

- [ ] **Step 1: Write failing expectations for initialized retry metadata**

Update the existing outbox assertions in these tests so saved outbox entries include initialized retry metadata:

- `src/features/charging-sessions/services/sessionService.test.ts`
- `src/features/tariffs/services/tariffService.test.ts`

For each existing assertion that reads an outbox item after a local write, add:

```ts
expect(outboxItems[0]).toMatchObject({
  retry_count: 0,
  last_attempt_at: undefined,
  next_attempt_at: undefined,
  last_error: undefined,
});
```

If a tariff test covers delete outbox entries, add the same expectation to that delete case.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm run test -- --run src/features/charging-sessions/services/sessionService.test.ts src/features/tariffs/services/tariffService.test.ts
```

Expected: FAIL because outbox entries do not yet include `retry_count: 0`.

- [ ] **Step 3: Extend `SyncOutbox` and Dexie schema**

In `src/lib/db.ts`, update `SyncOutbox`:

```ts
  /** Number of failed remote sync attempts for this queue item. */
  retry_count?: number;
  /** Most recent time this item was attempted by the sync engine. */
  last_attempt_at?: Date;
  /** Earliest time this item should be retried after a failure. */
  next_attempt_at?: Date;
  /** Last concise failure message recorded for diagnostics. */
  last_error?: string;
```

Then add a version 2 schema after version 1:

```ts
    this.version(2).stores({
      providers: 'id, name, deleted_at',
      tariffs: 'id, provider_id, deleted_at',
      sessions: 'id, session_timestamp, provider_id, charging_type, deleted_at',
      sync_outbox: '++id, table_name, action, timestamp, next_attempt_at'
    });
```

- [ ] **Step 4: Initialize retry metadata in service outbox writes**

For every `db.sync_outbox.add({ ... })` in:

- `src/features/charging-sessions/services/sessionService.ts`
- `src/features/tariffs/services/tariffService.ts`
- `src/features/tariffs/services/providerService.ts`

include:

```ts
      retry_count: 0,
      last_attempt_at: undefined,
      next_attempt_at: undefined,
      last_error: undefined
```

Example:

```ts
    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: session,
      timestamp: new Date(),
      retry_count: 0,
      last_attempt_at: undefined,
      next_attempt_at: undefined,
      last_error: undefined
    });
```

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```bash
npm run test -- --run src/features/charging-sessions/services/sessionService.test.ts src/features/tariffs/services/tariffService.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run lint**

Run:

```bash
npm run lint -- --max-warnings=0
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/lib/db.ts src/features/charging-sessions/services/sessionService.ts src/features/tariffs/services/tariffService.ts src/features/tariffs/services/providerService.ts src/features/charging-sessions/services/sessionService.test.ts src/features/tariffs/services/tariffService.test.ts
git commit -m "feat(sync): initialize outbox retry metadata" -m "Add retry metadata to local outbox records so failed sync attempts can be scheduled without losing payload integrity."
```

---

### Task 2: Add Retry Backoff To Sync Engine

**Files:**
- Modify: `src/features/offline-sync/services/syncEngine.test.ts`
- Modify: `src/features/offline-sync/services/syncEngine.ts`

- [ ] **Step 1: Write failing tests for Supabase error backoff**

Add this test inside `describe('syncEngine', ...)`:

```ts
  it('should record retry metadata and schedule backoff when Supabase returns an error', async () => {
    // Arrange: Make Supabase return a retryable sync error.
    const now = new Date('2026-05-21T12:00:00.000Z');
    const mockUpsert = vi.fn(() => Promise.resolve({ error: { message: 'Network Error' } }));
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>);

    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: { id: 'retry-me' } as SyncPayload,
      timestamp: new Date('2026-05-21T11:00:00.000Z')
    });

    // Act: Attempt to process the failing outbox item.
    await processOutbox({ now: () => now });

    // Assert: The failed item stays queued with first retry metadata.
    const [outboxItem] = await db.sync_outbox.toArray();
    expect(outboxItem).toMatchObject({
      retry_count: 1,
      last_attempt_at: now,
      next_attempt_at: new Date('2026-05-21T12:01:00.000Z'),
      last_error: 'Network Error'
    });
  });
```

- [ ] **Step 2: Write failing tests for thrown errors and future schedule blocking**

Add:

```ts
  it('should record thrown error messages as retry metadata', async () => {
    // Arrange: Make Supabase throw instead of returning an error object.
    const now = new Date('2026-05-21T12:00:00.000Z');
    const mockUpsert = vi.fn(() => Promise.reject(new Error('Connection lost')));
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>);

    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: { id: 'throwing-item' } as SyncPayload,
      timestamp: new Date('2026-05-21T11:00:00.000Z')
    });

    // Act: Attempt to process the throwing outbox item.
    await processOutbox({ now: () => now });

    // Assert: The thrown message is stored without deleting the item.
    const [outboxItem] = await db.sync_outbox.toArray();
    expect(outboxItem.retry_count).toBe(1);
    expect(outboxItem.last_error).toBe('Connection lost');
    expect(outboxItem.next_attempt_at?.toISOString()).toBe('2026-05-21T12:01:00.000Z');
  });

  it('should not process an item whose next retry is scheduled in the future', async () => {
    // Arrange: Queue an item blocked by a future retry time.
    const mockUpsert = vi.fn(() => Promise.resolve({ error: null }));
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>);

    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: { id: 'not-yet' } as SyncPayload,
      timestamp: new Date('2026-05-21T11:00:00.000Z'),
      retry_count: 1,
      next_attempt_at: new Date('2026-05-21T12:05:00.000Z')
    });

    // Act: Process before the retry window opens.
    await processOutbox({ now: () => new Date('2026-05-21T12:00:00.000Z') });

    // Assert: Future-scheduled items are left untouched.
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(await db.sync_outbox.count()).toBe(1);
  });
```

Add a dependency ordering test:

```ts
  it('should stop when the oldest item is scheduled for the future', async () => {
    // Arrange: Queue a blocked older item and an eligible newer item.
    const mockUpsert = vi.fn(() => Promise.resolve({ error: null }));
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as unknown as ReturnType<typeof supabase.from>);

    await db.sync_outbox.bulkAdd([
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: { id: 'blocked-first' } as SyncPayload,
        timestamp: new Date('2026-05-21T10:00:00.000Z'),
        retry_count: 1,
        next_attempt_at: new Date('2026-05-21T12:05:00.000Z')
      },
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: { id: 'eligible-second' } as SyncPayload,
        timestamp: new Date('2026-05-21T11:00:00.000Z')
      }
    ]);

    // Act: Process before the first item's retry window opens.
    await processOutbox({ now: () => new Date('2026-05-21T12:00:00.000Z') });

    // Assert: Later items are not processed ahead of the blocked oldest item.
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(await db.sync_outbox.count()).toBe(2);
  });
```

- [ ] **Step 3: Run sync engine tests to verify RED**

Run:

```bash
npm run test -- --run src/features/offline-sync/services/syncEngine.test.ts
```

Expected: FAIL because `processOutbox` does not accept `{ now }` and does not write retry metadata.

- [ ] **Step 4: Implement backoff constants, options, and result shape**

In `src/features/offline-sync/services/syncEngine.ts`, add near imports:

```ts
const RETRY_BACKOFF_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
];

/**
 * Clock injection point used to make retry scheduling deterministic in tests.
 */
export interface ProcessOutboxOptions {
  /** Supplies the current time for retry metadata and scheduling. */
  now?: () => Date;
}

interface SyncItemResult {
  success: boolean;
  errorMessage?: string;
}
```

Add helpers:

```ts
function getRetryDelay(retryCount: number): number {
  return RETRY_BACKOFF_MS[Math.min(retryCount - 1, RETRY_BACKOFF_MS.length - 1)];
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
```

- [ ] **Step 5: Update `processOutbox` and `syncItem`**

Change `processOutbox` signature and body:

```ts
export async function processOutbox(options: ProcessOutboxOptions = {}): Promise<void> {
  const now = options.now ?? (() => new Date());
  const items = await db.sync_outbox.orderBy('timestamp').toArray();

  for (const item of items) {
    const currentTime = now();

    if (item.next_attempt_at && item.next_attempt_at > currentTime) {
      break;
    }

    const result = await syncItem(item);
    if (result.success) {
      await db.sync_outbox.delete(item.id!);
    } else {
      const retryCount = (item.retry_count ?? 0) + 1;
      await db.sync_outbox.update(item.id!, {
        retry_count: retryCount,
        last_attempt_at: currentTime,
        next_attempt_at: new Date(currentTime.getTime() + getRetryDelay(retryCount)),
        last_error: result.errorMessage ?? 'Unknown sync error'
      });
      break;
    }
  }
}
```

Change `syncItem` return type to `Promise<SyncItemResult>` and return:

```ts
    if (error) {
      console.error(`Sync error for table ${item.table_name}:`, error.message);
      return { success: false, errorMessage: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error(`Unexpected sync failure for table ${item.table_name}:`, err);
    return { success: false, errorMessage: getErrorMessage(err) };
  }
```

- [ ] **Step 6: Run sync engine tests to verify GREEN**

Run:

```bash
npm run test -- --run src/features/offline-sync/services/syncEngine.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/features/offline-sync/services/syncEngine.ts src/features/offline-sync/services/syncEngine.test.ts
git commit -m "feat(sync): schedule retry backoff for failed uploads" -m "Record retry metadata on failed outbox uploads and delay repeated attempts while preserving chronological sync ordering."
```

---

### Task 3: Final Verification And Phase 3 Plan Update

**Files:**
- Modify: `IMPLEMENTATION_PLAN.md`
- Modify: `docs/superpowers/plans/2026-05-14-phase-3-sync-engine.md`

- [ ] **Step 1: Update roadmap wording**

In `IMPLEMENTATION_PLAN.md`, under Phase 3, ensure the outbox sync line mentions retry/backoff:

```md
- [x] Outbox Sync Engine implementation (ordered replay, retry/backoff metadata, and failure preservation)
```

In `docs/superpowers/plans/2026-05-14-phase-3-sync-engine.md`, mark Task 4 Step 5 and Step 6 as complete:

```md
- [x] **Step 5: Write failing test (Exponential backoff on network error)**
- [x] **Step 6: Implement retry logic**
```

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run lint -- --max-warnings=0
npm run test -- --run
npm run build
```

Expected: all pass. The existing Vite chunk-size warning is acceptable.

- [ ] **Step 3: Commit Task 3**

```bash
git add IMPLEMENTATION_PLAN.md docs/superpowers/plans/2026-05-14-phase-3-sync-engine.md
git commit -m "docs(sync): mark retry backoff complete" -m "Update Phase 3 planning docs after adding retry metadata and backoff scheduling to the sync engine."
```

## Self-Review Notes

- Spec coverage: retry metadata, Dexie schema, outbox initialization, deterministic backoff, future scheduling, oldest-first blocking, error messages, tests, and final verification are covered.
- Placeholder scan: no placeholder markers or unspecified implementation steps remain.
- Type consistency: `retry_count`, `last_attempt_at`, `next_attempt_at`, `last_error`, `ProcessOutboxOptions`, and `processOutbox({ now })` match the design spec.
