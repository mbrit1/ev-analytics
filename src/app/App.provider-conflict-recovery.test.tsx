import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { useAuth } from '../features/auth';
import { useSyncStatus } from '../features/offline-sync';

const recoveryMocks = vi.hoisted(() => ({
  useProviderConflictRecovery: vi.fn(),
}));
const recoveryHarness = vi.hoisted(() => ({
  isOpen: false,
  state: { kind: 'closed' } as { kind: 'closed' } | {
    kind: 'ready'; stagedProviderName: string; canonicalProviderName: string; summary: Record<string, never>;
  },
}));
const tariffModalHarness = vi.hoisted(() => ({
  initialState: 'non-pending-open' as 'closed' | 'non-pending-open' | 'pending-open',
}));

vi.mock('../features/auth', () => ({
  useAuth: vi.fn(),
  LoginForm: () => <div>Login Form</div>,
}));
vi.mock('../features/charging-plans/components/TariffList', () => ({
  TariffList: ({
    recoveryExclusion,
    onModalStateChange,
  }: {
    recoveryExclusion?: boolean;
    onModalStateChange?: (state: { isOpen: boolean; isPending: boolean }) => void;
  }) => {
    const [isOpen, setIsOpen] = React.useState(tariffModalHarness.initialState !== 'closed');
    const isPending = tariffModalHarness.initialState === 'pending-open';
    const isExcluded = recoveryExclusion === true;

    React.useEffect(() => {
      if (isExcluded && !isPending) setIsOpen(false);
    }, [isExcluded, isPending]);
    React.useEffect(() => {
      onModalStateChange?.({ isOpen, isPending });
    }, [isOpen, isPending, onModalStateChange]);

    return (
      <div data-testid="tariffs-feature">
        {isOpen && (
          <div role="dialog" aria-modal="true" aria-label="Retire tariff">
            {isPending ? 'Pending tariff confirmation' : 'Tariff confirmation'}
          </div>
        )}
        <button type="button" disabled={isExcluded} onClick={() => setIsOpen(true)}>Open another tariff modal</button>
      </div>
    );
  },
}));
vi.mock('../features/charging-sessions', () => ({
  ChargingHistory: () => <div>Charging History</div>,
  SessionForm: () => <div>Session Form</div>,
}));
vi.mock('../shared/ui', () => ({
  Navigation: ({ onTabChange }: { onTabChange: (tab: 'sessions' | 'tariffs' | 'analytics') => void }) => (
    <button type="button" onClick={() => onTabChange('tariffs')}>Tariffs</button>
  ),
  MobileContextAction: () => null,
}));
vi.mock('../features/offline-sync', () => ({
  SyncStatusIndicator: () => null,
  ProviderConflictRecoveryDialog: () => {
    const dialogRef = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
      dialogRef.current?.focus();
    });
    return <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Resolve provider conflict">Provider recovery</div>;
  },
  useProviderConflictRecovery: recoveryMocks.useProviderConflictRecovery,
  useSyncStatus: vi.fn(),
  startSyncRuntime: vi.fn(() => vi.fn()),
  retryActiveSyncRuntime: vi.fn(),
}));

/**
 * Test suite for Tariffs modal exclusion during provider-conflict recovery.
 *
 * Verifies the app shell leaves one owner of document-level modal isolation
 * while recovery is open and does not strand focus behind its replacement.
 */
describe('App provider-conflict recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tariffModalHarness.initialState = 'non-pending-open';
    recoveryHarness.isOpen = false;
    recoveryHarness.state = { kind: 'closed' };
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-1' },
      session: null,
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    } as never);
    vi.mocked(useSyncStatus).mockReturnValue({
      queueLength: 0,
      hasPendingSync: false,
      pendingByTable: { providers: 0, charging_plans: 0, sessions: 0, provider_plan_selections: 0 },
      hasBlockingSyncError: false,
      blockingErrorMessage: undefined,
      retryCount: undefined,
      nextRetryAt: undefined,
      oldestPendingAt: undefined,
      hydration: {
        providers: { status: 'ready' },
        charging_plans: { status: 'ready' },
        sessions: { status: 'ready' },
      },
      hasHydrationFailure: false,
      isHydrating: false,
      displayState: 'synced',
      isLoading: false,
    } as never);
    recoveryMocks.useProviderConflictRecovery.mockImplementation(() => ({
      state: recoveryHarness.state,
      isOpen: recoveryHarness.isOpen,
      isPending: false,
      open: vi.fn(),
      cancel: vi.fn(),
      confirm: vi.fn(),
      acknowledge: vi.fn(),
    }));
  });

  it('closes a non-pending Tariffs confirmation before recovery becomes the sole owner without restoring background focus', async () => {
    // Arrange: Begin with the Tariffs confirmation already open while recovery remains closed.
    const user = userEvent.setup();
    const view = render(<App />);

    // Act: Enter Tariffs, focus its stable background trigger, then open recovery.
    await user.click(await screen.findByRole('button', { name: 'Tariffs' }));
    await screen.findByTestId('tariffs-feature');
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/retire tariff/i);
    const tariffTrigger = screen.getByRole('button', { name: /open another tariff modal/i });
    tariffTrigger.focus();
    expect(tariffTrigger).toHaveFocus();
    recoveryHarness.isOpen = true;
    recoveryHarness.state = { kind: 'ready', stagedProviderName: 'Staged', canonicalProviderName: 'Canonical', summary: {} };
    view.rerender(<App />);

    // Assert: Recovery owns the only document-level modal layer; the old Tariffs modal cannot retain focus or reopen.
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    expect(screen.getByRole('dialog', { name: /resolve provider conflict/i })).toHaveFocus();
    expect(tariffTrigger).not.toHaveFocus();
    expect(screen.getByRole('button', { name: /open another tariff modal/i })).toBeDisabled();
  });

  it('waits behind a pending Tariffs confirmation instead of creating a second modal isolation owner', async () => {
    // Arrange: Keep the existing Tariffs confirmation pending while recovery requests exclusivity.
    tariffModalHarness.initialState = 'pending-open';
    const user = userEvent.setup();
    const view = render(<App />);

    // Act: Enter pending Tariffs, then request provider recovery.
    await user.click(await screen.findByRole('button', { name: 'Tariffs' }));
    await screen.findByTestId('tariffs-feature');
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/retire tariff/i);
    recoveryHarness.isOpen = true;
    recoveryHarness.state = { kind: 'ready', stagedProviderName: 'Staged', canonicalProviderName: 'Canonical', summary: {} };
    view.rerender(<App />);

    // Assert: The pending confirmation remains the only active modal until it releases ownership.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/retire tariff/i);
  });

  it('blocks a new Tariffs modal while provider recovery owns document-level isolation', async () => {
    // Arrange: Start without a Tariffs modal while recovery remains closed.
    tariffModalHarness.initialState = 'closed';
    const user = userEvent.setup();
    const view = render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Tariffs' }));
    await screen.findByTestId('tariffs-feature');
    recoveryHarness.isOpen = true;
    recoveryHarness.state = { kind: 'ready', stagedProviderName: 'Staged', canonicalProviderName: 'Canonical', summary: {} };
    view.rerender(<App />);

    // Act: Attempt a fresh Tariffs confirmation while recovery is active.
    await user.click(screen.getByRole('button', { name: /open another tariff modal/i }));

    // Assert: Recovery remains the sole modal owner and Tariffs cannot open beneath it.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: /retire tariff/i })).not.toBeInTheDocument();
  });
});
