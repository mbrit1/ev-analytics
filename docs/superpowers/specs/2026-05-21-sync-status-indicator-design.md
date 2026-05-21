# Sync Status Indicator Design

## Goal

Close the remaining Phase 3 visibility gap by adding a small, always-visible sync status indicator. The indicator should tell the user whether all local changes are synced or whether offline-first writes are still waiting in the Dexie outbox.

This is not a full diagnostics panel. It is the minimal user-facing surface and reusable hook needed before richer retry/backoff and diagnostics work.

## Scope

Build a headless sync status hook and a compact visual indicator in the authenticated app shell.

In scope:

- Read pending sync state from `db.sync_outbox`.
- Expose queue length and basic per-table counts through a reusable hook.
- Render a compact status indicator in the mobile and desktop headers.
- Cover hook and component behavior with tests.

Out of scope:

- Exponential backoff or retry scheduling.
- Manual "sync now" controls.
- Detailed diagnostics panel.
- Browser online/offline detection beyond the existing outbox-derived state.
- Changes to Supabase schema or remote sync behavior.

## User Experience

The indicator appears only after authentication, inside the existing app shell.

States:

- `Synced`: shown when the outbox is empty.
- `1 pending`: shown when exactly one outbox item is waiting.
- `N pending`: shown when multiple outbox items are waiting.
- Loading state: render a small neutral status while Dexie live query initializes, avoiding layout shift.

Placement:

- Mobile: in the top header near the existing sign-out button.
- Desktop: in the top header before the sign-out button.

Visual style should follow the current quiet utility UI: compact icon plus short text, minimum 44px hit-area only if rendered as an interactive control. Because the first version is informational, it should not look like a button.

## Architecture

Add a hook:

`src/features/offline-sync/hooks/useSyncStatus.ts`

Return shape:

```ts
interface SyncStatus {
  queueLength: number;
  hasPendingSync: boolean;
  pendingByTable: {
    providers: number;
    tariffs: number;
    sessions: number;
  };
  oldestPendingAt?: Date;
  isLoading: boolean;
}
```

The hook uses `useLiveQuery` against `db.sync_outbox`, matching existing Dexie live-query patterns in `useSessions`, `useTariffs`, and `useProviders`.

Add a component:

`src/features/offline-sync/components/SyncStatusIndicator.tsx`

The component depends only on `useSyncStatus` and renders the compact status. It should keep all display logic local so `App.tsx` only places the component in the headers.

## Data Flow

1. Domain services write local records and queue outbox entries.
2. `useSyncStatus` observes `sync_outbox`.
3. `SyncStatusIndicator` maps the hook state to concise UI text.
4. When `processOutbox()` removes successful items, Dexie live queries update the indicator automatically.

## Error Handling

The first version derives status from durable local state only. If the hook has not resolved yet, `isLoading` prevents false "Synced" messaging. Sync upload failures already preserve outbox items, so failures continue to show as pending.

Future retry metadata such as `retry_count`, `last_attempt_at`, and `last_error` can be added to the same hook without changing the indicator's placement.

## Testing

Use TDD for implementation.

Hook tests:

- Empty outbox returns `queueLength: 0`, `hasPendingSync: false`, and zero counts.
- Mixed provider, tariff, and session entries return correct `queueLength` and `pendingByTable`.
- Oldest pending timestamp is calculated from the earliest outbox item.

Component tests:

- Empty state renders `Synced`.
- One pending item renders `1 pending`.
- Multiple pending items render `N pending`.

App placement can be covered by component-level tests unless integration changes require broader App tests.

## Documentation

Follow `AGENTS.md`:

- Exported hook return types and component props, if any, need concise JSDoc.
- Test files need suite-level JSDoc above `describe`.
- Test blocks use Arrange, Act, Assert comments.

## Acceptance Criteria

- Sync status indicator is visible in authenticated mobile and desktop headers.
- Indicator updates automatically when outbox contents change.
- Hook and component tests pass.
- `npm run lint -- --max-warnings=0`, `npm run test -- --run`, and `npm run build` pass.
