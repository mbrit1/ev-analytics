import { describe, expect, it } from 'vitest';
import type { ChargingPlan } from '../../../infra/db';
import {
  assertNoLogicalIdentityOverlap,
  assertNoLogicalTimelineOverlap,
  assertNoPaidTariffOverlap,
  evaluateProviderRebindTariffConflicts,
  PaidTariffOverlapError,
  periodsOverlap,
} from './chargingPlanInvariants';

const utc = (date: string): Date => new Date(`${date}T00:00:00.000Z`);

const buildPlan = (overrides: Partial<ChargingPlan> = {}): ChargingPlan => ({
  id: 'plan-1',
  user_id: 'user-1',
  provider_id: 'provider-1',
  name: 'Base plan',
  valid_from: utc('2026-01-01'),
  valid_to: null,
  monthly_base_fee: 0,
  session_fee: 0,
  ac_price_per_kwh: 49,
  created_at: utc('2026-01-01'),
  updated_at: utc('2026-01-01'),
  ...overrides,
});

/** Test suite for the canonical charging-plan timeline invariants. */
describe('chargingPlanInvariants', () => {
  it('treats adjacent half-open intervals as non-overlapping', () => {
    // Arrange: Build two UTC intervals that meet at exactly one boundary.
    const leftStart = utc('2026-01-01');
    const boundary = utc('2026-02-01');

    // Act: Compare the adjoining intervals.
    const overlap = periodsOverlap(leftStart, boundary, boundary, null);

    // Assert: The shared boundary belongs only to the right-hand interval.
    expect(overlap).toBe(false);
  });

  it('retains the logical-timeline overlap error for active versions', () => {
    // Arrange: Build overlapping versions of the same logical tariff.
    const current = buildPlan({ id: 'current', valid_to: utc('2026-03-01') });
    const overlapping = buildPlan({ id: 'overlapping', valid_from: utc('2026-02-01') });

    // Act and assert: Existing user-facing validation copy remains unchanged.
    expect(() => assertNoLogicalTimelineOverlap([current, overlapping]))
      .toThrow('Tariff validity overlaps with an existing active version for this provider and name');
  });

  it('retains the typed paid-tariff conflict with its affected plan', () => {
    // Arrange: Build overlapping paid intervals for one provider.
    const candidate = buildPlan({ id: 'candidate', monthly_base_fee: 499, valid_from: utc('2026-02-01') });
    const incumbent = buildPlan({ id: 'incumbent', monthly_base_fee: 299, valid_to: utc('2026-03-01') });

    // Act: Evaluate the conflicting provider timeline.
    let thrown: unknown;
    try {
      assertNoPaidTariffOverlap([candidate], [incumbent]);
    } catch (error) {
      thrown = error;
    }

    // Assert: The error keeps both its type and actionable conflict row.
    expect(thrown).toBeInstanceOf(PaidTariffOverlapError);
    expect((thrown as PaidTariffOverlapError).conflicts).toEqual([incumbent]);
  });

  it('retains the destination logical identity in an overlap error', () => {
    // Arrange: Build source and destination timelines that overlap after a rebind.
    const source = buildPlan({ id: 'source', valid_to: utc('2026-04-01') });
    const destination = buildPlan({ id: 'destination', valid_from: utc('2026-03-01') });

    // Act and assert: The error preserves the destination identity detail.
    expect(() => assertNoLogicalIdentityOverlap(
      [source],
      [destination],
      { providerId: 'provider-2', name: ' Destination ' },
    )).toThrow('Tariff identity overlaps an existing active logical tariff for provider-2::destination');
  });

  it('accepts disjoint staged and canonical timelines after the provider rebind', () => {
    // Arrange: Build adjoining versions of one normalized logical tariff.
    const canonical = buildPlan({
      id: 'canonical',
      provider_id: 'canonical-provider',
      name: 'City',
      valid_to: utc('2026-02-01'),
    });
    const staged = buildPlan({
      id: 'staged',
      provider_id: 'staged-provider',
      name: ' city ',
      valid_from: utc('2026-02-01'),
    });

    // Act: Inspect the combined post-rebind timeline.
    const result = evaluateProviderRebindTariffConflicts({
      stagedPlans: [staged],
      canonicalPlans: [canonical],
    });

    // Assert: The shared half-open boundary remains safe.
    expect(result).toEqual({ kind: 'safe' });
  });

  it('reports a staged same-name overlap with structured affected plan details', () => {
    // Arrange: Build an overlapping normalized tariff identity across providers.
    const canonical = buildPlan({
      id: 'canonical',
      provider_id: 'canonical-provider',
      name: 'City',
      valid_to: utc('2026-03-01'),
    });
    const staged = buildPlan({
      id: 'staged',
      provider_id: 'staged-provider',
      name: ' city ',
      valid_from: utc('2026-02-01'),
    });

    // Act: Inspect the combined post-rebind timeline.
    const result = evaluateProviderRebindTariffConflicts({
      stagedPlans: [staged],
      canonicalPlans: [canonical],
    });

    // Assert: The conflict carries field-addressable dates and identities.
    expect(result).toEqual({
      kind: 'logical-tariff-overlap',
      affectedPlans: [
        {
          id: 'canonical',
          name: 'City',
          validFrom: utc('2026-01-01'),
          validTo: utc('2026-03-01'),
          source: 'canonical',
        },
        {
          id: 'staged',
          name: ' city ',
          validFrom: utc('2026-02-01'),
          validTo: null,
          source: 'staged',
        },
      ],
    });
  });

  it('reports a staged paid-tariff overlap across different tariff names', () => {
    // Arrange: Build overlapping paid plans that do not share a logical identity.
    const canonical = buildPlan({
      id: 'canonical-paid',
      provider_id: 'canonical-provider',
      name: 'Premium',
      monthly_base_fee: 999,
      valid_to: utc('2026-03-01'),
    });
    const staged = buildPlan({
      id: 'staged-paid',
      provider_id: 'staged-provider',
      name: 'Member',
      monthly_base_fee: 499,
      valid_from: utc('2026-02-01'),
    });

    // Act: Inspect the combined post-rebind timeline.
    const result = evaluateProviderRebindTariffConflicts({
      stagedPlans: [staged],
      canonicalPlans: [canonical],
    });

    // Assert: Paid overlap remains distinct from logical-tariff overlap.
    expect(result).toEqual({
      kind: 'paid-tariff-overlap',
      affectedPlans: [
        {
          id: 'canonical-paid',
          name: 'Premium',
          validFrom: utc('2026-01-01'),
          validTo: utc('2026-03-01'),
          source: 'canonical',
        },
        {
          id: 'staged-paid',
          name: 'Member',
          validFrom: utc('2026-02-01'),
          validTo: null,
          source: 'staged',
        },
      ],
    });
  });

  it('reports exact staged and canonical duplicates without merging either row', () => {
    // Arrange: Build two distinct row IDs with the same tariff interval and prices.
    const canonical = buildPlan({
      id: 'canonical-duplicate',
      provider_id: 'canonical-provider',
      name: 'City',
      valid_to: utc('2026-03-01'),
      ac_price_per_kwh: 39,
    });
    const staged = buildPlan({
      id: 'staged-duplicate',
      provider_id: 'staged-provider',
      name: ' city ',
      valid_to: utc('2026-03-01'),
      ac_price_per_kwh: 39,
    });

    // Act: Inspect the combined post-rebind timeline.
    const result = evaluateProviderRebindTariffConflicts({
      stagedPlans: [staged],
      canonicalPlans: [canonical],
    });

    // Assert: Exact duplicates are surfaced as an explicit ambiguity.
    expect(result).toEqual({
      kind: 'logical-tariff-overlap',
      reason: 'exact-duplicate',
      affectedPlans: [
        {
          id: 'canonical-duplicate',
          name: 'City',
          validFrom: utc('2026-01-01'),
          validTo: utc('2026-03-01'),
          source: 'canonical',
        },
        {
          id: 'staged-duplicate',
          name: ' city ',
          validFrom: utc('2026-01-01'),
          validTo: utc('2026-03-01'),
          source: 'staged',
        },
      ],
    });
  });

  it('ignores soft-deleted rows when evaluating the rebind union', () => {
    // Arrange: Build an otherwise conflicting canonical row that is soft-deleted.
    const canonical = buildPlan({
      id: 'deleted-canonical',
      provider_id: 'canonical-provider',
      name: 'City',
      deleted_at: utc('2026-01-15'),
    });
    const staged = buildPlan({
      id: 'staged',
      provider_id: 'staged-provider',
      name: ' city ',
    });

    // Act: Inspect the combined post-rebind timeline.
    const result = evaluateProviderRebindTariffConflicts({
      stagedPlans: [staged],
      canonicalPlans: [canonical],
    });

    // Assert: Deleted history is retained but does not block the rebind.
    expect(result).toEqual({ kind: 'safe' });
  });

  it('reports canonical-only conflicts as remote integrity failures', () => {
    // Arrange: Build an already-invalid canonical timeline with no staged conflict.
    const canonicalFirst = buildPlan({
      id: 'canonical-first',
      provider_id: 'canonical-provider',
      name: 'City',
      valid_to: utc('2026-03-01'),
    });
    const canonicalSecond = buildPlan({
      id: 'canonical-second',
      provider_id: 'canonical-provider',
      name: ' city ',
      valid_from: utc('2026-02-01'),
    });

    // Act: Inspect the canonical graph together with an unrelated staged tariff.
    const result = evaluateProviderRebindTariffConflicts({
      stagedPlans: [buildPlan({ id: 'staged', name: 'Member', provider_id: 'staged-provider' })],
      canonicalPlans: [canonicalFirst, canonicalSecond],
    });

    // Assert: The result distinguishes remote corruption from staged repair work.
    expect(result).toEqual({
      kind: 'remote-integrity',
      reason: 'logical-tariff-overlap',
      affectedPlans: [
        {
          id: 'canonical-first',
          name: 'City',
          validFrom: utc('2026-01-01'),
          validTo: utc('2026-03-01'),
          source: 'canonical',
        },
        {
          id: 'canonical-second',
          name: ' city ',
          validFrom: utc('2026-02-01'),
          validTo: null,
          source: 'canonical',
        },
      ],
    });
  });
});
