import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Sidebar } from './Sidebar'

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
    const onTabChange = vi.fn()
    render(<Sidebar activeTab="sessions" onTabChange={onTabChange} />)
    
    // Check initial render (should show text labels)
    expect(screen.getByText('Sessions')).toBeInTheDocument()
    
    // Toggle to rail mode
    const toggleBtn = screen.getByLabelText('Toggle Sidebar')
    fireEvent.click(toggleBtn)
    
    // In rail mode, 'EV Analytics' text should have collapsed classes
    const brandText = screen.getByText('EV Analytics')
    expect(brandText).toHaveClass('w-0')
    expect(brandText).toHaveClass('opacity-0')
    
    // Interaction check
    fireEvent.click(screen.getByLabelText('Navigate to Tariffs'))
    expect(onTabChange).toHaveBeenCalledWith('tariffs')
  })
})
