import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BottomNav } from './BottomNav'

/**
 * Test suite for the BottomNav component.
 * Focuses on ensuring tabs are rendered and user interactions fire the correct callbacks.
 */
describe('BottomNav', () => {
  it('renders navigation items and handles clicks', () => {
    // Arrange: Setup the component with a mocked callback function
    const onTabChange = vi.fn()
    render(<BottomNav activeTab="sessions" onTabChange={onTabChange} />)
    
    // Assert: Verify the expected elements are immediately visible
    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.getByText('Tariffs')).toBeInTheDocument()
    
    // Act & Assert: Simulate user interaction and verify the resulting behavior
    fireEvent.click(screen.getByText('Tariffs'))
    expect(onTabChange).toHaveBeenCalledWith('tariffs')
  })
})
