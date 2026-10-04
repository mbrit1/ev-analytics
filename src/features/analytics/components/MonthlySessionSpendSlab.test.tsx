import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { MonthlySessionSpendResult } from '../model/monthlySessionSpend'
import { createAnalyticsPeriod } from '../model/analyticsPeriods'
import { MonthlySessionSpendSlab } from './MonthlySessionSpendSlab'

const baseResult: MonthlySessionSpendResult = {
  totalSessionSpendCents: 12345,
  averageSessionPriceCtPerKwh: 12345 / 24.6,
  billedEnergyKwh: 24.6,
  sessionCount: 2,
  validBilledEnergySessionCount: 2,
  periodStartUtc: new Date(2026, 6, 1),
  periodEndUtc: new Date(2026, 7, 1),
  isCurrentMonth: true,
  isCompleteMonth: false,
  isEmpty: false,
}

/** Verifies summary metrics and distinct empty, loading, error and incomplete states. */
describe('MonthlySessionSpendSlab', () => {
  function renderSummary(overrides: Partial<MonthlySessionSpendResult> = {}, extra = {}) {
    const month = overrides.isCurrentMonth === false ? 5 : 6
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month } }, new Date(2026, 6, 31, 12))
    return render(<MonthlySessionSpendSlab period={period} result={{ ...baseResult, ...overrides }} isLoading={false} onAddSession={vi.fn()} {...extra} />)
  }

  it('shows three localized metrics and explicit scope', () => {
    // Arrange / Act
    renderSummary()
    // Assert
    expect(screen.getByText('123,45 €')).toBeInTheDocument()
    expect(screen.getByText(/24,6/)).toBeInTheDocument()
    expect(screen.getByText(/5,02/)).toBeInTheDocument()
    expect(screen.getByText('Average session price')).toBeInTheDocument()
    expect(screen.getByText(/Excludes subscription fees/)).toBeInTheDocument()
    expect(screen.getByText(/Month to date · In progress/)).toHaveTextContent('1 Jul 2026 – 31 Jul 2026')
  })

  it('discloses partial energy and unavailable average', () => {
    // Arrange / Act
    renderSummary({ sessionCount: 3, validBilledEnergySessionCount: 1, averageSessionPriceCtPerKwh: null })
    // Assert
    expect(screen.getByText('Billed energy available for 1 of 3 sessions.')).toBeInTheDocument()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.getByText('123,45 €')).toBeInTheDocument()
  })

  it('shows unavailable cost metrics while retaining valid energy', () => {
    // Arrange / Act
    renderSummary({ totalSessionSpendCents: null, averageSessionPriceCtPerKwh: null })
    // Assert
    expect(screen.getAllByText('Unavailable')).toHaveLength(2)
    expect(screen.getByText(/invalid recorded cost/)).toBeInTheDocument()
    expect(screen.getByText(/24,6/)).toBeInTheDocument()
  })

  it('renders a valid free price as zero', () => {
    // Arrange / Act
    renderSummary({ totalSessionSpendCents: 0, averageSessionPriceCtPerKwh: 0 })
    // Assert
    expect(screen.getByText('0,00 €')).toBeInTheDocument()
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument()
  })

  it('shows empty spending as zero and invokes Add Session', async () => {
    // Arrange
    const onAddSession = vi.fn()
    const user = userEvent.setup()
    renderSummary({ totalSessionSpendCents: 0, billedEnergyKwh: null, averageSessionPriceCtPerKwh: null, sessionCount: 0, validBilledEnergySessionCount: 0, isEmpty: true }, { onAddSession })
    // Act
    await user.click(screen.getByRole('button', { name: 'Add Session' }))
    // Assert
    expect(screen.getByText('0,00 €')).toBeInTheDocument()
    expect(screen.getAllByText('Unavailable')).toHaveLength(2)
    expect(screen.getByText('0 charging sessions')).toBeInTheDocument()
    expect(onAddSession).toHaveBeenCalledOnce()
  })

  it('keeps historical empty months accessible without a current-date action', () => {
    // Arrange / Act
    renderSummary({ isEmpty: true, isCurrentMonth: false, isCompleteMonth: true, totalSessionSpendCents: 0, billedEnergyKwh: null, averageSessionPriceCtPerKwh: null, sessionCount: 0 })
    // Assert
    expect(screen.getByText(/Completed month/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Session' })).not.toBeInTheDocument()
  })

  it('hides stale totals while loading', () => {
    // Arrange / Act
    renderSummary({}, { isLoading: true })
    // Assert
    expect(screen.getByRole('status')).toHaveTextContent('Loading summary')
    expect(screen.queryByText('123,45 €')).not.toBeInTheDocument()
  })

  it('shows a query error instead of stale or empty metrics', () => {
    // Arrange / Act
    renderSummary({}, { error: new Error('read failed') })
    // Assert
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load the summary')
    expect(screen.queryByText('123,45 €')).not.toBeInTheDocument()
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument()
  })
})
