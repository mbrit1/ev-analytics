import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthError } from '@supabase/supabase-js';
import App from './App';
import { useAuth } from '../features/auth';
import { useSyncStatus } from '../features/offline-sync';

vi.mock('../features/auth', () => ({
  useAuth: vi.fn(),
  LoginForm: () => <div data-testid="login-form">Login Form</div>,
}));
vi.mock('../features/charging-plans/components/TariffList', () => ({
  TariffList: ({
    isCreatingTariff,
    onCreateTariffChange,
    onFormOpenChange,
  }: {
    isCreatingTariff: boolean;
    onCreateTariffChange: (isCreatingTariff: boolean) => void;
    onFormOpenChange?: (isOpen: boolean) => void;
  }) => {
    const [isOpen, setIsOpen] = React.useState(false);
    React.useEffect(() => {
      onFormOpenChange?.(isOpen);
    }, [isOpen, onFormOpenChange]);

    React.useEffect(() => {
      if (!isCreatingTariff) {
        return;
      }

      setIsOpen(true);
    }, [isCreatingTariff]);

    return (
      <div>
        Tariff List
        {isOpen ? (
          <div>
            Tariff Form
            <button type="button" onClick={() => {
              setIsOpen(false);
              onCreateTariffChange(false);
            }}>
              Close Tariff Form
            </button>
          </div>
        ) : null}
      </div>
    );
  },
}));
vi.mock('../features/charging-sessions', () => ({
  ChargingHistory: () => <div>Charging History</div>,
  SessionForm: () => <div>Session Form</div>,
  saveSession: vi.fn(),
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
    mockSignOut.mockResolvedValue({ error: null });
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

    // Act: Jump to tariffs from the default sessions view and then back again.
    await user.click(screen.getByRole('button', { name: 'Tariffs' }));
    expect(await screen.findByText('Tariff List')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sessions' }));
    expect(await screen.findByText('Charging History')).toBeInTheDocument();
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
