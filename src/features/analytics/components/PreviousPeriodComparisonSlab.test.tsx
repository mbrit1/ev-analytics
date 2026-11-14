import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createAnalyticsPeriod, createPreviousAnalyticsPeriod } from '../model/analyticsPeriods'
import type { MonthlySessionSpendResult } from '../model/monthlySessionSpend'
import { PreviousPeriodComparisonSlab } from './PreviousPeriodComparisonSlab'

const now = new Date(2026, 6, 15, 12)
const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 6 } }, now)
const previousPeriod = createPreviousAnalyticsPeriod(period.selection, now)
const current: MonthlySessionSpendResult = { totalSessionSpendCents: 12500, billedEnergyKwh: 250, averageSessionPriceCtPerKwh: 50, sessionCount: 3, validBilledEnergySessionCount: 3, periodStartUtc: period.startUtc, periodEndUtc: period.endUtc, isCurrentMonth: true, isCompleteMonth: false, isEmpty: false }
const previous: MonthlySessionSpendResult = { ...current, totalSessionSpendCents: 10000, billedEnergyKwh: 200, averageSessionPriceCtPerKwh: 45, periodStartUtc: previousPeriod.startUtc, periodEndUtc: previousPeriod.endUtc }
const compared = { status: 'compared', spending: { status: 'percentage', percentage: 25 }, energy: { status: 'percentage', percentage: 25 }, priceDifferenceEurPerKwh: 0.05 } as const
const empty = { ...previous, isEmpty: true, sessionCount: 0, validBilledEnergySessionCount: 0, totalSessionSpendCents: 0, billedEnergyKwh: null, averageSessionPriceCtPerKwh: null }

