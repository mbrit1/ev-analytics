# Sync Status Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable outbox-derived sync status hook and show a compact sync status indicator in the authenticated app headers.

**Architecture:** `useSyncStatus` reads `db.sync_outbox` with Dexie `useLiveQuery` and returns normalized counts. `SyncStatusIndicator` renders the concise status text and icon from that hook. `App.tsx` only imports and places the indicator in the existing mobile and desktop headers.

**Tech Stack:** React, TypeScript, Dexie, dexie-react-hooks, Vitest, React Testing Library, lucide-react, Tailwind CSS.

---

## File Structure

- Create: `src/features/offline-sync/hooks/useSyncStatus.ts`
  - Owns all outbox aggregation logic and exported sync status types.
- Create: `src/features/offline-sync/hooks/useSyncStatus.test.ts`
  - Verifies empty, mixed-table, and oldest-timestamp hook behavior against fake IndexedDB.
- Create: `src/features/offline-sync/components/SyncStatusIndicator.tsx`
  - Owns display mapping from hook state to compact UI.
- Create: `src/features/offline-sync/components/SyncStatusIndicator.test.tsx`
  - Verifies loading, synced, one-pending, and multiple-pending display states with a mocked hook.
- Modify: `src/App.tsx`
  - Places the indicator in authenticated mobile and desktop headers.

---

### Task 1: Add Sync Status Hook

**Files:**
- Create: `src/features/offline-sync/hooks/useSyncStatus.test.ts`
- Create: `src/features/offline-sync/hooks/useSyncStatus.ts`

- [ ] **Step 1: Write the failing hook tests**

Create `src/features/offline-sync/hooks/useSyncStatus.test.ts`:

```ts
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { db, type SyncPayload } from '../../../lib/db';
import { useSyncStatus } from './useSyncStatus';
import 'fake-indexeddb/auto';

/**
 * Test suite for the sync status hook.
 *
 * Verifies outbox-derived queue counts, table breakdowns, and oldest pending
 * timestamps while reading from fake IndexedDB.
 */
describe('useSyncStatus', () => {
  beforeEach(async () => {
    // Arrange: Clear durable outbox state so each hook test starts isolated.
    await db.sync_outbox.clear();
  });

  it('returns an empty synced state when the outbox has no items', async () => {
    // Arrange: Leave the outbox empty.

    // Act: Render the hook and wait for Dexie live query resolution.
    const { result } = renderHook(() => useSyncStatus());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Assert: Empty outbox is normalized to a synced state.
    expect(result.current.queueLength).toBe(0);
    expect(result.current.hasPendingSync).toBe(false);
    expect(result.current.pendingByTable).toEqual({
      providers: 0,
      tariffs: 0,
      sessions: 0,
    });
    expect(result.current.oldestPendingAt).toBeUndefined();
  });

  it('counts pending outbox items by table', async () => {
    // Arrange: Queue mixed pending writes.
    await db.sync_outbox.bulkAdd([
      {
        table_name: 'providers',
        action: 'INSERT',
        payload: { id: 'p1' } as SyncPayload,
        timestamp: new Date('2026-05-21T08:00:00.000Z'),
      },
      {
        table_name: 'tariffs',
        action: 'UPDATE',
        payload: { id: 't1' } as SyncPayload,
        timestamp: new Date('2026-05-21T09:00:00.000Z'),
      },
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: { id: 's1' } as SyncPayload,
        timestamp: new Date('2026-05-21T10:00:00.000Z'),
      },
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: { id: 's2' } as SyncPayload,
        timestamp: new Date('2026-05-21T11:00:00.000Z'),
      },
    ]);

    // Act: Render the hook and wait for Dexie live query resolution.
    const { result } = renderHook(() => useSyncStatus());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Assert: Total and table-specific pending counts are exposed.
    expect(result.current.queueLength).toBe(4);
    expect(result.current.hasPendingSync).toBe(true);
    expect(result.current.pendingByTable).toEqual({
      providers: 1,
      tariffs: 1,
      sessions: 2,
    });
  });

  it('returns the oldest pending timestamp', async () => {
    // Arrange: Queue outbox items with non-sorted timestamps.
    await db.sync_outbox.bulkAdd([
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: { id: 'newer' } as SyncPayload,
        timestamp: new Date('2026-05-21T12:00:00.000Z'),
      },
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: { id: 'older' } as SyncPayload,
        timestamp: new Date('2026-05-21T07:30:00.000Z'),
      },
    ]);

    // Act: Render the hook and wait for Dexie live query resolution.
    const { result } = renderHook(() => useSyncStatus());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Assert: The earliest outbox timestamp is surfaced.
    expect(result.current.oldestPendingAt?.toISOString()).toBe('2026-05-21T07:30:00.000Z');
  });
});
```

- [ ] **Step 2: Run hook tests to verify RED**

Run:

```bash
npm run test -- --run src/features/offline-sync/hooks/useSyncStatus.test.ts
```

