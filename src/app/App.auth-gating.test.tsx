import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthError } from '@supabase/supabase-js';
import App from './App';
import { useAuth } from '../features/auth';
import { retryActiveSyncRuntime, useSyncStatus } from '../features/offline-sync';
import type {
  ProviderConflictRecoveryController,
  UseProviderConflictRecoveryOptions,
} from '../features/offline-sync';

const providerConflictRecoveryMocks = vi.hoisted(() => ({
  useProviderConflictRecovery: vi.fn(),
}));

type ProviderConflictSyncStatus = ReturnType<typeof useSyncStatus> & {
  blockingOutboxId?: number;
  blockingFailureKind?: 'provider-name-conflict';
  blockingProviderId?: string;
};

vi.mock('../features/auth', () => ({
  useAuth: vi.fn(),
  LoginForm: () => <div data-testid="login-form">Login Form</div>,
}));
vi.mock('../features/charging-plans/components/TariffList', () => ({
  TariffList: ({
    isCreatingTariff,
    tariffFormState,
    tariffLocationHydration,
  }: {
    isCreatingTariff?: boolean;
    tariffFormState?: { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; logicalTariffKey: string };
    tariffLocationHydration?: {
      providers: { status: string };
      chargingPlans: { status: string };
      onRetry: () => void;
    };
  }) => (
    <div>
      {tariffFormState?.mode === 'edit'
        ? 'Tariff Edit Form'
        : (tariffFormState?.mode === 'create' || isCreatingTariff ? 'Tariff Create Form' : 'Tariff List')}
      <span data-testid="tariff-location-hydration">
        {tariffLocationHydration
          ? `${tariffLocationHydration.providers.status}:${tariffLocationHydration.chargingPlans.status}`
          : 'missing'}
      </span>
    </div>
  ),
}));
vi.mock('../features/charging-sessions', () => ({
  ChargingHistory: ({
    hydrationState,
    onRetryHydration,
  }: {
    hydrationState: { status: string };
    onRetryHydration: () => void;
  }) => (
    <div>
      Charging History: {hydrationState.status}
      <button type="button" onClick={onRetryHydration}>Retry Session Hydration</button>
    </div>
  ),
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
  ProviderConflictRecoveryDialog: ({
    state,
    onAcknowledge,
  }: {
    state: { kind: string };
    onAcknowledge: () => void;
  }) => (
    <div data-testid="provider-conflict-recovery-dialog">
      Recovery state: {state.kind}
      {state.kind === 'success' && (
        <button type="button" onClick={onAcknowledge}>Done</button>
      )}
    </div>
  ),
  useProviderConflictRecovery: providerConflictRecoveryMocks.useProviderConflictRecovery,
  useSyncStatus: vi.fn(() => ({
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
  })),
  startSyncRuntime: vi.fn(() => vi.fn()),
  retryActiveSyncRuntime: vi.fn(),
}));

/**
 * Test suite for App authentication gating and logout wiring.
 *
 * Verifies unauthenticated users see the login form, authenticated users see
 * the app shell, and the sign-out UI invokes the auth hook action.
 */
