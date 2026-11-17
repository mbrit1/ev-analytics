import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { createAnalyticsPeriod, createPreviousAnalyticsPeriod } from '../model/analyticsPeriods'
import type { MonthlySessionSpendResult } from '../model/monthlySessionSpend'
import { PeriodComparisonSlab } from './PeriodComparisonSlab'

const selectedPeriod = createAnalyticsPeriod({ kind: 'preset', preset: '7-days' }, new Date(2024, 5, 15))
const previousPeriod = createPreviousAnalyticsPeriod(selectedPeriod)
function result(overrides: Partial<MonthlySessionSpendResult> = {}): MonthlySessionSpendResult {
  return {
    totalSessionSpendCents: 1234, averageSessionPriceCtPerKwh: 50, billedEnergyKwh: 24.68,
    sessionCount: 2, validBilledEnergySessionCount: 2, periodStartUtc: selectedPeriod.startUtc,
    periodEndUtc: selectedPeriod.endUtc, isCurrentMonth: false, isCompleteMonth: false, isEmpty: false,
    ...overrides,
  }
}
function renderSlab(overrides: Partial<React.ComponentProps<typeof PeriodComparisonSlab>> = {}) {
  return render(<PeriodComparisonSlab period={selectedPeriod} previousPeriod={previousPeriod}
    result={result()} previousResult={result({ totalSessionSpendCents: 1000, billedEnergyKwh: 20, averageSessionPriceCtPerKwh: 50 })}
    isLoading={false} metric="spending" onMetricChange={vi.fn()} {...overrides} />)
}

/** Tests exact period labels, metric values, availability states, and native radio behavior. */
describe('PeriodComparisonSlab', () => {
  it('shows exact ranges, legend labels, values and a keyboard-operable metric group', async () => {
    const user = userEvent.setup()
    const onMetricChange = vi.fn()
    renderSlab({ onMetricChange })
    expect(screen.getByRole('heading', { name: 'Period comparison' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Previous period' })).toHaveTextContent('2 Jun – 8 Jun 2024')
    expect(screen.getByRole('region', { name: 'Selected period' })).toHaveTextContent('9 Jun – 15 Jun 2024 · In progress')
    expect(screen.getByRole('group', { name: 'Chart metric' })).toBeInTheDocument()
    const spending = screen.getByRole('radio', { name: 'Spending' })
    const energy = screen.getByRole('radio', { name: 'Energy' })
    spending.focus()
    await user.keyboard('{ArrowRight}')
    expect(onMetricChange).toHaveBeenCalledWith('energy')
    expect(energy).not.toBeChecked()
  })

  it('distinguishes empty windows from valid free charging in Spend and Price/kWh', () => {
    // Arrange
    const empty = result({ isEmpty: true, sessionCount: 0, totalSessionSpendCents: 0 })
    const free = result({ totalSessionSpendCents: 0, averageSessionPriceCtPerKwh: 0 })

    // Act and assert
    const { unmount } = renderSlab({ result: free, previousResult: empty })
    expect(screen.getByRole('region', { name: 'Previous period' })).toHaveTextContent('No sessions')
    expect(screen.getByRole('region', { name: 'Selected period' })).toHaveTextContent('0,00 €')
    unmount()
    renderSlab({ result: empty, previousResult: free, metric: 'price' })
    expect(screen.getByRole('region', { name: 'Previous period' })).toHaveTextContent('0,00 €/kWh')
    expect(screen.getByRole('region', { name: 'Selected period' })).toHaveTextContent('No sessions')
  })

  it.each([
    ['energy', { billedEnergyKwh: 5, validBilledEnergySessionCount: 1 }, 'Known: 5 kWh · Partial coverage: 1 of 2 sessions'],
    ['energy', { billedEnergyKwh: null, validBilledEnergySessionCount: 0 }, 'Unavailable: no valid billed energy'],
    ['spending', { totalSessionSpendCents: null }, 'Unavailable: at least one session has an invalid recorded cost'],
    ['price', { averageSessionPriceCtPerKwh: null }, 'Unavailable: complete valid cost and billed energy coverage required'],
  ] as const)('explains incomplete or unavailable %s', (metric, aggregate, explanation) => {
    // Arrange and act
    renderSlab({ result: result(aggregate), metric })

    // Assert
    expect(screen.getByRole('region', { name: 'Selected period' })).toHaveTextContent(explanation)
  })

  it.each([
    ['spending', '12,34 €'], ['energy', '24,68 kWh'], ['price', '0,50 €/kWh'],
  ] as const)('formats %s values as %s', (metric, value) => {
    renderSlab({ metric })
    expect(screen.getAllByText(value).length).toBeGreaterThan(0)
  })

  it.each(['spending', 'energy', 'price'] as const)('scales the two %s bars from the same zero baseline', (metric) => {
    // Arrange: Each previous metric is half the selected metric.
    const previous = result({ totalSessionSpendCents: 1000, billedEnergyKwh: 20, averageSessionPriceCtPerKwh: 50 })
    const selected = result({ totalSessionSpendCents: 2000, billedEnergyKwh: 40, averageSessionPriceCtPerKwh: 100 })

    // Act
    renderSlab({ metric, result: selected, previousResult: previous })

    // Assert: The graphic conveys the same ratio as the numerical values.
    const previousBar = screen.getByRole('region', { name: 'Previous period' }).querySelector('[aria-hidden="true"] > div')
    const selectedBar = screen.getByRole('region', { name: 'Selected period' }).querySelector('[aria-hidden="true"] > div')
    expect(previousBar).toHaveStyle({ height: '50%' })
    expect(selectedBar).toHaveStyle({ height: '100%' })
  })

  it.each([
    ['spending', { totalSessionSpendCents: 0 }],
    ['spending', { isEmpty: true, totalSessionSpendCents: 0, sessionCount: 0 }],
    ['spending', { totalSessionSpendCents: null }],
    ['energy', { billedEnergyKwh: null }],
    ['price', { averageSessionPriceCtPerKwh: null }],
    ['price', { averageSessionPriceCtPerKwh: 0 }],
  ] as const)('omits a filled %s bar for zero or unavailable values', (metric, aggregate) => {
    // Arrange and act: The previous period remains positive.
    renderSlab({ metric, result: result(aggregate) })

    // Assert: A missing mark does not suppress the valid comparison bar.
    expect(screen.getByRole('region', { name: 'Selected period' }).querySelector('[aria-hidden="true"] > div')).toBeNull()
    expect(screen.getByRole('region', { name: 'Previous period' }).querySelector('[aria-hidden="true"] > div')).not.toBeNull()
  })

  it('hides stale values while loading or failed', () => {
    const { rerender } = renderSlab({ isLoading: true })
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('12,34 €')).not.toBeInTheDocument()
    rerender(<PeriodComparisonSlab period={selectedPeriod} previousPeriod={previousPeriod} result={result()} previousResult={result()}
      isLoading={false} error={new Error('offline')} metric="spending" onMetricChange={vi.fn()} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('12,34 €')).not.toBeInTheDocument()
  })
})
