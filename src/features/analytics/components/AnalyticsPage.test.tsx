import { act, render, screen, waitFor } from '@testing-library/react'
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
 * Verifies one lifetime data-query path, desktop ordering, mobile-only panels,
 * focus recovery, technical error handling, and local-date rollover behavior.
 */
describe('AnalyticsPage', () => {
  beforeEach(() => {
    vi.mocked(useMonthlySessionSpend).mockReturnValue({ result: monthlyResult, isLoading: false })
    vi.mocked(useOverallChargingPrice).mockReturnValue(readyOverallPrice)
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('sidebar')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders Overall Price before the unchanged monthly controls on sidebar layouts', () => {
    // Arrange: Freeze time while the responsive mode is sidebar.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 15, 12))

    // Act: Render the combined desktop Analytics page.
    render(<AnalyticsPage onAddSession={vi.fn()} />)

    // Assert: Both sections use ordinary document order without mobile tab semantics.
    const overallHeading = screen.getByRole('heading', { name: 'Overall price', level: 2 })
    const monthlyHeading = screen.getByRole('heading', { name: 'This month summary', level: 2 })
    expect(overallHeading.compareDocumentPosition(monthlyHeading))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.queryByRole('tablist', { name: 'Analytics view' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument()
    expect(vi.mocked(useOverallChargingPrice)).toHaveBeenCalledWith('2026-07-15')
  })

  it('opens mobile Analytics on Overview and preserves the monthly selection across view changes', async () => {
    // Arrange: Enter bottom-dock layout in July.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 6, 15, 12))
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('bottom-dock')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    // Act: Move to Monthly, change its month, then switch away and back.
    render(<AnalyticsPage onAddSession={vi.fn()} />)
    const overviewTab = screen.getByRole('tab', { name: 'Overview' })
    const overviewPanel = screen.getByRole('tabpanel', { name: 'Overview' })
    expect(overviewTab).toHaveAttribute('aria-selected', 'true')
    expect(overviewPanel).toHaveAttribute('aria-labelledby', overviewTab.id)
    expect(screen.queryByRole('tabpanel', { name: 'Monthly' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Monthly' }))
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    await user.click(screen.getByRole('tab', { name: 'Overview' }))
    await user.click(screen.getByRole('tab', { name: 'Monthly' }))

    // Assert: Inactive content is unmounted and the selected month survives locally.
    const monthlyTab = screen.getByRole('tab', { name: 'Monthly' })
    const monthlyPanel = screen.getByRole('tabpanel', { name: 'Monthly' })
    expect(monthlyPanel).toHaveAttribute('aria-labelledby', monthlyTab.id)
    expect(screen.getByText('June 2026')).toBeInTheDocument()
    expect(vi.mocked(useOverallChargingPrice).mock.calls.every(([date]) => date === '2026-07-15'))
      .toBe(true)
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

  it('restores disclosure-trigger focus when an open sheet remounts at the breakpoint', async () => {
    // Arrange: Open the mobile sheet before Analytics changes composition.
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('bottom-dock')
    const user = userEvent.setup()
    const { rerender } = render(<AnalyticsPage onAddSession={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'How Overall Price is calculated' }))
    expect(screen.getByRole('dialog', { name: 'How Overall Price is calculated' }))
      .toBeInTheDocument()

    // Act: Cross to the sidebar composition, which remounts the Overall Price slab.
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('sidebar')
    rerender(<AnalyticsPage onAddSession={vi.fn()} />)

    // Assert: Modal cleanup completes before focus reaches the replacement trigger.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'How Overall Price is calculated' }))
        .toHaveFocus()
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
  })

  it('restores the selected mobile tab when a sidebar-to-mobile transition removes focus', async () => {
    // Arrange: Select Monthly in mobile mode, then focus its desktop control.
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('bottom-dock')
    const user = userEvent.setup()
    const { rerender } = render(<AnalyticsPage onAddSession={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: 'Monthly' }))
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('sidebar')
    rerender(<AnalyticsPage onAddSession={vi.fn()} />)
    const monthlyControl = screen.getByRole('button', { name: 'Previous month' })
    monthlyControl.focus()

    // Act: Cross back into bottom-dock layout during the same Analytics visit.
    vi.mocked(useAnalyticsLayoutMode).mockReturnValue('bottom-dock')
    rerender(<AnalyticsPage onAddSession={vi.fn()} />)

    // Assert: Focus is recovered only because the prior control was removed.
    expect(screen.getByRole('tab', { name: 'Monthly' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Monthly' })).toHaveAttribute('aria-selected', 'true')
  })

  it('renders a busy Overall Price slab without a stale value while the query loads', () => {
    // Arrange: Hold the lifetime source query in its explicit loading state.
    vi.mocked(useOverallChargingPrice).mockReturnValue({ status: 'loading' })

    // Act: Render sidebar Analytics while monthly data remains available.
    render(<AnalyticsPage onAddSession={vi.fn()} />)

    // Assert: The monthly section remains usable and the KPI reserves busy geometry.
    const loadingCopy = screen.getByText('Loading Overall Price')
    expect(loadingCopy).toBeInTheDocument()
    expect(loadingCopy.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('60,0 ct/kWh')).not.toBeInTheDocument()
    expect(screen.getByText('This month summary')).toBeInTheDocument()
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
    expect(vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[1]).toEqual(
      new Date(2026, 7, 1),
    )
    expect(vi.mocked(useOverallChargingPrice).mock.calls.at(-1)).toEqual(['2026-08-01'])
  })
})
