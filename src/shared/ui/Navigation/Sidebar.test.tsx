import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Sidebar } from './Sidebar'

/**
 * Test suite for the Sidebar component.
 * Focuses on rendering, rail mode toggling, state persistence, and user interactions.
 */
describe('Sidebar', () => {
  beforeEach(() => {
    // Mock localStorage
    const localStorageMock = (() => {
      let store: Record<string, string> = {}
      return {
        getItem: vi.fn((key: string) => store[key] || null),
        setItem: vi.fn((key: string, value: string) => {
          store[key] = value.toString()
        }),
        clear: vi.fn(() => {
          store = {}
        }),
      }
    })()

    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true
    })
  })

  it('renders navigation items and toggles rail mode', () => {
    // Arrange: Setup the component with a mocked callback function
    const onTabChange = vi.fn()
    const { container } = render(<Sidebar activeTab="sessions" onTabChange={onTabChange} />)
    
    // Assert: Check initial render (should show text labels)
    expect(container.querySelector('aside')).toHaveClass('hidden')
    expect(container.querySelector('aside')).toHaveClass('md:flex')
    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.getByText('Analytics')).toBeInTheDocument()
    
    // Act: Toggle to rail mode
    const toggleBtn = screen.getByLabelText('Toggle Sidebar')
    fireEvent.click(toggleBtn)
    
    // Assert: In rail mode, 'EV Analytics' text should have collapsed classes
    const brandText = screen.getByText('EV Analytics')
    expect(brandText).toHaveClass('w-0')
    expect(brandText).toHaveClass('opacity-0')
    
    // Act: Select the tariffs navigation item.
    fireEvent.click(screen.getByLabelText('Navigate to Tariffs'))
    // Assert: The selected tab is reported to the parent.
    expect(onTabChange).toHaveBeenCalledWith('tariffs')
    fireEvent.click(screen.getByLabelText('Navigate to Analytics'))
    expect(onTabChange).toHaveBeenCalledWith('analytics')
  })
})
