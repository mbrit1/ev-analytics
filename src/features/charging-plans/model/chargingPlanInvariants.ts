import type { ChargingPlan } from '../../../infra/db';
import { getLogicalTariffKey, normalizeTariffName } from './logicalTariffs';

/** Identifies the destination logical tariff for an identity rebind check. */
export interface LogicalTariffDestinationIdentity {
  providerId: string;
  name: string;
}

/** A field-addressable plan involved in a provider-rebind tariff conflict. */
export interface ProviderRebindTariffAffectedPlan {
  id: string;
  name: string;
  validFrom: Date;
  validTo: Date | null;
  source: 'staged' | 'canonical';
}

/** A normalized logical tariff timeline conflict introduced by a provider rebind. */
export interface ProviderRebindLogicalTariffOverlap {
  kind: 'logical-tariff-overlap';
  reason?: 'exact-duplicate';
  affectedPlans: readonly ProviderRebindTariffAffectedPlan[];
}

/** A positive-monthly-fee tariff conflict introduced by a provider rebind. */
export interface ProviderRebindPaidTariffOverlap {
  kind: 'paid-tariff-overlap';
  affectedPlans: readonly ProviderRebindTariffAffectedPlan[];
}

/** An invalid conflict already present entirely in the canonical remote graph. */
export interface ProviderRebindRemoteIntegrityConflict {
  kind: 'remote-integrity';
  reason: 'exact-duplicate' | 'logical-tariff-overlap' | 'paid-tariff-overlap';
  affectedPlans: readonly ProviderRebindTariffAffectedPlan[];
}

/** The safe or blocked outcome of a proposed provider rebind's tariff union. */
export type ProviderRebindTariffConflictResult =
  | { kind: 'safe' }
  | ProviderRebindLogicalTariffOverlap
  | ProviderRebindPaidTariffOverlap
  | ProviderRebindRemoteIntegrityConflict;

interface SourcedChargingPlan {
  plan: ChargingPlan;
  source: 'staged' | 'canonical';
}

/** Describes provider-level paid tariff intervals that cannot coexist. */
export class PaidTariffOverlapError extends Error {
  public readonly candidate: ChargingPlan;
  public readonly conflicts: readonly ChargingPlan[];

  constructor(
    candidate: ChargingPlan,
    conflicts: readonly ChargingPlan[],
  ) {
    super('Paid tariff validity overlaps with another active paid tariff for this provider');
    this.name = 'PaidTariffOverlapError';
    this.candidate = candidate;
    this.conflicts = conflicts;
  }
}

const dateToComparableMs = (value: Date | null | undefined): number => {
  if (value == null) return Number.POSITIVE_INFINITY;
  return value.getTime();
};

/** Returns whether two half-open UTC plan intervals overlap. */
export const periodsOverlap = (
  leftStart: Date,
  leftEnd: Date | null | undefined,
  rightStart: Date,
  rightEnd: Date | null | undefined,
): boolean => {
  return leftStart.getTime() < dateToComparableMs(rightEnd)
    && rightStart.getTime() < dateToComparableMs(leftEnd);
};

const sameOptionalDate = (
  left: Date | null | undefined,
  right: Date | null | undefined,
): boolean => dateToComparableMs(left) === dateToComparableMs(right);

const isExactTariffDuplicate = (left: ChargingPlan, right: ChargingPlan): boolean => (
  normalizeTariffName(left.name) === normalizeTariffName(right.name)
  && left.valid_from.getTime() === right.valid_from.getTime()
  && sameOptionalDate(left.valid_to, right.valid_to)
  && left.ac_price_per_kwh === right.ac_price_per_kwh
  && left.dc_price_per_kwh === right.dc_price_per_kwh
  && left.roaming_ac_price_per_kwh === right.roaming_ac_price_per_kwh
  && left.roaming_dc_price_per_kwh === right.roaming_dc_price_per_kwh
  && left.monthly_base_fee === right.monthly_base_fee
  && left.session_fee === right.session_fee
  && left.affiliation === right.affiliation
  && left.notes === right.notes
);

const toAffectedPlan = ({ plan, source }: SourcedChargingPlan): ProviderRebindTariffAffectedPlan => ({
  id: plan.id,
  name: plan.name,
  validFrom: new Date(plan.valid_from),
  validTo: plan.valid_to == null ? null : new Date(plan.valid_to),
  source,
});

