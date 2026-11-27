import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type Dispatch, type SetStateAction } from 'react'
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
  type RetryState = { isLoading: boolean; error: unknown | null }

  function renderSummary(overrides: Partial<MonthlySessionSpendResult> = {}, extra: Partial<MonthlySessionSpendSlabProps> = {}) {
    const month = overrides.isCurrentMonth === false ? 5 : 6
    const period = extra.period ?? createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month } }, new Date(2026, 6, 31, 12))
    const previousPeriod = extra.previousPeriod ?? createPreviousAnalyticsPeriod(period)
    const result = { ...baseResult, ...overrides }
    const previousResult = extra.previousResult ?? { ...baseResult, isEmpty: true, sessionCount: 0, totalSessionSpendCents: 0, billedEnergyKwh: null, averageSessionPriceCtPerKwh: null, validBilledEnergySessionCount: 0 }
    const comparison = comparePreviousPeriod(result, previousResult, period, previousPeriod)
    return render(<MonthlySessionSpendSlab period={period} previousPeriod={previousPeriod} result={result} previousResult={previousResult} comparison={comparison} layoutMode={layoutMode} isLoading={false} onRetry={vi.fn()} onAddSession={vi.fn()} {...extra} />)
  }

  function renderRetryHarness(
    props: Omit<MonthlySessionSpendSlabProps, 'isLoading' | 'error'>,
    retrySettlement: RetryState = { isLoading: true, error: null },
  ) {
    let setQueryState: Dispatch<SetStateAction<RetryState>> | null = null
    function RetryHarness() {
      const [queryState, updateQueryState] = useState<RetryState>({ isLoading: false, error: new Error('read failed') })
      setQueryState = updateQueryState
      return <MonthlySessionSpendSlab
        {...props}
        {...queryState}
        onRetry={() => {
          props.onRetry()
          updateQueryState(retrySettlement)
        }}
      />
    }

    const view = render(<RetryHarness />)
    return {
      ...view,
      setQueryState: (state: RetryState) => {
        if (setQueryState === null) throw new Error('Retry harness is not mounted')
        act(() => setQueryState?.(state))
      },
    }
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

  it('keeps the metric order and reveals methodology on demand', async () => {
    // Arrange
    const user = userEvent.setup()
    renderSummary()
    const heading = 'How Charging Summary is calculated'
    const methodology = /divided by valid billed energy.*excluding fixed subscription fees.*vehicle battery/
    const surfaceRole = layoutMode === 'sidebar' ? 'region' : 'dialog'
    const metrics = ['Session spend', 'Billed energy', 'Average session price']

    // Assert
    expect(screen.getAllByRole('heading', { level: 3 }).map((element) => element.textContent))
      .toEqual(layoutMode === 'sidebar' ? metrics : [metrics[2], metrics[0], metrics[1]])
    expect(screen.queryByText('Session spend divided by billed energy.')).not.toBeInTheDocument()
    expect(screen.queryByText('Recorded session charges. Excludes subscription fees.')).not.toBeInTheDocument()
    expect(screen.queryByText('Energy billed by providers, not battery-added energy.')).not.toBeInTheDocument()
    expect(screen.queryByText(methodology)).not.toBeInTheDocument()

    // Act
    if (layoutMode === 'bottom-dock') {
      expect(screen.queryByRole('button', { name: /How .*calculated/ })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Compare periods' }))
      expect(screen.getByRole('region', { name: 'Previous period' })).toHaveTextContent('No sessions')
      expect(screen.getByRole('region', { name: 'Selected period' }).querySelector('[aria-hidden="true"]')).toBeNull()
      expect(screen.getByRole('button', { name: 'How these metrics are calculated' })).toBeVisible()
      expect(screen.queryByRole('button', { name: heading })).not.toBeInTheDocument()
    }
    const trigger = layoutMode === 'sidebar'
      ? screen.getByRole('button', { name: heading, expanded: false })
      : screen.getByRole('button', { name: 'How these metrics are calculated' })
    trigger.focus()
    await user.keyboard('{Enter}')

    // Assert
    const surface = screen.getByRole(surfaceRole, { name: heading })
    const close = within(surface).getByRole('button', { name: 'Close Charging Summary information' })
    expect(trigger).toHaveAttribute('aria-controls', surface.id)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    if (layoutMode === 'bottom-dock') {
      expect(surface).toHaveAttribute('aria-modal', 'true')
      expect(close).toHaveFocus()
      await user.tab()
      expect(close).toHaveFocus()
      await user.tab({ shift: true })
      expect(close).toHaveFocus()
    }
    expect(within(surface).getByText(methodology)).toBeVisible()

    // Act / Assert
    await user.keyboard('{Escape}')
    expect(screen.queryByRole(surfaceRole, { name: heading })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Close Charging Summary information' }))
    expect(screen.queryByRole(surfaceRole, { name: heading })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    if (layoutMode === 'sidebar') {
      await user.click(trigger)
      await user.click(screen.getByRole('heading', { level: 2 }))
      expect(screen.queryByRole(surfaceRole, { name: heading })).not.toBeInTheDocument()
    } else {
      const compare = screen.getByRole('button', { name: 'Compare periods' })
      await user.click(trigger)
      await user.click(screen.getByRole('button', { name: 'Dismiss Charging Summary information' }))
      expect(trigger).toHaveFocus()
      await user.click(compare)
      expect(compare).toHaveFocus()
      expect(trigger).not.toBeInTheDocument()
      await user.click(compare)
      await user.click(screen.getByRole('button', { name: 'How these metrics are calculated' }))
      // Simulate a disclosure closing programmatically while the background is inert.
      fireEvent.click(compare)
      await waitFor(() => expect(compare).toHaveFocus())
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(document.body.style.overflow).toBe('')
    }
  })

  it('integrates signed absolute and eligible relative changes with each localized metric', () => {
    // Arrange / Act: Use complete periods with decreasing energy and increasing spend and price.
    renderSummary({}, { previousResult: { ...baseResult, totalSessionSpendCents: 10_000, billedEnergyKwh: 25, averageSessionPriceCtPerKwh: 400 } })
    // Assert
    expect(screen.getByRole('region', { name: 'Session spend' })).toHaveTextContent(/\+23,45 €.*\+23,5%/)
    expect(screen.getByRole('region', { name: 'Billed energy' })).toHaveTextContent(/−0,4 kWh.*−1,6%/)
    expect(screen.getByRole('region', { name: 'Average session price' })).toHaveTextContent(/\+1,02 €\/kWh/)
    if (layoutMode === 'sidebar') {
      expect(screen.getAllByText(/^Previous:/).map((row) => row.textContent))
        .toEqual(['Previous: 100,00 €', 'Previous: 25 kWh', 'Previous: 4,00 €/kWh'])
    }
  })

  it.runIf(layoutMode === 'bottom-dock')('keeps collapsed state number-first and reveals both periods on demand', async () => {
    // Arrange / Act
    const user = userEvent.setup()
    renderSummary({}, { previousResult: { ...baseResult, totalSessionSpendCents: 10_000, billedEnergyKwh: 25, averageSessionPriceCtPerKwh: 400 } })
    // Assert
    expect(screen.queryByText(/^Previous period ·/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Previous:/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /How Charging Summary is calculated/ })).not.toBeInTheDocument()
    expect(screen.getByText('vs previous period')).toBeInTheDocument()
    expect(screen.getByText('2 charging sessions')).toBeInTheDocument()
    expect(screen.getByText(/\+23,45 €.*\+23,5%/)).toBeInTheDocument()
    const compare = screen.getByRole('button', { name: 'Compare periods' })
    expect(compare).toHaveAttribute('aria-expanded', 'false')
    await user.click(compare)
    expect(compare).toHaveAttribute('aria-expanded', 'true')
    const chart = screen.getByRole('region', { name: 'Period comparison' })
    expect(document.getElementById(compare.getAttribute('aria-controls')!)).toContainElement(chart)
    expect(within(chart).getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent))
      .toEqual(['Previous period', 'Selected period'])
    expect(within(chart).getByRole('region', { name: 'Previous period' })).toHaveTextContent(/4,00 €\/kWh.*31 May – 30 Jun 2026/)
    expect(within(chart).getByRole('region', { name: 'Selected period' })).toHaveTextContent(/5,02 €\/kWh.*1 Jul – 31 Jul 2026 · In progress/)
    await user.click(within(chart).getByRole('radio', { name: 'Spending' }))
    expect(within(chart).getByRole('region', { name: 'Previous period' })).toHaveTextContent('100,00 €')
    await user.click(within(chart).getByRole('radio', { name: 'Energy' }))
    expect(within(chart).getByRole('region', { name: 'Previous period' })).toHaveTextContent('25 kWh')
  })

  it('reports a zero baseline without a percentage and withholds incomplete energy and price comparisons', () => {
    // Arrange / Act: Previous charging was free but its total billed energy is unknown.
    renderSummary({}, { previousResult: { ...baseResult, totalSessionSpendCents: 0, billedEnergyKwh: 12, validBilledEnergySessionCount: 1, averageSessionPriceCtPerKwh: null } })
    // Assert
    const spend = screen.getByRole('region', { name: 'Session spend' })
    expect(spend).toHaveTextContent('+123,45 €')
    expect(screen.getByText('Percentage change is unavailable when previous spending is zero.')).toBeVisible()
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

  it('retains missing energy and previous invalid cost qualifications beside the totals', () => {
    // Arrange / Act
    renderSummary({ billedEnergyKwh: null, validBilledEnergySessionCount: 0, averageSessionPriceCtPerKwh: null }, {
      previousResult: { ...baseResult, totalSessionSpendCents: null, averageSessionPriceCtPerKwh: null },
    })

    // Assert
    const energy = screen.getByRole('region', { name: 'Billed energy' })
    expect(energy).toHaveTextContent(/Unavailable.*Billed energy available for 0 of 2 sessions/)
    expect(screen.getByRole('region', { name: 'Session spend' })).toHaveTextContent(/Change unavailable.*invalid recorded cost/)
    expect(screen.queryByText('vs previous period')).not.toBeInTheDocument()
  })

  it('retains unequal-day-count qualifications while suppressing additive deltas', () => {
    // Arrange / Act
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 6 } }, new Date(2026, 7, 10, 12))
    const previousPeriod = { ...createPreviousAnalyticsPeriod(period), startUtc: new Date(2026, 5, 1), dayCount: 30, isDayCountEqual: false }
    renderSummary({}, { period, previousPeriod, previousResult: baseResult })

    // Assert
    for (const label of ['Session spend', 'Billed energy']) {
      const metric = screen.getByRole('region', { name: label })
      expect(metric).toHaveTextContent('Period lengths differ')
      expect(metric).not.toHaveTextContent('%')
    }
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
    expect(billedEnergy).toHaveTextContent(layoutMode === 'sidebar'
      ? 'Previous: Known 12 kWh (1 of 2 sessions measured)'
      : 'Previous period: billed energy available for 1 of 2 sessions.')
    expect(billedEnergy).toHaveTextContent('Change unavailable')
    expect(billedEnergy).not.toHaveTextContent('%')
  })

  it('labels the previous window when month to date extends before the prior month', () => {
    // Arrange
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 2 } }, new Date(2026, 2, 31, 12))
    // Act
    renderSummary({}, { period, previousResult: baseResult })
    // Assert
    if (layoutMode === 'sidebar') {
      expect(screen.getByText('Previous period · 29 Jan – 28 Feb 2026')).toBeInTheDocument()
    }
    expect(screen.getByText('The previous window extends before the prior month to match 31 calendar days.')).toBeInTheDocument()
  })

  it('shows both years when the previous window crosses New Year', async () => {
    // Arrange
    const period = createAnalyticsPeriod({ kind: 'preset', preset: '30-days' }, new Date(2026, 1, 3, 12))
    // Act
    renderSummary({}, { period, previousResult: baseResult })
    // Assert
    if (layoutMode === 'bottom-dock') {
      await userEvent.click(screen.getByRole('button', { name: 'Compare periods' }))
      expect(within(screen.getByRole('region', { name: 'Previous period' })).getByText('6 Dec 2025 – 4 Jan 2026')).toBeVisible()
    } else {
      expect(screen.getByText('Previous period · 6 Dec 2025 – 4 Jan 2026')).toBeVisible()
    }
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

  it('shows one accessible retry action instead of stale or empty metrics', () => {
    // Arrange / Act
    renderSummary({}, { error: new Error('read failed') })
    // Assert
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load the summary')
    const retry = screen.getByRole('button', { name: 'Try again' })
    expect(retry).toHaveClass('min-h-[44px]')
    expect(screen.queryByText('123,45 €')).not.toBeInTheDocument()
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument()
    expect(screen.queryByText(/No charging sessions recorded/)).not.toBeInTheDocument()
  })

  it('keeps the same retry control focused across a retry that fails again', async () => {
    // Arrange: Render a failed selected-period query with a retry callback.
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 6 } }, new Date(2026, 6, 31, 12))
    const previousPeriod = createPreviousAnalyticsPeriod(period)
    const previousResult = { ...baseResult, isEmpty: true, sessionCount: 0, totalSessionSpendCents: 0, billedEnergyKwh: null, averageSessionPriceCtPerKwh: null, validBilledEnergySessionCount: 0 }
    const comparison = comparePreviousPeriod(baseResult, previousResult, period, previousPeriod)
    const props = { period, previousPeriod, result: baseResult, previousResult, comparison, layoutMode, onAddSession: vi.fn(), onRetry }
    const view = renderRetryHarness(props)
    const retry = screen.getByRole('button', { name: 'Try again' })
    retry.focus()

    // Act: Retry, then render the loading and repeated-failure states.
    await user.click(retry)
    const progressButton = screen.getByRole('button', { name: 'Retrying selected summary' })
    expect(progressButton).toBe(retry)
    expect(progressButton).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Retrying selected summary')
    expect(screen.getByRole('status').closest('[aria-busy="true"]')).toBeNull()
    view.setQueryState({ isLoading: false, error: new Error('retry failed') })

    // Assert: The retry action remains mounted and focused for another attempt.
    await waitFor(() => expect(retry).toHaveAccessibleName('Try again'))
    expect(retry).toHaveFocus()
    expect(onRetry).toHaveBeenCalledOnce()
    expect(screen.queryByText('123,45 €')).not.toBeInTheDocument()
  })

  it('moves focus to Summary after retry success only when retry still has focus', async () => {
    // Arrange: Render a failed query and focus its retry action.
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 6 } }, new Date(2026, 6, 31, 12))
    const previousPeriod = createPreviousAnalyticsPeriod(period)
    const previousResult = { ...baseResult, isEmpty: true, sessionCount: 0, totalSessionSpendCents: 0, billedEnergyKwh: null, averageSessionPriceCtPerKwh: null, validBilledEnergySessionCount: 0 }
    const comparison = comparePreviousPeriod(baseResult, previousResult, period, previousPeriod)
    const props = { period, previousPeriod, result: baseResult, previousResult, comparison, layoutMode, onAddSession: vi.fn(), onRetry }
    const view = renderRetryHarness(props)
    const retry = screen.getByRole('button', { name: 'Try again' })

    // Act: Retry and resolve the loading query successfully while retry remains focused.
    await user.click(retry)
    view.setQueryState({ isLoading: false, error: null })

    // Assert: Success returns focus to the Summary heading and shows the recovered value.
    const summary = screen.getByRole('heading', { name: /July 2026 summary/ })
    await waitFor(() => expect(summary).toHaveFocus())
    expect(screen.getByText('123,45 €')).toBeInTheDocument()
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('clears retry state and transfers focused retry after a synchronous success', async () => {
    // Arrange: Configure the retry callback to settle successfully in the same update.
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 6 } }, new Date(2026, 6, 31, 12))
    const previousPeriod = createPreviousAnalyticsPeriod(period)
    const previousResult = { ...baseResult, isEmpty: true, sessionCount: 0, totalSessionSpendCents: 0, billedEnergyKwh: null, averageSessionPriceCtPerKwh: null, validBilledEnergySessionCount: 0 }
    const comparison = comparePreviousPeriod(baseResult, previousResult, period, previousPeriod)
    const props = { period, previousPeriod, result: baseResult, previousResult, comparison, layoutMode, onAddSession: vi.fn(), onRetry }
    const view = renderRetryHarness(props, { isLoading: false, error: null })
    const retry = screen.getByRole('button', { name: 'Try again' })

    // Act: Settle the retry without an intermediate loading render.
    await user.click(retry)

    // Assert: The action is removed, values recover, and its focus transfers to Summary.
    expect(screen.queryByRole('button', { name: /Retrying selected summary|Try again/ })).not.toBeInTheDocument()
    const summary = screen.getByRole('heading', { name: /July 2026 summary/ })
    await waitFor(() => expect(summary).toHaveFocus())
    expect(screen.getByText('123,45 €')).toBeInTheDocument()
    expect(onRetry).toHaveBeenCalledOnce()
    view.unmount()
  })

  it('does not move focus after success when the user moved focus during retry', async () => {
    // Arrange: Start a retry and retain access to the methodology control as another focus target.
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 6 } }, new Date(2026, 6, 31, 12))
    const previousPeriod = createPreviousAnalyticsPeriod(period)
    const previousResult = { ...baseResult, isEmpty: true, sessionCount: 0, totalSessionSpendCents: 0, billedEnergyKwh: null, averageSessionPriceCtPerKwh: null, validBilledEnergySessionCount: 0 }
    const comparison = comparePreviousPeriod(baseResult, previousResult, period, previousPeriod)
    const props = { period, previousPeriod, result: baseResult, previousResult, comparison, layoutMode, onAddSession: vi.fn(), onRetry }
    const view = renderRetryHarness(props)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    const otherFocusTarget = document.createElement('button')
    otherFocusTarget.textContent = 'Other action'
    document.body.append(otherFocusTarget)
    otherFocusTarget.focus()

    // Act: Resolve the selected-period retry while focus is elsewhere.
    view.setQueryState({ isLoading: false, error: null })

    // Assert: Success leaves the user's chosen focus target in place.
    await waitFor(() => expect(otherFocusTarget).toHaveFocus())
    expect(screen.getByText('123,45 €')).toBeInTheDocument()
    expect(onRetry).toHaveBeenCalledOnce()
    otherFocusTarget.remove()
  })

  it('does not carry retry focus across a reload started elsewhere', () => {
    // Arrange: Focus the retry action without activating it.
    const period = createAnalyticsPeriod({ kind: 'month', month: { year: 2026, month: 6 } }, new Date(2026, 6, 31, 12))
    const previousPeriod = createPreviousAnalyticsPeriod(period)
    const comparison = comparePreviousPeriod(baseResult, baseResult, period, previousPeriod)
    const onRetry = vi.fn()
    const view = renderRetryHarness({ period, previousPeriod, result: baseResult, previousResult: baseResult, comparison, layoutMode, onAddSession: vi.fn(), onRetry })
    screen.getByRole('button', { name: 'Try again' }).focus()
    render(<button>Other action</button>)

    // Act: A separate reload removes Retry, and the user moves focus while it loads.
    view.setQueryState({ isLoading: true, error: null })
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    const otherAction = screen.getByRole('button', { name: 'Other action' })
    otherAction.focus()
    view.setQueryState({ isLoading: false, error: null })

    // Assert: The unrelated result does not take that focus.
    expect(otherAction).toHaveFocus()
    expect(onRetry).not.toHaveBeenCalled()
  })
})
