import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createAnalyticsPeriod, createPreviousAnalyticsPeriod } from '../model/analyticsPeriods'
import type { MonthlySessionSpendResult } from '../model/monthlySessionSpend'
import { PreviousPeriodComparisonSlab } from './PreviousPeriodComparisonSlab'

const currentResult: MonthlySessionSpendResult = {
  totalSessionSpendCents: 12_500,
  averageSessionPriceCtPerKwh: 50,
  billedEnergyKwh: 250,
  sessionCount: 3,
  validBilledEnergySessionCount: 2,
  periodStartUtc: new Date(2026, 6, 1),
  periodEndUtc: new Date(2026, 6, 16),
  isCurrentMonth: true,
  isCompleteMonth: false,
  isEmpty: false,
}
const previousResult: MonthlySessionSpendResult = {
  ...currentResult,
  totalSessionSpendCents: 10_000,
  averageSessionPriceCtPerKwh: 45,
  billedEnergyKwh: 200,
  sessionCount: 2,
  validBilledEnergySessionCount: 1,
  periodStartUtc: new Date(2026, 5, 1),
  periodEndUtc: new Date(2026, 5, 16),
  isCurrentMonth: false,
  isCompleteMonth: true,
}
const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 6 } }, new Date(2026, 6, 15, 12))
const previousPeriod = createPreviousAnalyticsPeriod(period.selection, new Date(2026, 6, 15, 12))

