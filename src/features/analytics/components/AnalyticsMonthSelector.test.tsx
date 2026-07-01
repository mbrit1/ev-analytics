import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AnalyticsMonthSelector } from './AnalyticsMonthSelector'

/**
 * Test suite for the analytics month selector.
 *
 * Verifies accessible month navigation and prevention of future selection.
 */
describe('AnalyticsMonthSelector', () => {
  it('navigates backward and disables next at the current month', async () => {
    // Arrange: Render the current month with a change callback.
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <AnalyticsMonthSelector
        value={{ year: 2026, month: 6 }}
        currentMonth={{ year: 2026, month: 6 }}
        onChange={onChange}
      />,
    )

    // Act: Use the available previous-month control.
    await user.click(screen.getByRole('button', { name: 'Previous month' }))

    // Assert: July is labelled, next is disabled, and June is requested.
    expect(screen.getByText('July 2026')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Analytics month' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()
    expect(onChange).toHaveBeenCalledWith({ year: 2026, month: 5 })
  })

  it('allows forward navigation from a completed month', async () => {
    // Arrange: Render June while July is the current month.
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <AnalyticsMonthSelector
        value={{ year: 2026, month: 5 }}
        currentMonth={{ year: 2026, month: 6 }}
        onChange={onChange}
      />,
    )

    // Act: Move toward the current month.
    const nextButton = screen.getByRole('button', { name: 'Next month' })
    await user.click(nextButton)

    // Assert: Forward navigation is enabled and requests July.
    expect(nextButton).toBeEnabled()
    expect(onChange).toHaveBeenCalledWith({ year: 2026, month: 6 })
  })
})
