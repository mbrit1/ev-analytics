import { useLiveQuery } from 'dexie-react-hooks';
import { getTariffs, saveTariff, deleteTariff } from '../services/tariffService';
import type { Tariff } from '../../../lib/db';

export function useTariffs() {
  const tariffs = useLiveQuery(() => getTariffs(), []);

  const addTariff = async (tariff: Tariff) => {
    await saveTariff(tariff);
  };

  const removeTariff = async (id: string) => {
    await deleteTariff(id);
  };

  return {
    tariffs: tariffs || [],
    isLoading: tariffs === undefined,
    addTariff,
    removeTariff,
  };
}
