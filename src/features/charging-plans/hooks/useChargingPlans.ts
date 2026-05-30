import { useLiveQuery } from 'dexie-react-hooks';
import { getChargingPlans, saveChargingPlan, deleteChargingPlan } from '../services/planService';
import type { ChargingPlan } from '../../../infra/db';
import { useAuth } from '../../auth';

/**
 * Subscribes components to active charging plans and exposes write operations.
 *
 * Dexie live queries re-run after local tariff changes, giving the UI immediate
 * feedback while the sync outbox handles remote persistence separately.
 */
export function useChargingPlans() {
  const { user } = useAuth();
  const plans = useLiveQuery(async () => {
    if (!user) return [];
    return getChargingPlans(user.id);
  }, [user?.id]);

  const addChargingPlan = async (plan: ChargingPlan) => {
    // saveChargingPlan handles both new records and edits based on id.
    await saveChargingPlan(plan);
  };

  const removeChargingPlan = async (id: string) => {
    // Plans are soft-deleted so existing session snapshots remain meaningful.
    await deleteChargingPlan(id);
  };

  return {
    plans: plans || [],
    isLoading: plans === undefined,
    addChargingPlan,
    removeChargingPlan,
  };
}
