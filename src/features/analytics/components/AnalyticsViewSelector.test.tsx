import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import {
  AnalyticsViewSelector,
  type AnalyticsView,
} from './AnalyticsViewSelector'

function StatefulSelector({ initialValue = 'overview' }: { initialValue?: AnalyticsView }) {
  const [value, setValue] = useState<AnalyticsView>(initialValue)
  return <AnalyticsViewSelector value={value} onChange={setValue} />
}

/**
 * Test suite for the mobile-only Analytics view selector.
 *
 * Verifies semantic tab relationships, full-width touch targets, and automatic
 * keyboard selection/focus behavior for the two Analytics subviews.
 */
describe('AnalyticsViewSelector', () => {
  it('renders a labelled full-width tablist with Overview selected by default', () => {
    // Arrange / Act: Render the controlled selector at its entry state.
    render(<StatefulSelector />)

    // Assert: Tabs expose the expected label, selection, and panel relationships.
    const tablist = screen.getByRole('tablist', { name: 'Analytics view' })
    const overview = screen.getByRole('tab', { name: 'Overview' })
    const monthly = screen.getByRole('tab', { name: 'Monthly' })
    expect(tablist).toHaveClass('grid', 'w-full', 'grid-cols-2')
    expect(overview).toHaveAttribute('aria-selected', 'true')
    expect(overview).toHaveAttribute('tabindex', '0')
    expect(monthly).toHaveAttribute('aria-selected', 'false')
    expect(monthly).toHaveAttribute('tabindex', '-1')
    expect(overview).toHaveAttribute('aria-controls', 'analytics-overview-panel')
    expect(monthly).toHaveAttribute('aria-controls', 'analytics-monthly-panel')
    expect(overview.getAttribute('aria-controls')).not.toBe(monthly.getAttribute('aria-controls'))
    expect(overview).toHaveClass('min-h-[44px]', 'focus-visible:ring-2')
    expect(monthly).toHaveClass('min-h-[44px]', 'focus-visible:ring-2')
  })

  it('selects Monthly when its tab is clicked', async () => {
    // Arrange: Render the Overview entry state.
    const user = userEvent.setup()
    render(<StatefulSelector />)

    // Act: Choose Monthly.
    await user.click(screen.getByRole('tab', { name: 'Monthly' }))

    // Assert: Controlled selection and roving tab stop update together.
    expect(screen.getByRole('tab', { name: 'Monthly' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Monthly' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'false')
  })

  it('automatically selects and focuses the adjacent view with Arrow keys', async () => {
    // Arrange: Start on Overview and focus its active tab.
    const user = userEvent.setup()
    render(<StatefulSelector />)
    const overview = screen.getByRole('tab', { name: 'Overview' })
    overview.focus()

    // Act: Move right, then wrap left from the first tab.
    await user.keyboard('{ArrowRight}')
    const monthly = screen.getByRole('tab', { name: 'Monthly' })

    // Assert: Arrow navigation activates and focuses the destination tab.
    expect(monthly).toHaveFocus()
    expect(monthly).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowLeft}')
    expect(overview).toHaveFocus()
    expect(overview).toHaveAttribute('aria-selected', 'true')
  })

  it('selects and focuses the first or last view with Home and End', async () => {
    // Arrange: Start with Monthly active.
    const user = userEvent.setup()
    render(<StatefulSelector initialValue="monthly" />)
    const monthly = screen.getByRole('tab', { name: 'Monthly' })
    monthly.focus()

    // Act: Move to the first then last tab using the explicit boundary keys.
    await user.keyboard('{Home}')
    const overview = screen.getByRole('tab', { name: 'Overview' })
    expect(overview).toHaveFocus()
    expect(overview).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{End}')

    // Assert: End restores the final view with automatic activation.
    expect(monthly).toHaveFocus()
    expect(monthly).toHaveAttribute('aria-selected', 'true')
  })
})
