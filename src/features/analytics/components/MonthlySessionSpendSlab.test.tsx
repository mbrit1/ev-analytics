import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { MonthlySessionSpendResult } from '../model/monthlySessionSpend'
import { createAnalyticsPeriod, createPreviousAnalyticsPeriod } from '../model/analyticsPeriods'
import { comparePreviousPeriod } from '../model/previousPeriodComparison'
import { MonthlySessionSpendSlab, type MonthlySessionSpendSlabProps } from './MonthlySessionSpendSlab'

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
describe.each(['sidebar', 'bottom-dock'] as const)('MonthlySessionSpendSlab (%s)', (layoutMode) => {
  function renderSummary(overrides: Partial<MonthlySessionSpendResult> = {}, extra: Partial<MonthlySessionSpendSlabProps> = {}) {
    const month = overrides.isCurrentMonth === false ? 5 : 6
    const period = extra.period ?? createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month } }, new Date(2026, 6, 31, 12))
    const previousPeriod = createPreviousAnalyticsPeriod(period)
    const result = { ...baseResult, ...overrides }
    const previousResult = extra.previousResult ?? { ...baseResult, isEmpty: true, sessionCount: 0, totalSessionSpendCents: 0, billedEnergyKwh: null, averageSessionPriceCtPerKwh: null, validBilledEnergySessionCount: 0 }
    const comparison = comparePreviousPeriod(result, previousResult, period, previousPeriod)
    return render(<MonthlySessionSpendSlab period={period} previousPeriod={previousPeriod} result={result} previousResult={previousResult} comparison={comparison} layoutMode={layoutMode} isLoading={false} onAddSession={vi.fn()} {...extra} />)
  }

  it('shows three localized metrics and explicit scope', () => {
    // Arrange / Act
    renderSummary()
    // Assert
    expect(screen.getByText('123,45 €')).toBeInTheDocument()
    expect(screen.getByText(/24,6/)).toBeInTheDocument()
    expect(screen.getByText(/5,02/)).toBeInTheDocument()
    expect(screen.getByText('Average session price')).toBeInTheDocument()
    const summaryHeading = screen.getByRole('heading', { name: /July 2026 summary, 1 Jul – 31 Jul 2026, Month to date, in progress/ })
    expect(summaryHeading).toHaveTextContent('Summary')
    expect(summaryHeading).not.toHaveTextContent('1 Jul')
    expect(screen.queryByText(/1 Jul|In progress|Month to date/)).not.toBeInTheDocument()
  })

  it('keeps methodology inline on the sidebar and in a dismissible sheet on mobile', async () => {
    // Arrange
    const user = userEvent.setup()
    renderSummary()
    const inlineNotes = [
      'Session spend divided by billed energy.',
      'Recorded session charges. Excludes subscription fees.',
      'Energy billed by providers, not battery-added energy.',
    ]
    const heading = 'How Charging Summary is calculated'

    // Act / Assert
    if (layoutMode === 'sidebar') {
      for (const note of inlineNotes) expect(screen.getByText(note)).toBeVisible()
      expect(screen.queryByRole('button', { name: heading })).not.toBeInTheDocument()
      return
    }

    for (const note of inlineNotes) expect(screen.queryByText(note)).not.toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: heading })
    await user.click(trigger)
    const sheet = within(screen.getByRole('dialog', { name: heading }))
    const close = sheet.getByRole('button', { name: 'Close Charging Summary information' })
    expect(close).toHaveFocus()
    expect(sheet.getByText(/divided by valid billed energy.*excluding fixed subscription fees.*vehicle battery/)).toBeVisible()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: heading })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('integrates signed absolute and eligible relative changes with each localized metric', () => {
    // Arrange / Act: Use complete periods with decreasing energy and increasing spend and price.
    renderSummary({}, { previousResult: { ...baseResult, totalSessionSpendCents: 10_000, billedEnergyKwh: 25, averageSessionPriceCtPerKwh: 400 } })
    // Assert
    expect(screen.getByRole('region', { name: 'Session spend' })).toHaveTextContent(/\+23,45 €.*\+23,5%.*100,00 €/)
    expect(screen.getByRole('region', { name: 'Billed energy' })).toHaveTextContent(/−0,4 kWh.*−1,6%.*25 kWh/)
    expect(screen.getByRole('region', { name: 'Average session price' })).toHaveTextContent(/\+1,02 €\/kWh.*4,00 €\/kWh/)
  })

  it('reports a zero baseline without a percentage and withholds incomplete energy and price comparisons', () => {
    // Arrange / Act: Previous charging was free but its total billed energy is unknown.
    renderSummary({}, { previousResult: { ...baseResult, totalSessionSpendCents: 0, billedEnergyKwh: 12, validBilledEnergySessionCount: 1, averageSessionPriceCtPerKwh: null } })
    // Assert
    const spend = screen.getByRole('region', { name: 'Session spend' })
    expect(spend).toHaveTextContent(/\+123,45 €.*0,00 €/)
    expect(spend).not.toHaveTextContent('%')
    const energy = screen.getByRole('region', { name: 'Billed energy' })
    expect(energy).toHaveTextContent(/1 of 2 sessions/)
    expect(energy).not.toHaveTextContent('%')
    expect(screen.getByRole('region', { name: 'Average session price' })).toHaveTextContent(/unavailable/i)
  })

  it('states that comparison data is absent once, without inventing a previous value', () => {
    // Arrange / Act
    renderSummary()
    // Assert
    expect(screen.getByText(/No comparison data/)).toBeInTheDocument()
    expect(screen.queryByText(/^Previous:/)).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Session spend' })).getByText('123,45 €')).toBeInTheDocument()
  })

  it('discloses partial energy and unavailable average', () => {
    // Arrange / Act
    renderSummary({ sessionCount: 3, validBilledEnergySessionCount: 1, averageSessionPriceCtPerKwh: null })
    // Assert
    expect(screen.getByRole('region', { name: 'Billed energy' })).toHaveTextContent('Billed energy available for 1 of 3 sessions.')
    expect(screen.getByRole('region', { name: 'Average session price' })).toHaveTextContent(/Unavailable.*Requires valid cost and billed energy for every session/)
    expect(screen.getByText('123,45 €')).toBeInTheDocument()
  })

  it('identifies both incomplete energy values as known subtotals', () => {
    // Arrange / Act
    renderSummary({ validBilledEnergySessionCount: 1, averageSessionPriceCtPerKwh: null }, {
      previousResult: { ...baseResult, billedEnergyKwh: 12, validBilledEnergySessionCount: 1, averageSessionPriceCtPerKwh: null },
    })
    // Assert
    const billedEnergy = screen.getByRole('region', { name: 'Billed energy' })
    expect(billedEnergy).toHaveTextContent('Known: 24,6 kWh')
    expect(billedEnergy).toHaveTextContent('Previous: Known 12 kWh (1 of 2 sessions measured)')
    expect(billedEnergy).toHaveTextContent('Change unavailable')
    expect(billedEnergy).not.toHaveTextContent('%')
  })

  it('labels the previous window when month to date extends before the prior month', () => {
    // Arrange
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 2 } }, new Date(2026, 2, 31, 12))
    // Act
    renderSummary({}, { period, previousResult: baseResult })
    // Assert
    expect(screen.getByText('Previous period · 29 Jan – 28 Feb 2026')).toBeInTheDocument()
    expect(screen.getByText('The previous window extends before the prior month to match 31 calendar days.')).toBeInTheDocument()
  })

  it('shows both years when the previous window crosses New Year', () => {
    // Arrange
    const period = createAnalyticsPeriod({ kind: 'preset', preset: '30-days' }, new Date(2026, 1, 3, 12))
    // Act
    renderSummary({}, { period, previousResult: baseResult })
    // Assert
    expect(screen.getByText('Previous period · 6 Dec 2025 – 4 Jan 2026')).toBeInTheDocument()
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
    expect(screen.getByRole('heading', { name: /June 2026 summary, 1 Jun – 30 Jun 2026, Completed month/ })).toHaveTextContent('Summary')
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
