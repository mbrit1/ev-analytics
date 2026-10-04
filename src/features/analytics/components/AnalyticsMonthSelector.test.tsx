import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsPeriodSelection } from '../model/analyticsPeriods'
import { AnalyticsMonthSelector } from './AnalyticsMonthSelector'

/**
 * Test suite for the analytics period selector.
 *
 * Verifies keyboard-accessible period choices and prevention of future months.
 */
describe('AnalyticsMonthSelector', () => {
  it('navigates backward and disables next at the current month', async () => {
    // Arrange: Render the current month with a change callback.
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <AnalyticsMonthSelector
        selection={{ kind: 'month', month: { year: 2026, month: 6 } }}
        selectedMonth={{ year: 2026, month: 6 }}
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
    expect(selector).toHaveClass('mx-auto', 'grid', 'grid-cols-[44px_minmax(0,1fr)_44px]')
    expect(previousButton).toHaveClass('h-11', 'w-11')
    expect(previousButton).toHaveClass('inline-flex', 'bg-transparent', 'hover:bg-slab-border/50', 'active:scale-95', 'active:bg-slab-border')
    expect(nextButton).toHaveClass('h-11', 'w-11', 'disabled:pointer-events-none', 'disabled:opacity-30')
    expect(nextButton).toBeDisabled()
    expect(onChange).toHaveBeenCalledWith({ kind: 'month', month: { year: 2026, month: 5 } })

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
        selection={{ kind: 'month', month: { year: 2026, month: 5 } }}
        selectedMonth={{ year: 2026, month: 5 }}
        currentMonth={{ year: 2026, month: 6 }}
        onChange={onChange}
      />,
    )

    // Act: Move toward the current month.
    const nextButton = screen.getByRole('button', { name: 'Next month' })
    await user.click(nextButton)

    // Assert: Forward navigation is enabled and requests July.
    expect(nextButton).toBeEnabled()
    expect(onChange).toHaveBeenCalledWith({ kind: 'month', month: { year: 2026, month: 6 } })
  })

  it('supports arrow-key selection across the tactile preset choices', async () => {
    // Arrange: Start with calendar-month mode selected and focused.
    const onChange = vi.fn()
    const { rerender } = render(
      <AnalyticsMonthSelector
        selection={{ kind: 'month', month: { year: 2026, month: 6 } }}
        selectedMonth={{ year: 2026, month: 6 }}
        currentMonth={{ year: 2026, month: 6 }}
        onChange={onChange}
      />,
    )
    const calendarMonth = screen.getByRole('radio', { name: 'Calendar Month' })
    calendarMonth.focus()

    // Act: Move to the following period option with the native radio arrow behavior.
    await userEvent.keyboard('{ArrowRight}')

    // Assert: Focus and selection callback move to the seven-day preset.
    expect(screen.getByRole('radio', { name: '7 Days' })).toHaveFocus()
    expect(onChange).toHaveBeenCalledWith({ kind: 'preset', preset: '7-days' })

    // Act: Apply the controlled selection change from the page.
    rerender(
      <AnalyticsMonthSelector
        selection={{ kind: 'preset', preset: '7-days' }}
        selectedMonth={{ year: 2026, month: 6 }}
        currentMonth={{ year: 2026, month: 6 }}
        onChange={onChange}
      />,
    )

    // Assert: The chosen preset is now exposed as selected.
    expect(screen.getByRole('radio', { name: '7 Days' })).toHaveAttribute('aria-checked', 'true')
  })

  it('keeps presets hidden on desktop until Other ranges is opened', async () => {
    // Arrange: Render the desktop month-first selector.
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <AnalyticsMonthSelector
        layoutMode="sidebar"
        selection={{ kind: 'month', month: { year: 2026, month: 6 } }}
        selectedMonth={{ year: 2026, month: 6 }}
        currentMonth={{ year: 2026, month: 6 }}
        onChange={onChange}
      />,
    )

    // Act: Open the secondary range choices and select a trailing period.
    expect(screen.queryByRole('button', { name: '7 Days' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Other ranges' }))
    const popup = screen.getByRole('dialog', { name: 'Other ranges' })
    await user.click(within(popup).getByRole('button', { name: '30 Days' }))

    // Act: The page applies the controlled selection update.
    rerender(
      <AnalyticsMonthSelector
        layoutMode="sidebar"
        selection={{ kind: 'preset', preset: '30-days' }}
        selectedMonth={{ year: 2026, month: 6 }}
        currentMonth={{ year: 2026, month: 6 }}
        onChange={onChange}
      />,
    )

    // Assert: Selection closes the popup, returns focus and marks the active range on its trigger.
    expect(onChange).toHaveBeenCalledWith({ kind: 'preset', preset: '30-days' })
    expect(screen.queryByRole('dialog', { name: 'Other ranges' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Other ranges (30 Days)' })).toHaveFocus()
  })

  it('selects months from the month-year popup and disables future choices', async () => {
    // Arrange: Render July 2026 as the current desktop month.
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <AnalyticsMonthSelector
        layoutMode="sidebar"
        selection={{ kind: 'month', month: { year: 2026, month: 6 } }}
        selectedMonth={{ year: 2026, month: 6 }}
        currentMonth={{ year: 2026, month: 6 }}
        onChange={onChange}
      />,
    )

    // Act: Open the month-year picker and choose June.
    const trigger = screen.getByRole('button', { name: /Choose calendar month/ })
    await user.click(trigger)
    const picker = screen.getByRole('dialog', { name: 'Choose month and year' })

    // Assert: Future months and years are unavailable.
    expect(within(picker).getByRole('button', { name: 'August' })).toBeDisabled()
    expect(within(picker).getByRole('button', { name: 'Next year' })).toBeDisabled()
    expect(within(picker).getByRole('button', { name: 'July' })).toHaveFocus()

    // Act: Dismiss the picker with Escape, then reopen it to commit June.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Choose month and year' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    const reopenedPicker = screen.getByRole('dialog', { name: 'Choose month and year' })
    await user.click(within(reopenedPicker).getByRole('button', { name: 'June' }))

    // Assert: The historical month is selected, the popup closes, and focus returns.
    expect(onChange).toHaveBeenCalledWith({ kind: 'month', month: { year: 2026, month: 5 } })
    expect(screen.queryByRole('dialog', { name: 'Choose month and year' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it.each([
    ['7 Days', '7-days'],
    ['30 Days', '30-days'],
    ['3 Months', '3-months'],
    ['Year', 'year'],
  ] as const)('shows %s without navigation and restores calendar mode through options', async (label, preset) => {
    // Arrange: Keep a historical calendar month in memory while a rolling range is active.
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <AnalyticsMonthSelector
        layoutMode="sidebar"
        selection={{ kind: 'preset', preset }}
        selectedMonth={{ year: 2026, month: 5 }}
        currentMonth={{ year: 2026, month: 6 }}
        onChange={onChange}
      />,
    )

    // Assert: Rolling periods show their own label and have no historical stepping controls.
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Previous month' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next month' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Choose calendar month/ })).not.toBeInTheDocument()

    // Act: Restore calendar-month mode through the existing secondary control.
    const trigger = screen.getByRole('button', { name: `Other ranges (${label})` })
    await user.click(trigger)
    const popup = screen.getByRole('dialog', { name: 'Other ranges' })
    expect(within(popup).getByRole('button', { name: label })).toHaveFocus()
    await user.click(within(popup).getByRole('button', { name: 'Calendar Month' }))

    // Assert: The remembered month is restored and focus returns to the options control.
    expect(onChange).toHaveBeenCalledWith({ kind: 'month', month: { year: 2026, month: 5 } })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('dismisses the range popup on Escape and outside focus without stealing focus', async () => {
    // Arrange: Render the selector beside an independent focus target.
    const user = userEvent.setup()
    const onChange = vi.fn<(selection: AnalyticsPeriodSelection) => void>()
    render(
      <>
        <AnalyticsMonthSelector
          layoutMode="sidebar"
          selection={{ kind: 'month', month: { year: 2026, month: 6 } }}
          selectedMonth={{ year: 2026, month: 6 }}
          currentMonth={{ year: 2026, month: 6 }}
          onChange={onChange}
        />
        <button type="button">Outside</button>
        <div data-testid="outside-pointer-target">Outside surface</div>
      </>,
    )
    const trigger = screen.getByRole('button', { name: 'Other ranges' })
    const outside = screen.getByRole('button', { name: 'Outside' })
    const outsidePointerTarget = screen.getByTestId('outside-pointer-target')

    // Act: Dismiss once with Escape, then reopen and move focus outside.
    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    await user.pointer({ keys: '[MouseLeft]', target: outsidePointerTarget })
    expect(screen.queryByRole('dialog', { name: 'Other ranges' })).not.toBeInTheDocument()
    await user.click(trigger)
    act(() => outside.focus())

    // Assert: Focus dismissal closes the popup while preserving outside focus.
    expect(screen.queryByRole('dialog', { name: 'Other ranges' })).not.toBeInTheDocument()
    expect(outside).toHaveFocus()
  })
})
