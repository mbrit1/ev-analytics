import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAnalyticsLayoutMode } from '../hooks/useAnalyticsLayoutMode'
import { useMonthlySessionSpend } from '../hooks/useMonthlySessionSpend'
import {
  useOverallChargingPrice,
  type OverallChargingPriceQueryState,
} from '../hooks/useOverallChargingPrice'
import { AnalyticsPage } from './AnalyticsPage'

vi.mock('../hooks/useMonthlySessionSpend', () => ({
  useMonthlySessionSpend: vi.fn(),
}))
vi.mock('../hooks/useOverallChargingPrice', () => ({
  useOverallChargingPrice: vi.fn(),
}))
vi.mock('../hooks/useAnalyticsLayoutMode', () => ({
  useAnalyticsLayoutMode: vi.fn(),
}))

const monthlyResult = {
  totalSessionSpendCents: 0,
  averageSessionPriceCtPerKwh: null,
  billedEnergyKwh: null,
  sessionCount: 0,
  validBilledEnergySessionCount: 0,
  periodStartUtc: new Date(2026, 6, 1),
  periodEndUtc: new Date(2026, 7, 1),
  isCurrentMonth: true,
  isCompleteMonth: false,
  isEmpty: true,
}

const readyOverallPrice: OverallChargingPriceQueryState = {
  status: 'success',
  result: {
    status: 'ready',
    sessionCount: 2,
    billedEnergyKwh: 10,
    sessionSpendCents: 500,
    fixedCostCents: 100,
    includedSpendCents: 600,
    overallPriceCtPerKwh: 60,
  },
}

/**
 * Test suite for responsive Analytics page composition.
 *
 * Verifies one lifetime data-query path, vertical ordering on mobile and desktop,
 * focus recovery, technical error handling, and local-date rollover behavior.
 */
