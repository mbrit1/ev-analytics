import { useLiveQuery } from 'dexie-react-hooks';
import { getProviders } from '../services/providerService';
import { useAuth } from '../../auth';

/**
 * Subscribes components to active charging providers in the local cache.
 *
 * Providers are stored offline-first in IndexedDB and filtered for soft deletes
 * before they are shown in tariff forms and lists.
 */
export function useProviders() {
  const { user } = useAuth();
  const providers = useLiveQuery(async () => {
    if (!user) return [];
    return getProviders(user.id);
  }, [user?.id]);

  return {
    providers: providers || [],
    isLoading: providers === undefined,
  };
}
