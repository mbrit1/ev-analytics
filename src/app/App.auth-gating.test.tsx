import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthError } from '@supabase/supabase-js';
import App from './App';
import { useAuth } from '../features/auth';

vi.mock('../features/auth', () => ({
  useAuth: vi.fn(),
  LoginForm: () => <div data-testid="login-form">Login Form</div>,
}));
vi.mock('../features/tariffs', () => ({
  TariffList: () => <div>Tariff List</div>,
}));
vi.mock('../features/charging-sessions', () => ({
  ChargingHistory: () => <div>Charging History</div>,
  SessionForm: () => <div>Session Form</div>,
}));
vi.mock('../shared/ui', () => ({
  Navigation: () => <nav>Navigation</nav>,
}));
vi.mock('../features/offline-sync', () => ({
  SyncStatusIndicator: () => <div>Sync Status</div>,
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
});
