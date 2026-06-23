import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthError } from '@supabase/supabase-js';
import App from './App';
import { useAuth } from '../features/auth';
import type { ChargingSession } from '../infra/db';
import { useSyncStatus } from '../features/offline-sync';
import type { SessionPersistenceRequest } from '../features/charging-sessions';

const {
  existingSession,
  submittedSession,
  mockSaveSession,
  mockUpdateSession,
} = vi.hoisted(() => {
  const timestamp = new Date('2026-06-01T08:00:00.000Z');
  const baseSession = {
    user_id: 'user-1',
    session_timestamp: timestamp,
    provider_id: 'provider-1',
    provider_name_snapshot: 'Provider',
    charging_plan_name_snapshot: 'Plan',
    charging_type: 'AC' as const,
    kwh_billed: 10,
    total_cost: 400,
    session_mode: 'plan' as const,
    tariff_plan_id: 'plan-1',
    plan_selection_id: 'selection-1',
    price_snapshot: { label: 'Provider Plan', kWhPrice: 40, sessionFee: 0 },
    pricing_context: 'standard' as const,
    applied_price_per_kwh: 40,
    applied_ac_price_per_kwh: 40,
    applied_dc_price_per_kwh: 60,
    applied_roaming_ac_price_per_kwh: 50,
    applied_roaming_dc_price_per_kwh: 70,
    applied_monthly_base_fee: 0,
    applied_session_fee: 0,
    created_at: timestamp,
    updated_at: timestamp,
  };

  return {
    existingSession: { ...baseSession, id: 'session-existing' },
    submittedSession: {
      session: {
        ...baseSession,
        id: 'session-existing',
        notes: 'Edited',
        updated_at: new Date('2026-06-02T08:00:00.000Z'),
      },
    } satisfies SessionPersistenceRequest,
    mockSaveSession: vi.fn(),
    mockUpdateSession: vi.fn(),
  };
});

