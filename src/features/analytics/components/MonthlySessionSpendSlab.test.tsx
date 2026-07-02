import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { MonthlySessionSpendResult } from '../model/monthlySessionSpend'
import { MonthlySessionSpendSlab } from './MonthlySessionSpendSlab'

const baseResult: MonthlySessionSpendResult = {
  totalSessionSpendCents: 12345,
  billedEnergyKwh: 24.6,
  sessionCount: 2,
  validBilledEnergySessionCount: 2,
  periodStartUtc: new Date('2026-07-01T00:00:00.000Z'),
  periodEndUtc: new Date('2026-08-01T00:00:00.000Z'),
  isCurrentMonth: true,
  isCompleteMonth: false,
  isEmpty: false,
}

/**
 * Test suite for the monthly session-spend and billed-energy slab.
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
    const slab = value.closest('[aria-busy]')

    // Assert: Scope and month-to-date wording are explicit.
    expect(value).toHaveClass('tabular-nums', 'whitespace-nowrap', 'leading-none')
    expect(slab).toHaveClass(
      'min-[900px]:!max-w-[760px]',
      'min-[900px]:!rounded-[32px]',
      'min-[900px]:!px-13',
    )
    const energyValue = screen.getByText('24,6', { exact: false })
    expect(energyValue).toHaveClass('tabular-nums', 'whitespace-nowrap', 'leading-none')
    expect(screen.getByText('This month summary')).toBeInTheDocument()
    expect(screen.getByText('Session spend')).toBeInTheDocument()
    expect(screen.getByText('Billed energy')).toBeInTheDocument()
    expect(screen.getByText('Energy billed by providers, not battery-added energy.')).toBeInTheDocument()
    expect(screen.getByText('Across 2 charging sessions.')).toBeInTheDocument()
    const footer = screen.getByText('Month to date · Session spend and provider-billed energy')
    expect(footer).toHaveClass('text-xs', 'text-secondary')
    expect(footer).not.toHaveClass('border-t')
  })

  it('renders singular completed-month copy', () => {
    // Arrange: Use one session in a prior month.
    render(<MonthlySessionSpendSlab month={{ year: 2026, month: 5 }} result={{ ...baseResult, sessionCount: 1, isCurrentMonth: false, isCompleteMonth: true }} isLoading={false} onAddSession={vi.fn()} />)

    // Act: Read the prior-month slab.
    const heading = screen.getByText('June 2026 summary')

    // Assert: Completed and singular copy are accurate.
    expect(heading).toBeInTheDocument()
    expect(screen.getByText('Based on 1 charging session.')).toBeInTheDocument()
    expect(screen.getByText('Completed month · Session spend and provider-billed energy')).toBeInTheDocument()
    expect(screen.getByText('Billed energy')).toBeInTheDocument()
  })

  it('renders a specific unavailable state when sessions have no valid billed energy', () => {
    // Arrange: Keep a recorded session while making its billed-energy aggregate unavailable.
    render(
      <MonthlySessionSpendSlab
        month={{ year: 2026, month: 6 }}
        result={{ ...baseResult, billedEnergyKwh: null, validBilledEnergySessionCount: 0 }}
        isLoading={false}
        onAddSession={vi.fn()}
      />,
    )

    // Act: Read the billed-energy companion metric.
    const unavailableHeading = screen.getByText('Billed energy unavailable')

    // Assert: Missing values are explained without presenting a false zero.
    expect(unavailableHeading).toBeInTheDocument()
    expect(screen.getByText(/no valid billed-kWh values/)).toBeInTheDocument()
    expect(screen.queryByText('0 kWh')).not.toBeInTheDocument()
  })

  it('discloses when billed energy covers only some sessions', () => {
    // Arrange: Provide an energy subtotal built from only one of three sessions.
    render(
      <MonthlySessionSpendSlab
        month={{ year: 2026, month: 6 }}
        result={{ ...baseResult, sessionCount: 3, validBilledEnergySessionCount: 1 }}
        isLoading={false}
        onAddSession={vi.fn()}
      />,
    )

    // Act: Read the billed-energy qualification.
    const qualification = screen.getByText('Based on 1 of 3 sessions with valid billed-kWh values.')

    // Assert: The partial subtotal is not presented as complete coverage.
    expect(qualification).toBeInTheDocument()
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
    expect(screen.getByText('Recorded sessions with spend and billed kWh will appear here.')).toBeInTheDocument()
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
    expect(screen.queryByText('Month to date · Session spend and provider-billed energy')).not.toBeInTheDocument()
  })
})
