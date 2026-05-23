import { db } from '../../../infra/db';

export interface SyncEngineModule {
  initialSync: () => Promise<void>;
  processOutbox: () => Promise<void>;
}

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
 * Starts the authenticated sync runtime and returns a disposer.
 *
 * The runtime runs initial hydration once, then processes outbox sync work on
 * startup, online events, and newly queued outbox items. It guarantees only one
 * active run at a time and coalesces overlapping triggers into one rerun.
 */
export function startSyncRuntime(
  options: { isAuthenticated: boolean },
  deps: SyncRuntimeDeps = createDefaultSyncRuntimeDeps()
): () => void {
  if (!options.isAuthenticated) {
    return () => undefined;
  }

  let isDisposed = false;
  let isRunning = false;
  let rerunRequested = false;
  let hasHydrated = false;
  let engineModule: SyncEngineModule | undefined;

  const run = async (): Promise<void> => {
    if (isDisposed) {
      return;
    }

    if (isRunning) {
      rerunRequested = true;
      return;
    }

    isRunning = true;
    try {
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
            await engineModule.initialSync();
            hasHydrated = true;
          } catch (error) {
            deps.logger.error('Initial sync failed:', error);
          }
        }

        try {
          await engineModule.processOutbox();
        } catch (error) {
          deps.logger.error('Outbox processing failed:', error);
        }

      } while (!isDisposed && rerunRequested);
    } finally {
      isRunning = false;
    }
  };

  const unsubscribeOnline = deps.addOnlineListener(() => {
    void run();
  });
  const unsubscribeOutbox = deps.subscribeOutboxCreates(() => {
    void run();
  });

  void run();

  return () => {
    isDisposed = true;
    unsubscribeOnline();
    unsubscribeOutbox();
  };
}
