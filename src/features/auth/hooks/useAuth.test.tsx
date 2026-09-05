import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthError } from '@supabase/supabase-js';
import { supabase } from '../../../infra/supabase';
import { AuthProvider, useAuth } from './useAuth';

const mockIsMockMode = vi.hoisted(() => vi.fn());
const mockSignInWithPassword = vi.hoisted(() => vi.fn());
const mockSignOut = vi.hoisted(() => vi.fn());
const mockGetSession = vi.hoisted(() => vi.fn());
const mockGetUser = vi.hoisted(() => vi.fn());
const mockOnAuthStateChange = vi.hoisted(() => vi.fn());
const mockSetSession = vi.hoisted(() => vi.fn());
const mockUnsubscribe = vi.hoisted(() => vi.fn());
const mockClearLocalUserData = vi.hoisted(() => vi.fn());
const mockDisposeActiveSyncRuntime = vi.hoisted(() => vi.fn());

vi.mock('../../../infra/mocks', () => ({
  isMockMode: mockIsMockMode,
}));

vi.mock('../../../infra/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: mockSignInWithPassword,
      signOut: mockSignOut,
      getSession: mockGetSession,
      getUser: mockGetUser,
      onAuthStateChange: mockOnAuthStateChange,
      setSession: mockSetSession,
    },
  },
}));

vi.mock('../../../infra/db', () => ({
  clearLocalUserData: mockClearLocalUserData,
}));

vi.mock('../../offline-sync', () => ({
  disposeActiveSyncRuntime: mockDisposeActiveSyncRuntime,
}));

/**
 * Test suite for the auth hook contract exposed by AuthProvider.
 *
 * Verifies signIn/signOut are available from useAuth and execute the expected
 * Supabase or mock-mode behaviors without requiring real credentials.
 */
