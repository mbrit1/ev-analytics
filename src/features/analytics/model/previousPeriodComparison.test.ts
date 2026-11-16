import { describe, expect, it } from 'vitest'
import type { ChargingSession } from '../../charging-sessions'
import { createAnalyticsPeriod, createPreviousAnalyticsPeriod } from './analyticsPeriods'
import { calculateMonthlySessionSpend } from './monthlySessionSpend'
import { comparePreviousPeriod } from './previousPeriodComparison'

function session(id: string, timestamp: Date, cost: number, kwh = 10, deleted = false): ChargingSession {
  return {
    id, user_id: 'user-1', session_timestamp: timestamp, session_mode: 'plan', provider_id: 'provider-1',
    tariff_plan_id: 'plan-1', provider_name_snapshot: 'Provider', charging_type: 'AC', kwh_billed: kwh,
    total_cost: cost, applied_session_fee: 0, created_at: timestamp, updated_at: timestamp,
    deleted_at: deleted ? new Date(timestamp.getTime() + 1) : undefined,
  }
}

function aggregate(sessions: ChargingSession[], startUtc: Date, endUtc: Date, complete = true) {
  return calculateMonthlySessionSpend(sessions, { startUtc, endUtc, isCurrentMonth: !complete, isCompleteMonth: complete })
}

