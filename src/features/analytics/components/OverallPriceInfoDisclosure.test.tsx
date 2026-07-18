import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { OverallPriceInfoDisclosure } from './OverallPriceInfoDisclosure'

/**
 * Test suite for the Overall Price calculation disclosure.
 *
 * Verifies its labelled non-modal semantics, focus recovery, and inline
 * constrained-width presentation.
 */
describe('OverallPriceInfoDisclosure', () => {
  it('exposes a labelled expandable explanation', async () => {
    // Arrange: Render the disclosure in its collapsed state.
    const user = userEvent.setup()
    render(<OverallPriceInfoDisclosure />)
    const trigger = screen.getByRole('button', {
      name: 'How Overall Price is calculated',
    })

    // Act: Open the calculation explanation.
    await user.click(trigger)

    // Assert: Expanded state and disclosure content are linked accessibly.
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-controls')
    expect(screen.getByRole('region', { name: 'About Overall Price' })).toBeInTheDocument()
    expect(screen.getByText(/Overall price divides included spend/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close Overall Price information' }))
      .toHaveClass('min-h-[44px]', 'min-w-[44px]')
  })

  it('closes on Escape and returns focus to its trigger', async () => {
    // Arrange: Open the disclosure and move focus into its close control.
    const user = userEvent.setup()
    render(<OverallPriceInfoDisclosure />)
    const trigger = screen.getByRole('button', {
      name: 'How Overall Price is calculated',
    })
    await user.click(trigger)
    const close = screen.getByRole('button', { name: 'Close Overall Price information' })
    close.focus()

    // Act: Dismiss with Escape.
    await user.keyboard('{Escape}')

    // Assert: The non-modal content closes and focus is recoverable.
    expect(screen.queryByRole('region', { name: 'About Overall Price' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('dismisses when interaction moves outside the inline disclosure', async () => {
    // Arrange: Open the disclosure.
    const user = userEvent.setup()
    render(<OverallPriceInfoDisclosure />)
    await user.click(screen.getByRole('button', { name: 'How Overall Price is calculated' }))

    // Act: Interact outside its component boundary.
    fireEvent.pointerDown(document.body)

    // Assert: Outside dismissal does not leave stale explanatory content open.
    expect(screen.queryByRole('region', { name: 'About Overall Price' })).not.toBeInTheDocument()
  })

  it('uses an inline, reduced-motion-safe disclosure layout', async () => {
    // Arrange: Render and expand the narrow-width-safe disclosure.
    const user = userEvent.setup()
    render(<OverallPriceInfoDisclosure />)
    await user.click(screen.getByRole('button', { name: 'How Overall Price is calculated' }))

    // Act: Locate the disclosure region.
    const disclosure = screen.getByRole('region', { name: 'About Overall Price' })

    // Assert: It can reflow inside the slab without an anchored overlay.
    expect(disclosure).toHaveClass('w-full', 'motion-reduce:transition-none')
    expect(disclosure).not.toHaveClass('absolute')
  })
})