describe('useAuth', () => {
  const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockOnAuthStateChange.mockReturnValue({
      data: {
        subscription: {
          unsubscribe: mockUnsubscribe,
        },
      },
    });
    mockSignInWithPassword.mockResolvedValue({ error: null });
    mockSignOut.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockSetSession.mockImplementation(async () => {
      mockGetUser.mockResolvedValue({
        data: {
          user: {
            id: 'mock-user-id',
            email: 'tester@local.dev',
          },
        },
        error: null,
      });
      return { data: { session: null, user: null }, error: null };
    });
    mockDisposeActiveSyncRuntime.mockResolvedValue(undefined);
    mockClearLocalUserData.mockResolvedValue(undefined);
  });

  it('exposes signIn and signOut functions from context', async () => {
    // Arrange: Use live mode provider wiring with Supabase stubs.
    mockIsMockMode.mockReturnValue(false);

    // Act: Render the hook in provider context.
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Assert: Both auth actions are available as callable functions.
    expect(result.current.signIn).toEqual(expect.any(Function));
    expect(result.current.signOut).toEqual(expect.any(Function));
  });

  it('calls Supabase signInWithPassword in normal mode', async () => {
    // Arrange: Enable normal mode and prepare credentials.
    mockIsMockMode.mockReturnValue(false);
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Act: Trigger sign-in through context.
    const response = await result.current.signIn('user@example.com', 'secret');

    // Assert: Supabase is called with email/password and no error is returned.
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'secret',
    });
    expect(response.error).toBeNull();
  });

  it('propagates Supabase signIn errors in normal mode', async () => {
    // Arrange: Enable normal mode and make Supabase sign-in fail.
    mockIsMockMode.mockReturnValue(false);
    const authError = { message: 'Invalid login credentials' } as AuthError;
    mockSignInWithPassword.mockResolvedValue({ error: authError });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Act: Trigger sign-in through context.
    const response = await result.current.signIn('user@example.com', 'wrong-password');

    // Assert: The Supabase auth error is returned unchanged.
    expect(response.error).toBe(authError);
  });

  it('calls Supabase signOut in normal mode', async () => {
    // Arrange: Enable normal mode.
    mockIsMockMode.mockReturnValue(false);
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Act: Trigger sign-out through context.
    const response = await result.current.signOut();

    // Assert: Supabase signOut is invoked and succeeds.
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockDisposeActiveSyncRuntime).toHaveBeenCalledTimes(1);
    expect(mockClearLocalUserData).toHaveBeenCalledTimes(1);
    expect(response.error).toBeNull();
  });

  it('does not clear local data when Supabase signOut fails', async () => {
    // Arrange: Enable normal mode and fail remote sign-out.
    mockIsMockMode.mockReturnValue(false);
    const authError = { message: 'Remote sign-out failed' } as AuthError;
    mockSignOut.mockResolvedValue({ error: authError });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Act
    const response = await result.current.signOut();

    // Assert
    expect(response.error).toBe(authError);
    expect(mockDisposeActiveSyncRuntime).not.toHaveBeenCalled();
    expect(mockClearLocalUserData).not.toHaveBeenCalled();
  });

  it('waits for the disposed sync runtime before clearing local user data', async () => {
    // Arrange: Keep runtime disposal pending after successful remote sign-out.
    mockIsMockMode.mockReturnValue(false);
    let resolveDisposal: (() => void) | undefined;
    mockDisposeActiveSyncRuntime.mockImplementation(() => new Promise<void>((resolve) => {
      resolveDisposal = resolve;
    }));
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Act: Start sign-out, then release the runtime completion barrier.
    const signOutPromise = result.current.signOut();
    await waitFor(() => {
      expect(mockDisposeActiveSyncRuntime).toHaveBeenCalledTimes(1);
    });
    expect(mockClearLocalUserData).not.toHaveBeenCalled();
    resolveDisposal?.();
    await signOutPromise;

    // Assert: Dexie cleanup starts only after the old runtime is quiescent.
    expect(mockClearLocalUserData).toHaveBeenCalledTimes(1);
    expect(mockDisposeActiveSyncRuntime.mock.invocationCallOrder[0])
      .toBeLessThan(mockClearLocalUserData.mock.invocationCallOrder[0]);
  });

  it('returns successful no-op auth actions in mock mode', async () => {
    // Arrange: Enable mock mode where no remote auth request should occur.
    mockIsMockMode.mockReturnValue(true);

    // Act: Render hook and call both actions.
    const { result } = renderHook(() => useAuth(), { wrapper });
    const signInResponse = await result.current.signIn('tester@local.dev', 'ignored');
    const signOutResponse = await result.current.signOut();

    // Assert: Mock mode resolves cleanly without Supabase calls.
    expect(signInResponse.error).toBeNull();
    expect(signOutResponse.error).toBeNull();
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockDisposeActiveSyncRuntime).toHaveBeenCalledTimes(1);
    expect(mockClearLocalUserData).toHaveBeenCalledTimes(1);
  });

  it('seeds the Supabase client identity in mock mode for security rechecks', async () => {
    // Arrange: The mock auth client has no verified user before its session is seeded.
    mockIsMockMode.mockReturnValue(true);

    // Act: Mount the provider, then perform the same verified-user recheck as recovery.
    renderHook(() => useAuth(), { wrapper });
    await waitFor(() => {
      expect(mockSetSession).toHaveBeenCalledWith({
        access_token: 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJtb2NrLXVzZXItaWQiLCJlbWFpbCI6InRlc3RlckBsb2NhbC5kZXYiLCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImF1ZCI6ImF1dGhlbnRpY2F0ZWQiLCJleHAiOjQxMDI0NDQ4MDB9.mock-signature',
        refresh_token: 'mock-refresh-token',
      });
    });
    const { data, error } = await supabase.auth.getUser();

    // Assert: Client-level auth agrees with the local mock user identity.
    expect(error).toBeNull();
    expect(data.user).toMatchObject({
      id: 'mock-user-id',
      email: 'tester@local.dev',
    });
  });

  it('unsubscribes auth state listener on unmount', async () => {
    // Arrange: Enable live mode and render provider-backed hook.
    mockIsMockMode.mockReturnValue(false);
    const { result, unmount } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Act: Unmount to trigger effect cleanup.
    unmount();

    // Assert: Supabase auth subscription cleanup is executed.
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
