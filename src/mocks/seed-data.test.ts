import { describe, expect, it } from 'vitest';
import { mockChargingPlans, mockSessions } from './seed-data';

/**
 * Test suite for mock seed data coverage.
 *
 * Verifies the fixture set includes representative pricing gaps for the
 * session form as well as plan, roaming, and ad-hoc session history states.
 */
describe('seed-data', () => {
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
});
