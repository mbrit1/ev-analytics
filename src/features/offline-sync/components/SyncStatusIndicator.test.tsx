import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncStatusIndicator } from './SyncStatusIndicator';
import { useSyncStatus, type SyncStatus } from '../hooks/useSyncStatus';

vi.mock('../hooks/useSyncStatus');

const baseStatus: SyncStatus = {
  queueLength: 0,
  hasPendingSync: false,
  pendingByTable: { providers: 0, charging_plans: 0, sessions: 0, provider_plan_selections: 0 },
  hasBlockingSyncError: false,
  blockingErrorMessage: undefined,
  retryCount: undefined,
  nextRetryAt: undefined,
  hydration: {
    providers: { status: 'ready' },
    charging_plans: { status: 'ready' },
    sessions: { status: 'ready' }
  },
  hasHydrationFailure: false,
  isHydrating: false,
  displayState: 'synced',
  isLoading: false
};

/**
 * Test suite for the sync status indicator component.
 *
 * Verifies compact rendering across resolved hydration and outbox states while
 * the normalized sync status hook is mocked.
 */
describe('SyncStatusIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders syncing while hydration is loading', () => {
    // Arrange: Return active remote hydration with a resolved empty outbox.
    vi.mocked(useSyncStatus).mockReturnValue({
      ...baseStatus,
      hydration: {
        providers: { status: 'loading' },
        charging_plans: { status: 'loading' },
        sessions: { status: 'loading' }
      },
      isHydrating: true,
      displayState: 'syncing'
    });

    // Act: Render the compact indicator.
    render(<SyncStatusIndicator />);

    // Assert: Loading status is exposed with neutral text.
    expect(screen.getByLabelText('Sync status syncing')).toBeInTheDocument();
    expect(screen.getByText('Syncing')).toBeInTheDocument();
  });

  it('renders the synced status when the queue is empty', () => {
    // Arrange: Return an empty resolved outbox status.
    vi.mocked(useSyncStatus).mockReturnValue(baseStatus);

    // Act: Render the compact indicator.
    render(<SyncStatusIndicator />);

    // Assert: Synced status is exposed.
    expect(screen.getByLabelText('Sync status synced')).toBeInTheDocument();
    expect(screen.getByText('Synced')).toBeInTheDocument();
  });

  it('renders singular pending status for one queued mutation', () => {
    // Arrange: Return one pending outbox item.
    vi.mocked(useSyncStatus).mockReturnValue({
      ...baseStatus,
      queueLength: 1,
      hasPendingSync: true,
      displayState: 'pending'
    });

    // Act: Render the compact indicator.
    render(<SyncStatusIndicator />);

    // Assert: Singular pending status is exposed.
    expect(screen.getByLabelText('Sync status pending')).toBeInTheDocument();
    expect(screen.getByText('Pending Sync')).toBeInTheDocument();
  });

  it('renders plural pending status for multiple queued mutations', () => {
    // Arrange: Return multiple pending outbox items.
    vi.mocked(useSyncStatus).mockReturnValue({
      ...baseStatus,
      queueLength: 3,
      hasPendingSync: true,
      displayState: 'pending'
    });

    // Act: Render the compact indicator.
    render(<SyncStatusIndicator />);

    // Assert: Plural pending status is exposed.
    expect(screen.getByLabelText('Sync status pending')).toBeInTheDocument();
    expect(screen.getByText('Pending Sync')).toBeInTheDocument();
  });

  it('renders a sync issue when session hydration fails', () => {
    // Arrange: Return an isolated failed sessions hydration result.
    vi.mocked(useSyncStatus).mockReturnValue({
      ...baseStatus,
      hydration: {
        providers: { status: 'ready' },
        charging_plans: { status: 'ready' },
        sessions: { status: 'failed', failureKind: 'invalid_data' }
      },
      hasHydrationFailure: true,
      displayState: 'sync-issue'
    });

    // Act: Render the compact indicator.
    render(<SyncStatusIndicator />);

    // Assert: The status does not imply that all remote data is synced.
    expect(screen.getByLabelText('Sync status issue')).toBeInTheDocument();
    expect(screen.getByText('Sync issue')).toBeInTheDocument();
  });
});
