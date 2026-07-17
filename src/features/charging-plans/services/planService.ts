import { type Table } from 'dexie';
import { createSyncOutboxEntry, db, type ChargingPlan, type ProviderPlanSelection, type SyncOutbox } from '../../../infra/db';
import {
  addUtcDays,
  buildCurrentChargingPlans,
  formatUtcDate,
  getLogicalTariffKey,
  hydrateChargingPlanDates,
  normalizeTariffName,
  resolveEffectivePlanForDate,
} from '../model/logicalTariffs';

export interface LogicalTariffIdentityInput {
  userId: string;
  providerId: string;
  name: string;
}

export interface TariffPriceInput {
  ac_price_per_kwh?: number;
  dc_price_per_kwh?: number;
  roaming_ac_price_per_kwh?: number;
  roaming_dc_price_per_kwh?: number;
  monthly_base_fee: number;
  session_fee: number;
}

export interface ScheduleTemporaryPromotionInput extends LogicalTariffIdentityInput {
  promoStart: Date;
  promoEndInclusive: Date;
  prices: TariffPriceInput;
}

export interface UpdateCurrentTariffVersionInput extends LogicalTariffIdentityInput {
  currentVersionId: string;
  validFrom: Date;
  validTo?: Date | null;
  nextName: string;
  prices: TariffPriceInput;
  affiliation?: string;
  notes?: string;
}

export interface CreateSuccessorTariffVersionInput extends LogicalTariffIdentityInput {
  effectiveFrom: Date;
  validTo?: Date | null;
  nextName: string;
  prices: TariffPriceInput;
  affiliation?: string;
  notes?: string;
}

export interface UpdateLogicalTariffDetailsInput extends LogicalTariffIdentityInput {
  nextProviderId: string;
  nextName: string;
  affiliation?: string;
  notes?: string;
}

type PlanTable = Table<ChargingPlan, string>;
type OutboxTable = Table<SyncOutbox, number>;
type SelectionTable = Table<ProviderPlanSelection, string>;

