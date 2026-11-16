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
    expect(screen.getByText('Current period', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('July 2026')).toBeInTheDocument()
    expect(screen.getByText('1 Jul – 15 Jul · In progress')).toBeInTheDocument()
    expect(screen.getByText('Previous period', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('June 2026')).toBeInTheDocument()
    expect(screen.getByText('1 Jun – 15 Jun')).toBeInTheDocument()
    expect(screen.getByText('Compared across 15 matching calendar days.')).toBeInTheDocument()
    expect(screen.getByText('Recorded charging activity')).toBeInTheDocument()
    const table = screen.getByRole('table', { name: /previous period comparison/i })
    expect(within(table).getByRole('columnheader', { name: 'Current' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Previous' })).toBeInTheDocument()
    const spendRow = within(table).getByRole('row', { name: /Session spend/ })
    expect(within(spendRow).getByRole('rowheader', { name: /Session spend/ })).toHaveAccessibleName('Session spendChange +25%')
    expect(spendRow).toHaveTextContent('Session spend↑Increase +25%Current125,00 €Difference +25,00 €Previous100,00 €')
    expect(spendRow).toHaveTextContent('Difference +25,00 €')
    expect(within(table).getByRole('row', { name: /Weighted session price/ })).toHaveTextContent('Current0,50 €/kWhPrevious0,45 €/kWh')
    expect(within(table).getByRole('row', { name: /Weighted session price/ })).toHaveTextContent('+0,05 €/kWh')
    expect(within(spendRow).getByLabelText('Change +25%')).toBeInTheDocument()
    const priceRow = within(table).getByRole('row', { name: /Weighted session price/ })
    const priceCells = within(priceRow).getAllByRole('cell')
    expect(priceCells[0]).toHaveTextContent('Current0,50 €/kWh')
    expect(priceCells[0]).toHaveClass('min-w-0', '[overflow-wrap:anywhere]')
    expect(priceCells[1]).toHaveTextContent('Previous0,45 €/kWh')
    expect(priceCells[1]).toHaveClass('min-w-0', '[overflow-wrap:anywhere]')
    expect(priceCells[0].querySelector('span:last-child')).toHaveClass('text-lg', 'font-semibold', 'text-primary')
    expect(priceCells[1].querySelector('span:last-child')).toHaveClass('text-sm', 'font-normal', 'text-primary')
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    expect(screen.queryByText(/increased by 25,00 €/)).not.toBeInTheDocument()
  })
  it('preserves available values independently and distinguishes empty, unavailable and zero', () => {
    // Arrange / Act
    const { rerender } = render(<PreviousPeriodComparisonSlab period={period} previousPeriod={previousPeriod} result={{ ...current, totalSessionSpendCents: 0 }} previousResult={empty} comparison={{ status: 'no-comparison-data', spending: { status: 'unavailable' }, energy: { status: 'unavailable' }, priceDifferenceEurPerKwh: null }} isLoading={false} />)
    // Assert
    expect(screen.getByText('No comparison data')).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Session spend/ })).toHaveTextContent('Current0,00 €PreviousNo sessions')
    expect(screen.getByRole('row', { name: /Billed energy/ })).toHaveTextContent('Current250 kWhPreviousNo sessions')
    rerender(<PreviousPeriodComparisonSlab period={period} previousPeriod={previousPeriod} result={{ ...current, billedEnergyKwh: null, averageSessionPriceCtPerKwh: null }} previousResult={previous} comparison={{ ...compared, energy: { status: 'unavailable' }, priceDifferenceEurPerKwh: null }} isLoading={false} />)
    expect(screen.getByRole('row', { name: /Billed energy/ })).toHaveTextContent('Billed energyUnavailableCurrentUnavailablePrevious200 kWh')
    expect(screen.getByRole('row', { name: /Weighted session price/ })).toHaveTextContent('Weighted session priceUnavailableCurrentUnavailablePrevious0,45 €/kWh')
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
  it('retains preset labels and full cross-year ranges for rolling periods', () => {
    // Arrange: Build a rolling period that crosses a calendar year boundary.
    const rolling = createAnalyticsPeriod({ kind: 'preset', preset: '30-days' }, new Date(2026, 0, 10, 12))
    const rollingPrevious = createPreviousAnalyticsPeriod(rolling.selection, new Date(2026, 0, 10, 12))
    // Act
    render(<PreviousPeriodComparisonSlab period={rolling} previousPeriod={rollingPrevious} result={current} previousResult={previous} comparison={compared} isLoading={false} />)
    // Assert: The preset labels remain while both exact ranges retain their year context.
    expect(screen.getByText('30 Days')).toBeInTheDocument()
    expect(screen.getAllByText('Previous period').length).toBeGreaterThan(0)
    expect(screen.getByText(/12 Dec 2025 – 10 Jan 2026/)).toBeInTheDocument()
    expect(screen.getByText('12 Nov – 11 Dec 2025')).toBeInTheDocument()
    expect(screen.queryByText('Compared across 30 matching calendar days.')).not.toBeInTheDocument()
  })
  it('shows signed absolute differences only for comparable complete metrics', () => {
    // Arrange / Act
    const { rerender } = render(<PreviousPeriodComparisonSlab period={period} previousPeriod={previousPeriod} result={current} previousResult={previous} comparison={compared} isLoading={false} />)
    // Assert
    expect(screen.getAllByText('Difference +25,00 €')).toHaveLength(1)
    expect(screen.getAllByText('Difference +50 kWh')).toHaveLength(1)
    expect(screen.getByLabelText('Change +0,05 €/kWh')).toBeInTheDocument()
    expect(screen.getAllByText('↑')).toHaveLength(2)
    rerender(<PreviousPeriodComparisonSlab period={period} previousPeriod={previousPeriod} result={previous} previousResult={previous} comparison={{ ...compared, spending: { status: 'percentage', percentage: 0 }, energy: { status: 'percentage', percentage: 0 }, priceDifferenceEurPerKwh: 0 }} isLoading={false} />)
    expect(screen.getByRole('row', { name: /Session spend/ })).toHaveTextContent('Session spend0%')
    expect(screen.queryByText(/Difference [+-]/)).not.toBeInTheDocument()
    rerender(<PreviousPeriodComparisonSlab period={period} previousPeriod={previousPeriod} result={{ ...current, validBilledEnergySessionCount: 2 }} previousResult={previous} comparison={{ ...compared, energy: { status: 'unavailable' } }} isLoading={false} />)
    expect(screen.queryByText(/Difference .* kWh/)).not.toBeInTheDocument()
  })
  it('suppresses stale values during loading and error', () => {
    // Arrange / Act
    const { rerender } = render(<PreviousPeriodComparisonSlab period={period} previousPeriod={previousPeriod} result={current} previousResult={previous} comparison={compared} isLoading />)
    // Assert
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText(/Difference [+-]/)).not.toBeInTheDocument()
    rerender(<PreviousPeriodComparisonSlab period={period} previousPeriod={previousPeriod} result={current} previousResult={previous} comparison={compared} isLoading={false} error={new Error('read failed')} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load the previous period comparison.')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText(/Difference [+-]/)).not.toBeInTheDocument()
  })
})