describe('AnalyticsPage', () => {
  beforeEach(() => {
    vi.mocked(useMonthlySessionSpend).mockReturnValue({ result: monthlyResult, isLoading: false, error: null })
    vi.mocked(useOverallChargingPrice).mockReturnValue(readyOverallPrice)
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('sidebar')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the summary before lifetime Overall Price on sidebar layouts', () => {
    // Arrange: Freeze time while the responsive mode is sidebar.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 15, 12))

    // Act: Render the combined desktop Analytics page.
    render(<AnalyticsPage onAddSession={vi.fn()} />)

    // Assert: Both sections use ordinary document order without mobile tab semantics.
    const overallHeading = screen.getByRole('heading', { name: 'Overall price', level: 2 })
    const monthlyHeading = screen.getByRole('heading', { name: 'July 2026 summary', level: 2 })
    expect(overallHeading.compareDocumentPosition(monthlyHeading))
      .toBe(Node.DOCUMENT_POSITION_PRECEDING)
    expect(screen.queryByRole('tablist', { name: 'Analytics view' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument()
    expect(vi.mocked(useOverallChargingPrice)).toHaveBeenCalledWith('2026-07-15')
  })

  it('shows both sections on mobile and keeps lifetime independent of month selection', async () => {
    // Arrange
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 6, 15, 12))
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('bottom-dock')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<AnalyticsPage onAddSession={vi.fn()} />)
    // Act
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    // Assert
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.getByText('June 2026')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Overall price' })).toBeInTheDocument()
    expect(vi.mocked(useOverallChargingPrice).mock.calls.every(([date]) => date === '2026-07-15')).toBe(true)
  })

  it('switches presets and restores the previously selected calendar month', async () => {
    // Arrange: Start in calendar-month mode and navigate to the previous month.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 6, 15, 12))
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('bottom-dock')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<AnalyticsPage onAddSession={vi.fn()} />)
    expect(screen.getByRole('radio', { name: 'Calendar Month' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('button', { name: 'Previous month' }))

    // Act: Select every trailing preset, then return to calendar-month mode.
    for (const [name, preset] of [
      ['7 Days', '7-days'],
      ['30 Days', '30-days'],
      ['3 Months', '3-months'],
      ['Year', 'year'],
    ] as const) {
      await user.click(screen.getByRole('radio', { name }))
      expect(screen.getByRole('radio', { name })).toHaveAttribute('aria-checked', 'true')
      expect(vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[0].selection)
        .toEqual({ kind: 'preset', preset })
    }
    await user.click(screen.getByRole('radio', { name: 'Calendar Month' }))

    // Assert: The prior month remains selected after changing modes.
    expect(screen.getByText('June 2026')).toBeInTheDocument()
    expect(screen.getByText('June 2026 summary')).toBeInTheDocument()
    expect(vi.mocked(useOverallChargingPrice).mock.calls.every(([date]) => date === '2026-07-15')).toBe(true)
  })

  it('refreshes a selected preset at local midnight without changing its mode', async () => {
    // Arrange: Open Analytics immediately before the selected period's end advances.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 6, 31, 23, 59, 59))
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('bottom-dock')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<AnalyticsPage onAddSession={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    await user.click(screen.getByRole('radio', { name: '7 Days' }))

    // Act: Cross both local day and month boundaries while Analytics stays mounted.
    await act(() => vi.advanceTimersByTimeAsync(1_000))

    // Assert: The period refreshes in place and the preset remains selected.
    expect(screen.getByRole('radio', { name: '7 Days' })).toHaveAttribute('aria-checked', 'true')
    expect(vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[0].selection)
      .toEqual({ kind: 'preset', preset: '7-days' })
    expect(vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[0]).toMatchObject({
      startUtc: new Date(2026, 6, 26),
      endUtc: new Date(2026, 7, 2),
    })
    expect(screen.getByText('7 Days summary')).toBeInTheDocument()

    // Act: Return to calendar mode after the day and month rollover.
    await user.click(screen.getByRole('radio', { name: 'Calendar Month' }))

    // Assert: The historical month selected before the preset remains selected.
    expect(screen.getByText('June 2026')).toBeInTheDocument()
    expect(vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[0].selection)
      .toEqual({ kind: 'month', month: { year: 2026, month: 5 } })
  })

  it('uses rolling desktop ranges without stepping and restores the remembered calendar month', async () => {
    // Arrange: Render the desktop route and retain June before choosing a preset.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 6, 15, 12))
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('sidebar')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<AnalyticsPage onAddSession={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Previous month' }))

    // Act: Choose each relative range through the same options control.
    for (const [label, preset, range] of [
      ['7 Days', '7-days', '9 Jul 2026 – 15 Jul 2026'],
      ['30 Days', '30-days', '16 Jun 2026 – 15 Jul 2026'],
      ['3 Months', '3-months', '16 Apr 2026 – 15 Jul 2026'],
      ['Year', 'year', '16 Jul 2025 – 15 Jul 2026'],
    ] as const) {
      await user.click(screen.getByRole('button', { name: /^Other ranges/ }))
      await user.click(within(screen.getByRole('dialog', { name: 'Other ranges' })).getByRole('button', { name: label }))

      // Assert: The title and exact range follow the rolling period, with no month controls.
      expect(screen.getByRole('heading', { name: `${label} summary` })).toBeInTheDocument()
      expect(screen.getByText(`In progress · ${range}`)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Previous month' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Next month' })).not.toBeInTheDocument()
      expect(vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[0].selection)
        .toEqual({ kind: 'preset', preset })
      expect(vi.mocked(useOverallChargingPrice).mock.calls.every(([date]) => date === '2026-07-15')).toBe(true)
    }

    // Act: Return to the remembered June through the period-options control.
    await user.click(screen.getByRole('button', { name: 'Other ranges (Year)' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Other ranges' })).getByRole('button', { name: 'Calendar Month' }))

    // Assert: Month arrows return only in calendar mode and navigate the existing period.
    expect(screen.getByRole('heading', { name: 'June 2026 summary' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByRole('heading', { name: 'July 2026 summary' })).toBeInTheDocument()
    expect(vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[0].selection)
      .toEqual({ kind: 'month', month: { year: 2026, month: 6 } })
    expect(vi.mocked(useOverallChargingPrice).mock.calls.every(([date]) => date === '2026-07-15')).toBe(true)
  })

  it('passes the bottom-dock layout through to the Overall Price information sheet', async () => {
    // Arrange: Render the mobile Analytics overview with its responsive layout mode.
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('bottom-dock')
    const user = userEvent.setup()
    render(<AnalyticsPage onAddSession={vi.fn()} />)

    // Act: Open the Overall Price calculation explanation.
    await user.click(screen.getByRole('button', { name: 'How Overall Price is calculated' }))

    // Assert: Page composition retains the bottom-sheet interaction contract.
    expect(screen.getByRole('dialog', { name: 'How Overall Price is calculated' }))
      .toHaveAttribute('aria-modal', 'true')
  })

  it('restores disclosure-trigger focus when an open sheet closes at the breakpoint', async () => {
    // Arrange: Open the mobile sheet before Analytics changes composition.
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('bottom-dock')
    const user = userEvent.setup()
    const { rerender } = render(<AnalyticsPage onAddSession={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'How Overall Price is calculated' }))
    expect(screen.getByRole('dialog', { name: 'How Overall Price is calculated' }))
      .toBeInTheDocument()

    // Act: Cross to the sidebar disclosure mode while retaining the Overall Price slab.
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('sidebar')
    rerender(<AnalyticsPage onAddSession={vi.fn()} />)

    // Assert: Modal cleanup completes before focus reaches the live trigger.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'How Overall Price is calculated' }))
        .toHaveFocus()
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
  })

  it('preserves month-control focus across layout changes', () => {
    // Arrange
    const { rerender } = render(<AnalyticsPage onAddSession={vi.fn()} />)
    screen.getByRole('button', { name: 'Previous month' }).focus()
    // Act
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('bottom-dock')
    rerender(<AnalyticsPage onAddSession={vi.fn()} />)
    // Assert
    expect(screen.getByRole('button', { name: 'Previous month' })).toHaveFocus()
  })

  it('renders a busy Overall Price slab without a stale value while the query loads', () => {
    // Arrange: Hold the lifetime source query in its explicit loading state.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 15, 12))
    vi.mocked(useOverallChargingPrice).mockReturnValue({ status: 'loading' })

    // Act: Render sidebar Analytics while monthly data remains available.
    render(<AnalyticsPage onAddSession={vi.fn()} />)

    // Assert: The monthly section remains usable and the KPI reserves busy geometry.
    const loadingCopy = screen.getByText('Loading Overall Price')
    expect(loadingCopy).toBeInTheDocument()
    expect(loadingCopy.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('60,0 ct/kWh')).not.toBeInTheDocument()
    expect(screen.getByText('July 2026 summary')).toBeInTheDocument()
  })

  it('renders a page-level technical error and recovers into the slab on the next success', () => {
    // Arrange: Simulate an unexpected local-query failure.
    let overallState: OverallChargingPriceQueryState = {
      status: 'error',
      error: new Error('IndexedDB unavailable'),
    }
    vi.mocked(useOverallChargingPrice).mockImplementation(() => overallState)
    const { rerender } = render(<AnalyticsPage onAddSession={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Unable to calculate Overall Price right now. Please try again.',
    )

    // Act: Recover the query without changing the selected month.
    overallState = readyOverallPrice
    rerender(<AnalyticsPage onAddSession={vi.fn()} />)

    // Assert: A technical failure is never passed through as a calculation result.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Overall price', level: 2 })).toBeInTheDocument()
  })

  it('updates both monthly and lifetime local-date inputs after the page remains open overnight', async () => {
    // Arrange: Open Analytics just before the final midnight in July.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 31, 23, 59, 59))
    render(<AnalyticsPage onAddSession={vi.fn()} />)

    // Act: Let the page cross into August without remounting.
    await act(() => vi.advanceTimersByTimeAsync(1_000))

    // Assert: The month selector and explicit lifetime local date update together.
    expect(screen.getByRole('button', { name: 'Next month' })).toBeEnabled()
    expect(vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[0]).toMatchObject({
      selection: { kind: 'month', month: { year: 2026, month: 6 } },
      endUtc: new Date(2026, 7, 1),
      isCompleteMonth: true,
    })
    expect(vi.mocked(useOverallChargingPrice).mock.calls.at(-1)).toEqual(['2026-08-01'])
  })
  it('keeps lifetime available during a monthly query failure and recovers', () => {
    // Arrange
    vi.mocked(useMonthlySessionSpend).mockReturnValue({ result: monthlyResult, isLoading: false, error: new Error('read failed') })
    const { rerender } = render(<AnalyticsPage onAddSession={vi.fn()} />)
    // Act / Assert
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load the summary')
    expect(screen.getByRole('region', { name: 'Lifetime Overall Price' })).toHaveTextContent('0,60')
    vi.mocked(useMonthlySessionSpend).mockReturnValue({ result: monthlyResult, isLoading: false, error: null })
    rerender(<AnalyticsPage onAddSession={vi.fn()} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('0 charging sessions')).toBeInTheDocument()
  })

})