Expected: FAIL because `./useSyncStatus` does not exist.

- [ ] **Step 3: Implement the hook**

Create `src/features/offline-sync/hooks/useSyncStatus.ts`:

```ts
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../lib/db';

/**
 * Count of pending sync outbox items grouped by local domain table.
 */
export interface PendingSyncByTable {
  /** Provider mutations waiting for remote sync. */
  providers: number;
  /** Tariff mutations waiting for remote sync. */
  tariffs: number;
  /** Charging session mutations waiting for remote sync. */
  sessions: number;
}

/**
 * Normalized sync status derived from the local Dexie outbox.
 */
export interface SyncStatus {
  /** Total number of pending outbox items. */
  queueLength: number;
  /** True when at least one local write still needs remote sync. */
  hasPendingSync: boolean;
  /** Pending outbox counts by local table. */
  pendingByTable: PendingSyncByTable;
  /** Earliest queued mutation timestamp, when pending items exist. */
  oldestPendingAt?: Date;
  /** True while the Dexie live query has not resolved yet. */
  isLoading: boolean;
}

const emptyPendingByTable: PendingSyncByTable = {
  providers: 0,
  tariffs: 0,
  sessions: 0,
};

/**
 * Subscribes to the local sync outbox and exposes compact sync status.
 *
 * The hook intentionally derives status only from durable local state so it can
 * work offline and update automatically when the sync engine clears outbox rows.
 */
export function useSyncStatus(): SyncStatus {
  const outboxItems = useLiveQuery(() => db.sync_outbox.toArray(), []);

  if (outboxItems === undefined) {
    return {
      queueLength: 0,
      hasPendingSync: false,
      pendingByTable: emptyPendingByTable,
      isLoading: true,
    };
  }

  const pendingByTable = outboxItems.reduce<PendingSyncByTable>(
    (counts, item) => ({
      ...counts,
      [item.table_name]: counts[item.table_name] + 1,
    }),
    { ...emptyPendingByTable }
  );

  const oldestPendingAt = outboxItems.reduce<Date | undefined>((oldest, item) => {
    if (!oldest || item.timestamp < oldest) return item.timestamp;
    return oldest;
  }, undefined);

  return {
    queueLength: outboxItems.length,
    hasPendingSync: outboxItems.length > 0,
    pendingByTable,
    oldestPendingAt,
    isLoading: false,
  };
}
```

- [ ] **Step 4: Run hook tests to verify GREEN**

Run:

```bash
npm run test -- --run src/features/offline-sync/hooks/useSyncStatus.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/features/offline-sync/hooks/useSyncStatus.ts src/features/offline-sync/hooks/useSyncStatus.test.ts
git commit -m "feat(sync): add sync status hook" -m "Expose outbox-derived sync queue status through a reusable hook so UI and future diagnostics can share the same local-first state."
```

---

### Task 2: Add Sync Status Indicator Component

**Files:**
- Create: `src/features/offline-sync/components/SyncStatusIndicator.test.tsx`
- Create: `src/features/offline-sync/components/SyncStatusIndicator.tsx`

- [ ] **Step 1: Write the failing component tests**

Create `src/features/offline-sync/components/SyncStatusIndicator.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncStatusIndicator } from './SyncStatusIndicator';
import { useSyncStatus, type SyncStatus } from '../hooks/useSyncStatus';

vi.mock('../hooks/useSyncStatus');

const baseStatus: SyncStatus = {
  queueLength: 0,
  hasPendingSync: false,
  pendingByTable: {
    providers: 0,
    tariffs: 0,
    sessions: 0,
  },
  isLoading: false,
};

/**
 * Test suite for the sync status indicator.
 *
 * Verifies compact rendering for loading, synced, singular pending, and plural
 * pending states while the sync status hook is mocked.
 */
describe('SyncStatusIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a loading sync status while the hook initializes', () => {
    // Arrange: Return the hook initialization state.
    vi.mocked(useSyncStatus).mockReturnValue({
      ...baseStatus,
      isLoading: true,
    });

    // Act: Render the indicator.
    render(<SyncStatusIndicator />);

    // Assert: A neutral loading label is shown.
    expect(screen.getByText(/syncing/i)).toBeInTheDocument();
  });

  it('renders Synced when there are no pending outbox items', () => {
    // Arrange: Return an empty outbox status.
    vi.mocked(useSyncStatus).mockReturnValue(baseStatus);

    // Act: Render the indicator.
    render(<SyncStatusIndicator />);

    // Assert: Synced state is shown.
    expect(screen.getByText(/synced/i)).toBeInTheDocument();
  });

  it('renders singular pending text for one pending outbox item', () => {
    // Arrange: Return one pending item.
    vi.mocked(useSyncStatus).mockReturnValue({
      ...baseStatus,
      queueLength: 1,
      hasPendingSync: true,
      pendingByTable: {
        providers: 0,
        tariffs: 0,
        sessions: 1,
      },
    });

    // Act: Render the indicator.
    render(<SyncStatusIndicator />);

    // Assert: Singular pending text is shown.
    expect(screen.getByText(/1 pending/i)).toBeInTheDocument();
  });

  it('renders plural pending text for multiple pending outbox items', () => {
    // Arrange: Return multiple pending items.
    vi.mocked(useSyncStatus).mockReturnValue({
      ...baseStatus,
      queueLength: 3,
      hasPendingSync: true,
      pendingByTable: {
        providers: 1,
        tariffs: 1,
        sessions: 1,
      },
    });

    // Act: Render the indicator.
    render(<SyncStatusIndicator />);

    // Assert: Plural pending text is shown.
    expect(screen.getByText(/3 pending/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run component tests to verify RED**

Run:

```bash
npm run test -- --run src/features/offline-sync/components/SyncStatusIndicator.test.tsx
```

Expected: FAIL because `./SyncStatusIndicator` does not exist.

- [ ] **Step 3: Implement the component**

Create `src/features/offline-sync/components/SyncStatusIndicator.tsx`:

```tsx
import { CheckCircle2, Clock3, Loader2 } from 'lucide-react';
import { useSyncStatus } from '../hooks/useSyncStatus';