const findTariffConflict = (
  plans: readonly SourcedChargingPlan[],
  includePair: (left: SourcedChargingPlan, right: SourcedChargingPlan) => boolean,
): { reason: 'exact-duplicate' | 'logical-tariff-overlap' | 'paid-tariff-overlap'; plans: readonly SourcedChargingPlan[] } | null => {
  const activePlans = plans.filter(({ plan }) => !plan.deleted_at);

  for (let leftIndex = 0; leftIndex < activePlans.length; leftIndex += 1) {
    const left = activePlans[leftIndex];

    for (const right of activePlans.slice(leftIndex + 1)) {
      if (!includePair(left, right) || !periodsOverlap(
        left.plan.valid_from,
        left.plan.valid_to,
        right.plan.valid_from,
        right.plan.valid_to,
      )) {
        continue;
      }

      if (isExactTariffDuplicate(left.plan, right.plan)) {
        return { reason: 'exact-duplicate', plans: [left, right] };
      }

      if (normalizeTariffName(left.plan.name) === normalizeTariffName(right.plan.name)) {
        return { reason: 'logical-tariff-overlap', plans: [left, right] };
      }

      if (left.plan.monthly_base_fee > 0 && right.plan.monthly_base_fee > 0) {
        return { reason: 'paid-tariff-overlap', plans: [left, right] };
      }
    }
  }

  return null;
};

/**
 * Validates the complete post-rebind tariff union without mutating either graph.
 *
 * Conflicts wholly inside the canonical graph are reported as remote integrity
 * failures; every other conflict identifies staged tariff repair work.
 */
export function evaluateProviderRebindTariffConflicts(input: {
  stagedPlans: readonly ChargingPlan[];
  canonicalPlans: readonly ChargingPlan[];
}): ProviderRebindTariffConflictResult {
  const canonicalPlans = input.canonicalPlans.map((plan) => ({ plan, source: 'canonical' as const }));
  const stagedPlans = input.stagedPlans.map((plan) => ({ plan, source: 'staged' as const }));
  const canonicalConflict = findTariffConflict(canonicalPlans, () => true);

  if (canonicalConflict) {
    return {
      kind: 'remote-integrity',
      reason: canonicalConflict.reason,
      affectedPlans: canonicalConflict.plans.map(toAffectedPlan),
    };
  }

  const rebindConflict = findTariffConflict(
    [...canonicalPlans, ...stagedPlans],
    (left, right) => left.source === 'staged' || right.source === 'staged',
  );

  if (!rebindConflict) {
    return { kind: 'safe' };
  }

  if (rebindConflict.reason === 'paid-tariff-overlap') {
    return {
      kind: 'paid-tariff-overlap',
      affectedPlans: rebindConflict.plans.map(toAffectedPlan),
    };
  }

  return {
    kind: 'logical-tariff-overlap',
    ...(rebindConflict.reason === 'exact-duplicate' ? { reason: 'exact-duplicate' as const } : {}),
    affectedPlans: rebindConflict.plans.map(toAffectedPlan),
  };
}

/** Rejects overlapping non-deleted versions of one logical tariff. */
export function assertNoLogicalTimelineOverlap(versions: readonly ChargingPlan[]): void {
  const activeVersions = versions.filter((version) => !version.deleted_at);

  for (let index = 0; index < activeVersions.length; index += 1) {
    const candidate = activeVersions[index];

    if (activeVersions.slice(index + 1).some((other) => (
      periodsOverlap(candidate.valid_from, candidate.valid_to, other.valid_from, other.valid_to)
    ))) {
      throw new Error('Tariff validity overlaps with an existing active version for this provider and name');
    }
  }
}

/** Rejects overlapping positive-monthly-fee plans within one provider. */
export function assertNoPaidTariffOverlap(
  candidateVersions: readonly ChargingPlan[],
  existingProviderVersions: readonly ChargingPlan[],
): void {
  const candidateIds = new Set(candidateVersions.map((candidate) => candidate.id));
  const retainedVersions = existingProviderVersions.filter((existing) => !candidateIds.has(existing.id));

  for (const candidate of candidateVersions) {
    if (candidate.deleted_at || candidate.monthly_base_fee <= 0) {
      continue;
    }

    const conflicts = [...retainedVersions, ...candidateVersions].filter((existing) => (
      existing.id !== candidate.id
      && !existing.deleted_at
      && existing.user_id === candidate.user_id
      && existing.provider_id === candidate.provider_id
      && existing.monthly_base_fee > 0
      && periodsOverlap(
        candidate.valid_from,
        candidate.valid_to,
        existing.valid_from,
        existing.valid_to,
      )
    ));

    if (conflicts.length > 0) {
      throw new PaidTariffOverlapError(candidate, conflicts);
    }
  }
}

/** Rejects a timeline whose versions overlap an existing destination identity. */
export function assertNoLogicalIdentityOverlap(
  sourceVersions: readonly ChargingPlan[],
  destinationVersions: readonly ChargingPlan[],
  destinationIdentity: LogicalTariffDestinationIdentity,
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
        name: destinationIdentity.name,
      })}`
    );
  }
}
