import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { db } from '../../../infra/db';
import type { SyncPayload } from '../../../infra/db';
import type { InitialSyncResult } from '../model/types';
import {
  startSyncRuntime,
  createDefaultSyncRuntimeDeps,
  getSyncRuntimeHydrationSnapshot,
  retryActiveSyncRuntime,
  runSyncRuntimeExclusive,
  type SyncRuntimeDeps,
  type SyncEngineModule
} from './syncRuntime';

const readyHydrationResult: InitialSyncResult = {
  providers: { status: 'ready' },
  charging_plans: { status: 'ready' },
  sessions: { status: 'ready' },
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
};

const installQueuedWebLocks = (): void => {
  const pendingByName = new Map<string, Promise<void>>();

  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (
        name: string,
        optionsOrCallback: unknown,
        callbackArgument?: (lock: { name: string }) => unknown,
      ): Promise<unknown> => {
        const callback = typeof optionsOrCallback === 'function'
          ? optionsOrCallback as (lock: { name: string }) => unknown
          : callbackArgument;
        const runCallback = (): Promise<unknown> => Promise.resolve(callback?.({ name }));
        const previous = pendingByName.get(name);
        const result = previous ? previous.then(runCallback) : runCallback();
        pendingByName.set(name, result.then(() => undefined, () => undefined));
        return result;
      },
    },
  });
};

/**
 * Test suite for the sync runtime orchestrator.
 *
 * Verifies auth-gated startup ordering, browser and outbox triggers, reentrancy
 * protection, rerun semantics, and resilient behavior after failures.
 */
