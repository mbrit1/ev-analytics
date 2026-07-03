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
    const selector = screen.getByRole('group', { name: 'Analytics month' })
    const previousButton = screen.getByRole('button', { name: 'Previous month' })
    const nextButton = screen.getByRole('button', { name: 'Next month' })
    expect(selector).toHaveClass(
      'mx-auto',
      'grid',
      'max-w-72',
      'grid-cols-[44px_minmax(0,1fr)_44px]',
      'md:max-w-sm',
      'md:rounded-full',
      'md:border-slab-border',
      'md:bg-surface/70',
      'min-[900px]:!max-w-[640px]',
      'min-[900px]:!rounded-3xl',
      'min-[900px]:!shadow-slab',
    )
    expect(previousButton).toHaveClass('h-11', 'w-11')
    expect(previousButton).toHaveClass('inline-flex', 'bg-transparent', 'hover:bg-slab-border/50', 'active:scale-95', 'active:bg-slab-border')
    expect(nextButton).toHaveClass('h-11', 'w-11', 'disabled:pointer-events-none', 'disabled:opacity-30')
    expect(nextButton).toBeDisabled()
    expect(onChange).toHaveBeenCalledWith({ year: 2026, month: 5 })

    // Act: Attempt to use the semantically disabled future-month control.
    await user.click(nextButton)

    // Assert: The disabled button does not request another month change.
    expect(onChange).toHaveBeenCalledOnce()
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