/**
 * Compact outbox-derived sync status shown in the authenticated app header.
 *
 * The indicator is informational only; detailed retry state and diagnostics
 * remain reserved for the later diagnostics panel.
 */
export function SyncStatusIndicator() {
  const { isLoading, queueLength, hasPendingSync } = useSyncStatus();

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 text-xs font-bold text-secondary" aria-label="Sync status loading">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>Syncing</span>
      </div>
    );
  }

  if (!hasPendingSync) {
    return (
      <div className="flex items-center gap-1.5 text-xs font-bold text-green-600" aria-label="Sync status synced">
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span>Synced</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs font-bold text-amber-600" aria-label="Sync status pending">
      <Clock3 className="h-3.5 w-3.5" />
      <span>{queueLength === 1 ? '1 pending' : `${queueLength} pending`}</span>
    </div>
  );
}
```

- [ ] **Step 4: Run component tests to verify GREEN**

Run:

```bash
npm run test -- --run src/features/offline-sync/components/SyncStatusIndicator.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/features/offline-sync/components/SyncStatusIndicator.tsx src/features/offline-sync/components/SyncStatusIndicator.test.tsx
git commit -m "feat(sync): add sync status indicator" -m "Render compact outbox-derived sync status so users can see whether local-first writes are fully synced or still pending."
```

---

### Task 3: Place Indicator In Authenticated Headers

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update `App.tsx`**

Modify imports:

```ts
import { SyncStatusIndicator } from './features/offline-sync/components/SyncStatusIndicator'
```

In the mobile header, replace the sign-out button block with this wrapper:

```tsx
<div className="flex items-center gap-3">
  <SyncStatusIndicator />
  <button
    onClick={handleLogout}
    className="p-2 text-secondary hover:text-primary transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
    aria-label="Sign Out"
  >
    <LogOut className="w-5 h-5" />
  </button>
</div>
```

In the desktop header, place the indicator before the sign-out button:

```tsx
<div className="flex-1 px-8 h-16 flex items-center justify-end gap-4">
  <SyncStatusIndicator />
  <button
    onClick={handleLogout}
    className="flex items-center gap-2 p-2 text-secondary hover:text-primary transition-colors min-h-[44px]"
    aria-label="Sign Out"
  >
    <span className="font-bold">Sign Out</span>
    <LogOut className="w-5 h-5" />
  </button>
</div>
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm run test -- --run src/features/offline-sync/hooks/useSyncStatus.test.ts src/features/offline-sync/components/SyncStatusIndicator.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run lint with zero warnings**

Run:

```bash
npm run lint -- --max-warnings=0
```

Expected: PASS with no warnings.

- [ ] **Step 4: Commit Task 3**

```bash
git add src/App.tsx
git commit -m "feat(sync): show sync status in app headers" -m "Place the outbox-derived status indicator in authenticated mobile and desktop headers so sync visibility is always available without opening diagnostics."
```

---

### Task 4: Final Verification

**Files:**
- No planned edits.

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm run test -- --run
```

Expected: PASS.

- [ ] **Step 2: Run production build**

Run:

```bash
npm run build
```

Expected: PASS. Existing Vite chunk-size warnings are acceptable if unchanged.

- [ ] **Step 3: Confirm working tree**

Run:

```bash
git status --short --branch
```

Expected: clean working tree on `feat/sync-status-indicator`.

## Self-Review Notes

- Spec coverage: hook, component, App placement, TDD tests, documentation expectations, and verification commands are covered.
- Placeholder scan: no placeholder markers or unspecified implementation steps remain.
- Type consistency: `SyncStatus`, `PendingSyncByTable`, `queueLength`, `hasPendingSync`, `pendingByTable`, `oldestPendingAt`, and `isLoading` match the design spec.
