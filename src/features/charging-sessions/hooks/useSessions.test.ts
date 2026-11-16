import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSessions } from './useSessions';
import { getSessions } from '../services/sessionService';
import { db, type ChargingSession, type SyncPayload } from '../../../infra/db';

let currentUser: { id: string } | null = { id: 'user-1' };

// Mock the service so the hook test can focus on live-query state transitions.
vi.mock('../services/sessionService');
vi.mock('../../auth', () => ({
  useAuth: () => ({ user: currentUser }),
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/**
 * Test suite for the charging-session live query hook.
 *
 * Verifies loading-state normalization and session exposure from the service
 * layer without depending on real IndexedDB contents.
 */
describe('useSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = { id: 'user-1' };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.sync_outbox.clear();
  });

  it('fetches sessions and handles loading state', async () => {
    // Arrange: Mock one resolved session from the service layer.
    vi.mocked(getSessions).mockResolvedValue([
      { id: 's1', session_timestamp: new Date() }
    ] as unknown as ChargingSession[]);

    // Act: Render the hook and let the live query resolve.
    const { result } = renderHook(() => useSessions());

    // Assert: The hook reports loading before the async query resolves.
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Assert: Resolved sessions are exposed as a normalized array.
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0].id).toBe('s1');
    expect(result.current.error).toBeNull();
    expect(getSessions).toHaveBeenCalledWith('user-1');
  });

  it('surfaces session query failures without presenting successful empty data', async () => {
    // Arrange: Reject the user-scoped local session read.
    const error = new Error('IndexedDB session read failed');
    vi.mocked(getSessions).mockRejectedValue(error);

    // Act: Render the live session hook.
    const { result } = renderHook(() => useSessions());

    // Assert: The failure settles as an explicit technical error.
    await waitFor(() => expect(result.current.error).toBe(error));
    expect(result.current.sessions).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it.each([null, undefined])('normalizes nullish session failures into visible errors (%s)', async (rejection) => {
    // Arrange: Reject the session query with a nullish value.
    vi.mocked(getSessions).mockRejectedValue(rejection);

    // Act: Render the hook and allow the query to settle.
    const { result } = renderHook(() => useSessions());

    // Assert: The failure remains distinguishable from a successful empty read.
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.sessions).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('fences prior account rows during account changes and logout', async () => {
    // Arrange: Keep account A's live read settled while account B remains deferred.
    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'UPDATE',
      payload: { id: 'a-pending', user_id: 'account-a' } as SyncPayload,
      timestamp: new Date(),
    });
    const accountARead = createDeferred<ChargingSession[]>();
    const accountBRead = createDeferred<ChargingSession[]>();
    vi.mocked(getSessions).mockImplementation((userId) => userId === 'account-a' ? accountARead.promise : accountBRead.promise);
    currentUser = { id: 'account-a' };
    const { result, rerender } = renderHook(() => useSessions());
    accountARead.resolve([{ id: 'a-session' } as unknown as ChargingSession]);
    await waitFor(() => expect(result.current.sessions.map(({ id }) => id)).toEqual(['a-session']));
    await waitFor(() => expect(result.current.pendingSyncIds).toEqual(new Set(['a-pending'])));

    // Act: Switch accounts while B's query is unresolved.
    currentUser = { id: 'account-b' };
    rerender();

    // Assert: A's rows are hidden immediately and B remains loading until its read settles.
    expect(result.current.sessions).toEqual([]);
    expect(result.current.pendingSyncIds).toEqual(new Set());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(getSessions).toHaveBeenCalledWith('account-b'));
    accountBRead.resolve([{ id: 'b-session' } as unknown as ChargingSession]);
    await waitFor(() => expect(result.current.sessions.map(({ id }) => id)).toEqual(['b-session']));
    expect(result.current.isLoading).toBe(false);

    // Act: Log out after B's result has settled.
    currentUser = null;
    rerender();

    // Assert: The prior account's rows are fenced while the null-user query settles.
    expect(result.current.sessions).toEqual([]);
    expect(result.current.pendingSyncIds).toEqual(new Set());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sessions).toEqual([]);
  });

  it('keeps session loading active while the pending-sync read has failed', async () => {
    // Arrange: Fail the outbox decoration read while leaving the session read unresolved.
    const error = new Error('Outbox read failed');
    const sessionsRead = createDeferred<ChargingSession[]>();
    vi.mocked(getSessions).mockReturnValue(sessionsRead.promise);
    vi.spyOn(db.sync_outbox, 'where').mockImplementation(() => { throw error; });

    // Act: Render both live reads.
    const { result } = renderHook(() => useSessions());

    // Assert: The known outbox error does not hide unresolved session loading.
    await waitFor(() => expect(result.current.pendingSyncError).toBe(error));
    expect(result.current.isLoading).toBe(true);
    sessionsRead.resolve([]);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.pendingSyncError).toBe(error);
  });

  it.each([null, undefined])('normalizes nullish pending-sync failures into visible errors (%s)', async (rejection) => {
    // Arrange: Keep the session query successful while the outbox query rejects nullishly.
    vi.mocked(getSessions).mockResolvedValue([]);
    vi.spyOn(db.sync_outbox, 'where').mockImplementation(() => { throw rejection; });

    // Act: Render both live reads.
    const { result } = renderHook(() => useSessions());

    // Assert: The outbox failure remains visible rather than collapsing to no error.
    await waitFor(() => expect(result.current.pendingSyncError).toBeInstanceOf(Error));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.pendingSyncIds).toEqual(new Set());
  });

  it('does not expose a late successful result from a previous account after the new account settles', async () => {
    // Arrange: Leave account A unresolved and prepare account B to succeed immediately.
    const accountARead = createDeferred<ChargingSession[]>();
    vi.mocked(getSessions).mockImplementation((userId) => userId === 'account-a'
      ? accountARead.promise
      : Promise.resolve([{ id: 'b-session' } as unknown as ChargingSession]));
    currentUser = { id: 'account-a' };
    const { result, rerender } = renderHook(() => useSessions());
    await waitFor(() => expect(getSessions).toHaveBeenCalledWith('account-a'));

    // Act: Switch to B and wait for its successful result before A completes.
    currentUser = { id: 'account-b' };
    rerender();
    await waitFor(() => expect(result.current.sessions.map(({ id }) => id)).toEqual(['b-session']));

    // Assert: A's late successful completion cannot replace B's data or error state.
    await act(async () => {
      accountARead.resolve([{ id: 'a-late-session' } as unknown as ChargingSession]);
    });
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.sessions.map(({ id }) => id)).toEqual(['b-session']);
  });
});
