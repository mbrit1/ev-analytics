import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthError } from '@supabase/supabase-js';
import App from './App';
import { useAuth } from '../features/auth';
import { useSyncStatus } from '../features/offline-sync';

vi.mock('../features/auth', () => ({
  useAuth: vi.fn(),
  LoginForm: () => <div data-testid="login-form">Login Form</div>,
}));
vi.mock('../features/charging-plans/components/TariffList', () => ({
  TariffList: ({ isCreatingTariff }: { isCreatingTariff: boolean }) => (
    <div>{isCreatingTariff ? 'Tariff Create Form' : 'Tariff List'}</div>
  ),
}));
vi.mock('../features/charging-sessions', () => ({
  ChargingHistory: () => <div>Charging History</div>,
  SessionForm: () => <div>Session Form</div>,
}));
vi.mock('../shared/ui', () => ({
  Navigation: ({
    activeTab,
    onTabChange,
  }: {
    activeTab: 'sessions' | 'tariffs' | 'analytics';
    onTabChange: (tab: 'sessions' | 'tariffs' | 'analytics') => void;
  }) => (
    <nav>
      <div>Navigation</div>
      <button
        type="button"
        aria-pressed={activeTab === 'sessions'}
        onClick={() => onTabChange('sessions')}
      >
        Sessions Tab
      </button>
      <button
        type="button"
        aria-pressed={activeTab === 'tariffs'}
        onClick={() => onTabChange('tariffs')}
      >
        Tariffs Tab
      </button>
      <button
        type="button"
        aria-pressed={activeTab === 'analytics'}
        onClick={() => onTabChange('analytics')}
      >
        Analytics Tab
      </button>
    </nav>
  ),
  MobileContextAction: () => <div>Mobile Context Action</div>,
  Slab: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../features/offline-sync', () => ({
  SyncStatusIndicator: () => <div>Sync Status</div>,
  useSyncStatus: vi.fn(() => ({
    queueLength: 0,
    hasPendingSync: false,
    pendingByTable: { providers: 0, charging_plans: 0, sessions: 0, provider_plan_selections: 0 },
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
 * Test suite for App authentication gating and logout wiring.
 *
 * Verifies unauthenticated users see the login form, authenticated users see
 * the app shell, and the sign-out UI invokes the auth hook action.
 */
describe('App auth gating', () => {
  const mockSignOut = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockSignOut.mockResolvedValue({ error: null });
    vi.mocked(useSyncStatus).mockReturnValue({
      queueLength: 0,
      hasPendingSync: false,
      pendingByTable: { providers: 0, charging_plans: 0, sessions: 0, provider_plan_selections: 0 },
      hasBlockingSyncError: false,
      blockingErrorMessage: undefined,
      retryCount: undefined,
      nextRetryAt: undefined,
      oldestPendingAt: undefined,
      isLoading: false,
    });
  });

  it('renders login form when user is unauthenticated', () => {
    // Arrange: Mock auth context with no signed-in user.
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      session: null,
      loading: false,
      signIn: vi.fn(),
      signOut: mockSignOut,
    });

    // Act: Render the root app shell.
    render(<App />);

    // Assert: Login form is shown instead of authenticated app content.
    expect(screen.getByTestId('login-form')).toBeInTheDocument();
    expect(screen.queryByText('Sessions')).not.toBeInTheDocument();
  });

  it('renders loading state while auth session is hydrating', () => {
    // Arrange: Mock auth context while initial session lookup is still pending.
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      session: null,
      loading: true,
      signIn: vi.fn(),
      signOut: mockSignOut,
    });

    // Act: Render the root app shell.
    render(<App />);

    // Assert: Login and app content are both withheld while loading is true.
    expect(screen.queryByTestId('login-form')).not.toBeInTheDocument();
    expect(screen.queryByText('Navigation')).not.toBeInTheDocument();
  });

  it('calls signOut from useAuth when clicking Sign Out', async () => {
    // Arrange: Mock auth context for an authenticated user.
    const user = userEvent.setup();
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: 'user-1',
        email: 'driver@example.com',
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString(),
      },
      session: null,
      loading: false,
      signIn: vi.fn(),
      signOut: mockSignOut,
    });

    // Act: Render app and click the stable desktop sign-out control.
    render(<App />);
    const signOutText = screen.getByText('Sign Out');
    const signOutButton = signOutText.closest('button');
    expect(signOutButton).not.toBeNull();
    await user.click(signOutButton!);

    // Assert: App delegates logout to auth context action.
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('keeps mobile dock clearance on the main scroll container', () => {
    // Arrange: Mock an authenticated user so the app shell renders.
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: 'user-1',
        email: 'driver@example.com',
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString(),
      },
      session: null,
      loading: false,
      signIn: vi.fn(),
      signOut: mockSignOut,
    });

    // Act: Render the authenticated app shell.
    const { container } = render(<App />);
    const main = container.querySelector('main');

    // Assert: The mobile content container reserves the dock clearance token budget.
    expect(main).not.toBeNull();
    expect(main).toHaveClass('pb-[var(--mobile-content-clearance-with-action)]');
    expect(main).toHaveClass('md:pb-8');
  });

  it('handles signOut rejection without crashing and still attempts logout', async () => {
    // Arrange: Mock auth context for an authenticated user with rejecting signOut.
    const user = userEvent.setup();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSignOut.mockRejectedValueOnce(new Error('network down'));
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: 'user-1',
        email: 'driver@example.com',
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString(),
      },
      session: null,
      loading: false,
      signIn: vi.fn(),
      signOut: mockSignOut,
    });

    // Act: Render app and trigger logout via stable sign-out button.
    render(<App />);
    const signOutText = screen.getByText('Sign Out');
    const signOutButton = signOutText.closest('button');
    expect(signOutButton).not.toBeNull();
    await user.click(signOutButton!);

    // Assert: Logout was attempted, error is surfaced, and app remains rendered.
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('network down');
    expect(screen.getByText('Navigation')).toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });

  it('logs signOut auth error response without crashing', async () => {
    // Arrange: Mock auth context where signOut resolves with a Supabase error.
    const user = userEvent.setup();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const authError = { message: 'Token revoked' } as AuthError;
    mockSignOut.mockResolvedValueOnce({ error: authError });
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: 'user-1',
        email: 'driver@example.com',
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString(),
      },
      session: null,
      loading: false,
      signIn: vi.fn(),
      signOut: mockSignOut,
    });

    // Act: Render and trigger logout.
    render(<App />);
    const signOutText = screen.getByText('Sign Out');
    const signOutButton = signOutText.closest('button');
    expect(signOutButton).not.toBeNull();
    await user.click(signOutButton!);

    // Assert: Error path is handled, error is surfaced, and app remains mounted.
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Sign-out failed:', authError);
    expect(screen.getByRole('alert')).toHaveTextContent('Token revoked');
    expect(screen.getByText('Navigation')).toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });

  it('renders tariffs tab content for authenticated users', async () => {
    // Arrange: Mock authenticated user and keep core app shell loaded.
    const user = userEvent.setup();
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: 'user-1',
        email: 'driver@example.com',
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString(),
      },
      session: null,
      loading: false,
      signIn: vi.fn(),
      signOut: mockSignOut,
    });

    // Act: Switch from default sessions tab to tariffs tab.
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Tariffs Tab' }));

    // Assert: Tariff view resolves through the direct tariff module mock.
    expect(await screen.findByText('Tariff List')).toBeInTheDocument();
  });

  it('shows a sync issue alert when blocking sync error metadata is present', () => {
    // Arrange: Authenticated user with a blocking sync error in outbox status.
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: 'user-1',
        email: 'driver@example.com',
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString(),
      },
      session: null,
      loading: false,
      signIn: vi.fn(),
      signOut: mockSignOut,
    });
    vi.mocked(useSyncStatus).mockReturnValue({
      queueLength: 1,
      hasPendingSync: true,
      pendingByTable: { providers: 0, charging_plans: 0, sessions: 1, provider_plan_selections: 0 },
      hasBlockingSyncError: true,
      blockingErrorMessage: 'Unsupported sync table: provider_plan_selections',
      retryCount: 1,
      nextRetryAt: new Date('2026-05-30T10:15:00.000Z'),
      oldestPendingAt: new Date('2026-05-30T10:00:00.000Z'),
      isLoading: false,
    });

    // Act
    render(<App />);

    // Assert
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Sync issue');
    expect(alert).toHaveTextContent('Unsupported sync table: provider_plan_selections');
    expect(alert).toHaveTextContent('Data is saved locally and will retry automatically.');
  });

  it('does not show sync issue alert for first-failure sync state', () => {
    // Arrange: Authenticated user with first-failure sync metadata but no blocking flag.
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: 'user-1',
        email: 'driver@example.com',
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString(),
      },
      session: null,
      loading: false,
      signIn: vi.fn(),
      signOut: mockSignOut,
    });
    vi.mocked(useSyncStatus).mockReturnValue({
      queueLength: 1,
      hasPendingSync: true,
      pendingByTable: { providers: 0, charging_plans: 0, sessions: 1, provider_plan_selections: 0 },
      hasBlockingSyncError: false,
      blockingErrorMessage: undefined,
      retryCount: 1,
      nextRetryAt: new Date('2026-05-30T10:15:00.000Z'),
      oldestPendingAt: new Date('2026-05-30T10:00:00.000Z'),
      isLoading: false,
    });

    // Act
    render(<App />);

    // Assert
    expect(screen.queryByText('Sync issue')).not.toBeInTheDocument();
  });
});
