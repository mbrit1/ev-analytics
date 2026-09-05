import { db } from '../../../infra/db';
import type {
  InitialSyncResult,
  SyncRuntimeHydrationSnapshot,
} from '../model/types';
import { runWithSyncExclusion, SyncExclusionUnavailableError } from './syncExclusion';

export interface SyncEngineModule {
  initialSync: (options?: { signal?: AbortSignal }) => Promise<InitialSyncResult>;
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
const activeRuntimeRetries = new Set<() => void>();
const hydrationStateListeners = new Set<() => void>();

interface ActiveSyncRuntimeControl {
  pauseForExclusiveWork: () => Promise<void>;
  resumeAfterExclusiveWork: () => void;
}

const activeRuntimeControls = new Set<ActiveSyncRuntimeControl>();

function createUniformHydrationSnapshot(
  status: 'idle' | 'loading' | 'failed'
): SyncRuntimeHydrationSnapshot {
  const tableState = status === 'failed'
    ? { status, failureKind: 'unknown' as const }
    : { status };

  return {
    providers: tableState,
    charging_plans: tableState,
    sessions: tableState,
  };
}

let hydrationSnapshot = createUniformHydrationSnapshot('idle');

function publishHydrationSnapshot(nextSnapshot: SyncRuntimeHydrationSnapshot): void {
  hydrationSnapshot = nextSnapshot;
  hydrationStateListeners.forEach((listener) => listener());
}

function publishInitialSyncResult(result: InitialSyncResult): void {
  const toRuntimeState = (outcome: InitialSyncResult[keyof InitialSyncResult]) => {
    return outcome.status === 'aborted' ? { status: 'idle' as const } : outcome;
  };

  publishHydrationSnapshot({
    providers: toRuntimeState(result.providers),
    charging_plans: toRuntimeState(result.charging_plans),
    sessions: toRuntimeState(result.sessions),
  });
}

/** Returns the stable hydration snapshot used by React external-store consumers. */
export function getSyncRuntimeHydrationSnapshot(): SyncRuntimeHydrationSnapshot {
  return hydrationSnapshot;
}

/** Subscribes to authenticated runtime hydration-state changes. */
export function subscribeSyncRuntimeHydration(listener: () => void): () => void {
  hydrationStateListeners.add(listener);
  return () => hydrationStateListeners.delete(listener);
}

/** Requests a new hydration pass from every active authenticated runtime. */
export function retryActiveSyncRuntime(): void {
  activeRuntimeRetries.forEach((retry) => retry());
}

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
 * Runs recovery work after local runtime passes quiesce and under the shared
 * database lock. The lock is released when the callback settles, including on
 * throw, as defined by the Web Locks API.
 * Source: https://w3c.github.io/web-locks/#dom-lockmanager-request
 */
export async function runSyncRuntimeExclusive<T>(callback: () => Promise<T>): Promise<T> {
  const runtimeControls = [...activeRuntimeControls];

  await Promise.all(runtimeControls.map((runtime) => runtime.pauseForExclusiveWork()));

  try {
    return await runWithSyncExclusion(callback);
  } finally {
    runtimeControls.forEach((runtime) => runtime.resumeAfterExclusiveWork());
  }
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
  let exclusivePauseCount = 0;

  const runCycle = async (): Promise<void> => {
    await runWithSyncExclusion(async () => {
      if (isDisposed || !engineModule) {
        return;
      }

      if (!hasHydrated) {
        publishHydrationSnapshot(createUniformHydrationSnapshot('loading'));
        try {
          const result = await engineModule.initialSync({ signal: abortController.signal });
          if (isDisposed) {
            return;
          }
          publishInitialSyncResult(result);
          hasHydrated = Object.values(result).every((outcome) => outcome.status === 'ready');
        } catch (error) {
          deps.logger.error('Initial sync failed:', error);
          publishHydrationSnapshot(createUniformHydrationSnapshot('failed'));
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
    }, { signal: abortController.signal });
  };

  const executeRun = async (): Promise<void> => {
    if (!engineModule) {
      try {
        engineModule = await deps.loadSyncEngine();
      } catch (error) {
        deps.logger.error('Loading sync engine failed:', error);
        publishHydrationSnapshot(createUniformHydrationSnapshot('failed'));
        return;
      }
    }

    if (isDisposed || !engineModule) {
      return;
    }

    do {
      rerunRequested = false;
      try {
        await runCycle();
      } catch (error) {
        if (error instanceof SyncExclusionUnavailableError) {
          deps.logger.error('Sync exclusion is unavailable:', error);
        } else {
          deps.logger.error('Sync runtime cycle failed:', error);
        }
      }
    } while (!isDisposed && exclusivePauseCount === 0 && rerunRequested);
  };

  const requestRun = (): void => {
    if (isDisposed) {
      return;
    }

    if (exclusivePauseCount > 0) {
      rerunRequested = true;
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

  const runtimeControl: ActiveSyncRuntimeControl = {
    pauseForExclusiveWork: async () => {
      exclusivePauseCount += 1;
      await activeRunPromise;
    },
    resumeAfterExclusiveWork: () => {
      exclusivePauseCount -= 1;
      if (exclusivePauseCount === 0 && !isDisposed) {
        rerunRequested = true;
        requestRun();
      }
    },
  };

  const dispose: DisposeSyncRuntime = () => {
    if (disposePromise) {
      return disposePromise;
    }

    isDisposed = true;
    abortController.abort();
    unsubscribeOnline();
    unsubscribeOutbox();
    activeRuntimeRetries.delete(requestRun);
    activeRuntimeControls.delete(runtimeControl);
    const pendingRun = activeRunPromise;
    disposePromise = (async () => {
      await pendingRun;
      activeRuntimeDisposers.delete(dispose);
      if (activeRuntimeDisposers.size === 0) {
        publishHydrationSnapshot(createUniformHydrationSnapshot('idle'));
      }
    })();
    return disposePromise;
  };

  activeRuntimeDisposers.add(dispose);
  activeRuntimeRetries.add(requestRun);
  activeRuntimeControls.add(runtimeControl);
  requestRun();

  return dispose;
}
