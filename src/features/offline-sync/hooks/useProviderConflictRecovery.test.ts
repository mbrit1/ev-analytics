import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ProviderConflictRecoveryDescriptor,
  ProviderConflictRecoveryPreparation,
} from '../model/providerConflictRecovery';
import {
  confirmProviderConflictRecovery,
  prepareProviderConflictRecovery,
} from '../services/providerConflictRecoveryService';
import { useProviderConflictRecovery } from './useProviderConflictRecovery';

vi.mock('../services/providerConflictRecoveryService', () => ({
  prepareProviderConflictRecovery: vi.fn(),
  confirmProviderConflictRecovery: vi.fn(),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const descriptor: ProviderConflictRecoveryDescriptor = {
  userId: 'user-1',
  terminalOutboxId: 42,
  stagedProviderId: 'provider-staged',
  canonicalProviderId: 'provider-canonical',
  affectedRowIds: {
    chargingPlanIds: ['plan-1'],
    selectionIds: ['selection-1'],
    sessionIds: ['session-1'],
  },
  affectedOutboxIds: [43, 44, 45],
  reviewVersion: 'opaque-review-version',
};

const readyPreparation: ProviderConflictRecoveryPreparation = {
  status: 'ready',
  descriptor,
  summary: {
    stagedProviderName: 'Staged provider',
    canonicalProviderName: 'Canonical provider',
    chargingPlanCount: 1,
    selectionCount: 1,
    sessionCount: 1,
    outboxCount: 3,
  },
};

const openInput = {
  terminalOutboxId: 42,
  stagedProviderId: 'provider-staged',
};

/**
 * RED contract for the feature-owned provider-conflict recovery controller.
 *
 * The hook must own preparation, confirmation, retries, cancellation, auth
 * invalidation, and post-exclusion sync signalling without leaking graph or
 * review-version decisions into the app shell.
 */
describe('useProviderConflictRecovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens by preparing the authenticated terminal identity and publishes the ready summary', async () => {
    // Arrange: Hold preparation so loading and pending state can be observed.
    const preparation = createDeferred<ProviderConflictRecoveryPreparation>();
    vi.mocked(prepareProviderConflictRecovery).mockReturnValue(preparation.promise);
    const { result } = renderHook(() => useProviderConflictRecovery({
      userId: 'user-1',
      onRecoveryCommitted: vi.fn(),
    }));

    // Act: Open the typed provider-conflict recovery workflow.
    act(() => result.current.open(openInput));

    // Assert: Preparation receives only authenticated stable identities.
    expect(prepareProviderConflictRecovery).toHaveBeenCalledWith({
      userId: 'user-1',
      terminalOutboxId: 42,
    });
    expect(result.current.state).toEqual({ kind: 'loading' });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.isPending).toBe(true);

    await act(async () => preparation.resolve(readyPreparation));
    expect(result.current.state).toEqual({
      kind: 'ready',
      stagedProviderName: 'Staged provider',
      canonicalProviderName: 'Canonical provider',
      summary: readyPreparation.summary,
    });
    expect(result.current.isPending).toBe(false);
  });

  it('cancels a pending review without confirming and ignores its late result', async () => {
    // Arrange: Start a preparation that remains unresolved during cancellation.
    const preparation = createDeferred<ProviderConflictRecoveryPreparation>();
    vi.mocked(prepareProviderConflictRecovery).mockReturnValue(preparation.promise);
    const { result } = renderHook(() => useProviderConflictRecovery({
      userId: 'user-1',
      onRecoveryCommitted: vi.fn(),
    }));
    act(() => result.current.open(openInput));
    expect(prepareProviderConflictRecovery).toHaveBeenCalledTimes(1);

    // Act: Cancel before the read-only preparation completes.
    act(() => result.current.cancel());
    await act(async () => preparation.resolve(readyPreparation));

    // Assert: Cancellation closes the workflow and never enters confirmation.
    expect(result.current.state).toEqual({ kind: 'closed' });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.isPending).toBe(false);
    expect(confirmProviderConflictRecovery).not.toHaveBeenCalled();
  });

  it('preserves a typed blocked preparation reason as non-confirmable user-safe state', async () => {
    // Arrange: Preparation rejects an ambiguous tariff without exposing raw diagnostics.
    vi.mocked(prepareProviderConflictRecovery).mockResolvedValue({
      status: 'blocked',
      reason: 'tariff-ambiguity',
    });
    const { result } = renderHook(() => useProviderConflictRecovery({
      userId: 'user-1',
      onRecoveryCommitted: vi.fn(),
    }));

    // Act: Open the review.
    act(() => result.current.open(openInput));

    // Assert: Blocked preparation settles without confirmation or pending work.
    await waitFor(() => expect(result.current.state).toEqual({
      kind: 'blocked',
      reason: 'tariff-ambiguity',
      message: 'Tariff history cannot be reconciled safely.',
    }));
    expect(result.current.isPending).toBe(false);
    expect(confirmProviderConflictRecovery).not.toHaveBeenCalled();
  });

  it('retries preparation after a retryable review error instead of confirming stale state', async () => {
    // Arrange: The first read-only review fails operationally and the retry succeeds.
    vi.mocked(prepareProviderConflictRecovery)
      .mockResolvedValueOnce({
        status: 'retryable-error',
        reason: 'Provider conflict verification could not be completed. Please try again.',
      })
      .mockResolvedValueOnce(readyPreparation);
    const { result } = renderHook(() => useProviderConflictRecovery({
      userId: 'user-1',
      onRecoveryCommitted: vi.fn(),
    }));
    act(() => result.current.open(openInput));
    await waitFor(() => expect(result.current.state.kind).toBe('retryable-error'));

    // Act: The dialog's retry action re-runs preparation for the same identity.
    await act(async () => result.current.confirm());

    // Assert: No stale descriptor is confirmed and the fresh review becomes ready.
    expect(prepareProviderConflictRecovery).toHaveBeenCalledTimes(2);
    expect(confirmProviderConflictRecovery).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({
      kind: 'ready',
      stagedProviderName: 'Staged provider',
      canonicalProviderName: 'Canonical provider',
      summary: readyPreparation.summary,
    });
  });

  it('turns a confirm-time block into a stale review and prepares again on retry', async () => {
    // Arrange: Initial review is ready, but confirm-time preflight rejects it.
    vi.mocked(prepareProviderConflictRecovery).mockResolvedValue(readyPreparation);
    vi.mocked(confirmProviderConflictRecovery).mockResolvedValue({
      status: 'blocked',
      reason: 'tariff-ambiguity',
    });
    const { result } = renderHook(() => useProviderConflictRecovery({
      userId: 'user-1',
      onRecoveryCommitted: vi.fn(),
    }));
    act(() => result.current.open(openInput));
    await waitFor(() => expect(result.current.state.kind).toBe('ready'));

    // Act: Confirm the reviewed descriptor, then request another review.
    await act(async () => result.current.confirm());
    expect(result.current.state).toEqual({
      kind: 'stale-review',
      message: 'Your data changed while you were reviewing it. Review the provider conflict again before confirming.',
    });
    await act(async () => result.current.confirm());

    // Assert: Retry prepares fresh facts rather than reusing the rejected descriptor.
    expect(confirmProviderConflictRecovery).toHaveBeenCalledTimes(1);
    expect(confirmProviderConflictRecovery).toHaveBeenCalledWith(descriptor);
    expect(prepareProviderConflictRecovery).toHaveBeenCalledTimes(2);
    expect(result.current.state.kind).toBe('ready');
  });

  it('signals normal sync only after successful confirmation releases exclusion and waits for acknowledgement', async () => {
    // Arrange: Confirmation records release immediately before its promise resolves.
    const order: string[] = [];
    const onRecoveryCommitted = vi.fn(() => order.push('normal-sync'));
    vi.mocked(prepareProviderConflictRecovery).mockResolvedValue(readyPreparation);
    vi.mocked(confirmProviderConflictRecovery).mockImplementation(async () => {
      order.push('exclusive-release');
      return { status: 'reconciled' };
    });
    const { result } = renderHook(() => useProviderConflictRecovery({
      userId: 'user-1',
      onRecoveryCommitted,
    }));
    act(() => result.current.open(openInput));
    await waitFor(() => expect(result.current.state.kind).toBe('ready'));

    // Act: Confirm the reviewed recovery.
    await act(async () => result.current.confirm());

    // Assert: Sync starts after release while success remains until explicit acknowledgement.
    expect(order).toEqual(['exclusive-release', 'normal-sync']);
    expect(onRecoveryCommitted).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ kind: 'success' });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.isPending).toBe(false);

    act(() => result.current.acknowledge());
    expect(result.current.state).toEqual({ kind: 'closed' });
    expect(onRecoveryCommitted).toHaveBeenCalledTimes(1);
  });

  it('closes and ignores deferred preparation when logout clears the authenticated identity', async () => {
    // Arrange: A review is in flight for the authenticated user.
    const preparation = createDeferred<ProviderConflictRecoveryPreparation>();
    vi.mocked(prepareProviderConflictRecovery).mockReturnValue(preparation.promise);
    const onRecoveryCommitted = vi.fn();
    const { result, rerender } = renderHook(
      ({ userId }: { userId?: string }) => useProviderConflictRecovery({
        userId,
        onRecoveryCommitted,
      }),
      { initialProps: { userId: 'user-1' } as { userId?: string } },
    );
    act(() => result.current.open(openInput));
    expect(prepareProviderConflictRecovery).toHaveBeenCalledTimes(1);

    // Act: Logout invalidates the controller before preparation returns.
    rerender({ userId: undefined });
    await act(async () => preparation.resolve(readyPreparation));

    // Assert: Late authenticated work cannot reopen or advance recovery.
    expect(result.current.state).toEqual({ kind: 'closed' });
    expect(result.current.isPending).toBe(false);
    expect(confirmProviderConflictRecovery).not.toHaveBeenCalled();
    expect(onRecoveryCommitted).not.toHaveBeenCalled();
  });

  it('clears the reviewed workflow before the same user logs in again', async () => {
    // Arrange: Complete a review for the initial authenticated session.
    vi.mocked(prepareProviderConflictRecovery).mockResolvedValue(readyPreparation);
    const { result, rerender } = renderHook(
      ({ userId }: { userId?: string }) => useProviderConflictRecovery({
        userId,
        onRecoveryCommitted: vi.fn(),
      }),
      { initialProps: { userId: 'user-1' } as { userId?: string } },
    );
    act(() => result.current.open(openInput));
    await waitFor(() => expect(result.current.state.kind).toBe('ready'));

    // Act: Logout, then start a new authenticated session for the same stable ID.
    rerender({ userId: undefined });
    rerender({ userId: 'user-1' });

    // Assert: A prior review cannot reappear or be confirmed in the new session.
    await waitFor(() => expect(result.current.state).toEqual({ kind: 'closed' }));
    expect(result.current.isOpen).toBe(false);
    expect(result.current.isPending).toBe(false);
    await act(async () => result.current.confirm());
    expect(confirmProviderConflictRecovery).not.toHaveBeenCalled();
  });

  it('does not signal sync when unmounted confirmation settles after logout teardown', async () => {
    // Arrange: Confirmation remains in flight while the controller is unmounted.
    const confirmation = createDeferred<{ status: 'reconciled' }>();
    const onRecoveryCommitted = vi.fn();
    vi.mocked(prepareProviderConflictRecovery).mockResolvedValue(readyPreparation);
    vi.mocked(confirmProviderConflictRecovery).mockReturnValue(confirmation.promise);
    const { result, unmount } = renderHook(() => useProviderConflictRecovery({
      userId: 'user-1',
      onRecoveryCommitted,
    }));
    act(() => result.current.open(openInput));
    await waitFor(() => expect(result.current.state.kind).toBe('ready'));
    let pendingConfirmation!: Promise<void>;
    act(() => {
      pendingConfirmation = result.current.confirm();
    });
    expect(result.current.isPending).toBe(true);

    // Act: App/auth teardown unmounts the controller before exclusion is released.
    unmount();
    confirmation.resolve({ status: 'reconciled' });
    await pendingConfirmation;

    // Assert: The stale completion cannot request sync after teardown.
    expect(onRecoveryCommitted).not.toHaveBeenCalled();
  });
});
