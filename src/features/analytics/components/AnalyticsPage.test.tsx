import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMonthlySessionSpend } from '../hooks/useMonthlySessionSpend'
import { AnalyticsPage } from './AnalyticsPage'

vi.mock('../hooks/useMonthlySessionSpend', () => ({
  useMonthlySessionSpend: vi.fn(),
}))

/**
 * Test suite for the Analytics page composition.
 *
 * Verifies current-month initialization and that selector changes reach the
 * monthly session-spend query layer.
 */
describe('AnalyticsPage', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('defaults to the current month and queries again after navigation', async () => {
    // Arrange: Freeze time in July and provide an empty analytics result.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 6, 15, 12))
    vi.mocked(useMonthlySessionSpend).mockReturnValue({
      result: {
        totalSessionSpendCents: 0,
        sessionCount: 0,
        periodStartUtc: new Date(2026, 6, 1),
        periodEndUtc: new Date(2026, 7, 1),
        isCurrentMonth: true,
        isCompleteMonth: false,
        isEmpty: true,
      },
      isLoading: false,
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { container } = render(<AnalyticsPage onAddSession={vi.fn()} />)

    // Act: Confirm the default label, then navigate to June.
    expect(screen.getByText('July 2026')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Previous month' }))

    // Assert: The page passes both selected periods to its query hook.
    expect(screen.getByText('June 2026')).toBeInTheDocument()
    const pageHeading = screen.getByRole('heading', { name: 'Analytics', level: 1 })
    expect(pageHeading.childElementCount).toBe(0)
    expect(pageHeading).toHaveClass('md:text-center')
    expect(container.querySelector('section')).toHaveClass(
      'mx-auto',
      'w-full',
      'space-y-4',
      'md:max-w-xl',
      'md:space-y-5',
    )
    expect(vi.mocked(useMonthlySessionSpend).mock.calls[0]?.[0]).toEqual({ year: 2026, month: 6 })
    expect(vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[0]).toEqual({ year: 2026, month: 5 })
  })

  it('updates the current month after the page remains open overnight', async () => {
    // Arrange: Open analytics shortly before the final midnight in July.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 31, 23, 59, 59))
    vi.mocked(useMonthlySessionSpend).mockReturnValue({
      result: {
        totalSessionSpendCents: 0,
        sessionCount: 0,
        periodStartUtc: new Date(2026, 6, 1),
        periodEndUtc: new Date(2026, 7, 1),
        isCurrentMonth: true,
        isCompleteMonth: false,
        isEmpty: true,
      },
      isLoading: false,
    })
    render(<AnalyticsPage onAddSession={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()

    // Act: Let the page cross into August without remounting.
    await act(() => vi.advanceTimersByTimeAsync(1_000))

    // Assert: July is now navigable toward the new current month.
    expect(screen.getByRole('button', { name: 'Next month' })).toBeEnabled()
    expect(vi.mocked(useMonthlySessionSpend).mock.calls.at(-1)?.[1]).toEqual(
      new Date(2026, 7, 1),
    )
  })
})
