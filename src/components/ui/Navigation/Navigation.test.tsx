import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Navigation } from './Navigation'

// Mock the child components to verify they are called with correct props
vi.mock('./Sidebar', () => ({
  Sidebar: vi.fn(({ activeTab, onTabChange }) => (
    <div data-testid="sidebar">
      Sidebar: {activeTab}
      <button onClick={() => onTabChange('tariffs')}>Change to Tariffs</button>
    </div>
  ))
}))

vi.mock('./BottomNav', () => ({
  BottomNav: vi.fn(({ activeTab }) => (
    <div data-testid="bottom-nav">
      BottomNav: {activeTab}
    </div>
  ))
}))

/**
 * Test suite for the root Navigation component.
 * Focuses on ensuring that both mobile and desktop navigation variants are
 * rendered and receive the correct props.
 */
describe('Navigation', () => {
  it('renders both Sidebar and BottomNav with correct props', () => {
    // Arrange: Render the root navigation component
    const onTabChange = vi.fn()
    render(<Navigation activeTab="sessions" onTabChange={onTabChange} />)

    // Assert: Verify both mock children are rendered with expected initial state
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('bottom-nav')).toBeInTheDocument()
    expect(screen.getByText(/Sidebar: sessions/)).toBeInTheDocument()
    expect(screen.getByText(/BottomNav: sessions/)).toBeInTheDocument()
  })

  it('passes onTabChange handler to children', async () => {
    // Arrange: Render the root navigation component with a mock callback
    const onTabChange = vi.fn()
    render(<Navigation activeTab="sessions" onTabChange={onTabChange} />)

    // Act: Simulate an interaction from a child component
    const button = screen.getByText('Change to Tariffs')
    button.click()

    // Assert: Verify the parent callback is invoked
    expect(onTabChange).toHaveBeenCalledWith('tariffs')
  })
})