describe('syncRuntime', () => {
  let addOnlineListener: SyncRuntimeDeps['addOnlineListener'];
  let subscribeOutboxCreates: SyncRuntimeDeps['subscribeOutboxCreates'];
  let triggerOnline: (() => void) | undefined;
  let triggerOutboxCreate: (() => void) | undefined;
  let unsubscribeOnline: () => void;
  let unsubscribeOutbox: () => void;
  let unsubscribeOnlineCount: number;
  let unsubscribeOutboxCount: number;
  let originalLocksDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalLocksDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
    installQueuedWebLocks();
    triggerOnline = undefined;
    triggerOutboxCreate = undefined;
    unsubscribeOnlineCount = 0;
    unsubscribeOutboxCount = 0;
    unsubscribeOnline = () => {
      unsubscribeOnlineCount += 1;
    };
    unsubscribeOutbox = () => {
      unsubscribeOutboxCount += 1;
    };

    addOnlineListener = vi.fn((listener: () => void) => {
      triggerOnline = listener;
      return unsubscribeOnline;
    });

    subscribeOutboxCreates = vi.fn((listener: () => void) => {
      triggerOutboxCreate = listener;
      return unsubscribeOutbox;
    });
  });

  afterEach(() => {
    if (originalLocksDescriptor) {
      Object.defineProperty(navigator, 'locks', originalLocksDescriptor);
    } else {
      Reflect.deleteProperty(navigator, 'locks');
    }
    vi.clearAllMocks();
  });

  const createDeps = (engine: SyncEngineModule, logger: Pick<Console, 'error'> = { error: vi.fn() }) => {
    const loadSyncEngine = vi.fn(async () => engine);

    const deps: SyncRuntimeDeps = {
      loadSyncEngine,
      addOnlineListener,
      subscribeOutboxCreates,
      logger
    };

    return { deps, loadSyncEngine };
  };

  it('runs initialSync before processOutbox when authenticated', async () => {
    // Arrange: Capture call ordering between hydration and outbox processing.
    const callOrder: string[] = [];
    const { deps } = createDeps({
      initialSync: vi.fn(async () => {
        callOrder.push('initialSync');
        return readyHydrationResult;
      }),
      processOutbox: vi.fn(async () => {
        callOrder.push('processOutbox');
      })
    });

    // Act: Start the authenticated runtime and wait one microtask turn.
    const dispose = startSyncRuntime({ isAuthenticated: true }, deps);
    await Promise.resolve();
    await Promise.resolve();
    dispose();

    // Assert: Initial hydration runs first, then outbox processing.
    expect(callOrder).toEqual(['initialSync', 'processOutbox']);
  });

  it('publishes isolated table hydration failures for UI consumers', async () => {
    // Arrange: Return a failed session hydration alongside successful tariff data.
    const { deps } = createDeps({
      initialSync: vi.fn(async () => ({
        ...readyHydrationResult,
        sessions: { status: 'failed', failureKind: 'invalid_data' } as const,
      })),
      processOutbox: vi.fn(async () => undefined),
    });

    // Act: Run the authenticated startup hydration.
    const dispose = startSyncRuntime({ isAuthenticated: true }, deps);
    await vi.waitFor(() => {
      expect(getSyncRuntimeHydrationSnapshot().sessions).toEqual({
        status: 'failed',
        failureKind: 'invalid_data',
      });
    });

    // Assert: Successful tables remain independently ready.
    expect(getSyncRuntimeHydrationSnapshot().charging_plans).toEqual({ status: 'ready' });
    await dispose();
  });

  it('retries failed hydration explicitly and clears the failure only after success', async () => {
    // Arrange: Fail the first session hydration and succeed on retry.
    const initialSync = vi
      .fn<() => Promise<InitialSyncResult>>()
      .mockResolvedValueOnce({
        ...readyHydrationResult,
        sessions: { status: 'failed', failureKind: 'network' },
      })
      .mockResolvedValueOnce(readyHydrationResult);
    const { deps } = createDeps({
      initialSync,
      processOutbox: vi.fn(async () => undefined),
    });
    const dispose = startSyncRuntime({ isAuthenticated: true }, deps);
    await vi.waitFor(() => {
      expect(getSyncRuntimeHydrationSnapshot().sessions.status).toBe('failed');
    });

    // Act: Request an explicit retry from the user-facing action.
    retryActiveSyncRuntime();

    // Assert: The retry reruns hydration and publishes the successful result.
    await vi.waitFor(() => {
      expect(initialSync).toHaveBeenCalledTimes(2);
      expect(getSyncRuntimeHydrationSnapshot().sessions).toEqual({ status: 'ready' });
    });
    await dispose();
  });

  it('resets hydration state after the authenticated runtime is disposed', async () => {
    // Arrange: Complete an authenticated hydration pass.
    const { deps } = createDeps({
      initialSync: vi.fn(async () => readyHydrationResult),
      processOutbox: vi.fn(async () => undefined),
    });
    const dispose = startSyncRuntime({ isAuthenticated: true }, deps);
    await vi.waitFor(() => {
      expect(getSyncRuntimeHydrationSnapshot().sessions).toEqual({ status: 'ready' });
    });

    // Act: Dispose the runtime when the authenticated session ends.
    await dispose();

    // Assert: A later user cannot observe the previous hydration outcome.
    expect(getSyncRuntimeHydrationSnapshot()).toEqual({
      providers: { status: 'idle' },
      charging_plans: { status: 'idle' },
      sessions: { status: 'idle' },
    });
  });

  it('triggers processOutbox on online event after initial run', async () => {
    // Arrange: Start with successful startup sync.
    const processOutbox = vi.fn(async () => undefined);
    const { deps } = createDeps({
      initialSync: vi.fn(async () => readyHydrationResult),
      processOutbox
    });

    // Act: Start runtime, then simulate connectivity restoration.
    const dispose = startSyncRuntime({ isAuthenticated: true }, deps);
    await Promise.resolve();
    await Promise.resolve();
    triggerOnline?.();
    await vi.waitFor(() => {
      expect(processOutbox).toHaveBeenCalledTimes(2);
    });
    await dispose();

    // Assert: One startup call plus one online-triggered call.
    expect(processOutbox).toHaveBeenCalledTimes(2);
  });

  it('triggers processOutbox when a new outbox entry is created', async () => {
    // Arrange: Start with successful startup sync.
    const processOutbox = vi.fn(async () => undefined);
    const { deps } = createDeps({
      initialSync: vi.fn(async () => readyHydrationResult),
      processOutbox
    });

    // Act: Start runtime, then simulate a new outbox queue insertion.
    const dispose = startSyncRuntime({ isAuthenticated: true }, deps);
    await Promise.resolve();
    await Promise.resolve();
    triggerOutboxCreate?.();
    await vi.waitFor(() => {
      expect(processOutbox).toHaveBeenCalledTimes(2);
    });
    await dispose();

    // Assert: Startup plus outbox-driven trigger.
    expect(processOutbox).toHaveBeenCalledTimes(2);
  });

  it('triggers processOutbox after outbox commit when using default Dexie subscription', async () => {
    // Arrange: Use the real default outbox subscription and clear local state.
    await db.sync_outbox.clear();
    const processOutbox = vi.fn(async () => {
      const [oldestItem] = await db.sync_outbox.orderBy('timestamp').toArray();
      if (oldestItem?.id !== undefined) {
        await db.sync_outbox.delete(oldestItem.id);
      }
    });
    const deps: SyncRuntimeDeps = {
      ...createDefaultSyncRuntimeDeps(),
      loadSyncEngine: vi.fn(async () => ({
        initialSync: vi.fn(async () => readyHydrationResult),
        processOutbox
      })),
      logger: { error: vi.fn() }
    };

    // Act: Start runtime, then insert a new outbox item.
    const dispose = startSyncRuntime({ isAuthenticated: true }, deps);
    await Promise.resolve();
    await Promise.resolve();
    expect(processOutbox).toHaveBeenCalledTimes(1);

    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: { id: 'post-commit' } as SyncPayload,
      timestamp: new Date()
    });

    await vi.waitFor(async () => {
      expect(await db.sync_outbox.count()).toBe(0);
    });
    dispose();

    // Assert: A post-create run occurs and processes the committed queue item.
    expect(processOutbox).toHaveBeenCalledTimes(2);
  });

  it('prevents parallel runs and performs exactly one rerun when retriggered in-flight', async () => {
    // Arrange: Keep processOutbox pending to simulate an active sync run.
    let release: (() => void) | undefined;
    const processOutbox = vi.fn(
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        })
    );
    const { deps } = createDeps({
      initialSync: vi.fn(async () => readyHydrationResult),
      processOutbox
    });

    // Act: Start runtime, retrigger twice while first run is still active.
    const dispose = startSyncRuntime({ isAuthenticated: true }, deps);
    await Promise.resolve();
    await Promise.resolve();
    triggerOnline?.();
    triggerOutboxCreate?.();
    expect(processOutbox).toHaveBeenCalledTimes(1);

    // Finish the first run, then allow one rerun to start.
    release?.();
    await vi.waitFor(() => {
      expect(processOutbox).toHaveBeenCalledTimes(2);
    });
    release?.();
    await dispose();

    // Assert: Exactly one additional run executes after the in-flight run.
    expect(processOutbox).toHaveBeenCalledTimes(2);
  });

  it('waits for an active cooperative outbox pass before entering recovery exclusivity', async () => {
    // Arrange: Hold the current runtime's cooperative upload after it starts.
    const activePass = createDeferred<void>();
    let receivedSignal: AbortSignal | undefined;
    const processOutbox = vi.fn((options?: { signal?: AbortSignal }) => {
      receivedSignal = options?.signal;
      return activePass.promise;
    });
    const { deps } = createDeps({
      initialSync: vi.fn(async () => readyHydrationResult),
      processOutbox,
    });
    const exclusiveCallback = vi.fn(async () => undefined);
    const dispose = startSyncRuntime({ isAuthenticated: true }, deps);

    try {
      await vi.waitFor(() => {
        expect(processOutbox).toHaveBeenCalledTimes(1);
      });

      // Act: Request recovery exclusion without using abort as a quiescence proof.
      const exclusiveWork = runSyncRuntimeExclusive(exclusiveCallback);
      await Promise.resolve();

      // Assert: The in-flight upload remains active and exclusive work waits.
      expect(receivedSignal?.aborted).toBe(false);
      expect(exclusiveCallback).not.toHaveBeenCalled();

      activePass.resolve();
      await exclusiveWork;

      // Assert: The callback can enter only after the cooperative pass settles.
      expect(exclusiveCallback).toHaveBeenCalledTimes(1);
    } finally {
      activePass.resolve();
      await dispose();
    }
  });

  it('holds the shared lock across initialSync, outbox, and coalesced triggers in another runtime', async () => {
    // Arrange: Hold recovery exclusivity before a second runtime starts.
    const releaseExclusive = createDeferred<void>();
    const exclusiveCallback = vi.fn(async () => releaseExclusive.promise);
    const exclusiveWork = runSyncRuntimeExclusive(exclusiveCallback);
    let triggerSecondOnline: (() => void) | undefined;
    let triggerSecondOutbox: (() => void) | undefined;
    const secondInitialSync = vi.fn(async () => readyHydrationResult);
    const secondProcessOutbox = vi.fn(async () => undefined);
    const secondDeps: SyncRuntimeDeps = {
      loadSyncEngine: vi.fn(async () => ({
        initialSync: secondInitialSync,
        processOutbox: secondProcessOutbox,
      })),
      addOnlineListener: (listener) => {
        triggerSecondOnline = listener;
        return () => undefined;
      },
      subscribeOutboxCreates: (listener) => {
        triggerSecondOutbox = listener;
        return () => undefined;
      },
      logger: { error: vi.fn() },
    };

    await vi.waitFor(() => {
      expect(exclusiveCallback).toHaveBeenCalledTimes(1);
    });
    const disposeSecond = startSyncRuntime({ isAuthenticated: true }, secondDeps);

    try {
      // Act: Request two second-runtime passes while recovery owns the database lock.
      triggerSecondOnline?.();
      triggerSecondOutbox?.();
      await Promise.resolve();

      // Assert: The database-scoped lock has no user component, so no write cycle starts.
      expect(secondInitialSync).not.toHaveBeenCalled();
      expect(secondProcessOutbox).not.toHaveBeenCalled();

      releaseExclusive.resolve();
      await exclusiveWork;

      // Assert: The queued startup and triggers collapse into one normal sync after release.
      await vi.waitFor(() => {
        expect(secondInitialSync).toHaveBeenCalledTimes(1);
        expect(secondProcessOutbox).toHaveBeenCalledTimes(1);
      });
    } finally {
      releaseExclusive.resolve();
      await exclusiveWork;
      await disposeSecond();
    }
  });

  it('releases recovery exclusivity after a throwing callback and cancels a disposed queued runtime', async () => {
    // Arrange: Make the first exclusive callback fail, then hold a second callback.
    const failure = new Error('recovery failed');
    const releaseExclusive = createDeferred<void>();
    const secondExclusiveCallback = vi.fn(async () => releaseExclusive.promise);
    const queuedInitialSync = vi.fn(async () => readyHydrationResult);
    const queuedProcessOutbox = vi.fn(async () => undefined);
    const { deps } = createDeps({
      initialSync: queuedInitialSync,
      processOutbox: queuedProcessOutbox,
    });

    // Act: Throw from one callback, then queue and dispose a runtime behind the next one.
    await expect(runSyncRuntimeExclusive(async () => {
      throw failure;
    })).rejects.toThrow(failure);
    const exclusiveWork = runSyncRuntimeExclusive(secondExclusiveCallback);
    await vi.waitFor(() => {
      expect(secondExclusiveCallback).toHaveBeenCalledTimes(1);
    });
    const disposeQueued = startSyncRuntime({ isAuthenticated: true }, deps);
    const queuedDisposal = disposeQueued();
    releaseExclusive.resolve();
    await exclusiveWork;
    await queuedDisposal;

    // Assert: The thrown callback released the lock and disposal prevented queued writes.
    expect(queuedInitialSync).not.toHaveBeenCalled();
    expect(queuedProcessOutbox).not.toHaveBeenCalled();
  });

  it('does not fall back to unlocked synchronization when Web Locks are unavailable', async () => {
    // Arrange: Remove the browser capability required for cooperative exclusion.
    Reflect.deleteProperty(navigator, 'locks');
    const logger = { error: vi.fn() };
    const processOutbox = vi.fn(async () => undefined);
    const { deps } = createDeps({
      initialSync: vi.fn(async () => readyHydrationResult),
      processOutbox,
    }, logger);

    // Act: Start authenticated synchronization without a supported lock manager.
    const dispose = startSyncRuntime({ isAuthenticated: true }, deps);
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        'Sync exclusion is unavailable:',
        expect.objectContaining({ name: 'SyncExclusionUnavailableError' }),
      );
    });
    await dispose();

    // Assert: The runtime reports the unsupported capability and performs no unlocked writes.
    expect(processOutbox).not.toHaveBeenCalled();
  });

  it('aborts an active outbox pass and drops its queued rerun on dispose', async () => {
    // Arrange: Keep the startup outbox pass pending and capture its lifecycle signal.
    let resolveOutbox: (() => void) | undefined;
    let receivedSignal: AbortSignal | undefined;
    const processOutbox = vi.fn((options?: { signal?: AbortSignal }) => {
      receivedSignal = options?.signal;
      return new Promise<void>((resolve) => {
        resolveOutbox = resolve;
      });
    });
    const { deps } = createDeps({
      initialSync: vi.fn(async () => readyHydrationResult),
      processOutbox
    });

    // Act: Queue a rerun, dispose the active pass, then release its remote work.
    const dispose = startSyncRuntime({ isAuthenticated: true }, deps);
    await vi.waitFor(() => {
      expect(processOutbox).toHaveBeenCalledTimes(1);
    });
    triggerOnline?.();
    const disposalPromise = dispose();
    expect(receivedSignal?.aborted).toBe(true);
    resolveOutbox?.();
    await disposalPromise;

    // Assert: The disposed runtime never starts the coalesced follow-up pass.
    expect(processOutbox).toHaveBeenCalledTimes(1);
  });

  it('does not run when unauthenticated', async () => {
    // Arrange: Provide no-op sync dependencies.
    const loadSyncEngine = vi.fn(async () => ({
      initialSync: vi.fn(async () => readyHydrationResult),
      processOutbox: vi.fn(async () => undefined)
    }));
    const deps: SyncRuntimeDeps = {
      loadSyncEngine,
      addOnlineListener,
      subscribeOutboxCreates,
      logger: { error: vi.fn() }
    };

    // Act: Start runtime without auth and then trigger events.
    const dispose = startSyncRuntime({ isAuthenticated: false }, deps);
    triggerOnline?.();
    triggerOutboxCreate?.();
    await Promise.resolve();
    dispose();

    // Assert: Runtime remains inactive and does not subscribe to triggers.
    expect(addOnlineListener).not.toHaveBeenCalled();
    expect(subscribeOutboxCreates).not.toHaveBeenCalled();
    expect(loadSyncEngine).not.toHaveBeenCalled();
  });

  it('loads syncEngine once on authenticated startup and executes engine functions', async () => {
    // Arrange: Provide a lazy loader returning mock engine functions.
    const initialSync = vi.fn(async () => readyHydrationResult);
    const processOutbox = vi.fn(async () => undefined);
    const loadSyncEngine = vi.fn(async () => ({
      initialSync,
      processOutbox
    }));
    const deps: SyncRuntimeDeps = {
      loadSyncEngine,
      addOnlineListener,
      subscribeOutboxCreates,
      logger: { error: vi.fn() }
    };

    // Act: Start authenticated runtime and trigger additional reruns.
    const dispose = startSyncRuntime({ isAuthenticated: true }, deps);
    await Promise.resolve();
    await Promise.resolve();
    triggerOnline?.();
    triggerOutboxCreate?.();
    await vi.waitFor(() => {
      expect(processOutbox).toHaveBeenCalledTimes(2);
    });
    await dispose();

    // Assert: Engine loader runs once and returned functions are executed.
    expect(loadSyncEngine).toHaveBeenCalledTimes(1);
    expect(initialSync).toHaveBeenCalledTimes(1);
    expect(processOutbox).toHaveBeenCalledTimes(2);
  });

  it('does not execute engine functions when disposed before loader resolves', async () => {
    // Arrange: Keep sync engine loader pending until runtime is disposed.
    let resolveLoader: ((engine: SyncEngineModule) => void) | undefined;
    const initialSync = vi.fn(async () => readyHydrationResult);
    const processOutbox = vi.fn(async () => undefined);
    const loadSyncEngine = vi.fn(
      () =>
        new Promise<SyncEngineModule>(resolve => {
          resolveLoader = resolve;
        })
    );
    const deps: SyncRuntimeDeps = {
      loadSyncEngine,
      addOnlineListener,
      subscribeOutboxCreates,
      logger: { error: vi.fn() }
    };

    // Act: Start runtime, dispose while loader is pending, then resolve loader.
    const dispose = startSyncRuntime({ isAuthenticated: true }, deps);
    await Promise.resolve();
    dispose();
    resolveLoader?.({ initialSync, processOutbox });
    await Promise.resolve();
    await Promise.resolve();

    // Assert: No sync engine function executes after dispose race.
    expect(initialSync).not.toHaveBeenCalled();
    expect(processOutbox).not.toHaveBeenCalled();
  });

  it('does not start outbox processing when disposed during initial hydration', async () => {
    // Arrange: Keep initial hydration pending after the engine has loaded.
    let resolveInitialSync: ((result: InitialSyncResult) => void) | undefined;
    let receivedSignal: AbortSignal | undefined;
    const initialSync = vi.fn((options?: { signal?: AbortSignal }) => {
      receivedSignal = options?.signal;
      return new Promise<InitialSyncResult>((resolve) => {
        resolveInitialSync = resolve;
      });
    });
    const processOutbox = vi.fn(async () => undefined);
    const { deps } = createDeps({ initialSync, processOutbox });

    // Act: Dispose the runtime while hydration is active, then resolve it.
    const dispose = startSyncRuntime({ isAuthenticated: true }, deps);
    await vi.waitFor(() => {
      expect(initialSync).toHaveBeenCalledTimes(1);
    });
    const disposalPromise = dispose();
    expect(receivedSignal?.aborted).toBe(true);
    resolveInitialSync?.(readyHydrationResult);
    await disposalPromise;

    // Assert: Disposal after engine load prevents the subsequent outbox phase.
    expect(processOutbox).not.toHaveBeenCalled();
  });

  it('logs loader failures and retries loading on later trigger', async () => {
    // Arrange: Fail first engine load and succeed on a later trigger.
    const logger = { error: vi.fn() };
    const initialSync = vi.fn(async () => readyHydrationResult);
    const processOutbox = vi.fn(async () => undefined);
    const loadSyncEngine = vi
      .fn<() => Promise<SyncEngineModule>>()
      .mockRejectedValueOnce(new Error('loader failed'))
      .mockResolvedValueOnce({ initialSync, processOutbox });
    const deps: SyncRuntimeDeps = {
      loadSyncEngine,
      addOnlineListener,
      subscribeOutboxCreates,
      logger
    };

    // Act: Start runtime, then retrigger after the failed initial load.
    const dispose = startSyncRuntime({ isAuthenticated: true }, deps);
    await Promise.resolve();
    await Promise.resolve();
    triggerOnline?.();
    await vi.waitFor(() => {
      expect(processOutbox).toHaveBeenCalledTimes(1);
    });
    await dispose();

    // Assert: Failure is logged and next trigger retries loader successfully.
    expect(logger.error).toHaveBeenCalledWith('Loading sync engine failed:', expect.any(Error));
    expect(loadSyncEngine).toHaveBeenCalledTimes(2);
    expect(initialSync).toHaveBeenCalledTimes(1);
    expect(processOutbox).toHaveBeenCalledTimes(1);
  });

  it('logs initialSync errors and still attempts processOutbox', async () => {
    // Arrange: Fail initial hydration but keep outbox processing successful.
    const logger = { error: vi.fn() };
    const processOutbox = vi.fn(async () => undefined);
    const { deps } = createDeps(
      {
        initialSync: vi.fn(async () => {
          throw new Error('initial failed');
        }),
        processOutbox
      },
      logger
    );

    // Act: Start runtime and let startup complete.
    const dispose = startSyncRuntime({ isAuthenticated: true }, deps);
    await vi.waitFor(() => {
      expect(processOutbox).toHaveBeenCalledTimes(1);
    });
    await dispose();

    // Assert: Initial failure is logged and outbox processing still runs.
    expect(logger.error).toHaveBeenCalledWith('Initial sync failed:', expect.any(Error));
    expect(processOutbox).toHaveBeenCalledTimes(1);
  });

  it('retries initialSync on a later trigger after an initial failure', async () => {
    // Arrange: Fail first hydration, then succeed on the next trigger.
    const initialSync = vi
      .fn<() => Promise<InitialSyncResult>>()
      .mockRejectedValueOnce(new Error('transient initial sync failure'))
      .mockResolvedValueOnce(readyHydrationResult);
    const { deps } = createDeps({
      initialSync,
      processOutbox: vi.fn(async () => undefined)
    });

    // Act: Start runtime, then trigger a second run via online event.
    const dispose = startSyncRuntime({ isAuthenticated: true }, deps);
    await Promise.resolve();
    await Promise.resolve();
    triggerOnline?.();
    await vi.waitFor(() => {
      expect(initialSync).toHaveBeenCalledTimes(2);
    });
    await dispose();

    // Assert: Initial sync is attempted again on a later trigger.
    expect(initialSync).toHaveBeenCalledTimes(2);
  });

  it('logs processOutbox errors and retries on later triggers', async () => {
    // Arrange: Fail the first outbox run, succeed the second.
    const logger = { error: vi.fn() };
    const processOutbox = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('flush failed'))
      .mockResolvedValueOnce(undefined);
    const { deps } = createDeps(
      {
        initialSync: vi.fn(async () => readyHydrationResult),
        processOutbox
      },
      logger
    );

    // Act: Start runtime, then retrigger via online event.
    const dispose = startSyncRuntime({ isAuthenticated: true }, deps);
    await Promise.resolve();
    await Promise.resolve();
    triggerOnline?.();
    await vi.waitFor(() => {
      expect(processOutbox).toHaveBeenCalledTimes(2);
    });
    await dispose();

    // Assert: First failure is logged and later trigger executes again.
    expect(logger.error).toHaveBeenCalledWith('Outbox processing failed:', expect.any(Error));
    expect(processOutbox).toHaveBeenCalledTimes(2);
  });

  it('cleans up listeners on dispose', async () => {
    // Arrange: Start with successful startup sync.
    const { deps } = createDeps({
      initialSync: vi.fn(async () => readyHydrationResult),
      processOutbox: vi.fn(async () => undefined)
    });

    // Act: Start runtime and then dispose.
    const dispose = startSyncRuntime({ isAuthenticated: true }, deps);
    await Promise.resolve();
    dispose();

    // Assert: Both trigger subscriptions are torn down.
    expect(unsubscribeOnlineCount).toBe(1);
    expect(unsubscribeOutboxCount).toBe(1);
  });
});
