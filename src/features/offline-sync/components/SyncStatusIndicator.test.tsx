import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncStatusIndicator } from './SyncStatusIndicator';
import { useSyncStatus, type SyncStatus } from '../hooks/useSyncStatus';

vi.mock('../hooks/useSyncStatus');

const baseStatus: SyncStatus = {
  queueLength: 0,
  hasPendingSync: false,
  pendingByTable: { providers: 0, charging_plans: 0, sessions: 0, provider_plan_selections: 0 },
  isLoading: false
};

/**
 * Test suite for the sync status indicator component.
 *
 * Verifies compact rendering for loading, synced, and pending outbox states
 * while the outbox status hook is mocked.
 */
describe('SyncStatusIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the loading sync status', () => {
    // Arrange: Return the unresolved outbox query state.
    vi.mocked(useSyncStatus).mockReturnValue({ ...baseStatus, isLoading: true });

    // Act: Render the compact indicator.
    render(<SyncStatusIndicator />);

    // Assert: Loading status is exposed with neutral text.
    expect(screen.getByLabelText('Sync status loading')).toBeInTheDocument();
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
      hasPendingSync: true
    });

    // Act: Render the compact indicator.
    render(<SyncStatusIndicator />);

    // Assert: Singular pending status is exposed.
    expect(screen.getByLabelText('Sync status pending')).toBeInTheDocument();
    expect(screen.getByText('1 pending')).toBeInTheDocument();
  });

  it('renders plural pending status for multiple queued mutations', () => {
    // Arrange: Return multiple pending outbox items.
    vi.mocked(useSyncStatus).mockReturnValue({
      ...baseStatus,
      queueLength: 3,
      hasPendingSync: true
    });

    // Act: Render the compact indicator.
    render(<SyncStatusIndicator />);

    // Assert: Plural pending status is exposed.
    expect(screen.getByLabelText('Sync status pending')).toBeInTheDocument();
    expect(screen.getByText('3 pending')).toBeInTheDocument();
  });
});
