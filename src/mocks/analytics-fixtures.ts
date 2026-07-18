/** Development-only Overall Price scenarios used for deterministic browser QA. */
export type OverallPriceMockScenario =
  | 'ready'
  | 'empty'
  | 'missing-history'
  | 'overlap'

interface FixturePlan {
  id: string
  provider_id: string
  monthly_base_fee: number
}

interface FixtureSession {
  id: string
  tariff_plan_id: string | null
  session_mode: string
}

/** Preserves the data shapes consumed by the local MSW handlers. */
export interface OverallPriceMockFixture<Plan extends FixturePlan, Session extends FixtureSession> {
  chargingPlans: readonly Plan[]
  sessions: readonly Session[]
}

/**
 * Selects a local mock profile without adding runtime controls to the product.
 *
 * The default ready profile deliberately returns the existing general-purpose
 * mock data so ordinary development behavior does not change.
 */
export function selectOverallPriceMockFixture<Plan extends FixturePlan, Session extends FixtureSession>(
  scenario: string | undefined,
  defaults: OverallPriceMockFixture<Plan, Session>,
): OverallPriceMockFixture<Plan, Session> {
  if (scenario === 'empty') {
    return { chargingPlans: defaults.chargingPlans, sessions: [] }
  }

  if (scenario === 'missing-history') {
    const sourceSession = defaults.sessions.find((session) => session.session_mode === 'plan')
    if (!sourceSession) {
      return { chargingPlans: [], sessions: [] }
    }

    return {
      chargingPlans: [],
      sessions: [{
        ...sourceSession,
        id: 'session-overall-missing-history',
        tariff_plan_id: 'missing-overall-price-plan',
        session_mode: 'plan',
      }],
    }
  }

  if (scenario === 'overlap') {
    const unpaidPlan = defaults.chargingPlans.find((plan) => (
      plan.monthly_base_fee === 0
      && defaults.chargingPlans.some((candidate) => (
        candidate.provider_id === plan.provider_id && candidate.monthly_base_fee > 0
      ))
    ))
    const paidPlan = unpaidPlan && defaults.chargingPlans.find((plan) => (
      plan.provider_id === unpaidPlan.provider_id && plan.monthly_base_fee > 0
    ))
    if (!paidPlan || !unpaidPlan) {
      return defaults
    }

    return {
      chargingPlans: defaults.chargingPlans.map((plan) => (
        plan.id === unpaidPlan.id
          ? { ...plan, monthly_base_fee: paidPlan.monthly_base_fee }
          : plan
      )),
      sessions: defaults.sessions,
    }
  }

  return defaults
}