vi.mock('../features/auth', () => ({
  useAuth: vi.fn(),
  LoginForm: () => <div data-testid="login-form">Login Form</div>,
}));
vi.mock('../features/charging-plans/components/TariffList', () => ({
  TariffList: ({
    tariffFormState,
    onCreateTariff,
    onCloseForm,
    onFormOpenChange,
  }: {
    tariffFormState: { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; logicalTariffKey: string };
    onCreateTariff: () => void;
    onCloseForm: () => void;
    onFormOpenChange?: (isOpen: boolean) => void;
  }) => {
    React.useEffect(() => {
      onFormOpenChange?.(tariffFormState.mode !== 'closed');
    }, [onFormOpenChange, tariffFormState.mode]);

    return (
      <div>
        Tariff List
        {tariffFormState.mode !== 'closed' ? (
          <div>
            Tariff Form
            <button type="button" onClick={onCloseForm}>
              Close Tariff Form
            </button>
          </div>
        ) : (
          <button type="button" onClick={onCreateTariff}>
            Open Tariff Form
          </button>
        )}
      </div>
    );
  },
}));
vi.mock('../features/charging-sessions', () => ({
  ChargingHistory: ({
    onSelectSession,
    restorationRequest,
    onRestorationComplete,
  }: {
    onSelectSession?: (session: ChargingSession) => void;
    restorationRequest?: { type: 'position'; scrollY: number; focusSessionId?: string | null } | { type: 'session'; sessionId: string } | null;
    onRestorationComplete?: () => void;
  }) => (
    <div>
      Charging History
      <button
        type="button"
        onClick={() => onSelectSession?.(existingSession as ChargingSession)}
      >
        Open Existing Session
      </button>
      <button
        type="button"
        data-testid="restore-position"
        onClick={() => onRestorationComplete?.()}
      >
        {restorationRequest?.type === 'position' ? `Restore Position ${restorationRequest.scrollY}` : 'No Position Restore'}
      </button>
      <button
        type="button"
        data-testid="restore-session"
        onClick={() => onRestorationComplete?.()}
      >
        {restorationRequest?.type === 'session' ? `Restore Session ${restorationRequest.sessionId}` : 'No Session Restore'}
      </button>
    </div>
  ),
  SessionForm: ({ onSubmit, onCancel, initialValues }: {
    onSubmit: (request: SessionPersistenceRequest) => Promise<void>;
    onCancel: () => void;
    initialValues?: ChargingSession;
  }) => (
    <div>
      <div>{initialValues ? 'Edit Session Form' : 'Session Form'}</div>
      <button
        type="button"
        onClick={() => {
          void onSubmit(submittedSession as SessionPersistenceRequest).catch(() => undefined);
        }}
      >
        Trigger Session Submit
      </button>
      <button type="button" onClick={onCancel}>Cancel Session Form</button>
    </div>
  ),
  saveSession: mockSaveSession,
  updateSession: mockUpdateSession,
}));
vi.mock('../shared/ui', () => ({
  Navigation: ({
    activeTab,
    onTabChange,
  }: {
    activeTab: 'sessions' | 'tariffs' | 'analytics';
    onTabChange: (tab: 'sessions' | 'tariffs' | 'analytics') => void;
  }) => (
    <nav aria-label="Primary app navigation">
      <button type="button" aria-pressed={activeTab === 'sessions'} onClick={() => onTabChange('sessions')}>Sessions</button>
      <button type="button" aria-pressed={activeTab === 'tariffs'} onClick={() => onTabChange('tariffs')}>Tariffs</button>
      <button type="button" aria-pressed={activeTab === 'analytics'} onClick={() => onTabChange('analytics')}>Analytics</button>
    </nav>
  ),
  MobileContextAction: ({
    activeTab,
    onAddSession,
    onAddTariff,
    isVisible = true,
  }: {
    activeTab: 'sessions' | 'tariffs' | 'analytics';
    onAddSession: () => void;
    onAddTariff: () => void;
    isVisible?: boolean;
  }) => {
    if (!isVisible || activeTab === 'analytics') {
      return null
    }

    return (
      <div>
        {activeTab === 'sessions' ? <button type="button" onClick={onAddSession}>Add Session Pill</button> : null}
        {activeTab === 'tariffs' ? <button type="button" onClick={onAddTariff}>Add Tariff Pill</button> : null}
      </div>
    )
  },
  Slab: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../features/offline-sync', () => ({
  SyncStatusIndicator: () => <div>Sync Status</div>,
  useSyncStatus: vi.fn(() => ({
    queueLength: 0,
    hasPendingSync: false,
    pendingByTable: {
      providers: 0,
      charging_plans: 0,
      sessions: 0,
      provider_plan_selections: 0,
    },
    hasBlockingSyncError: false,
    blockingErrorMessage: undefined,
    retryCount: undefined,
    nextRetryAt: undefined,
    oldestPendingAt: undefined,
    isLoading: false,
  })),
  startSyncRuntime: vi.fn(() => vi.fn()),
}));

/**
 * Test suite for the mobile action dock shell wiring.
 *
 * Verifies tab switching, contextual mobile create actions, and sign-out flows.
 */
