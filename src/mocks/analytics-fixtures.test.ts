import { describe, expect, it } from 'vitest'
import { selectOverallPriceMockFixture } from './analytics-fixtures'

const chargingPlans = [
  { id: 'plan-other-provider', provider_id: 'provider-2', name: 'Other', monthly_base_fee: 999 },
  { id: 'plan-ready', provider_id: 'provider-1', name: 'Ready', monthly_base_fee: 0 },
  { id: 'plan-overlap', provider_id: 'provider-1', name: 'Overlap', monthly_base_fee: 499 },
]

const sessions = [
  { id: 'session-ready', tariff_plan_id: 'plan-ready', session_mode: 'plan' },
  { id: 'session-overlap', tariff_plan_id: 'plan-overlap', session_mode: 'plan' },
]

/**
 * Test suite for local mock-mode Overall Price scenario selection.
 *
 * Guards the dedicated runtime fixture path without introducing shipped UI or
 * changing the ordinary mock dataset used for local development.
 */
describe('selectOverallPriceMockFixture', () => {
  it('keeps the ordinary mock dataset for the ready scenario', () => {
    // Arrange / Act: Select the explicit ready profile.
    const fixture = selectOverallPriceMockFixture('ready', { chargingPlans, sessions })

    // Assert: Existing local mock behavior remains unchanged.
    expect(fixture.chargingPlans).toEqual(chargingPlans)
    expect(fixture.sessions).toEqual(sessions)
  })

  it('removes sessions for the empty scenario', () => {
    // Arrange / Act: Select the no-session profile.
    const fixture = selectOverallPriceMockFixture('empty', { chargingPlans, sessions })

    // Assert: Fixed-cost records remain available but no session can qualify them.
    expect(fixture.chargingPlans).toEqual(chargingPlans)
    expect(fixture.sessions).toEqual([])
  })

  it('returns only an unresolved plan session for missing history', () => {
    // Arrange / Act: Select the explicit missing-history profile.
    const fixture = selectOverallPriceMockFixture('missing-history', { chargingPlans, sessions })

    // Assert: The calculator receives an active plan reference absent from returned history.
    expect(fixture.chargingPlans).toEqual([])
    expect(fixture.sessions).toEqual([
      expect.objectContaining({
        id: 'session-overall-missing-history',
        tariff_plan_id: 'missing-overall-price-plan',
        session_mode: 'plan',
      }),
    ])
  })

  it('makes both qualifying same-provider tariffs paid for the overlap scenario', () => {
    // Arrange / Act: Select the conflict profile.
    const fixture = selectOverallPriceMockFixture('overlap', { chargingPlans, sessions })

    // Assert: The existing session references remain while the first tariff becomes paid.
    expect(fixture.sessions).toEqual(sessions)
    expect(fixture.chargingPlans).toEqual([
      expect.objectContaining({ id: 'plan-other-provider', monthly_base_fee: 999 }),
      expect.objectContaining({ id: 'plan-ready', monthly_base_fee: 499 }),
      expect.objectContaining({ id: 'plan-overlap', monthly_base_fee: 499 }),
    ])
  })
})
