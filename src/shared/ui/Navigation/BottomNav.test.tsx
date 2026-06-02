import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BottomNav } from './BottomNav'

/**
 * Test suite for the BottomNav component.
 *
 * Verifies the mobile dock exposes the three navigation destinations, applies
 * the active-state accessibility contract, and forwards tab callbacks.
 */
describe('BottomNav', () => {
  it('renders the mobile dock controls with the active-state contract', () => {
    // Arrange: Render the dock in its default mobile state.
    const onTabChange = vi.fn()

    // Act: Mount the dock with Sessions selected.
    render(<BottomNav activeTab="sessions" onTabChange={onTabChange} />)

    // Assert: The dock is mobile-only, labeled, and exposes three controls.
    const dock = screen.getByRole('navigation', { name: 'Primary mobile actions' })
    expect(dock).toHaveClass('md:hidden')

    const dockButtons = screen.getAllByRole('button')
    expect(dockButtons).toHaveLength(3)
    dockButtons.forEach((button) => {
      expect(button).toHaveClass('min-h-[44px]')
      expect(button).toHaveClass('w-full')
    })

    expect(screen.getByRole('button', { name: 'Sessions' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Sessions' })).not.toHaveAttribute('aria-pressed')
    expect(screen.getByRole('button', { name: 'Tariffs' })).not.toHaveAttribute('aria-pressed')
    expect(screen.getByRole('button', { name: 'Analytics' })).not.toHaveAttribute('aria-pressed')
    expect(screen.getByRole('button', { name: 'Sessions' })).toHaveClass('font-bold')

    // Act: Use the dock actions that the shell depends on.
    fireEvent.click(screen.getByRole('button', { name: 'Tariffs' }))
    fireEvent.click(screen.getByRole('button', { name: 'Analytics' }))

    // Assert: The dock forwards the expected callbacks.
    expect(onTabChange).toHaveBeenCalledWith('tariffs')
    expect(onTabChange).toHaveBeenCalledWith('analytics')
  })

  it('marks Tariffs as the active destination when that tab is selected', () => {
    // Arrange: Render the dock with Tariffs active.
    render(<BottomNav activeTab="tariffs" onTabChange={vi.fn()} />)

    // Assert: The active destination is exposed for assistive technologies.
    expect(screen.getByRole('button', { name: 'Tariffs' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Tariffs' })).not.toHaveAttribute('aria-pressed')
    expect(screen.getByRole('button', { name: 'Sessions' })).not.toHaveAttribute('aria-current')
  })
})