describe('App mobile action dock', () => {
  const mockSignOut = vi.fn();
  const mockScrollTo = vi.fn();

  const authenticatedUser = {
    id: 'user-1',
    email: 'driver@example.com',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('scrollTo', mockScrollTo);
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      writable: true,
      value: 0,
    });
    mockSignOut.mockResolvedValue({ error: null });
    mockSaveSession.mockReset();
    mockUpdateSession.mockReset();
    vi.mocked(useSyncStatus).mockReturnValue({
      queueLength: 0,
      hasPendingSync: false,
      pendingByTable: {
        providers: 0,
        charging_plans: 0,
        sessions: 0,
        provider_plan_selections: 0,
      },
      hasBlockingSyncError: false,
      blockingErrorMessage: undefined,
      retryCount: undefined,
      nextRetryAt: undefined,
      oldestPendingAt: undefined,
      isLoading: false,
    });
    vi.mocked(useAuth).mockReturnValue({
      user: authenticatedUser,
      session: null,
      loading: false,
      signIn: vi.fn(),
      signOut: mockSignOut,
    });
  });

  it('keeps the inline Add Session action desktop-only while reserving dock clearance', () => {
    // Arrange: Render the authenticated app shell.
    const { container } = render(<App />);

    // Assert: The shell keeps the current dock clearance token budget.
    const main = container.querySelector('main');
    expect(main).not.toBeNull();
    expect(main).toHaveClass('pb-[var(--mobile-content-clearance-with-action)]');
    expect(main).toHaveClass('md:pb-8');

    const inlineAddSession = screen.getByRole('button', { name: 'Add Session' });
    expect(inlineAddSession).toHaveClass('hidden');
    expect(inlineAddSession).toHaveClass('md:flex');
  });

  it('switches between sessions and tariffs views through the navigation controls', async () => {
    // Arrange: Set up an authenticated app shell with the navigation dock mock.
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Charging History' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sessions' })).not.toBeInTheDocument();

    // Act: Jump to tariffs from the default sessions view and then back again.
    await user.click(screen.getByRole('button', { name: 'Tariffs' }));
    expect(await screen.findByText('Tariff List')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sessions' }));
    expect(await screen.findByRole('heading', { name: 'Charging History' })).toBeInTheDocument();
  });

  it('does not show a contextual create pill on analytics', async () => {
    // Arrange: Render the authenticated shell and move to the analytics tab.
    const user = userEvent.setup();
    render(<App />);

    // Act: Switch to the analytics tab where mobile create actions are suppressed.
    await user.click(screen.getByRole('button', { name: 'Analytics' }));

    // Assert: The mobile create pill stays hidden on analytics.
    expect(screen.queryByText('Add Session Pill')).not.toBeInTheDocument();
    expect(screen.queryByText('Add Tariff Pill')).not.toBeInTheDocument();
  });

  it('opens the session form when Add Session is invoked from mobile contextual action', async () => {
    // Arrange: Render the authenticated shell and the mock contextual action.
    const user = userEvent.setup();
    render(<App />);

    // Act: Trigger the contextual add action.
    await user.click(screen.getByText('Add Session Pill'));

    // Assert: The existing Add Session flow opens the session form surface.
    expect(screen.getByText('Session Form')).toBeInTheDocument();
    expect(screen.queryByText('Edit Session Form')).not.toBeInTheDocument();
  });

  it('opens the selected session and cancel returns to history without persistence', async () => {
    // Arrange: open edit mode.
    const user = userEvent.setup();
    Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 840 });
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Open Existing Session' }));
    expect(screen.getByText('Edit Session Form')).toBeInTheDocument();

    // Act: cancel.
    await user.click(screen.getByRole('button', { name: 'Cancel Session Form' }));

    // Assert: history returns, requests prior-position restoration, and no write occurs.
    expect(screen.getByRole('heading', { name: 'Charging History' })).toBeInTheDocument();
    expect(screen.getByTestId('restore-position')).toHaveTextContent('Restore Position 840');
    expect(mockSaveSession).not.toHaveBeenCalled();
    expect(mockUpdateSession).not.toHaveBeenCalled();
  });

  it('saves an edited session through update and then opens a blank create form', async () => {
    // Arrange: open edit mode.
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Open Existing Session' }));

    // Act: submit the prepared edit, return to history, then start create mode.
    await user.click(screen.getByRole('button', { name: 'Trigger Session Submit' }));
    await screen.findByRole('heading', { name: 'Charging History' });

    // Assert: update receives the prepared session and restoration targets the edited card.
    expect(mockUpdateSession).toHaveBeenCalledWith(submittedSession.session);
    expect(mockSaveSession).not.toHaveBeenCalled();
    expect(screen.getByTestId('restore-session')).toHaveTextContent('Restore Session session-existing');

    // Act: reopen create mode after returning to history.
    await user.click(screen.getByText('Add Session Pill'));

    // Assert: edit state does not leak into the blank create form.
    expect(screen.getByText('Session Form')).toBeInTheDocument();
    expect(screen.queryByText('Edit Session Form')).not.toBeInTheDocument();
  });

  it('clears the pending history restoration request after the history acknowledges it', async () => {
    // Arrange: return from edit mode into history with a pending restoration request.
    const user = userEvent.setup();
    Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 512 });
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Open Existing Session' }));
    await user.click(screen.getByRole('button', { name: 'Cancel Session Form' }));
    expect(screen.getByTestId('restore-position')).toHaveTextContent('Restore Position 512');

    // Act: simulate the history component consuming the restore request.
    await user.click(screen.getByTestId('restore-position'));

    // Assert: the request is one-shot and no longer present after acknowledgement.
    expect(screen.getByTestId('restore-position')).toHaveTextContent('No Position Restore');
    expect(screen.getByTestId('restore-session')).toHaveTextContent('No Session Restore');
  });

  it('keeps edit mode open when the local update rejects', async () => {
    // Arrange: make the offline update transaction fail.
    const user = userEvent.setup();
    mockUpdateSession.mockRejectedValueOnce(new Error('Outbox failed'));
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Open Existing Session' }));

    // Act: submit the edit.
    await user.click(screen.getByRole('button', { name: 'Trigger Session Submit' }));

    // Assert: App does not close edit mode after a rejected promise.
    expect(screen.getByText('Edit Session Form')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Existing Session' })).not.toBeInTheDocument();
  });

  it('discards unsaved edit state when leaving the sessions tab', async () => {
    // Arrange: open edit mode and then navigate away.
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Open Existing Session' }));
    expect(screen.getByText('Edit Session Form')).toBeInTheDocument();

    // Act: leave sessions and then return.
    await user.click(screen.getByRole('button', { name: 'Tariffs' }));
    expect(await screen.findByText('Tariff List')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sessions' }));

    // Assert: the shell returns to history instead of restoring the stale edit form.
    expect(await screen.findByRole('heading', { name: 'Charging History' })).toBeInTheDocument();
    expect(screen.queryByText('Edit Session Form')).not.toBeInTheDocument();
  });

  it('opens the tariff form when Add Tariff is invoked from mobile contextual action', async () => {
    // Arrange: Switch to tariffs so the tariff pill is visible.
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Tariffs' }));

    // Act: Trigger the contextual tariff create action.
    await user.click(screen.getByText('Add Tariff Pill'));

    // Assert: TariffList receives the create request and opens its existing form.
    expect(screen.getByText('Tariff Form')).toBeInTheDocument();
  });

  it('closes tariff create mode when leaving the tariffs tab', async () => {
    // Arrange: Open the tariff form from the mobile add action.
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Tariffs' }));
    await user.click(screen.getByText('Add Tariff Pill'));
    expect(screen.getByText('Tariff Form')).toBeInTheDocument();

    // Act: Leave the tariffs tab.
    await user.click(screen.getByRole('button', { name: 'Sessions' }));

    // Assert: Returning to tariffs does not reopen the create flow.
    await user.click(screen.getByRole('button', { name: 'Tariffs' }));
    expect(screen.queryByText('Tariff Form')).not.toBeInTheDocument();
  });

  it('surfaces sign-out errors without blocking the dock flow', async () => {
    // Arrange: Make the auth layer reject logout so the shell remains mounted.
    const user = userEvent.setup();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSignOut.mockRejectedValueOnce(new Error('network down'));
    vi.mocked(useAuth).mockReturnValue({
      user: authenticatedUser,
      session: null,
      loading: false,
      signIn: vi.fn(),
      signOut: mockSignOut,
    });

    // Act: Trigger logout from the app shell.
    render(<App />);
    await user.click(screen.getAllByRole('button', { name: 'Sign Out' })[0]);

    // Assert: The alert is surfaced and the app shell remains interactive.
    expect(screen.getByRole('alert')).toHaveTextContent('network down');
    expect(screen.getByRole('button', { name: 'Add Session' })).toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });

  it('logs signOut auth error responses without blocking the dock flow', async () => {
    // Arrange: Make the auth layer return a Supabase auth error object.
    const user = userEvent.setup();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const authError = { message: 'Token revoked' } as AuthError;
    mockSignOut.mockResolvedValueOnce({ error: authError });
    vi.mocked(useAuth).mockReturnValue({
      user: authenticatedUser,
      session: null,
      loading: false,
      signIn: vi.fn(),
      signOut: mockSignOut,
    });

    // Act: Trigger logout from the app shell.
    render(<App />);
    await user.click(screen.getAllByRole('button', { name: 'Sign Out' })[0]);

    // Assert: The auth error is logged and the shell stays mounted.
    expect(consoleErrorSpy).toHaveBeenCalledWith('Sign-out failed:', authError);
    expect(screen.getByRole('alert')).toHaveTextContent('Token revoked');
    expect(screen.getByRole('button', { name: 'Add Session' })).toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });
});
