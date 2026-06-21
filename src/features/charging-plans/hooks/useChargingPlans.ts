import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { buildLogicalTariffs, type LogicalTariff } from '../model/logicalTariffs';
import {
  createSuccessorTariffVersion,
  deleteChargingPlan,
  deleteLogicalTariff as deleteLogicalTariffService,
  getChargingPlans,
  saveChargingPlan,
  schedulePermanentTariffVersion,
  scheduleTemporaryPromotion,
  type LogicalTariffIdentityInput,
  type CreateSuccessorTariffVersionInput,
  type SchedulePermanentTariffVersionInput,
  type ScheduleTemporaryPromotionInput,
  type UpdateCurrentTariffVersionInput,
  type UpdateLogicalTariffDetailsInput,
  updateCurrentTariffVersion as updateCurrentTariffVersionService,
  updateLogicalTariffDetails as updateLogicalTariffDetailsService,
} from '../services/planService';
import type { ChargingPlan } from '../../../infra/db';
import { useAuth } from '../../auth';
import { useUtcToday } from './useUtcToday';

export interface UseChargingPlansResult {
  plans: ChargingPlan[];
  isLoading: boolean;
  addChargingPlan: (plan: ChargingPlan) => Promise<void>;
  removeChargingPlan: (id: string) => Promise<void>;
  logicalTariffs?: LogicalTariff[];
  updateCurrentVersion?: (input: UpdateCurrentTariffVersionInput) => Promise<void>;
  createSuccessorVersion?: (input: CreateSuccessorTariffVersionInput) => Promise<void>;
  updateLogicalTariffDetails?: (input: UpdateLogicalTariffDetailsInput) => Promise<void>;
  schedulePermanentChange?: (input: SchedulePermanentTariffVersionInput) => Promise<void>;
  schedulePromotion?: (input: ScheduleTemporaryPromotionInput) => Promise<void>;
  deleteLogicalTariff?: (input: LogicalTariffIdentityInput) => Promise<void>;
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
  const plans = useLiveQuery(async () => {
    if (!user) return [];
    return getChargingPlans(user.id);
  }, [user?.id]);
  const logicalTariffs = useMemo(
    () => buildLogicalTariffs(plans ?? [], today),
    [plans, today]
  );

  const addChargingPlan = async (plan: ChargingPlan) => {
    // saveChargingPlan handles both new records and edits based on id.
    await saveChargingPlan(plan);
  };

  const removeChargingPlan = async (id: string) => {
    // Plans are soft-deleted so existing session snapshots remain meaningful.
    await deleteChargingPlan(id);
  };

  const updateLogicalTariffDetails = async (input: UpdateLogicalTariffDetailsInput) => {
    await updateLogicalTariffDetailsService(input);
  };

  const updateCurrentVersion = async (input: UpdateCurrentTariffVersionInput) => {
    await updateCurrentTariffVersionService(input);
  };

  const createSuccessorVersion = async (input: CreateSuccessorTariffVersionInput) => {
    await createSuccessorTariffVersion(input);
  };

  const schedulePermanentChange = async (input: SchedulePermanentTariffVersionInput) => {
    await schedulePermanentTariffVersion(input);
  };

  const schedulePromotion = async (input: ScheduleTemporaryPromotionInput) => {
    await scheduleTemporaryPromotion(input);
  };

  const deleteLogicalTariff = async (input: LogicalTariffIdentityInput) => {
    await deleteLogicalTariffService(input);
  };

  return {
    plans: plans || [],
    logicalTariffs,
    isLoading: plans === undefined,
    addChargingPlan,
    removeChargingPlan,
    updateCurrentVersion,
    createSuccessorVersion,
    updateLogicalTariffDetails,
    schedulePermanentChange,
    schedulePromotion,
    deleteLogicalTariff,
  };
}