describe('App auth gating', () => {
  const mockSignOut = vi.fn();
  const recoveryOpen = vi.fn();
  const recoveryCancel = vi.fn();
  const recoveryConfirm = vi.fn(async () => undefined);
  const recoveryAcknowledge = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({ unrelated: 'keep-me' }, '', '/');
    mockSignOut.mockResolvedValue({ error: null });
    vi.mocked(retryActiveSyncRuntime).mockImplementation(() => undefined);
    const recoveryController: ProviderConflictRecoveryController = {
      state: { kind: 'closed' },
      isOpen: false,
      isPending: false,
      open: recoveryOpen,
      cancel: recoveryCancel,
      confirm: recoveryConfirm,
      acknowledge: recoveryAcknowledge,
    };
    providerConflictRecoveryMocks.useProviderConflictRecovery.mockReturnValue(recoveryController);
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

  it('wires failed session hydration and retry into charging history', async () => {
    // Arrange: Authenticate with an isolated session hydration failure.
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
        sessions: { status: 'failed', failureKind: 'invalid_data' },
      },
      hasHydrationFailure: true,
      isHydrating: false,
      displayState: 'sync-issue',
      isLoading: false,
    });

    // Act: Render the sessions tab and use its retry action.
    render(<App />);
    expect(screen.getByText('Charging History: failed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry Session Hydration' }));

    // Assert: App delegates retry to the active authenticated sync runtime.
    expect(retryActiveSyncRuntime).toHaveBeenCalledTimes(1);
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

  it('preserves a recognized tariffs edit location while auth is loading and resolves it after authentication completes', async () => {
    // Arrange: Begin initial auth hydration on a loadable direct tariff location.
    window.history.replaceState({ unrelated: 'keep-me' }, '', '#tariffs/edit/provider-1%3A%3Alidl');
    const authenticatedUser = {
      id: 'user-1', email: 'driver@example.com', app_metadata: {}, user_metadata: {},
      aud: 'authenticated', created_at: new Date().toISOString(),
    } as never;
    vi.mocked(useAuth).mockReturnValue({
      user: null, session: null, loading: true, signIn: vi.fn(), signOut: mockSignOut,
    });
    const view = render(<App />);

    // Act: Complete authentication without replacing the browser location.
    vi.mocked(useAuth).mockReturnValue({
      user: authenticatedUser, session: null, loading: false, signIn: vi.fn(), signOut: mockSignOut,
    });
    view.rerender(<App />);

    // Assert: Loading did not discard the requested edit destination.
    expect(window.location.hash).toBe('#tariffs/edit/provider-1%3A%3Alidl');
    expect(await screen.findByText('Tariff Edit Form')).toBeInTheDocument();
  });

  it('clears a signed-out tariff editor location and transient state instead of preserving it for the next principal', async () => {
    // Arrange: Render the authenticated app from an in-app editor entry with list restoration state.
    window.history.replaceState({
      unrelated: 'keep-me',
      evAnalytics: {
        tab: 'tariffs',
        entryId: 'edit-user-1',
        tariffListPredecessorId: 'list-user-1',
        tariffListScrollY: 640,
      },
    }, '', '#tariffs/edit/provider-1%3A%3Alidl');
    const authenticatedUser = {
      id: 'user-1', email: 'driver@example.com', app_metadata: {}, user_metadata: {},
      aud: 'authenticated', created_at: new Date().toISOString(),
    } as never;
    vi.mocked(useAuth).mockReturnValue({
      user: authenticatedUser, session: null, loading: false, signIn: vi.fn(), signOut: mockSignOut,
    });
    const view = render(<App />);
    expect(await screen.findByText('Tariff Edit Form')).toBeInTheDocument();

    // Act: Simulate the auth transition produced by a completed sign-out.
    vi.mocked(useAuth).mockReturnValue({
      user: null, session: null, loading: false, signIn: vi.fn(), signOut: mockSignOut,
    });
    await act(async () => {
      view.rerender(<App />);
    });

    // Assert: The next principal cannot inherit the former editor or restoration entry.
    expect(screen.getByTestId('login-form')).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(window.history.state).toMatchObject({ unrelated: 'keep-me' });
    const marker = window.history.state.evAnalytics;
    expect(marker == null || (
      marker.tariffListPredecessorId == null
      && marker.tariffListScrollY == null
    )).toBe(true);
  });

  it('clears tariff edit transient state before resolving the same recognized location for a different principal', async () => {
    // Arrange: Start user one from an actual in-app editor marker with a list predecessor and scroll snapshot.
    window.history.replaceState({
      unrelated: 'keep-me',
      evAnalytics: {
        tab: 'tariffs',
        entryId: 'edit-user-1',
        tariffListPredecessorId: 'list-user-1',
        tariffListScrollY: 640,
      },
    }, '', '#tariffs/edit/provider-1%3A%3Alidl');
    const firstUser = {
      id: 'user-1', email: 'first@example.com', app_metadata: {}, user_metadata: {},
      aud: 'authenticated', created_at: new Date().toISOString(),
    } as never;
    const secondUser = {
      id: 'user-2', email: 'second@example.com', app_metadata: {}, user_metadata: {},
      aud: 'authenticated', created_at: new Date().toISOString(),
    } as never;
    vi.mocked(useAuth).mockReturnValue({
      user: firstUser, session: null, loading: false, signIn: vi.fn(), signOut: mockSignOut,
    });
    const view = render(<App />);
    expect(await screen.findByText('Tariff Edit Form')).toBeInTheDocument();

    // Act: Replace the authenticated principal while retaining the browser location.
    vi.mocked(useAuth).mockReturnValue({
      user: secondUser, session: null, loading: false, signIn: vi.fn(), signOut: mockSignOut,
    });
    await act(async () => {
      view.rerender(<App />);
    });

    // Assert: User two gets a direct editor marker, never user one's list predecessor or scroll snapshot.
    expect(await screen.findByText('Tariff Edit Form')).toBeInTheDocument();
    expect(window.history.state).toMatchObject({
      unrelated: 'keep-me',
      evAnalytics: {
        tab: 'tariffs',
        tariffListPredecessorId: null,
        tariffListScrollY: 0,
      },
    });
  });

  it('keeps a locally available direct target editable while tariff hydration remains pending', async () => {
    // Arrange: Load an edit target before remote providers and plans have hydrated.
    window.history.replaceState({}, '', '#tariffs/edit/provider-1%3A%3Alidl');
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-1' } as never, session: null, loading: false, signIn: vi.fn(), signOut: mockSignOut,
    });
    vi.mocked(useSyncStatus).mockReturnValue({
      queueLength: 0, hasPendingSync: false,
      pendingByTable: { providers: 0, charging_plans: 0, sessions: 0, provider_plan_selections: 0 },
      hasBlockingSyncError: false, blockingErrorMessage: undefined, retryCount: undefined, nextRetryAt: undefined,
      oldestPendingAt: undefined,
      hydration: { providers: { status: 'loading' }, charging_plans: { status: 'loading' }, sessions: { status: 'ready' } },
      hasHydrationFailure: false, isHydrating: true, displayState: 'syncing', isLoading: false,
    });

    // Act: Render with the local target available through the Tariffs feature seam.
    render(<App />);

    // Assert: Pending remote hydration does not block a local positive edit resolution.
    expect(await screen.findByText('Tariff Edit Form')).toBeInTheDocument();
  });

  it('waits for both tariff hydration gates before showing a missing target and exposes failure as retryable instead', async () => {
    // Arrange: Load an absent direct target with a failed provider hydration gate.
    window.history.replaceState({}, '', '#tariffs/edit/missing');
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-1' } as never, session: null, loading: false, signIn: vi.fn(), signOut: mockSignOut,
    });
    vi.mocked(useSyncStatus).mockReturnValue({
      queueLength: 0, hasPendingSync: false,
      pendingByTable: { providers: 0, charging_plans: 0, sessions: 0, provider_plan_selections: 0 },
      hasBlockingSyncError: false, blockingErrorMessage: undefined, retryCount: undefined, nextRetryAt: undefined,
      oldestPendingAt: undefined,
      hydration: { providers: { status: 'failed', failureKind: 'network' }, charging_plans: { status: 'ready' }, sessions: { status: 'ready' } },
      hasHydrationFailure: true, isHydrating: false, displayState: 'sync-issue', isLoading: false,
    });

    // Act: Render the failed-hydration direct location.
    render(<App />);

    // Assert: Failure preserves the requested target rather than falsely claiming it is missing.
    expect(await screen.findByText('Tariff Edit Form')).toBeInTheDocument();
    expect(screen.queryByText('Tariff is no longer available')).not.toBeInTheDocument();
  });

  it('passes the provider and charging-plan hydration gates to the Tariffs location seam', async () => {
    // Arrange: Keep providers pending while charging plans have settled.
    const user = userEvent.setup();
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-1' } as never, session: null, loading: false, signIn: vi.fn(), signOut: mockSignOut,
    });
    vi.mocked(useSyncStatus).mockReturnValue({
      queueLength: 0, hasPendingSync: false,
      pendingByTable: { providers: 0, charging_plans: 0, sessions: 0, provider_plan_selections: 0 },
      hasBlockingSyncError: false, blockingErrorMessage: undefined, retryCount: undefined, nextRetryAt: undefined,
      oldestPendingAt: undefined,
      hydration: { providers: { status: 'loading' }, charging_plans: { status: 'ready' }, sessions: { status: 'ready' } },
      hasHydrationFailure: false, isHydrating: true, displayState: 'syncing', isLoading: false,
    });
    render(<App />);

    // Act: Enter the Tariffs location surface.
    await user.click(screen.getByRole('button', { name: 'Tariffs Tab' }));

    // Assert: The app supplies both independent gates rather than forcing TariffList to infer remote readiness.
    expect(await screen.findByTestId('tariff-location-hydration')).toHaveTextContent('loading:ready');
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
      blockingErrorKind: 'retryable',
      blockingErrorMessage: 'Unsupported sync table: provider_plan_selections',
      retryCount: 1,
      nextRetryAt: new Date('2026-05-30T10:15:00.000Z'),
      oldestPendingAt: new Date('2026-05-30T10:00:00.000Z'),
      hydration: {
        providers: { status: 'ready' },
        charging_plans: { status: 'ready' },
        sessions: { status: 'ready' },
      },
      hasHydrationFailure: false,
      isHydrating: false,
      displayState: 'sync-issue',
      isLoading: false,
    });

    // Act
    render(<App />);

    // Assert
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Sync issue');
    expect(alert).toHaveTextContent('Unsupported sync table: provider_plan_selections');
    expect(alert).toHaveTextContent('Data is saved locally and will retry automatically.');
    expect(alert).not.toHaveTextContent('Sync paused');
    expect(screen.queryByRole('button', { name: 'Resolve provider conflict' })).not.toBeInTheDocument();
  });

  it('shows a typed terminal provider conflict with a global resolve action', async () => {
    // Arrange: Authenticate a user with complete typed provider-conflict recovery metadata.
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
    const syncStatus: ProviderConflictSyncStatus = {
      queueLength: 2,
      hasPendingSync: true,
      pendingByTable: { providers: 1, charging_plans: 1, sessions: 0, provider_plan_selections: 0 },
      hasBlockingSyncError: true,
      blockingErrorKind: 'terminal',
      blockingErrorMessage: 'Provider name already exists remotely (active, case-insensitive)',
      blockingOutboxId: 42,
      blockingFailureKind: 'provider-name-conflict',
      blockingProviderId: 'provider-staged-conflict',
      retryCount: 1,
      nextRetryAt: undefined,
      oldestPendingAt: new Date('2026-05-30T10:00:00.000Z'),
      hydration: {
        providers: { status: 'ready' },
        charging_plans: { status: 'ready' },
        sessions: { status: 'ready' },
      },
      hasHydrationFailure: false,
      isHydrating: false,
      displayState: 'sync-issue',
      isLoading: false,
    };
    vi.mocked(useSyncStatus).mockReturnValue(syncStatus);

    // Act: Render the app and request recovery from the global blocking alert.
    render(<App />);

    // Assert: Terminal copy remains visible and the global alert offers typed conflict resolution.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Sync paused');
    expect(alert).toHaveTextContent(
      'Provider name already exists remotely (active, case-insensitive)'
    );
    expect(alert).toHaveTextContent(
      'Data is saved locally. Resolve this conflict before sync can continue.'
    );
    expect(alert).not.toHaveTextContent('will retry automatically');
    expect(alert).not.toHaveTextContent('Next retry after');
    const resolveAction = screen.getByRole('button', { name: 'Resolve provider conflict' });
    await user.click(resolveAction);
    expect(providerConflictRecoveryMocks.useProviderConflictRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
    );
    expect(recoveryOpen).toHaveBeenCalledWith({
      terminalOutboxId: 42,
      stagedProviderId: 'provider-staged-conflict',
    });
  });

  it('requests normal sync after recovery commit and before success acknowledgement', async () => {
    // Arrange: The controller has committed recovery and holds the success view open.
    const user = userEvent.setup();
    const order: string[] = [];
    vi.mocked(retryActiveSyncRuntime).mockImplementation(() => {
      order.push('normal-sync');
    });
    recoveryAcknowledge.mockImplementation(() => {
      order.push('acknowledge');
    });
    providerConflictRecoveryMocks.useProviderConflictRecovery.mockReturnValue({
      state: { kind: 'success' },
      isOpen: true,
      isPending: false,
      open: recoveryOpen,
      cancel: recoveryCancel,
      confirm: recoveryConfirm,
      acknowledge: recoveryAcknowledge,
    } satisfies ProviderConflictRecoveryController);
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

    // Act: Deliver the controller's post-commit/exclusion-release boundary.
    render(<App />);
    expect(providerConflictRecoveryMocks.useProviderConflictRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        onRecoveryCommitted: expect.any(Function),
      }),
    );
    const options = providerConflictRecoveryMocks.useProviderConflictRecovery.mock
      .calls.at(-1)?.[0] as UseProviderConflictRecoveryOptions;
    act(() => options.onRecoveryCommitted());

    // Assert: Ordinary sync starts immediately while acknowledgement is still pending.
    expect(order).toEqual(['normal-sync']);
    expect(retryActiveSyncRuntime).toHaveBeenCalledTimes(1);
    expect(recoveryAcknowledge).not.toHaveBeenCalled();
    expect(screen.getByTestId('provider-conflict-recovery-dialog')).toHaveTextContent(
      'Recovery state: success',
    );

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(order).toEqual(['normal-sync', 'acknowledge']);
    expect(retryActiveSyncRuntime).toHaveBeenCalledTimes(1);
  });

  it('keeps generic terminal errors outside provider-conflict recovery', () => {
    // Arrange: Authenticated user has a terminal error without the typed recovery discriminator.
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
      pendingByTable: { providers: 1, charging_plans: 0, sessions: 0, provider_plan_selections: 0 },
      hasBlockingSyncError: true,
      blockingErrorKind: 'terminal',
      blockingErrorMessage: 'A generic provider upload failed.',
      blockingOutboxId: 42,
      retryCount: 2,
      nextRetryAt: undefined,
      oldestPendingAt: new Date('2026-05-30T10:00:00.000Z'),
      hydration: {
        providers: { status: 'ready' },
        charging_plans: { status: 'ready' },
        sessions: { status: 'ready' },
      },
      hasHydrationFailure: false,
      isHydrating: false,
      displayState: 'sync-issue',
      isLoading: false,
    });

    // Act: Render the generic terminal alert.
    render(<App />);

    // Assert: Controller composition exists, but generic metadata cannot open it.
    expect(providerConflictRecoveryMocks.useProviderConflictRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('A generic provider upload failed.');
    expect(screen.queryByRole('button', { name: 'Resolve provider conflict' })).not.toBeInTheDocument();
    expect(recoveryOpen).not.toHaveBeenCalled();
  });

  it('does not show the provider-conflict action when typed recovery metadata is incomplete', () => {
    // Arrange: Authenticate a user with a typed terminal conflict but no stable outbox identity.
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
    const syncStatus: ProviderConflictSyncStatus = {
      queueLength: 1,
      hasPendingSync: true,
      pendingByTable: { providers: 1, charging_plans: 0, sessions: 0, provider_plan_selections: 0 },
      hasBlockingSyncError: true,
      blockingErrorKind: 'terminal',
      blockingErrorMessage: 'Provider name already exists remotely (active, case-insensitive)',
      blockingFailureKind: 'provider-name-conflict',
      blockingProviderId: 'provider-staged-conflict',
      retryCount: 1,
      nextRetryAt: undefined,
      oldestPendingAt: new Date('2026-05-30T10:00:00.000Z'),
      hydration: {
        providers: { status: 'ready' },
        charging_plans: { status: 'ready' },
        sessions: { status: 'ready' },
      },
      hasHydrationFailure: false,
      isHydrating: false,
      displayState: 'sync-issue',
      isLoading: false,
    };
    vi.mocked(useSyncStatus).mockReturnValue(syncStatus);

    // Act: Render the app while the typed conflict lacks a stable outbox ID.
    render(<App />);

    // Assert: Generic terminal copy remains, but recovery cannot start without both identities.
    expect(screen.getByRole('alert')).toHaveTextContent('Sync paused');
    expect(screen.queryByRole('button', { name: 'Resolve provider conflict' })).not.toBeInTheDocument();
  });

  it('does not show the provider-conflict action when typed recovery lacks a staged provider ID', () => {
    // Arrange: Authenticate a user with a typed terminal conflict but no staged provider identity.
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
    const syncStatus: ProviderConflictSyncStatus = {
      queueLength: 1,
      hasPendingSync: true,
      pendingByTable: { providers: 1, charging_plans: 0, sessions: 0, provider_plan_selections: 0 },
      hasBlockingSyncError: true,
      blockingErrorKind: 'terminal',
      blockingErrorMessage: 'Provider name already exists remotely (active, case-insensitive)',
      blockingOutboxId: 42,
      blockingFailureKind: 'provider-name-conflict',
      retryCount: 1,
      nextRetryAt: undefined,
      oldestPendingAt: new Date('2026-05-30T10:00:00.000Z'),
      hydration: {
        providers: { status: 'ready' },
        charging_plans: { status: 'ready' },
        sessions: { status: 'ready' },
      },
      hasHydrationFailure: false,
      isHydrating: false,
      displayState: 'sync-issue',
      isLoading: false,
    };
    vi.mocked(useSyncStatus).mockReturnValue(syncStatus);

    // Act: Render the app while the typed conflict lacks a staged provider ID.
    render(<App />);

    // Assert: Generic terminal copy remains, but recovery cannot start without both identities.
    expect(screen.getByRole('alert')).toHaveTextContent('Sync paused');
    expect(screen.queryByRole('button', { name: 'Resolve provider conflict' })).not.toBeInTheDocument();
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
      hydration: {
        providers: { status: 'ready' },
        charging_plans: { status: 'ready' },
        sessions: { status: 'ready' },
      },
      hasHydrationFailure: false,
      isHydrating: false,
      displayState: 'pending',
      isLoading: false,
    });

    // Act
    render(<App />);

    // Assert
    expect(screen.queryByText('Sync issue')).not.toBeInTheDocument();
  });
});
