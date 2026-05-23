import { db, type ProviderPlanSelection, type SyncPayload, type TariffPriceSnapshot } from '../../../infra/db';

export interface SetActivePlanSelectionInput {
  userId: string;
  providerId: string;
  tariffPlanId: string;
  validFrom: Date;
  priceSnapshot: TariffPriceSnapshot;
}

export async function setActivePlanSelection(input: SetActivePlanSelectionInput): Promise<ProviderPlanSelection> {
  return db.transaction('rw', db.provider_plan_selections, db.sync_outbox, async () => {
    const current = await db.provider_plan_selections
      .where('provider_id')
      .equals(input.providerId)
      .filter((row) => !row.deleted_at && row.valid_to == null)
      .first();

    const now = new Date();
    if (current) {
      await db.provider_plan_selections.update(current.id, { valid_to: input.validFrom, updated_at: now });
      const updatedCurrent = await db.provider_plan_selections.get(current.id);
      if (updatedCurrent) {
        await db.sync_outbox.add({
          table_name: 'provider_plan_selections',
          action: 'UPDATE',
          payload: updatedCurrent as SyncPayload,
          timestamp: now,
          retry_count: 0,
          last_attempt_at: undefined,
          next_attempt_at: undefined,
          last_error: undefined
        });
      }
    }

    const next: ProviderPlanSelection = {
      id: crypto.randomUUID(),
      user_id: input.userId,
      provider_id: input.providerId,
      tariff_plan_id: input.tariffPlanId,
      valid_from: input.validFrom,
      valid_to: null,
      price_snapshot: structuredClone(input.priceSnapshot),
      created_at: now,
      updated_at: now
    };

    await db.provider_plan_selections.add(next);
    await db.sync_outbox.add({
      table_name: 'provider_plan_selections',
      action: 'INSERT',
      payload: next as SyncPayload,
      timestamp: now,
      retry_count: 0,
      last_attempt_at: undefined,
      next_attempt_at: undefined,
      last_error: undefined
    });

    return next;
  });
}

export async function getProviderPlanSelections(providerId: string): Promise<ProviderPlanSelection[]> {
  return db.provider_plan_selections
    .where('provider_id')
    .equals(providerId)
    .filter((row) => !row.deleted_at)
    .sortBy('valid_from');
}

export async function getActivePlanSelectionAt(providerId: string, at: Date): Promise<ProviderPlanSelection | null> {
  const rows = await db.provider_plan_selections
    .where('provider_id')
    .equals(providerId)
    .filter((row) => !row.deleted_at && row.valid_from <= at && (row.valid_to == null || row.valid_to > at))
    .toArray();

  return rows[0] ?? null;
}
