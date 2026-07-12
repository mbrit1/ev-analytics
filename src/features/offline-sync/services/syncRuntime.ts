import { db } from '../../../infra/db';

export interface SyncEngineModule {
  initialSync: (options?: { signal?: AbortSignal }) => Promise<void>;
  processOutbox: (options?: { signal?: AbortSignal }) => Promise<void>;
}

/** Stops a sync runtime and resolves after its active pass has quiesced. */
export type DisposeSyncRuntime = () => Promise<void>;

/**
 * Dependencies used by the sync runtime orchestrator.
 *
 * Exported for focused unit tests without browser or Dexie side effects.
 */
export interface SyncRuntimeDeps {
  /** Lazy loader for syncEngine functions used on authenticated runtime startup. */
  loadSyncEngine: () => Promise<SyncEngineModule>;
  /** Registers a callback for browser online events and returns cleanup. */
  addOnlineListener: (listener: () => void) => () => void;
  /** Registers a callback for new outbox entries and returns cleanup. */
  subscribeOutboxCreates: (listener: () => void) => () => void;
  /** Logger used for non-fatal runtime sync errors. */
  logger: Pick<Console, 'error'>;
}

const defaultDeps: SyncRuntimeDeps = {
  loadSyncEngine: () => import('./syncEngine'),
  addOnlineListener: (listener: () => void) => {
    window.addEventListener('online', listener);
    return () => window.removeEventListener('online', listener);
  },
  subscribeOutboxCreates: (listener: () => void) => {
    const hookHandler = (_primKey: unknown, _obj: unknown, transaction: { on: (eventName: 'complete', cb: () => void) => void }) => {
      // Trigger only after the outbox write commits and next task turn so
      // processOutbox observes the newly committed row reliably.
      transaction.on('complete', () => {
        setTimeout(listener, 0);
      });
    };
    db.sync_outbox.hook('creating', hookHandler);
    return () => db.sync_outbox.hook('creating').unsubscribe(hookHandler);
  },
  logger: console
};

const activeRuntimeDisposers = new Set<DisposeSyncRuntime>();

/**
 * Creates the default runtime dependencies used in production wiring.
 *
 * Exported for integration-style tests that verify actual Dexie and browser
 * trigger behavior without replacing the subscription implementation.
 */
export function createDefaultSyncRuntimeDeps(): SyncRuntimeDeps {
  return defaultDeps;
}

/**
 * Disposes the currently authenticated runtime before logout clears Dexie.
 */
export async function disposeActiveSyncRuntime(): Promise<void> {
  await Promise.all([...activeRuntimeDisposers].map((dispose) => dispose()));
}

/**
 * Starts the authenticated sync runtime and returns a disposer.
 *
 * The runtime runs initial hydration once, then processes outbox sync work on
 * startup, online events, and newly queued outbox items. It guarantees only one
 * active run at a time and coalesces overlapping triggers into one rerun.
 */
export function startSyncRuntime(
  options: { isAuthenticated: boolean },
  deps: SyncRuntimeDeps = createDefaultSyncRuntimeDeps()
): DisposeSyncRuntime {
  if (!options.isAuthenticated) {
    return async () => undefined;
  }

  const abortController = new AbortController();
  let isDisposed = false;
  let isRunning = false;
  let rerunRequested = false;
  let hasHydrated = false;
  let engineModule: SyncEngineModule | undefined;
  let activeRunPromise: Promise<void> | undefined;
  let disposePromise: Promise<void> | undefined;

  const executeRun = async (): Promise<void> => {
    if (!engineModule) {
      try {
        engineModule = await deps.loadSyncEngine();
      } catch (error) {
        deps.logger.error('Loading sync engine failed:', error);
        return;
      }
    }

    if (isDisposed || !engineModule) {
      return;
    }

    do {
      rerunRequested = false;

      if (!hasHydrated) {
        try {
          await engineModule.initialSync({ signal: abortController.signal });
          if (isDisposed) {
            return;
          }
          hasHydrated = true;
        } catch (error) {
          deps.logger.error('Initial sync failed:', error);
        }
      }

      if (isDisposed) {
        return;
      }

      try {
        await engineModule.processOutbox({ signal: abortController.signal });
      } catch (error) {
        deps.logger.error('Outbox processing failed:', error);
      }
    } while (!isDisposed && rerunRequested);
  };

  const requestRun = (): void => {
    if (isDisposed) {
      return;
    }

    if (isRunning) {
      rerunRequested = true;
      return;
    }

    isRunning = true;
    const runPromise = executeRun().finally(() => {
      isRunning = false;
      if (activeRunPromise === runPromise) {
        activeRunPromise = undefined;
      }
    });
    activeRunPromise = runPromise;
    void runPromise;
  };

  const unsubscribeOnline = deps.addOnlineListener(() => {
    requestRun();
  });
  const unsubscribeOutbox = deps.subscribeOutboxCreates(() => {
    requestRun();
  });

  const dispose: DisposeSyncRuntime = () => {
    if (disposePromise) {
      return disposePromise;
    }

    isDisposed = true;
    abortController.abort();
    unsubscribeOnline();
    unsubscribeOutbox();
    const pendingRun = activeRunPromise;
    disposePromise = (async () => {
      await pendingRun;
      activeRuntimeDisposers.delete(dispose);
    })();
    return disposePromise;
  };

  activeRuntimeDisposers.add(dispose);
  requestRun();

  return dispose;
}