/** Test suite for previous-period metric status and signed changes. */
describe('comparePreviousPeriod', () => {
  const now = new Date(2026, 5, 15, 12)
  const selection = { kind: 'month' as const, month: { year: 2026, month: 5 } }
  const currentPeriod = createAnalyticsPeriod(selection, now)
  const previousPeriod = createPreviousAnalyticsPeriod(selection, now)

  it('reports previous empty globally and never treats empty current data as free', () => {
    // Arrange: Previous aggregate has no sessions, current has one session.
    const previous = aggregate([], previousPeriod.startUtc, previousPeriod.endUtc)
    const current = aggregate([session('current', currentPeriod.startUtc, 500)], currentPeriod.startUtc, currentPeriod.endUtc, false)
    // Act: Compare both aggregates.
    expect(comparePreviousPeriod(current, previous, currentPeriod, previousPeriod).status).toBe('no-comparison-data')
    const emptyCurrent = aggregate([], currentPeriod.startUtc, currentPeriod.endUtc, false)
    const nonEmptyPrevious = aggregate([session('prior', previousPeriod.startUtc, 0)], previousPeriod.startUtc, previousPeriod.endUtc)
    // Assert: Empty current is unavailable rather than free.
    expect(comparePreviousPeriod(emptyCurrent, nonEmptyPrevious, currentPeriod, previousPeriod).spending.status).toBe('unavailable')
  })

  it('reports signed spending and energy percentages and a positive-to-free drop', () => {
    // Arrange: Current totals 600 cents / 20 kWh, previous 400 cents / 20 kWh.
    const current = aggregate([session('c1', currentPeriod.startUtc, 300), session('c2', new Date(2026, 5, 5), 300)], currentPeriod.startUtc, currentPeriod.endUtc, false)
    const previous = aggregate([session('p1', previousPeriod.startUtc, 200), session('p2', new Date(2026, 4, 5), 200)], previousPeriod.startUtc, previousPeriod.endUtc)
    // Act: Compare valid aggregates.
    const result = comparePreviousPeriod(current, previous, currentPeriod, previousPeriod)
    // Assert: Changes are signed and price difference is EUR/kWh.
    expect(result.spending).toEqual({ status: 'percentage', percentage: 50 })
    expect(result.energy).toEqual({ status: 'percentage', percentage: 0 })
    expect(result.priceDifferenceEurPerKwh).toBe(0.1)
    const freeCurrent = aggregate([session('free', currentPeriod.startUtc, 0)], currentPeriod.startUtc, currentPeriod.endUtc, false)
    expect(comparePreviousPeriod(freeCurrent, previous, currentPeriod, previousPeriod).spending).toEqual({ status: 'percentage', percentage: -100 })
    const zeroPrevious = aggregate([session('zero', previousPeriod.startUtc, 0)], previousPeriod.startUtc, previousPeriod.endUtc)
    expect(comparePreviousPeriod(current, zeroPrevious, currentPeriod, previousPeriod).spending).toEqual({ status: 'up-from-zero' })
  })

  it('distinguishes zero baselines, invalid metric coverage, and incomplete energy', () => {
    // Arrange: Both valid spending totals are zero, but energy is partly unavailable.
    const current = aggregate([session('c', currentPeriod.startUtc, 0, 5), session('cx', new Date(2026, 5, 4), 0, 0)], currentPeriod.startUtc, currentPeriod.endUtc, false)
    const previous = aggregate([session('p', previousPeriod.startUtc, 0, 5), session('px', new Date(2026, 4, 4), 0, 0)], previousPeriod.startUtc, previousPeriod.endUtc)
    // Act: Compare metrics independently.
    const result = comparePreviousPeriod(current, previous, currentPeriod, previousPeriod)
    // Assert: Valid zero spend is no change; partial energy and price are unavailable.
    expect(result.spending.status).toBe('no-change')
    expect(result.energy.status).toBe('unavailable')
    expect(result.priceDifferenceEurPerKwh).toBeNull()

    // Invalid costs suppress spending only; complete energy remains comparable.
    const invalidCost = aggregate([{ ...session('bad-cost', currentPeriod.startUtc, 100), total_cost: Number.NaN }], currentPeriod.startUtc, currentPeriod.endUtc, false)
    const energyValidPrevious = aggregate([session('energy-prior', previousPeriod.startUtc, 200, 10)], previousPeriod.startUtc, previousPeriod.endUtc)
    const invalidCostResult = comparePreviousPeriod(invalidCost, energyValidPrevious, currentPeriod, previousPeriod)
    expect(invalidCostResult.spending.status).toBe('unavailable')
    expect(invalidCostResult.energy).toEqual({ status: 'percentage', percentage: 0 })

    // Invalid energy on one side does not invalidate otherwise valid spending.
    const invalidEnergy = aggregate([session('bad-energy', previousPeriod.startUtc, 200, Number.NaN)], previousPeriod.startUtc, previousPeriod.endUtc)
    const independentMetrics = comparePreviousPeriod(current, invalidEnergy, currentPeriod, previousPeriod)
    expect(independentMetrics.spending).toEqual({ status: 'percentage', percentage: -100 })
    expect(independentMetrics.energy.status).toBe('unavailable')
  })

  it('suppresses only unequal current-month-to-date percentages', () => {
    // Arrange: 30 days of March compare with 28 prior days in non-leap 2026.
    const selection = { kind: 'month' as const, month: { year: 2026, month: 2 } }
    const currentPeriod = createAnalyticsPeriod(selection, new Date(2026, 2, 30, 12))
    const previousPeriod = createPreviousAnalyticsPeriod(selection, new Date(2026, 2, 30, 12))
    const current = aggregate([session('c', currentPeriod.startUtc, 100)], currentPeriod.startUtc, currentPeriod.endUtc, false)
    const previous = aggregate([session('p', previousPeriod.startUtc, 100)], previousPeriod.startUtc, previousPeriod.endUtc)
    // Act: Compare unequal MTD windows.
    const result = comparePreviousPeriod(current, previous, currentPeriod, previousPeriod)
    // Assert: Percentages suppress but price remains available.
    expect(result.spending.status).toBe('unequal-day-count')
    expect(result.energy.status).toBe('unequal-day-count')
    expect(result.priceDifferenceEurPerKwh).toBe(0)
    const cappedUnavailableCurrent = aggregate([session('capped-bad', currentPeriod.startUtc, 100, Number.NaN)], currentPeriod.startUtc, currentPeriod.endUtc, false)
    const cappedResult = comparePreviousPeriod(cappedUnavailableCurrent, previous, currentPeriod, previousPeriod)
    expect(cappedResult.spending.status).toBe('unequal-day-count')
    expect(cappedResult.energy.status).toBe('unavailable')
    const feb = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 1 } }, now)
    const janPrevious = createPreviousAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 1 } }, now)
    const febSpend = aggregate([session('feb', feb.startUtc, 200)], feb.startUtc, feb.endUtc)
    const janSpend = aggregate([session('jan', janPrevious.startUtc, 100)], janPrevious.startUtc, janPrevious.endUtc)
    // Assert: Completed months compare despite different month lengths.
    expect(comparePreviousPeriod(febSpend, janSpend, feb, janPrevious).spending).toEqual({ status: 'percentage', percentage: 100 })
  })

  it('uses aggregate boundary/deletion filtering and exact weighted price arithmetic', () => {
    // Arrange: Include start, exclude exclusive end and deleted record.
    const current = aggregate([
      session('start', currentPeriod.startUtc, 101, 3),
      session('deleted', new Date(2026, 5, 3), 999, 3, true),
      session('end', currentPeriod.endUtc, 999, 3),
    ], currentPeriod.startUtc, currentPeriod.endUtc, false)
    const previous = aggregate([session('prior', previousPeriod.startUtc, 100, 3)], previousPeriod.startUtc, previousPeriod.endUtc)
    // Act: Compare aggregate outputs.
    const result = comparePreviousPeriod(current, previous, currentPeriod, previousPeriod)
    // Assert: Difference uses unrounded average prices in EUR/kWh.
    expect(current.sessionCount).toBe(1)
    expect(result.priceDifferenceEurPerKwh).toBeCloseTo((101 / 3 - 100 / 3) / 100)
  })

  it('compares preset periods with a negative unrounded price and positive energy change', () => {
    // Arrange: The selected 7-day preset and its prior window contain different energy and rates.
    const preset = { kind: 'preset' as const, preset: '7-days' as const }
    const presetCurrentPeriod = createAnalyticsPeriod(preset, now)
    const presetPreviousPeriod = createPreviousAnalyticsPeriod(preset, now)
    const current = aggregate([session('preset-current', presetCurrentPeriod.startUtc, 101, 7)], presetCurrentPeriod.startUtc, presetCurrentPeriod.endUtc, false)
    const previous = aggregate([session('preset-previous', presetPreviousPeriod.startUtc, 100, 5)], presetPreviousPeriod.startUtc, presetPreviousPeriod.endUtc, false)
    // Act: Compare preset aggregates.
    const result = comparePreviousPeriod(current, previous, presetCurrentPeriod, presetPreviousPeriod)
    // Assert: Energy change is signed and price delta retains its unrounded negative value.
    expect(result.energy).toEqual({ status: 'percentage', percentage: 40 })
    expect(result.priceDifferenceEurPerKwh).toBeCloseTo((101 / 7 - 100 / 5) / 100, 12)
    expect(result.priceDifferenceEurPerKwh).toBeLessThan(0)
  })
})
