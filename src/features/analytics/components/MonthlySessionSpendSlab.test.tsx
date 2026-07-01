import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { MonthlySessionSpendResult } from '../model/monthlySessionSpend'
import { MonthlySessionSpendSlab } from './MonthlySessionSpendSlab'

const baseResult: MonthlySessionSpendResult = {
  totalSessionSpendCents: 12345,
  sessionCount: 2,
  periodStartUtc: new Date('2026-07-01T00:00:00.000Z'),
  periodEndUtc: new Date('2026-08-01T00:00:00.000Z'),
  isCurrentMonth: true,
  isCompleteMonth: false,
  isEmpty: false,
}

/**
 * Test suite for the monthly session-spend slab.
 *
 * Verifies precise metric wording, localized money, sparse copy, and the real
 * empty-state action.
 */
describe('MonthlySessionSpendSlab', () => {
  it('renders current-month localized spend and plural session copy', () => {
    // Arrange: Use two current-month sessions.
    render(<MonthlySessionSpendSlab month={{ year: 2026, month: 6 }} result={baseResult} isLoading={false} onAddSession={vi.fn()} />)

    // Act: Read the completed slab.
    const value = screen.getByText('123,45 €')

    // Assert: Scope and month-to-date wording are explicit.
    expect(value).toHaveClass('tabular-nums')
    expect(screen.getByText('Across 2 charging sessions.')).toBeInTheDocument()
    expect(screen.getByText('Month to date · Charging session costs only')).toBeInTheDocument()
  })

  it('renders singular completed-month copy', () => {
    // Arrange: Use one session in a prior month.
    render(<MonthlySessionSpendSlab month={{ year: 2026, month: 5 }} result={{ ...baseResult, sessionCount: 1, isCurrentMonth: false, isCompleteMonth: true }} isLoading={false} onAddSession={vi.fn()} />)

    // Act: Read the prior-month slab.
    const heading = screen.getByText('Session spend in June 2026')

    // Assert: Completed and singular copy are accurate.
    expect(heading).toBeInTheDocument()
    expect(screen.getByText('Based on 1 charging session.')).toBeInTheDocument()
    expect(screen.getByText('Completed month · Charging session costs only')).toBeInTheDocument()
  })

  it('renders empty copy and invokes the existing add-session action', async () => {
    // Arrange: Render an empty result and action callback.
    const user = userEvent.setup()
    const onAddSession = vi.fn()
    render(<MonthlySessionSpendSlab month={{ year: 2026, month: 6 }} result={{ ...baseResult, totalSessionSpendCents: 0, sessionCount: 0, isEmpty: true }} isLoading={false} onAddSession={onAddSession} />)

    // Act: Select the empty-state action.
    await user.click(screen.getByRole('button', { name: 'Add Session' }))

    // Assert: Helpful copy is shown and the callback is reused.
    expect(screen.getByText('No charging spend recorded for this month yet.')).toBeInTheDocument()
    expect(onAddSession).toHaveBeenCalledOnce()
  })

  it('does not offer a current-date action for an empty completed month', () => {
    // Arrange: Render an empty result for a historical month.
    render(
      <MonthlySessionSpendSlab
        month={{ year: 2026, month: 5 }}
        result={{
          ...baseResult,
          totalSessionSpendCents: 0,
          sessionCount: 0,
          isCurrentMonth: false,
          isCompleteMonth: true,
          isEmpty: true,
        }}
        isLoading={false}
        onAddSession={vi.fn()}
      />,
    )

    // Act: Read the historical empty state.
    const emptyHeading = screen.getByText('No charging spend recorded for this month.')

    // Assert: Copy is period-appropriate and no misleading current-date action is shown.
    expect(emptyHeading).toBeInTheDocument()
    expect(screen.getByText('Charging sessions dated to this month will appear here.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Session' })).not.toBeInTheDocument()
  })

  it('exposes an accessible loading state without stale totals', () => {
    // Arrange: Mark the slab as loading while a previous result is available.
    const { container } = render(
      <MonthlySessionSpendSlab
        month={{ year: 2026, month: 6 }}
        result={baseResult}
        isLoading
        onAddSession={vi.fn()}
      />,
    )

    // Act: Locate the loading indicator and slab container.
    const loadingIndicator = screen.getByRole('status')
    const slab = container.firstChild

    // Assert: Loading is semantic and stale values/supporting copy stay hidden.
    expect(loadingIndicator).toBeInTheDocument()
    expect(screen.getByText('Loading session spend')).toHaveClass('sr-only')
    expect(slab).toHaveAttribute('aria-busy', 'true')
    expect(slab).not.toHaveClass('p-8')
    expect(screen.queryByText('123,45 €')).not.toBeInTheDocument()
    expect(screen.queryByText('Month to date · Charging session costs only')).not.toBeInTheDocument()
  })
})
