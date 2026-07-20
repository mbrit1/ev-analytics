import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OverallPriceInfoDisclosure } from './OverallPriceInfoDisclosure'

function createRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    width,
    height,
    top,
    right: left + width,
    bottom: top + height,
    left,
    toJSON: () => ({}),
  } as DOMRect
}

/**
 * Test suite for the Overall Price calculation disclosure.
 *
 * Verifies the layout-adaptive popover and bottom-sheet semantics, exact
 * explanation, focus recovery, and background isolation.
 */
describe('OverallPriceInfoDisclosure', () => {
  it('opens a body-portal non-modal region beside the sidebar trigger', async () => {
    // Arrange: Render the desktop sidebar variant in its collapsed state.
    const user = userEvent.setup()
    const { container } = render(<OverallPriceInfoDisclosure layoutMode="sidebar" />)
    const trigger = screen.getByRole('button', {
      name: 'How Overall Price is calculated',
    })

    // Act: Open the calculation explanation from its compact trigger.
    await user.click(trigger)

    // Assert: The out-of-flow region is labelled, portal-mounted, and non-modal.
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-controls')
    const disclosure = screen.getByRole('region', {
      name: 'How Overall Price is calculated',
    })
    expect(disclosure).toHaveClass('fixed', 'max-w-[calc(100vw-2rem)]')
    expect(disclosure).not.toHaveAttribute('aria-modal')
    expect(disclosure.parentElement).not.toBe(container)
    expect(screen.getByText(
      'Overall Price divides included spend by provider-billed energy across all recorded sessions. Fixed tariff fees are included only for months in which that tariff was used. The current month is calculated through today. Battery-added energy is not included.',
    )).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close Overall Price information' }))
      .toHaveClass('min-h-[44px]', 'min-w-[44px]', 'motion-reduce:transition-none')
    expect(trigger).toHaveClass('min-h-[44px]', 'min-w-[44px]', 'motion-reduce:transition-none')
  })

  it('flips above and clamps the sidebar popover within the viewport after resize', async () => {
    // Arrange: Place the trigger at the lower-right viewport edge.
    const originalViewport = { width: window.innerWidth, height: window.innerHeight }
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 1024 },
      innerHeight: { configurable: true, value: 768 },
    })
    const user = userEvent.setup()
    render(<OverallPriceInfoDisclosure layoutMode="sidebar" />)
    const trigger = screen.getByRole('button', { name: 'How Overall Price is calculated' })
    const triggerRect = vi.spyOn(trigger, 'getBoundingClientRect')
      .mockReturnValue(createRect(990, 740, 44, 44))

    // Act: Open the popover and recalculate after its measured surface is available.
    await user.click(trigger)
    const disclosure = screen.getByRole('region', { name: 'How Overall Price is calculated' })
    vi.spyOn(disclosure, 'getBoundingClientRect').mockReturnValue(createRect(0, 0, 352, 180))
    fireEvent.resize(window)

    // Assert: The out-of-flow surface flips above and stays inside both right and bottom gutters.
    expect(disclosure).toHaveStyle({ left: '630px', top: '552px' })
    triggerRect.mockReturnValue(createRect(396, 182, 44, 44))
    fireEvent.scroll(window)
    expect(disclosure).toHaveStyle({ left: '36px', top: '16px' })
    triggerRect.mockReturnValue(createRect(20, 20, 44, 44))
    fireEvent.scroll(window)
    expect(disclosure).toHaveStyle({ left: '16px', top: '72px' })
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: originalViewport.width },
      innerHeight: { configurable: true, value: originalViewport.height },
    })
  })

  it('dismisses the sidebar popover on outside interaction, Escape, and close while restoring focus', async () => {
    // Arrange: Open the sidebar popover beside an outside page control.
    const user = userEvent.setup()
    render(
      <div>
        <OverallPriceInfoDisclosure layoutMode="sidebar" />
        <button type="button">Outside control</button>
      </div>,
    )
    const trigger = screen.getByRole('button', {
      name: 'How Overall Price is calculated',
    })
    await user.click(trigger)

    // Act: Dismiss with outside interaction, then Escape, then the close control.
    await user.click(screen.getByRole('button', { name: 'Outside control' }))
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Close Overall Price information' }))

    // Assert: Every dismissal removes the popover and restores its trigger.
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens a modal bottom sheet with focus trapping and locked inert background', async () => {
    // Arrange: Render the narrow bottom-dock variant with a page sibling.
    const user = userEvent.setup()
    const { container } = render(
      <div>
        <OverallPriceInfoDisclosure layoutMode="bottom-dock" />
        <button type="button">Background control</button>
      </div>,
    )
    const trigger = screen.getByRole('button', { name: 'How Overall Price is calculated' })

    // Act: Open the bottom sheet and tab from its entry focus.
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'How Overall Price is calculated' })
    const close = screen.getByRole('button', { name: 'Close Overall Price information' })
    await user.tab()

    // Assert: The sheet is modal, keeps focus inside, and isolates scrolling/background content.
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-controls', dialog.id)
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveClass('bottom-0', 'overflow-y-auto', 'motion-reduce:transition-none')
    expect(dialog.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(dialog.firstElementChild).toHaveClass('h-1', 'w-12', 'bg-secondary/40')
    expect(close).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')
    expect(container).toHaveAttribute('inert')
    expect(close).toHaveClass('min-h-[44px]', 'min-w-[44px]', 'motion-reduce:transition-none')
  })

  it('restores focus only after removing modal background isolation', async () => {
    // Arrange: Keep an existing body overflow value and open the mobile sheet.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'clip'
    try {
      const user = userEvent.setup()
      const { container } = render(<OverallPriceInfoDisclosure layoutMode="bottom-dock" />)
      const trigger = screen.getByRole('button', { name: 'How Overall Price is calculated' })
      await user.click(trigger)
      const originalFocus = trigger.focus.bind(trigger)
      const focusSpy = vi.spyOn(trigger, 'focus').mockImplementation(() => {
        expect(container).not.toHaveAttribute('inert')
        originalFocus()
      })

      // Act: Dismiss through the sheet's close control.
      await user.click(screen.getByRole('button', { name: 'Close Overall Price information' }))

      // Assert: Existing scroll styling, background interactivity, and trigger focus all recover.
      expect(focusSpy).toHaveBeenCalledOnce()
      expect(trigger).toHaveFocus()
      expect(container).not.toHaveAttribute('inert')
      expect(document.body.style.overflow).toBe('clip')
    } finally {
      document.body.style.overflow = previousOverflow
    }
  })

  it('dismisses the bottom sheet with Escape, its backdrop, and a layout-mode change', async () => {
    // Arrange: Open the narrow modal variant.
    const user = userEvent.setup()
    const { rerender } = render(<OverallPriceInfoDisclosure layoutMode="bottom-dock" />)
    const trigger = screen.getByRole('button', { name: 'How Overall Price is calculated' })
    await user.click(trigger)

    // Act: Close with Escape, reopen and close from the backdrop, then reopen across a mode change.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Dismiss Overall Price information' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    rerender(<OverallPriceInfoDisclosure layoutMode="sidebar" />)

    // Assert: No modal state survives an adaptive layout change and scrolling is restored.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })
})