function assertIntegerCents(value: number, fieldName: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer number of cents`);
  }
}

function assertNonNegative(value: number, fieldName: string): void {
  if (value < 0) {
    throw new Error(`${fieldName} must be non-negative`);
  }
}

function assertNonNegativeNullable(value: number | undefined, fieldName: string): void {
  if (value == null) return;
  assertIntegerCents(value, fieldName);
  assertNonNegative(value, fieldName);
}

function validatePlan(plan: ChargingPlan): void {
  assertNonNegativeNullable(plan.ac_price_per_kwh, 'ac_price_per_kwh');
  assertNonNegativeNullable(plan.dc_price_per_kwh, 'dc_price_per_kwh');
  assertNonNegativeNullable(plan.roaming_ac_price_per_kwh, 'roaming_ac_price_per_kwh');
  assertNonNegativeNullable(plan.roaming_dc_price_per_kwh, 'roaming_dc_price_per_kwh');
  assertIntegerCents(plan.monthly_base_fee, 'monthly_base_fee');
  assertNonNegative(plan.monthly_base_fee, 'monthly_base_fee');
  assertIntegerCents(plan.session_fee, 'session_fee');
  assertNonNegative(plan.session_fee, 'session_fee');

  const hasMeaningfulPricing = [
    plan.ac_price_per_kwh,
    plan.dc_price_per_kwh,
    plan.roaming_ac_price_per_kwh,
    plan.roaming_dc_price_per_kwh
  ].some((value) => value != null)
    || plan.monthly_base_fee > 0
    || plan.session_fee > 0;

  if (!hasMeaningfulPricing) {
    throw new Error('charging plan requires at least one price or fee value');
  }
}

async function putPlanAndQueue(
  plans: PlanTable,
  outbox: OutboxTable,
  plan: ChargingPlan,
  action: 'INSERT' | 'UPDATE' | 'DELETE',
  now: Date,
  options?: {
    validate?: boolean;
  }
): Promise<void> {
  if (options?.validate !== false) {
    validatePlan(plan);
  }
  await plans.put(plan);
  await outbox.add(createSyncOutboxEntry('charging_plans', action, plan, now));
}

async function putSelectionAndQueue(
  selections: SelectionTable,
  outbox: OutboxTable,
  selection: ProviderPlanSelection,
  action: 'INSERT' | 'UPDATE' | 'DELETE',
  now: Date
): Promise<void> {
  await selections.put(selection);
  await outbox.add(createSyncOutboxEntry(
    'provider_plan_selections',
    action,
    selection,
    now,
  ));
}

function dateToComparableMs(value: Date | null | undefined): number {
  if (value == null) return Number.POSITIVE_INFINITY;
  return value.getTime();
}

function periodsOverlap(
  leftStart: Date,
  leftEnd: Date | null | undefined,
  rightStart: Date,
  rightEnd: Date | null | undefined
): boolean {
  return leftStart.getTime() < dateToComparableMs(rightEnd)
    && rightStart.getTime() < dateToComparableMs(leftEnd);
}

function trimPlanName(name: string): string {
  return (name ?? '').trim();
}

function sortPlansByStartDate(plans: ChargingPlan[]): ChargingPlan[] {
  return [...plans].sort((left, right) => left.valid_from.getTime() - right.valid_from.getTime());
}

function buildLogicalTariffMissingError(providerId: string, name: string): Error {
  return new Error(`No active tariff baseline exists for ${providerId}::${normalizeTariffName(name)}`);
}

function findFirstVersionStartingWithin(
  versions: ChargingPlan[],
  startInclusive: Date,
  endExclusive?: Date
): ChargingPlan | undefined {
  return versions.find((version) => {
    const startsAt = version.valid_from.getTime();
    return startsAt >= startInclusive.getTime()
      && (endExclusive == null || startsAt < endExclusive.getTime());
  });
}

function findVersionStartingExactlyAt(
  versions: ChargingPlan[],
  at: Date
): ChargingPlan | undefined {
  return versions.find((version) => version.valid_from.getTime() === at.getTime());
}

async function loadLogicalVersions(
  userId: string,
  providerId: string,
  name: string
): Promise<ChargingPlan[]> {
  return loadLogicalVersionsFromTable(db.charging_plans, userId, providerId, name);
}

async function loadLogicalVersionsFromTable(
  plans: PlanTable,
  userId: string,
  providerId: string,
  name: string
): Promise<ChargingPlan[]> {
  const normalizedName = normalizeTariffName(name);
  const matchingPlans = await plans
    .where('provider_id')
    .equals(providerId)
    .filter((plan) => (
      plan.user_id === userId
      && !plan.deleted_at
      && normalizeTariffName(plan.name) === normalizedName
    ))
    .toArray();

  return sortPlansByStartDate(matchingPlans.map(hydrateChargingPlanDates));
}

function buildPlanFromIdentityAndPrices(
  identity: LogicalTariffIdentityInput,
  prices: TariffPriceInput,
  now: Date,
  overrides: Partial<ChargingPlan>
): ChargingPlan {
  return {
    id: crypto.randomUUID(),
    user_id: identity.userId,
    provider_id: identity.providerId,
    name: trimPlanName(identity.name),
    valid_from: now,
    created_at: now,
    updated_at: now,
    ...prices,
    ...overrides
  };
}

function buildSuccessorFromBaseline(
  baseline: ChargingPlan,
  identity: LogicalTariffIdentityInput,
  prices: TariffPriceInput,
  validFrom: Date,
  validTo: Date | null | undefined,
  now: Date
): ChargingPlan {
  return buildPlanFromIdentityAndPrices(identity, prices, now, {
    valid_from: validFrom,
    valid_to: validTo ?? null,
    affiliation: baseline.affiliation,
    notes: baseline.notes
  });
}

function buildRestorationFromBaseline(
  baseline: ChargingPlan,
  identity: LogicalTariffIdentityInput,
  validFrom: Date,
  now: Date
): ChargingPlan {
  return {
    ...baseline,
    id: crypto.randomUUID(),
    user_id: identity.userId,
    provider_id: identity.providerId,
    name: trimPlanName(identity.name),
    valid_from: validFrom,
    created_at: now,
    updated_at: now
  };
}

function assertNoLogicalIdentityOverlap(
  sourceVersions: ChargingPlan[],
  destinationVersions: ChargingPlan[],
  destinationIdentity: Pick<LogicalTariffIdentityInput, 'providerId' | 'name'>
): void {
  const overlappingDestination = sourceVersions.find((source) => (
    destinationVersions.some((destination) => (
      periodsOverlap(source.valid_from, source.valid_to, destination.valid_from, destination.valid_to)
    ))
  ));

  if (overlappingDestination) {
    throw new Error(
      `Tariff identity overlaps an existing active logical tariff for ${getLogicalTariffKey({
        provider_id: destinationIdentity.providerId,
        name: destinationIdentity.name
      })}`
    );
  }
}

export async function getEffectiveChargingPlanAt(
  userId: string,
  providerId: string,
  name: string,
  at: Date
): Promise<ChargingPlan | null> {
  const versions = await loadLogicalVersions(userId, providerId, name);
  return resolveEffectivePlanForDate(versions, at);
}

export async function saveChargingPlan(plan: ChargingPlan): Promise<void> {
  validatePlan(plan);

  await db.transaction('rw', db.charging_plans, db.sync_outbox, async () => {
    const normalizedIncomingPlan = hydrateChargingPlanDates(plan);
    const existing = await db.charging_plans.get(normalizedIncomingPlan.id);
    const now = new Date();
    const normalizedPlanName = (normalizedIncomingPlan.name ?? '').trim();
    const normalizedPlanNameLower = normalizedPlanName.toLowerCase();

    const overlappingTariffVersion = (await db.charging_plans
      .where('provider_id')
      .equals(normalizedIncomingPlan.provider_id)
      .filter((candidate) => (
        !hydrateChargingPlanDates(candidate).deleted_at
        && candidate.id !== normalizedIncomingPlan.id
        && candidate.user_id === normalizedIncomingPlan.user_id
        && (candidate.name ?? '').trim().toLowerCase() === normalizedPlanNameLower
        && periodsOverlap(
          normalizedIncomingPlan.valid_from,
          normalizedIncomingPlan.valid_to,
          hydrateChargingPlanDates(candidate).valid_from,
          hydrateChargingPlanDates(candidate).valid_to,
        )
      ))
      .first()) ?? undefined;

    if (overlappingTariffVersion) {
      throw new Error('Tariff validity overlaps with an existing active version for this provider and name');
    }

    const planToSave: ChargingPlan = {
      ...normalizedIncomingPlan,
      name: normalizedPlanName,
      created_at: existing?.created_at || now,
      updated_at: now
    };

    await putPlanAndQueue(db.charging_plans, db.sync_outbox, planToSave, existing ? 'UPDATE' : 'INSERT', now);
  });
}

export async function getChargingPlans(userId: string): Promise<ChargingPlan[]> {
  const versions = await getChargingPlanVersions(userId);
  return buildCurrentChargingPlans(versions, { at: new Date() });
}

export async function getChargingPlanVersions(userId: string): Promise<ChargingPlan[]> {
  const plans = await db.charging_plans
    .filter((plan) => plan.user_id === userId && !plan.deleted_at)
    .toArray();

  return plans.map(hydrateChargingPlanDates);
}

/**
 * Loads the user-owned historical plan rows needed by referenced sessions.
 *
 * Exact referenced versions establish which logical tariffs are in scope;
 * unresolved or cross-user ids remain absent. Matching siblings include
 * soft-deleted rows so callers can reconstruct the complete tariff timeline.
 */
export async function getChargingPlanHistory(
  userId: string,
  referencedPlanIds: readonly string[]
): Promise<ChargingPlan[]> {
  const distinctPlanIds = [...new Set(referencedPlanIds)];
  if (distinctPlanIds.length === 0) {
    return [];
  }

  const referencedPlans = (await db.charging_plans.bulkGet(distinctPlanIds))
    .filter((plan): plan is ChargingPlan => plan !== undefined && plan.user_id === userId)
    .map(hydrateChargingPlanDates);
  if (referencedPlans.length === 0) {
    return [];
  }

  const logicalTariffKeys = new Set(referencedPlans.map(getLogicalTariffKey));
  const providerIds = [...new Set(referencedPlans.map((plan) => plan.provider_id))];
  const relatedPlans = await db.charging_plans
    .where('provider_id')
    .anyOf(providerIds)
    .filter((plan) => (
      plan.user_id === userId
      && logicalTariffKeys.has(getLogicalTariffKey(plan))
    ))
    .toArray();

  return sortPlansByStartDate(relatedPlans.map(hydrateChargingPlanDates));
}

export async function scheduleTemporaryPromotion(
  input: ScheduleTemporaryPromotionInput
): Promise<void> {
  await db.transaction('rw', db.charging_plans, db.sync_outbox, async () => {
    if (input.promoEndInclusive.getTime() < input.promoStart.getTime()) {
      throw new Error('promoEndInclusive must be on or after promoStart');
    }

    const versions = await loadLogicalVersionsFromTable(
      db.charging_plans,
      input.userId,
      input.providerId,
      input.name
    );
    const baseline = resolveEffectivePlanForDate(versions, input.promoStart);

    if (!baseline) {
      throw buildLogicalTariffMissingError(input.providerId, input.name);
    }

    if (input.promoStart.getTime() <= baseline.valid_from.getTime()) {
      throw new Error('promoStart must be after the current baseline start date');
    }

    const restoreFrom = addUtcDays(input.promoEndInclusive, 1);

    const conflictingVersion = findFirstVersionStartingWithin(
      versions,
      input.promoStart,
      restoreFrom
    ) ?? findVersionStartingExactlyAt(versions, restoreFrom);

    if (conflictingVersion) {
      throw new Error(
        `Cannot schedule promotion because version starting ${formatUtcDate(conflictingVersion.valid_from)} already exists`
      );
    }

    if (baseline.valid_to != null && restoreFrom.getTime() >= baseline.valid_to.getTime()) {
      throw new Error('Promotion must leave time to restore the baseline before it ends');
    }

    const now = new Date();
    const closedBaseline: ChargingPlan = {
      ...baseline,
      valid_to: input.promoStart,
      updated_at: now
    };
    const promotion = buildSuccessorFromBaseline(
      baseline,
      input,
      input.prices,
      input.promoStart,
      restoreFrom,
      now
    );
    const restoration = buildRestorationFromBaseline(baseline, input, restoreFrom, now);

    validatePlan(closedBaseline);
    validatePlan(promotion);
    validatePlan(restoration);

    await putPlanAndQueue(db.charging_plans, db.sync_outbox, closedBaseline, 'UPDATE', now);
    await putPlanAndQueue(db.charging_plans, db.sync_outbox, promotion, 'INSERT', now);
    await putPlanAndQueue(db.charging_plans, db.sync_outbox, restoration, 'INSERT', now);
  });
}

export async function updateCurrentTariffVersion(
  input: UpdateCurrentTariffVersionInput
): Promise<void> {
  await db.transaction('rw', db.charging_plans, db.sync_outbox, async () => {
    const sourceVersions = await loadLogicalVersionsFromTable(
      db.charging_plans,
      input.userId,
      input.providerId,
      input.name
    );

    const currentVersion = sourceVersions.find((version) => version.id === input.currentVersionId);
    if (!currentVersion) {
      throw new Error('Current tariff version no longer exists');
    }

    if (currentVersion.valid_from.getTime() !== input.validFrom.getTime()) {
      throw new Error('Current tariff update requires an unchanged valid_from date');
    }

    const destinationVersions = sortPlansByStartDate(
      (await loadLogicalVersionsFromTable(
        db.charging_plans,
        input.userId,
        input.providerId,
        input.nextName
      )).filter((version) => !sourceVersions.some((source) => source.id === version.id))
    );

    assertNoLogicalIdentityOverlap(
      sourceVersions,
      destinationVersions,
      { providerId: input.providerId, name: input.nextName }
    );

    const now = new Date();
    const nextName = trimPlanName(input.nextName);
    const shouldUpdateValidTo = Object.prototype.hasOwnProperty.call(input, 'validTo');
    const updatedVersions = sourceVersions.map((version) => {
      if (version.id !== currentVersion.id) {
        return {
          ...version,
          name: nextName,
          updated_at: now,
        };
      }

      return {
        ...version,
        name: nextName,
        valid_to: shouldUpdateValidTo ? input.validTo ?? null : version.valid_to,
        ac_price_per_kwh: input.prices.ac_price_per_kwh,
        dc_price_per_kwh: input.prices.dc_price_per_kwh,
        roaming_ac_price_per_kwh: input.prices.roaming_ac_price_per_kwh,
        roaming_dc_price_per_kwh: input.prices.roaming_dc_price_per_kwh,
        monthly_base_fee: input.prices.monthly_base_fee,
        session_fee: input.prices.session_fee,
        affiliation: Object.prototype.hasOwnProperty.call(input, 'affiliation')
          ? input.affiliation
          : version.affiliation,
        notes: Object.prototype.hasOwnProperty.call(input, 'notes')
          ? input.notes
          : version.notes,
        updated_at: now,
      };
    });

    updatedVersions.forEach(validatePlan);

    for (const version of updatedVersions) {
      await putPlanAndQueue(db.charging_plans, db.sync_outbox, version, 'UPDATE', now);
    }
  });
}

export async function createSuccessorTariffVersion(
  input: CreateSuccessorTariffVersionInput
): Promise<void> {
  await db.transaction('rw', db.charging_plans, db.sync_outbox, async () => {
    const versions = await loadLogicalVersionsFromTable(
      db.charging_plans,
      input.userId,
      input.providerId,
      input.name
    );
    const baseline = resolveEffectivePlanForDate(versions, input.effectiveFrom);

    if (!baseline) {
      throw buildLogicalTariffMissingError(input.providerId, input.name);
    }

    if (input.effectiveFrom.getTime() <= baseline.valid_from.getTime()) {
      throw new Error('effectiveFrom must be after the current baseline start date');
    }

    const conflictingVersion = findFirstVersionStartingWithin(versions, input.effectiveFrom);

    if (conflictingVersion) {
      throw new Error(
        `Cannot schedule tariff change because version starting ${formatUtcDate(conflictingVersion.valid_from)} already exists`
      );
    }

    const now = new Date();
    const successor = buildPlanFromIdentityAndPrices(
      {
        userId: input.userId,
        providerId: input.providerId,
        name: input.nextName,
      },
      input.prices,
      now,
      {
        valid_from: input.effectiveFrom,
        valid_to: Object.prototype.hasOwnProperty.call(input, 'validTo')
          ? input.validTo ?? null
          : baseline.valid_to ?? null,
        affiliation: input.affiliation ?? baseline.affiliation,
        notes: input.notes ?? baseline.notes,
      }
    );

    const destinationVersions = sortPlansByStartDate(
      (await loadLogicalVersionsFromTable(
        db.charging_plans,
        input.userId,
        input.providerId,
        input.nextName
      )).filter((version) => !versions.some((source) => source.id === version.id))
    );
    const overlappingDestination = destinationVersions.find((destination) => (
      periodsOverlap(successor.valid_from, successor.valid_to, destination.valid_from, destination.valid_to)
    ));

    if (overlappingDestination) {
      throw new Error(
        `Tariff identity overlaps an existing active logical tariff for ${getLogicalTariffKey({
          provider_id: input.providerId,
          name: input.nextName
        })}`
      );
    }

    const closedBaseline: ChargingPlan = {
      ...baseline,
      valid_to: input.effectiveFrom,
      updated_at: now
    };

    validatePlan(closedBaseline);
    validatePlan(successor);

    await putPlanAndQueue(db.charging_plans, db.sync_outbox, closedBaseline, 'UPDATE', now);
    await putPlanAndQueue(db.charging_plans, db.sync_outbox, successor, 'INSERT', now);
  });
}

export async function updateLogicalTariffDetails(
  input: UpdateLogicalTariffDetailsInput
): Promise<void> {
  await db.transaction('rw', db.charging_plans, db.provider_plan_selections, db.sync_outbox, async () => {
    const sourceVersions = await loadLogicalVersionsFromTable(
      db.charging_plans,
      input.userId,
      input.providerId,
      input.name
    );

    if (sourceVersions.length === 0) {
      return;
    }

    const destinationVersions = sortPlansByStartDate(
      (await loadLogicalVersionsFromTable(
        db.charging_plans,
        input.userId,
        input.nextProviderId,
        input.nextName
      )).filter((version) => !sourceVersions.some((source) => source.id === version.id))
    );

    assertNoLogicalIdentityOverlap(
      sourceVersions,
      destinationVersions,
      { providerId: input.nextProviderId, name: input.nextName }
    );

    const now = new Date();
    const nextName = trimPlanName(input.nextName);
    const shouldUpdateAffiliation = Object.prototype.hasOwnProperty.call(input, 'affiliation');
    const shouldUpdateNotes = Object.prototype.hasOwnProperty.call(input, 'notes');
    const updatedVersions = sourceVersions.map((version) => ({
      ...version,
      provider_id: input.nextProviderId,
      name: nextName,
      affiliation: shouldUpdateAffiliation ? input.affiliation : version.affiliation,
      notes: shouldUpdateNotes ? input.notes : version.notes,
      updated_at: now
    }));

    updatedVersions.forEach(validatePlan);

    for (const version of updatedVersions) {
      await putPlanAndQueue(db.charging_plans, db.sync_outbox, version, 'UPDATE', now);
    }

    if (input.nextProviderId !== input.providerId) {
      const sourceVersionIds = sourceVersions.map((version) => version.id);
      const linkedSelections = await db.provider_plan_selections
        .where('tariff_plan_id')
        .anyOf(sourceVersionIds)
        .filter((selection) => selection.user_id === input.userId && !selection.deleted_at)
        .toArray();

      for (const selection of linkedSelections) {
        await putSelectionAndQueue(
          db.provider_plan_selections,
          db.sync_outbox,
          {
            ...selection,
            provider_id: input.nextProviderId,
            updated_at: now
          },
          'UPDATE',
          now
        );
      }
    }
  });
}

export async function deleteLogicalTariff(input: LogicalTariffIdentityInput): Promise<void> {
  await db.transaction('rw', db.charging_plans, db.provider_plan_selections, db.sync_outbox, async () => {
    const versions = await loadLogicalVersionsFromTable(
      db.charging_plans,
      input.userId,
      input.providerId,
      input.name
    );

    if (versions.length === 0) {
      return;
    }

    const now = new Date();
    const sourceVersionIds = versions.map((version) => version.id);
    const deletedVersions = versions.map((version) => ({
      ...version,
      deleted_at: now,
      updated_at: now
    }));

    const linkedSelections = await db.provider_plan_selections
      .where('tariff_plan_id')
      .anyOf(sourceVersionIds)
      .filter((selection) => selection.user_id === input.userId && !selection.deleted_at)
      .toArray();

    for (const selection of linkedSelections) {
      await putSelectionAndQueue(
        db.provider_plan_selections,
        db.sync_outbox,
        {
          ...selection,
          deleted_at: now,
          updated_at: now
        },
        'DELETE',
        now
      );
    }

    for (const version of deletedVersions) {
      await putPlanAndQueue(db.charging_plans, db.sync_outbox, version, 'DELETE', now, { validate: false });
    }
  });
}
