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
    const nextButton = screen.getByRole('button', { name: 'Next month' })
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose analysis period' })).toBeInTheDocument()
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

  it('opens a modal mobile period sheet with selected state, trapped focus and cleanup', async () => {
    // Arrange: Render calendar-month mode and retain the original background state.
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { container } = render(
      <AnalyticsMonthSelector
        selection={{ kind: 'month', month: { year: 2026, month: 6 } }}
        selectedMonth={{ year: 2026, month: 6 }}
        currentMonth={{ year: 2026, month: 6 }}
        onChange={onChange}
      />,
    )
    const originalOverflow = document.body.style.overflow
    const trigger = screen.getByRole('button', { name: 'Choose analysis period' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // Act: Open the sheet and wrap keyboard focus in both directions.
    await user.click(trigger)
    const sheet = screen.getByRole('dialog', { name: 'Analysis period' })
    const calendarMonth = within(sheet).getByRole('button', { name: 'Calendar Month' })
    const cancel = within(sheet).getByRole('button', { name: 'Cancel' })

    // Assert: The active choice is selected, while background scrolling and focus are blocked.
    expect(sheet).toHaveAttribute('aria-modal', 'true')
    expect(calendarMonth).toHaveAttribute('aria-pressed', 'true')
    expect(calendarMonth).toHaveFocus()
    expect(container).toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('hidden')
    expect(within(sheet).getAllByRole('button')).toHaveLength(6)
    await user.tab({ shift: true })
    expect(cancel).toHaveFocus()
    await user.tab()
    expect(calendarMonth).toHaveFocus()

    // Act: Cancel the sheet without changing the period.
    await user.click(cancel)

    // Assert: Background state and trigger focus are restored.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(container).not.toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe(originalOverflow)
    expect(trigger).toHaveFocus()
    expect(onChange).not.toHaveBeenCalled()

    // Act: Exercise the other existing dismissal paths.
    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Dismiss Analysis period' }))

    // Assert: Backdrop dismissal also cleans up without a selection.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(onChange).not.toHaveBeenCalled()
  })

  it.each([
    ['7 Days', '7-days'], ['30 Days', '30-days'], ['3 Months', '3-months'], ['Year', 'year'],
  ] as const)('keeps mobile %s rolling and restores the remembered calendar month through its sheet', async (label, preset) => {
    // Arrange: Render a relative range with a historical calendar month retained.
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <AnalyticsMonthSelector
        selection={{ kind: 'preset', preset }}
        selectedMonth={{ year: 2026, month: 5 }}
        currentMonth={{ year: 2026, month: 6 }}
        onChange={onChange}
      />,
    )

    // Assert: Relative mode has only its label and the options control.
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Previous month' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next month' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Choose calendar month/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()

    // Act: Open the sheet and return to Calendar Month.
    const trigger = screen.getByRole('button', { name: 'Choose analysis period' })
    await user.click(trigger)
    const sheet = screen.getByRole('dialog', { name: 'Analysis period' })
    expect(within(sheet).getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true')
    expect(within(sheet).getByRole('button', { name: label })).toHaveFocus()
    await user.click(within(sheet).getByRole('button', { name: 'Calendar Month' }))

    // Assert: Selection restores the retained month and closes with focus recovery.
    expect(onChange).toHaveBeenCalledWith({ kind: 'month', month: { year: 2026, month: 5 } })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('opens the mobile month-year chooser with future restrictions and historical selection', async () => {
    // Arrange: July is the current month.
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
    const trigger = screen.getByRole('button', { name: 'Choose calendar month, July 2026' })

    // Act: Open the existing month/year interaction as a mobile sheet.
    await user.click(trigger)
    const sheet = screen.getByRole('dialog', { name: 'Choose month and year' })

    // Assert: Current month is focused, and future choices are disabled.
    expect(within(sheet).getByRole('button', { name: 'July' })).toHaveFocus()
    expect(within(sheet).getByRole('button', { name: 'August' })).toBeDisabled()
    expect(within(sheet).getByRole('button', { name: 'Next year' })).toBeDisabled()

    // Act: Choose a month from the preceding year.
    await user.click(within(sheet).getByRole('button', { name: 'Previous year' }))
    await user.click(within(sheet).getByRole('button', { name: 'June' }))

    // Assert: Calendar selection commits once and restores month-trigger focus.
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith({ kind: 'month', month: { year: 2025, month: 5 } })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('cleans up an open mobile sheet and restores options focus after switching to desktop', async () => {
    // Arrange: Open the mobile options sheet before crossing the sidebar breakpoint.
    const user = userEvent.setup()
    const props = {
      selection: { kind: 'month', month: { year: 2026, month: 6 } } as AnalyticsPeriodSelection,
      selectedMonth: { year: 2026, month: 6 },
      currentMonth: { year: 2026, month: 6 },
      onChange: vi.fn(),
    }
    const { container, rerender } = render(<AnalyticsMonthSelector {...props} />)
    await user.click(screen.getByRole('button', { name: 'Choose analysis period' }))

    // Act: Replace the mobile controls while their sheet is open.
    rerender(<AnalyticsMonthSelector {...props} layoutMode="sidebar" />)
    await act(async () => {})

    // Assert: The sheet releases background state and focus returns to desktop options.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(container).not.toHaveAttribute('inert')
    expect(document.body.style.overflow).not.toBe('hidden')
    expect(screen.getByRole('button', { name: 'Other ranges' })).toHaveFocus()
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

  it.each(['bottom-dock', 'sidebar'] as const)('announces selected month changes in %s layout', async (layoutMode) => {
    // Arrange: Render a completed month with a controlled selection.
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <AnalyticsMonthSelector
        layoutMode={layoutMode}
        selection={{ kind: 'month', month: { year: 2026, month: 5 } }}
        selectedMonth={{ year: 2026, month: 5 }}
        currentMonth={{ year: 2026, month: 6 }}
        onChange={onChange}
      />,
    )
    const announcer = document.querySelector('[aria-live="polite"][aria-atomic="true"]')
    expect(announcer).toHaveTextContent('Selected month: June 2026')

    // Act: Move backward, then forward, applying each controlled value.
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    rerender(
      <AnalyticsMonthSelector
        layoutMode={layoutMode}
        selection={{ kind: 'month', month: { year: 2026, month: 4 } }}
        selectedMonth={{ year: 2026, month: 4 }}
        currentMonth={{ year: 2026, month: 6 }}
        onChange={onChange}
      />,
    )
    expect(announcer).toHaveTextContent('Selected month: May 2026')
    await user.click(screen.getByRole('button', { name: 'Next month' }))
    rerender(
      <AnalyticsMonthSelector
        layoutMode={layoutMode}
        selection={{ kind: 'month', month: { year: 2026, month: 5 } }}
        selectedMonth={{ year: 2026, month: 5 }}
        currentMonth={{ year: 2026, month: 6 }}
        onChange={onChange}
      />,
    )

    // Assert: The polite atomic announcement updates with the selected month.
    expect(announcer).toHaveTextContent('Selected month: June 2026')
  })

  it.each([
    ['month', 'Choose calendar month, July 2026', 'July'],
    ['ranges', 'Other ranges', '7 Days'],
  ] as const)('restores %s popup focus across both breakpoint directions', async (identity, triggerName, popupButton) => {
    // Arrange: Render with an independent outside focus target.
    const user = userEvent.setup()
    const props = {
      selection: { kind: 'month', month: { year: 2026, month: 6 } } as AnalyticsPeriodSelection,
      selectedMonth: { year: 2026, month: 6 },
      currentMonth: { year: 2026, month: 6 },
      onChange: vi.fn(),
    }
    const { rerender } = render(
      <><AnalyticsMonthSelector {...props} layoutMode="bottom-dock" /><button type="button">Outside focus</button></>,
    )
    const outside = screen.getByRole('button', { name: 'Outside focus' })

    // Act: Focus inside each popup, then cross desktop/mobile and back.
    if (identity === 'month') {
      await user.click(screen.getByRole('button', { name: 'Choose calendar month, July 2026' }))
      act(() => within(screen.getByRole('dialog', { name: 'Choose month and year' })).getByRole('button', { name: popupButton }).focus())
    } else {
      await user.click(screen.getByRole('button', { name: 'Choose analysis period' }))
      act(() => within(screen.getByRole('dialog', { name: 'Analysis period' })).getByRole('button', { name: popupButton }).focus())
    }
    rerender(<><AnalyticsMonthSelector {...props} layoutMode="sidebar" /><button type="button">Outside focus</button></>)
    await act(async () => {})
    const desktopControl = screen.getByRole('button', { name: triggerName })
    expect(desktopControl).toHaveFocus()
    if (identity === 'month') {
      await user.click(desktopControl)
      act(() => within(screen.getByRole('dialog', { name: 'Choose month and year' })).getByRole('button', { name: popupButton }).focus())
    } else {
      await user.click(desktopControl)
      act(() => within(screen.getByRole('dialog', { name: 'Other ranges' })).getByRole('button', { name: popupButton }).focus())
    }
    rerender(<><AnalyticsMonthSelector {...props} layoutMode="bottom-dock" /><button type="button">Outside focus</button></>)
    await act(async () => {})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const mobileControl = identity === 'month'
      ? screen.getByRole('button', { name: triggerName })
      : screen.getByRole('button', { name: 'Choose analysis period' })
    expect(mobileControl).toHaveFocus()
    expect(document.body.style.overflow).not.toBe('hidden')

    // Assert: Layout changes do not reclaim focus after it has moved outside.
    act(() => outside.focus())
    rerender(<><AnalyticsMonthSelector {...props} layoutMode="sidebar" /><button type="button">Outside focus</button></>)
    await act(async () => {})
    expect(outside).toHaveFocus()
  })


  it.each(['Previous month', 'Next month'] as const)('restores focus to the equivalent %s arrow across breakpoints', async (label) => {
    // Arrange: Keep both month arrows enabled while changing layouts.
    const props = {
      selection: { kind: 'month', month: { year: 2026, month: 5 } } as AnalyticsPeriodSelection,
      selectedMonth: { year: 2026, month: 5 },
      currentMonth: { year: 2026, month: 7 },
      onChange: vi.fn(),
    }
    const { rerender } = render(<AnalyticsMonthSelector {...props} layoutMode="bottom-dock" />)

    // Act: Focus each arrow and switch to the other composition.
    const mobileArrow = screen.getByRole('button', { name: label })
    act(() => mobileArrow.focus())
    rerender(<AnalyticsMonthSelector {...props} layoutMode="sidebar" />)
    await act(async () => {})
    const desktopArrow = screen.getByRole('button', { name: label })
    expect(desktopArrow).toHaveFocus()

    // Assert: The existing arrow focus recovery also works in reverse.
    act(() => desktopArrow.focus())
    rerender(<AnalyticsMonthSelector {...props} layoutMode="bottom-dock" />)
    await act(async () => {})
    expect(screen.getByRole('button', { name: label })).toHaveFocus()
  })


  it('does not restore stale selector focus after outside focus is replaced', async () => {
    // Arrange: Keep focusable controls outside the selector across layout changes.
    const props = {
      selection: { kind: 'month', month: { year: 2026, month: 5 } } as AnalyticsPeriodSelection,
      selectedMonth: { year: 2026, month: 5 },
      currentMonth: { year: 2026, month: 7 },
      onChange: vi.fn(),
    }
    const outsideButton = (layoutMode: 'bottom-dock' | 'sidebar') => (
      <button key={layoutMode} type="button">Outside focus</button>
    )
    const { rerender } = render(
      <><AnalyticsMonthSelector {...props} layoutMode="bottom-dock" />{outsideButton('bottom-dock')}</>,
    )

    // Act: Leave the selector, then replace the focused outside node during a breakpoint change.
    act(() => screen.getByRole('button', { name: 'Next month' }).focus())
    act(() => screen.getByRole('button', { name: 'Outside focus' }).focus())
    rerender(<><AnalyticsMonthSelector {...props} layoutMode="sidebar" />{outsideButton('sidebar')}</>)
    await act(async () => {})

    // Assert: Stale selector focus is not reclaimed when the outside node is removed.
    expect(screen.getByRole('button', { name: 'Next month' })).not.toHaveFocus()
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