/** Covers comparison table values, coverage, period context and query states. */
describe('PreviousPeriodComparisonSlab', () => {
  it('presents both periods and neutral changes in an accessible table', () => {
    // Arrange / Act
    render(<PreviousPeriodComparisonSlab period={period} previousPeriod={previousPeriod} result={current} previousResult={previous} comparison={compared} isLoading={false} />)
    // Assert
    expect(screen.getByText('Current · July 2026: 1 Jul – 15 Jul 2026 · In progress')).toBeInTheDocument()
    expect(screen.getByText('Previous · June 2026: 1 Jun – 15 Jun 2026')).toBeInTheDocument()
    const table = screen.getByRole('table', { name: /previous period comparison/i })
    expect(within(table).getByRole('columnheader', { name: 'Current' })).toBeInTheDocument()
    expect(within(table).getByRole('row', { name: /Session spend/ })).toHaveTextContent('Current125,00 €Previous100,00 €Change+25%')
    expect(within(table).getByRole('row', { name: /Weighted session price/ })).toHaveTextContent('Current0,50 €/kWhPrevious0,45 €/kWhChange+0,05 €/kWh')
  })
  it('preserves available values independently and distinguishes empty, unavailable and zero', () => {
    // Arrange / Act
    const { rerender } = render(<PreviousPeriodComparisonSlab period={period} previousPeriod={previousPeriod} result={{ ...current, totalSessionSpendCents: 0 }} previousResult={empty} comparison={{ status: 'no-comparison-data', spending: { status: 'unavailable' }, energy: { status: 'unavailable' }, priceDifferenceEurPerKwh: null }} isLoading={false} />)
    // Assert
    expect(screen.getByRole('row', { name: /Session spend/ })).toHaveTextContent('Current0,00 €PreviousNo sessionsChangeUnavailable')
    expect(screen.getByRole('row', { name: /Billed energy/ })).toHaveTextContent('Current250 kWhPreviousNo sessionsChangeUnavailable')
    rerender(<PreviousPeriodComparisonSlab period={period} previousPeriod={previousPeriod} result={{ ...current, billedEnergyKwh: null, averageSessionPriceCtPerKwh: null }} previousResult={previous} comparison={{ ...compared, energy: { status: 'unavailable' }, priceDifferenceEurPerKwh: null }} isLoading={false} />)
    expect(screen.getByRole('row', { name: /Billed energy/ })).toHaveTextContent('CurrentUnavailablePrevious200 kWhChangeUnavailable')
    expect(screen.getByRole('row', { name: /Weighted session price/ })).toHaveTextContent('CurrentUnavailablePrevious0,45 €/kWhChangeUnavailable')
  })
  it('associates partial energy coverage with each known subtotal', () => {
    // Arrange / Act
    render(<PreviousPeriodComparisonSlab period={period} previousPeriod={previousPeriod} result={{ ...current, validBilledEnergySessionCount: 2 }} previousResult={{ ...previous, validBilledEnergySessionCount: 1 }} comparison={{ ...compared, energy: { status: 'unavailable' }, priceDifferenceEurPerKwh: null }} isLoading={false} />)
    // Assert
    const row = screen.getByRole('row', { name: /Billed energy/ })
    expect(row).toHaveTextContent('Known: 250 kWh')
    expect(row).toHaveTextContent('2 of 3 sessions')
    expect(row).toHaveTextContent('1 of 3 sessions')
  })
  it('explains a zero baseline and avoids negative zero', () => {
    // Arrange / Act
    render(<PreviousPeriodComparisonSlab period={period} previousPeriod={previousPeriod} result={current} previousResult={{ ...previous, totalSessionSpendCents: 0 }} comparison={{ ...compared, spending: { status: 'up-from-zero' }, priceDifferenceEurPerKwh: -0.0049 }} isLoading={false} />)
    // Assert
    expect(screen.getByRole('row', { name: /Session spend/ })).toHaveTextContent('Increased from zero')
    expect(screen.getByText(/Percentage change is unavailable when the previous value is zero/)).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Weighted session price/ })).toHaveTextContent('0,00 €/kWh')
  })
  it('shows unequal day counts for in-progress and completed months while retaining their comparison states', () => {
    // Arrange / Act
    const march = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 2 } }, new Date(2026, 2, 31, 12))
    const february = createPreviousAnalyticsPeriod(march.selection, new Date(2026, 2, 31, 12))
    const { rerender } = render(<PreviousPeriodComparisonSlab period={march} previousPeriod={february} result={current} previousResult={previous} comparison={{ ...compared, spending: { status: 'unequal-day-count' }, energy: { status: 'unequal-day-count' } }} isLoading={false} />)
    // Assert
    expect(screen.getByText(/current period 31 days; previous period 28 days/)).toHaveTextContent('Percentage changes are unavailable')
    expect(screen.getAllByText('Period lengths differ')).toHaveLength(2)
    const completed = createAnalyticsPeriod(march.selection, new Date(2026, 3, 10, 12))
    const prior = createPreviousAnalyticsPeriod(march.selection, new Date(2026, 3, 10, 12))
    rerender(<PreviousPeriodComparisonSlab period={completed} previousPeriod={prior} result={current} previousResult={previous} comparison={compared} isLoading={false} />)
    expect(screen.getByText(/current period 31 days; previous period 28 days/)).not.toHaveTextContent('Percentage changes are unavailable')
    expect(screen.getAllByText('+25%')).toHaveLength(2)
  })
  it('shows one observation immediately above the table only when a metric qualifies', () => {
    // Arrange / Act
    const { rerender } = render(<PreviousPeriodComparisonSlab period={period} previousPeriod={previousPeriod} result={current} previousResult={previous} comparison={compared} isLoading={false} />)
    // Assert
    const observation = screen.getByText('Session spend increased by 25,00 € (25%).')
    expect(observation.nextElementSibling).toBe(screen.getByRole('table'))
    rerender(<PreviousPeriodComparisonSlab period={period} previousPeriod={previousPeriod} result={previous} previousResult={previous} comparison={{ ...compared, spending: { status: 'percentage', percentage: 0 }, energy: { status: 'percentage', percentage: 0 }, priceDifferenceEurPerKwh: 0 }} isLoading={false} />)
    expect(screen.queryByText(/increased by|decreased by|changed by/)).not.toBeInTheDocument()
  })
  it('suppresses stale values during loading and error', () => {
    // Arrange / Act
    const { rerender } = render(<PreviousPeriodComparisonSlab period={period} previousPeriod={previousPeriod} result={current} previousResult={previous} comparison={compared} isLoading />)
    // Assert
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText(/increased by|decreased by|changed by/)).not.toBeInTheDocument()
    rerender(<PreviousPeriodComparisonSlab period={period} previousPeriod={previousPeriod} result={current} previousResult={previous} comparison={compared} isLoading={false} error={new Error('read failed')} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load the previous period comparison.')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText(/increased by|decreased by|changed by/)).not.toBeInTheDocument()
  })
})