/** Covers displayed comparison ranges, values, partial coverage, and query states. */
describe('PreviousPeriodComparisonSlab', () => {
  it('shows both period ranges, calendar labels, neutral changes and separate partial energy coverage', () => {
    // Arrange: Compare month-to-date with the capped prior month and incomplete current coverage.
    render(<PreviousPeriodComparisonSlab
      period={period}
      previousPeriod={previousPeriod}
      result={{ ...currentResult, validBilledEnergySessionCount: 3 }}
      previousResult={{ ...previousResult, validBilledEnergySessionCount: 2 }}
      comparison={{ status: 'compared', spending: { status: 'percentage', percentage: 25 }, energy: { status: 'percentage', percentage: 25 }, priceDifferenceEurPerKwh: 0.05 }}
      isLoading={false}
    />)

    // Assert: The ranges, raw values, percentage movement, price direction and coverage are explicit.
    expect(screen.getByText('July 2026: 1 Jul – 15 Jul 2026 · In progress')).toBeInTheDocument()
    expect(screen.getByText('June 2026: 1 Jun – 15 Jun 2026')).toBeInTheDocument()
    expect(screen.getByText('125,00 € now · 100,00 € before')).toBeInTheDocument()
    expect(screen.getAllByText('Change: +25%')).toHaveLength(2)
    expect(screen.getByText('+0,05 €/kWh')).toBeInTheDocument()
    expect(screen.queryByText(/energy is available for/)).not.toBeInTheDocument()
  })

  it('keeps spending comparison while partial energy coverage makes energy and price unavailable', () => {
    // Arrange: Both periods have partial energy coverage but valid recorded spending.
    render(<PreviousPeriodComparisonSlab period={period} previousPeriod={previousPeriod} result={currentResult} previousResult={previousResult} comparison={{ status: 'compared', spending: { status: 'percentage', percentage: 25 }, energy: { status: 'unavailable' }, priceDifferenceEurPerKwh: null }} isLoading={false} />)

    // Assert: Spending remains comparable while both energy coverage gaps are disclosed.
    expect(screen.getByText('Change: +25%')).toBeInTheDocument()
    expect(screen.getByText('Change: Unavailable')).toBeInTheDocument()
    expect(screen.getByText('Current period energy is available for 2 of 3 sessions.')).toBeInTheDocument()
    expect(screen.getByText('Previous period energy is available for 1 of 2 sessions.')).toBeInTheDocument()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.queryByText(/[+−].*€\/kWh/)).not.toBeInTheDocument()
  })

  it('hides comparison metrics during loading and error states', () => {
    // Arrange / Act: Render loading, then an error with the same stale inputs.
    const { rerender } = render(<PreviousPeriodComparisonSlab period={period} previousPeriod={previousPeriod} result={currentResult} previousResult={previousResult} comparison={{ status: 'compared', spending: { status: 'percentage', percentage: 25 }, energy: { status: 'percentage', percentage: 25 }, priceDifferenceEurPerKwh: 0.05 }} isLoading />)
    // Assert: Loading reserves layout without exposing old figures.
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('125,00 € now · 100,00 € before')).not.toBeInTheDocument()

    rerender(<PreviousPeriodComparisonSlab period={period} previousPeriod={previousPeriod} result={currentResult} previousResult={previousResult} comparison={{ status: 'compared', spending: { status: 'percentage', percentage: 25 }, energy: { status: 'percentage', percentage: 25 }, priceDifferenceEurPerKwh: 0.05 }} isLoading={false} error={new Error('read failed')} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load the previous period comparison.')
    expect(screen.queryByText('125,00 € now · 100,00 € before')).not.toBeInTheDocument()
  })

  it('distinguishes no comparison data from unavailable metric coverage', () => {
    // Arrange: Previous period contains no sessions, so there are no comparison metrics.
    render(<PreviousPeriodComparisonSlab period={period} previousPeriod={previousPeriod} result={currentResult} previousResult={{ ...previousResult, isEmpty: true, sessionCount: 0, totalSessionSpendCents: 0, billedEnergyKwh: null, validBilledEnergySessionCount: 0 }} comparison={{ status: 'no-comparison-data', spending: { status: 'unavailable' }, energy: { status: 'unavailable' }, priceDifferenceEurPerKwh: null }} isLoading={false} />)

    // Assert: The empty comparison is clearly explained without implying a zero change.
    expect(screen.getByText(/No comparison data/)).toBeInTheDocument()
    expect(screen.queryByText(/Change:/)).not.toBeInTheDocument()
  })

  it('shows unequal capped MTD day counts when the previous period has no comparison data', () => {
    // Arrange: March has 31 days while its capped February comparison has 28, with no prior sessions.
    const march = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 2 } }, new Date(2026, 2, 31, 12))
    const february = createPreviousAnalyticsPeriod(march.selection, new Date(2026, 2, 31, 12))
    render(<PreviousPeriodComparisonSlab period={march} previousPeriod={february} result={currentResult} previousResult={{ ...previousResult, isEmpty: true, sessionCount: 0, totalSessionSpendCents: 0, billedEnergyKwh: null, validBilledEnergySessionCount: 0 }} comparison={{ status: 'no-comparison-data', spending: { status: 'unavailable' }, energy: { status: 'unavailable' }, priceDifferenceEurPerKwh: null }} isLoading={false} />)

    // Assert: Both the empty comparison state and unequal calendar ranges remain explicit.
    expect(screen.getByText(/No comparison data/)).toBeInTheDocument()
    expect(screen.getByText(/current period 31 days; previous period 28 days/)).toBeInTheDocument()
  })

  it('explains capped unequal ranges and zero baselines without showing negative zero', () => {
    // Arrange: March month-to-date is longer than the capped February comparator.
    const march = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 2 } }, new Date(2026, 2, 31, 12))
    const february = createPreviousAnalyticsPeriod(march.selection, new Date(2026, 2, 31, 12))
    render(<PreviousPeriodComparisonSlab period={march} previousPeriod={february} result={{ ...currentResult, totalSessionSpendCents: 1, averageSessionPriceCtPerKwh: 0.004 }} previousResult={{ ...previousResult, totalSessionSpendCents: 0, averageSessionPriceCtPerKwh: 0 }} comparison={{ status: 'compared', spending: { status: 'unequal-day-count' }, energy: { status: 'up-from-zero' }, priceDifferenceEurPerKwh: -0.0049 }} isLoading={false} />)

    // Assert: Ranges remain visible, unsuitable percentage movement is explained, and tiny values normalize to zero.
    expect(screen.getByText('March 2026: 1 Mar – 31 Mar 2026 · In progress')).toBeInTheDocument()
    expect(screen.getByText(/Period lengths differ/)).toBeInTheDocument()
    expect(screen.getByText(/current period 31 days; previous period 28 days/)).toBeInTheDocument()
    expect(screen.getByText(/Increased from zero/)).toBeInTheDocument()
    expect(screen.getByText('0,00 €/kWh')).toBeInTheDocument()
    expect(screen.queryByText(/[+−]0,00 €\/kWh/)).not.toBeInTheDocument()
    expect(screen.queryByText(/−0,0/)).not.toBeInTheDocument()
  })

  it('does not present an empty current aggregate as recorded zero spend', () => {
    // Arrange: Current period is empty while a previous period has recorded data.
    render(<PreviousPeriodComparisonSlab period={period} previousPeriod={previousPeriod} result={{ ...currentResult, isEmpty: true, totalSessionSpendCents: 0, billedEnergyKwh: null, sessionCount: 0, validBilledEnergySessionCount: 0 }} previousResult={previousResult} comparison={{ status: 'compared', spending: { status: 'unavailable' }, energy: { status: 'unavailable' }, priceDifferenceEurPerKwh: null }} isLoading={false} />)

    // Assert: Empty-period values are unavailable, never rendered as €0,00.
    expect(screen.getAllByText('Unavailable')).toHaveLength(3)
    expect(screen.queryByText(/0,00 € now/)).not.toBeInTheDocument()
  })
})
