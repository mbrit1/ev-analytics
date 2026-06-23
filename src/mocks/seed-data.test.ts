import { describe, expect, it } from 'vitest';
import { buildLogicalTariffs } from '../features/charging-plans';
import { type ChargingPlan } from '../infra/db';
import { mockChargingPlans, mockSessions } from './seed-data';

/**
 * Test suite for mock seed data coverage.
 *
 * Verifies the fixture set includes representative pricing gaps for the
 * session form as well as plan, roaming, and ad-hoc session history states.
 */
describe('seed-data', () => {
  function parseMockDate(value: Date | string | null | undefined): Date | undefined {
    if (value == null) {
      return undefined;
    }

    return value instanceof Date ? value : new Date(value);
  }

  function toLogicalTariffPlans(): ChargingPlan[] {
    return mockChargingPlans.map((plan) => ({
      ...plan,
      valid_from: parseMockDate(plan.valid_from) ?? new Date(),
      valid_to: parseMockDate(plan.valid_to) ?? null,
      roaming_ac_price_per_kwh: plan.roaming_ac_price_per_kwh ?? undefined,
      roaming_dc_price_per_kwh: plan.roaming_dc_price_per_kwh ?? undefined,
      affiliation: plan.affiliation ?? undefined,
      notes: plan.notes ?? undefined,
      created_at: parseMockDate(plan.created_at) ?? new Date(),
      updated_at: parseMockDate(plan.updated_at) ?? new Date(),
    }));
  }

  function buildPricingAvailability(plan: (typeof mockChargingPlans)[number]) {
    return {
      AC: {
        standard: plan.ac_price_per_kwh != null,
        roaming: plan.roaming_ac_price_per_kwh != null,
      },
      DC: {
        standard: plan.dc_price_per_kwh != null,
        roaming: plan.roaming_dc_price_per_kwh != null,
      }
    };
  }

  it('covers every supported and unsupported tariff pricing combination used by the session form', () => {
    // Arrange: Define the expected availability matrix for the seeded plans.
    const expectedAvailability = {
      cp1: {
        AC: { standard: true, roaming: false },
        DC: { standard: true, roaming: false }
      },
      cp2: {
        AC: { standard: true, roaming: true },
        DC: { standard: true, roaming: true }
      },
      cp6: {
        AC: { standard: true, roaming: true },
        DC: { standard: true, roaming: true }
      },
      cp3: {
        AC: { standard: false, roaming: true },
        DC: { standard: false, roaming: true }
      },
      cp4: {
        AC: { standard: false, roaming: false },
        DC: { standard: true, roaming: true }
      },
      cp5: {
        AC: { standard: true, roaming: true },
        DC: { standard: false, roaming: false }
      },
      cp7: {
        AC: { standard: true, roaming: false },
        DC: { standard: false, roaming: true }
      },
      cp8: {
        AC: { standard: false, roaming: true },
        DC: { standard: true, roaming: false }
      },
    };

    // Act: Derive the current fixture availability matrix from the seed data.
    const actualAvailability = Object.fromEntries(
      mockChargingPlans.map((plan) => [plan.id, buildPricingAvailability(plan)])
    );

    // Assert: Each seeded plan drives a distinct session-form availability case.
    expect(actualAvailability).toMatchObject(expectedAvailability);
  });

  it('includes a provider with multiple active plans for the session dropdown smoke path', () => {
    // Arrange: Group seeded plans by provider id.
    const planCountsByProvider = mockChargingPlans.reduce<Record<string, number>>((counts, plan) => {
      counts[plan.provider_id] = (counts[plan.provider_id] ?? 0) + 1;
      return counts;
    }, {});

    // Assert: The fixture set contains at least one one-plan provider and one multi-plan provider.
    expect(planCountsByProvider.p1).toBe(1);
    expect(planCountsByProvider.p2).toBe(2);
    expect(planCountsByProvider.p6).toBe(2);
  });

  it('includes a provider with complementary null pricing across multiple plans', () => {
    // Arrange: Pick the seeded plans for the mixed-null provider.
    const mixedNullPlans = mockChargingPlans.filter((plan) => plan.provider_id === 'p6');

    // Act: Derive the nullability profile for each plan.
    const profileByPlan = Object.fromEntries(
      mixedNullPlans.map((plan) => [
        plan.id,
        {
          AC: {
            standard: plan.ac_price_per_kwh != null,
            roaming: plan.roaming_ac_price_per_kwh != null,
          },
          DC: {
            standard: plan.dc_price_per_kwh != null,
            roaming: plan.roaming_dc_price_per_kwh != null,
          },
        },
      ])
    );

    // Assert: The provider exposes two distinct, complementary pricing shapes for AC/DC and roaming.
    expect(profileByPlan.cp7).toEqual({
      AC: { standard: true, roaming: false },
      DC: { standard: false, roaming: true },
    });
    expect(profileByPlan.cp8).toEqual({
      AC: { standard: false, roaming: true },
      DC: { standard: true, roaming: false },
    });
  });

  it('includes representative plan, roaming, and ad-hoc session histories', () => {
    // Arrange: Read the seeded session modes and pricing contexts.
    const sessionModes = Array.from(new Set(mockSessions.map((session) => session.session_mode))).sort();
    const pricingContexts = Array.from(new Set(mockSessions.map((session) => session.pricing_context))).sort();

    // Act: No additional transformation is needed because the seed data is the fixture under test.

    // Assert: History data covers the major session states rendered by the UI.
    expect(sessionModes).toEqual(['ad_hoc', 'plan']);
    expect(pricingContexts).toEqual(['ad_hoc', 'roaming', 'standard']);
  });

  it('includes two plan sessions whose tariffs expose different domestic and roaming prices', () => {
    // Arrange: Join seeded plan sessions back to their mocked tariff versions.
    const sessionsWithTariffs = mockSessions.flatMap((session) => {
      if (!session.tariff_plan_id || session.session_mode !== 'plan') {
        return [];
      }

      const plan = mockChargingPlans.find((candidate) => candidate.id === session.tariff_plan_id);
      if (!plan) {
        return [];
      }

      return [{ session, plan }];
    });

    // Act: Keep only plan sessions whose tariff exposes both domestic and roaming
    // prices for the saved charging type and where those two prices differ.
    const differingPlanSessions = sessionsWithTariffs.filter(({ session, plan }) => {
      if (session.charging_type === 'AC') {
        return plan.ac_price_per_kwh != null
          && plan.roaming_ac_price_per_kwh != null
          && plan.ac_price_per_kwh !== plan.roaming_ac_price_per_kwh;
      }

      return plan.dc_price_per_kwh != null
        && plan.roaming_dc_price_per_kwh != null
        && plan.dc_price_per_kwh !== plan.roaming_dc_price_per_kwh;
    });
    const differingPricingContexts = Array.from(
      new Set(differingPlanSessions.map(({ session }) => session.pricing_context))
    ).sort();

    // Assert: The browser mock data always includes both standard and roaming
    // examples on tariffs where the two prices truly differ.
    expect(differingPlanSessions.length).toBeGreaterThanOrEqual(2);
    expect(differingPricingContexts).toEqual(['roaming', 'standard']);
  });

  it('includes an active promotion tariff and a session priced against that promo version', () => {
    // Arrange: Build logical tariffs for the current UTC day.
    const today = new Date();
    const currentUtcDay = new Date(Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate()
    ));

    // Act: Locate the active promo badge and any session saved against its raw version id.
    const promoTariff = buildLogicalTariffs(toLogicalTariffPlans(), currentUtcDay)
      .find((logicalTariff) => logicalTariff.badge?.kind === 'promo');
    const promoSession = mockSessions.find(
      (session) => session.tariff_plan_id === promoTariff?.currentVersion?.id
    );

    // Assert: Mock mode always exposes a live promotion badge and a matching session.
    expect(promoTariff?.badge?.kind).toBe('promo');
    expect(promoTariff?.currentVersion).not.toBeNull();
    expect(promoSession?.session_mode).toBe('plan');
  });

  it('uses distinct, newest-first session dates so history stays easy to inspect in mock mode', () => {
    // Arrange: Read the seeded timestamps as ISO strings.
    const sessionTimestamps = Object.fromEntries(
      mockSessions.map((session) => [session.id, session.session_timestamp])
    );

    // Act: Derive the unique set of seeded session dates and their sorted order.
    const uniqueTimestamps = new Set(mockSessions.map((session) => session.session_timestamp));
    const sortedTimestamps = [...mockSessions]
      .map((session) => session.session_timestamp)
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime());

    // Assert: Each mock session keeps a unique timestamp and the array is already
    // ordered newest-first for easy browser verification.
    expect(uniqueTimestamps.size).toBe(mockSessions.length);
    expect(Object.keys(sessionTimestamps)).toEqual(['s7', 's1', 's5', 's2', 's6', 's4', 's3']);
    expect(Object.values(sessionTimestamps)).toEqual(sortedTimestamps);
  });
});
