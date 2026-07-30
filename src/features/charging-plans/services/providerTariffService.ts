import { db, type ChargingPlan, type Provider } from '../../../infra/db';
import { saveChargingPlan } from './planService';
import { saveProvider } from './providerService';

/**
 * Records staged for one atomic provider-and-first-tariff creation.
 */
export interface CreateProviderWithTariffInput {
  /** New provider that will own the tariff. */
  provider: Provider;
  /** First tariff linked to the new provider. */
  plan: ChargingPlan;
}

/**
 * Saves a new provider and its first tariff in one local transaction.
 *
 * Identity checks run before the transaction. Compatible nested Dexie
 * transactions then reuse the parent transaction, and uncaught child failures
 * roll back the provider, tariff, and both outbox entries together.
 */
export async function createProviderWithTariff(
  input: CreateProviderWithTariffInput
): Promise<void> {
  const { provider, plan } = input;

  if (provider.user_id !== plan.user_id) {
    throw new Error('Provider and tariff must belong to the same user');
  }

  if (provider.id !== plan.provider_id) {
    throw new Error('Tariff must reference the provider being created');
  }

  await db.transaction(
    'rw',
    [db.providers, db.charging_plans, db.sync_outbox],
    async () => {
      await saveProvider(provider);
      await saveChargingPlan(plan);
    }
  );
}
