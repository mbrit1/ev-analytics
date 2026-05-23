import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../infra/db';

/**
 * Subscribes components to active charging providers in the local cache.
 *
 * Providers are stored offline-first in IndexedDB and filtered for soft deletes
 * before they are shown in tariff forms and lists.
 */
export function useProviders() {
  const providers = useLiveQuery(() => db.providers.filter(p => !p.deleted_at).toArray(), []);

  return {
    providers: providers || [],
    isLoading: providers === undefined,
  };
}
