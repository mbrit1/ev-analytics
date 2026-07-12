import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { db } from '../../../infra/db';
import type { SyncPayload } from '../../../infra/db';
import {
  startSyncRuntime,
  createDefaultSyncRuntimeDeps,
  type SyncRuntimeDeps,
  type SyncEngineModule
} from './syncRuntime';

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

  beforeEach(() => {
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

  it('triggers processOutbox on online event after initial run', async () => {
    // Arrange: Start with successful startup sync.
    const processOutbox = vi.fn(async () => undefined);
    const { deps } = createDeps({
      initialSync: vi.fn(async () => undefined),
      processOutbox
    });

    // Act: Start runtime, then simulate connectivity restoration.
    const dispose = startSyncRuntime({ isAuthenticated: true }, deps);
    await Promise.resolve();
    await Promise.resolve();
    triggerOnline?.();
    await Promise.resolve();
    await Promise.resolve();
    dispose();

    // Assert: One startup call plus one online-triggered call.
    expect(processOutbox).toHaveBeenCalledTimes(2);
  });

  it('triggers processOutbox when a new outbox entry is created', async () => {
    // Arrange: Start with successful startup sync.
    const processOutbox = vi.fn(async () => undefined);
    const { deps } = createDeps({
      initialSync: vi.fn(async () => undefined),
      processOutbox
    });

    // Act: Start runtime, then simulate a new outbox queue insertion.
    const dispose = startSyncRuntime({ isAuthenticated: true }, deps);
    await Promise.resolve();
    await Promise.resolve();
    triggerOutboxCreate?.();
    await Promise.resolve();
    await Promise.resolve();
    dispose();

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
        initialSync: vi.fn(async () => undefined),
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
      initialSync: vi.fn(async () => undefined),
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
    await Promise.resolve();
    await Promise.resolve();
    dispose();

    // Assert: Exactly one additional run executes after the in-flight run.
    expect(processOutbox).toHaveBeenCalledTimes(2);
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
      initialSync: vi.fn(async () => undefined),
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
      initialSync: vi.fn(async () => undefined),
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
    const initialSync = vi.fn(async () => undefined);
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
    await Promise.resolve();
    await Promise.resolve();
    dispose();

    // Assert: Engine loader runs once and returned functions are executed.
    expect(loadSyncEngine).toHaveBeenCalledTimes(1);
    expect(initialSync).toHaveBeenCalledTimes(1);
    expect(processOutbox).toHaveBeenCalledTimes(2);
  });

  it('does not execute engine functions when disposed before loader resolves', async () => {
    // Arrange: Keep sync engine loader pending until runtime is disposed.
    let resolveLoader: ((engine: SyncEngineModule) => void) | undefined;
    const initialSync = vi.fn(async () => undefined);
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
    let resolveInitialSync: (() => void) | undefined;
    let receivedSignal: AbortSignal | undefined;
    const initialSync = vi.fn((options?: { signal?: AbortSignal }) => {
      receivedSignal = options?.signal;
      return new Promise<void>((resolve) => {
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
    resolveInitialSync?.();
    await disposalPromise;

    // Assert: Disposal after engine load prevents the subsequent outbox phase.
    expect(processOutbox).not.toHaveBeenCalled();
  });

  it('logs loader failures and retries loading on later trigger', async () => {
    // Arrange: Fail first engine load and succeed on a later trigger.
    const logger = { error: vi.fn() };
    const initialSync = vi.fn(async () => undefined);
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
    await Promise.resolve();
    await Promise.resolve();
    dispose();

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
    await Promise.resolve();
    await Promise.resolve();
    dispose();

    // Assert: Initial failure is logged and outbox processing still runs.
    expect(logger.error).toHaveBeenCalledWith('Initial sync failed:', expect.any(Error));
    expect(processOutbox).toHaveBeenCalledTimes(1);
  });

  it('retries initialSync on a later trigger after an initial failure', async () => {
    // Arrange: Fail first hydration, then succeed on the next trigger.
    const initialSync = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('transient initial sync failure'))
      .mockResolvedValueOnce(undefined);
    const { deps } = createDeps({
      initialSync,
      processOutbox: vi.fn(async () => undefined)
    });

    // Act: Start runtime, then trigger a second run via online event.
    const dispose = startSyncRuntime({ isAuthenticated: true }, deps);
    await Promise.resolve();
    await Promise.resolve();
    triggerOnline?.();
    await Promise.resolve();
    await Promise.resolve();
    dispose();

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
        initialSync: vi.fn(async () => undefined),
        processOutbox
      },
      logger
    );

    // Act: Start runtime, then retrigger via online event.
    const dispose = startSyncRuntime({ isAuthenticated: true }, deps);
    await Promise.resolve();
    await Promise.resolve();
    triggerOnline?.();
    await Promise.resolve();
    await Promise.resolve();
    dispose();

    // Assert: First failure is logged and later trigger executes again.
    expect(logger.error).toHaveBeenCalledWith('Outbox processing failed:', expect.any(Error));
    expect(processOutbox).toHaveBeenCalledTimes(2);
  });

  it('cleans up listeners on dispose', async () => {
    // Arrange: Start with successful startup sync.
    const { deps } = createDeps({
      initialSync: vi.fn(async () => undefined),
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
