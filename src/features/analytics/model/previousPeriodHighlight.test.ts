import { describe, expect, it } from 'vitest'
import { createAnalyticsPeriod, createPreviousAnalyticsPeriod } from './analyticsPeriods'
import type { MonthlySessionSpendResult } from './monthlySessionSpend'
import { comparePreviousPeriod } from './previousPeriodComparison'
import { selectPreviousPeriodHighlight } from './previousPeriodHighlight'

const now = new Date(2026, 6, 15, 12)
const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 6 } }, now)
const previousPeriod = createPreviousAnalyticsPeriod(period.selection, now)
const base: MonthlySessionSpendResult = { totalSessionSpendCents: 10_000, billedEnergyKwh: 100, averageSessionPriceCtPerKwh: 50, sessionCount: 1, validBilledEnergySessionCount: 1, periodStartUtc: period.startUtc, periodEndUtc: period.endUtc, isCurrentMonth: true, isCompleteMonth: false, isEmpty: false }
function select(current: Partial<MonthlySessionSpendResult>, previous: Partial<MonthlySessionSpendResult> = {}, equal = true) {
  const a = { ...base, ...current }
  const b = { ...base, ...previous }
  const priorPeriod = { ...previousPeriod, isDayCountEqual: equal }
  return selectPreviousPeriodHighlight(a, b, comparePreviousPeriod(a, b, period, priorPeriod), equal)
}

/** Covers highlight thresholds, availability, duration and priority. */
describe('selectPreviousPeriodHighlight', () => {
  it.each([
    [11_499, 10_000, false], [11_500, 10_000, true], [11_501, 10_000, true],
    [8_501, 10_000, false], [8_500, 10_000, true], [8_499, 10_000, true],
    [7_999, 7_000, false], [8_000, 7_000, false], [8_050, 7_000, true],
    [6_001, 7_000, false], [6_000, 7_000, false], [5_950, 7_000, true],
  ])('requires both spend minima for %i vs %i', (current, previous, qualifies) => {
    // Arrange / Act
    const result = select({ totalSessionSpendCents: current }, { totalSessionSpendCents: previous })
    // Assert
    expect(result?.metric === 'spending').toBe(qualifies)
  })
  it.each([
    [119.999, 100, false], [120, 100, true], [120.001, 100, true],
    [80.001, 100, false], [80, 100, true], [79.999, 100, true],
    [229.999, 200, false], [230, 200, true], [230.001, 200, true],
    [170.001, 200, false], [170, 200, true], [169.999, 200, true],
  ])('requires both energy minima for %f vs %f', (current, previous, qualifies) => {
    // Arrange / Act
    const result = select({ billedEnergyKwh: current }, { billedEnergyKwh: previous })
    // Assert
    expect(result?.metric === 'energy').toBe(qualifies)
  })
  it.each([[54.999, false], [55, true], [55.001, true], [45.001, false], [45, true], [44.999, true]])('applies the unrounded price threshold to %f cents', (price, qualifies) => {
    // Arrange / Act
    const result = select({ averageSessionPriceCtPerKwh: price })
    // Assert
    expect(result?.metric === 'price').toBe(qualifies)
  })
  it('accepts decimal-derived exact energy boundaries without rounding smaller changes up', () => {
    // Arrange / Act / Assert
    expect(select({ billedEnergyKwh: 32.05 }, { billedEnergyKwh: 12.05 })?.metric).toBe('energy')
    expect(select({ billedEnergyKwh: 12.05 }, { billedEnergyKwh: 32.05 })?.metric).toBe('energy')
    expect(select({ billedEnergyKwh: 32.049999999 }, { billedEnergyKwh: 12.05 })).toBeNull()
  })
  it('accepts decimal-derived exact price boundaries without rounding below-threshold changes up', () => {
    // Arrange / Act / Assert
    expect(select({ averageSessionPriceCtPerKwh: 8.04 }, { averageSessionPriceCtPerKwh: 3.04 })?.metric).toBe('price')
    expect(select({ averageSessionPriceCtPerKwh: 3.04 }, { averageSessionPriceCtPerKwh: 8.04 })?.metric).toBe('price')
    expect(select({ averageSessionPriceCtPerKwh: 8.039999999 }, { averageSessionPriceCtPerKwh: 3.04 })).toBeNull()
  })
  it('does not round amounts or percentages to qualify', () => {
    // Arrange / Act / Assert
    expect(select({ totalSessionSpendCents: 11_499 })).toBeNull()
    expect(select({ billedEnergyKwh: 119.99 })).toBeNull()
    expect(select({ averageSessionPriceCtPerKwh: 54.999 })).toBeNull()
  })
  it('handles recorded zero baselines without percentages', () => {
    // Arrange / Act / Assert
    expect(select({ totalSessionSpendCents: 999 }, { totalSessionSpendCents: 0 })).toBeNull()
    expect(select({ totalSessionSpendCents: 1000 }, { totalSessionSpendCents: 0 })).toMatchObject({ metric: 'spending', difference: 1000, percentage: null })
    expect(select({ billedEnergyKwh: 19.99 }, { billedEnergyKwh: 0 })).toBeNull()
    expect(select({ billedEnergyKwh: 20 }, { billedEnergyKwh: 0 })).toMatchObject({ metric: 'energy', difference: 20, percentage: null })
  })
  it('prioritizes spend, then energy, then price', () => {
    // Arrange / Act / Assert
    expect(select({ totalSessionSpendCents: 12_000, billedEnergyKwh: 130, averageSessionPriceCtPerKwh: 60 })?.metric).toBe('spending')
    expect(select({ billedEnergyKwh: 130, averageSessionPriceCtPerKwh: 60 })?.metric).toBe('energy')
    expect(select({ averageSessionPriceCtPerKwh: 60 })?.metric).toBe('price')
    expect(select({})).toBeNull()
  })
  it('excludes unavailable or incomplete metrics without hiding independent available metrics', () => {
    // Arrange / Act / Assert
    expect(select({ isEmpty: true, totalSessionSpendCents: 12_000, billedEnergyKwh: null, averageSessionPriceCtPerKwh: null })).toBeNull()
    expect(select({ totalSessionSpendCents: null, billedEnergyKwh: null, averageSessionPriceCtPerKwh: null })).toBeNull()
    expect(select({ billedEnergyKwh: 130, validBilledEnergySessionCount: 0, averageSessionPriceCtPerKwh: null })).toBeNull()
    expect(select({ totalSessionSpendCents: 12_000, billedEnergyKwh: 130, validBilledEnergySessionCount: 0, averageSessionPriceCtPerKwh: null })?.metric).toBe('spending')
    expect(select({ totalSessionSpendCents: 12_000 }, { isEmpty: true, averageSessionPriceCtPerKwh: null })).toBeNull()
  })
  it('suppresses spend and energy for unequal durations while allowing price', () => {
    // Arrange / Act / Assert
    expect(select({ totalSessionSpendCents: 12_000, billedEnergyKwh: 130 }, {}, false)).toBeNull()
    expect(select({ totalSessionSpendCents: 12_000, billedEnergyKwh: 130, averageSessionPriceCtPerKwh: 60 }, {}, false)?.metric).toBe('price')
  })
})
