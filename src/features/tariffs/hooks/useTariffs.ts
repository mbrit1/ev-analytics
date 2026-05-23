import { useLiveQuery } from 'dexie-react-hooks';
import { getTariffs, saveTariff, deleteTariff } from '../services/tariffService';
import type { Tariff } from '../../../infra/db';

/**
 * Subscribes components to active tariffs and exposes tariff write operations.
 *
 * Dexie live queries re-run after local tariff changes, giving the UI immediate
 * feedback while the sync outbox handles remote persistence separately.
 */
export function useTariffs() {
  const tariffs = useLiveQuery(() => getTariffs(), []);

  const addTariff = async (tariff: Tariff) => {
    // saveTariff handles both new records and edits based on the tariff id.
    await saveTariff(tariff);
  };

  const removeTariff = async (id: string) => {
    // Tariffs are soft-deleted so existing session snapshots remain meaningful.
    await deleteTariff(id);
  };

  return {
    tariffs: tariffs || [],
    isLoading: tariffs === undefined,
    addTariff,
    removeTariff,
  };
}
