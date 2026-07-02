import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MobileNavigationDock } from './MobileNavigationDock'

/**
 * Test suite for the mobile navigation dock.
 *
 * Verifies the dock stays navigation-only, exposes the three destinations, and
 * preserves the active-state callback contract used by the app shell.
 */
describe('MobileNavigationDock', () => {
  it('renders the three navigation destinations without any create action', () => {
    // Arrange: Render the dock with Sessions selected.
    const onTabChange = vi.fn()

    // Act: Mount the mobile dock in its default state.
    render(<MobileNavigationDock activeTab="sessions" onTabChange={onTabChange} />)

    // Assert: The dock is mobile-only, contains the three destinations, and no create action.
    const dock = screen.getByRole('navigation', { name: 'Primary mobile actions' })
    expect(dock).toHaveClass('md:hidden')
    expect(dock).toHaveAttribute(
      'style',
      expect.stringContaining('padding-bottom: calc(10px + env(safe-area-inset-bottom))')
    )
    expect(dock).toHaveStyle({ bottom: '0px' })
    expect(dock.firstElementChild).toHaveClass('grid')
    expect(dock.firstElementChild).toHaveClass('grid-cols-3')

    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Sessions' })).toHaveClass('w-full')
    expect(screen.getByRole('button', { name: 'Sessions' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Sessions' })).not.toHaveAttribute('aria-pressed')
    expect(screen.getByRole('button', { name: 'Tariffs' })).not.toHaveAttribute('aria-pressed')
    expect(screen.getByRole('button', { name: 'Analytics' })).not.toHaveAttribute('aria-pressed')
    expect(screen.queryByRole('button', { name: /add/i })).not.toBeInTheDocument()
  })

  it('forwards tab changes from the dock controls', () => {
    // Arrange: Render the dock with Sessions selected.
    const onTabChange = vi.fn()
    render(<MobileNavigationDock activeTab="sessions" onTabChange={onTabChange} />)

    // Act: Use each dock destination.
    fireEvent.click(screen.getByRole('button', { name: 'Tariffs' }))
    fireEvent.click(screen.getByRole('button', { name: 'Analytics' }))

    // Assert: The dock forwards the expected tab changes.
    expect(onTabChange).toHaveBeenCalledWith('tariffs')
    expect(onTabChange).toHaveBeenCalledWith('analytics')
  })

  it('keeps aria-current in sync with the selected tab', () => {
    // Arrange: Render the dock with Tariffs selected.
    const onTabChange = vi.fn()

    // Act: Mount the mobile dock in a non-default active state.
    render(<MobileNavigationDock activeTab="tariffs" onTabChange={onTabChange} />)

    // Assert: Only the active destination advertises the current page state.
    expect(screen.getByRole('button', { name: 'Tariffs' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Sessions' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: 'Analytics' })).not.toHaveAttribute('aria-current')
  })
})
