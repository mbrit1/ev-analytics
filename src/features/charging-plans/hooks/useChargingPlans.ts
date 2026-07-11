import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { buildLogicalTariffs, type LogicalTariff } from '../model/logicalTariffs';
import {
  createSuccessorTariffVersion,
  deleteLogicalTariff as deleteLogicalTariffService,
  getChargingPlanVersions,
  saveChargingPlan,
  scheduleTemporaryPromotion,
  type LogicalTariffIdentityInput,
  type CreateSuccessorTariffVersionInput,
  type ScheduleTemporaryPromotionInput,
  type UpdateCurrentTariffVersionInput,
  updateCurrentTariffVersion as updateCurrentTariffVersionService,
} from '../services/planService';
import type { ChargingPlan } from '../../../infra/db';
import { useAuth } from '../../auth';
import { useUtcToday } from './useUtcToday';

export interface UseChargingPlansResult {
  /** Full tariff version history, including past and future scheduled versions. */
  planVersions: ChargingPlan[];
  isLoading: boolean;
  addChargingPlan: (plan: ChargingPlan) => Promise<void>;
  logicalTariffs: LogicalTariff[];
  updateCurrentVersion: (input: UpdateCurrentTariffVersionInput) => Promise<void>;
  createSuccessorVersion: (input: CreateSuccessorTariffVersionInput) => Promise<void>;
  schedulePromotion: (input: ScheduleTemporaryPromotionInput) => Promise<void>;
  deleteLogicalTariff: (input: LogicalTariffIdentityInput) => Promise<void>;
}

/**
 * Subscribes components to active charging plans and exposes write operations.
 *
 * Dexie live queries re-run after local tariff changes, giving the UI immediate
 * feedback while the sync outbox handles remote persistence separately.
 */
export function useChargingPlans(): UseChargingPlansResult {
  const { user } = useAuth();
  const today = useUtcToday();
  const versions = useLiveQuery(async () => {
    if (!user) return [];
    return getChargingPlanVersions(user.id);
  }, [user?.id]);
  const logicalTariffs = useMemo(
    () => buildLogicalTariffs(versions ?? [], today),
    [today, versions]
  );

  const addChargingPlan = async (plan: ChargingPlan) => {
    // saveChargingPlan handles both new records and edits based on id.
    await saveChargingPlan(plan);
  };

  const updateCurrentVersion = async (input: UpdateCurrentTariffVersionInput) => {
    await updateCurrentTariffVersionService(input);
  };

  const createSuccessorVersion = async (input: CreateSuccessorTariffVersionInput) => {
    await createSuccessorTariffVersion(input);
  };

  const schedulePromotion = async (input: ScheduleTemporaryPromotionInput) => {
    await scheduleTemporaryPromotion(input);
  };

  const deleteLogicalTariff = async (input: LogicalTariffIdentityInput) => {
    await deleteLogicalTariffService(input);
  };

  return {
    planVersions: versions ?? [],
    logicalTariffs,
    isLoading: versions === undefined,
    addChargingPlan,
    updateCurrentVersion,
    createSuccessorVersion,
    schedulePromotion,
    deleteLogicalTariff,
  };
}
