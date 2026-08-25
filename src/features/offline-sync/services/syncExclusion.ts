import { db } from '../../../infra/db';

interface WebLockManager {
  request<T>(
    name: string,
    options: { mode: 'exclusive'; signal?: AbortSignal },
    callback: (lock: unknown) => T | Promise<T>,
  ): Promise<T>;
}

/** Raised when the supported browser cannot provide the required Web Locks API. */
export class SyncExclusionUnavailableError extends Error {
  constructor() {
    super('The browser does not support the required cross-runtime sync exclusion lock');
    this.name = 'SyncExclusionUnavailableError';
  }
}

/** Returns the origin-wide Web Lock resource name for the current Dexie database. */
export const getSyncExclusionLockName = (): string => (
  `ev-analytics/sync/${encodeURIComponent(db.name)}`
);

const getWebLockManager = (): WebLockManager => {
  const lockManager = (globalThis.navigator as Navigator & { locks?: WebLockManager } | undefined)?.locks;

  if (!lockManager) {
    throw new SyncExclusionUnavailableError();
  }

  return lockManager;
};

/**
 * Runs work under the database-scoped cooperative cross-runtime exclusion lock.
 *
 * Web Locks hold the exclusive resource until the callback's promise settles.
 * Source: https://w3c.github.io/web-locks/#lock-lifetime
 */
export const runWithSyncExclusion = async <T>(
  callback: () => Promise<T>,
  options: { signal?: AbortSignal } = {},
): Promise<T> => {
  const lockManager = getWebLockManager();

  return lockManager.request(
    getSyncExclusionLockName(),
    { mode: 'exclusive', signal: options.signal },
    async () => callback(),
  );
};
