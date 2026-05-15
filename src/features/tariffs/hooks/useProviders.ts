import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../lib/db';

export function useProviders() {
  const providers = useLiveQuery(() => db.providers.filter(p => !p.deleted_at).toArray(), []);

  return {
    providers: providers || [],
    isLoading: providers === undefined,
  };
}
