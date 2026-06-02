import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MobileContextAction } from './MobileContextAction'

/**
 * Test suite for the mobile contextual action pill.
 *
 * Verifies tab-specific labels, callback wiring, and suppression on analytics
 * and when the shell explicitly hides the pill.
 */
describe('MobileContextAction', () => {
  it('renders + Add Session on sessions and forwards the session callback', () => {
    // Arrange: Render the mobile pill on the sessions tab.
    const onAddSession = vi.fn()
    const onAddTariff = vi.fn()

    // Act: Mount the contextual action in its sessions state.
    render(
      <MobileContextAction
        activeTab="sessions"
        onAddSession={onAddSession}
        onAddTariff={onAddTariff}
      />
    )

    // Assert: The sessions label is visible and the button is interactive.
    const pill = screen.getByRole('button', { name: '+ Add Session' })
    expect(pill).toBeInTheDocument()
    expect(pill.parentElement?.parentElement).toHaveStyle({
      bottom: 'var(--mobile-context-action-bottom)',
    })
    expect(pill).toHaveClass('min-h-[52px]')
    expect(pill).toHaveClass('px-7')

    fireEvent.click(pill)
    expect(onAddSession).toHaveBeenCalledTimes(1)
    expect(onAddTariff).not.toHaveBeenCalled()
  })

  it('renders + Tariff on tariffs and forwards the tariff callback', () => {
    // Arrange: Render the mobile pill on the tariffs tab.
    const onAddSession = vi.fn()
    const onAddTariff = vi.fn()

    // Act: Mount the contextual action in its tariffs state.
    render(
      <MobileContextAction
        activeTab="tariffs"
        onAddSession={onAddSession}
        onAddTariff={onAddTariff}
      />
    )

    // Assert: The tariffs label is visible and the button is interactive.
    const pill = screen.getByRole('button', { name: '+ Tariff' })
    expect(pill).toBeInTheDocument()

    fireEvent.click(pill)
    expect(onAddTariff).toHaveBeenCalledTimes(1)
    expect(onAddSession).not.toHaveBeenCalled()
  })

  it('does not render on analytics or when hidden by the shell', () => {
    // Arrange: Render the pill in the states where mobile creates are suppressed.
    const onAddSession = vi.fn()
    const onAddTariff = vi.fn()

    // Act: Mount analytics and hidden variants.
    const { rerender } = render(
      <MobileContextAction
        activeTab="analytics"
        onAddSession={onAddSession}
        onAddTariff={onAddTariff}
      />
    )

    // Assert: Analytics never shows a floating create action.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    // Act: Re-render with the shell explicitly hiding the pill.
    rerender(
      <MobileContextAction
        activeTab="sessions"
        onAddSession={onAddSession}
        onAddTariff={onAddTariff}
        isVisible={false}
      />
    )

    // Assert: Hidden state also suppresses the pill.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
