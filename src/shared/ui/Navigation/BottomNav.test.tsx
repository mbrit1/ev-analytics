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
    // Act: Render the mobile navigation.
    render(<BottomNav activeTab="sessions" onTabChange={onTabChange} />)
    
    // Assert: Verify the expected elements are immediately visible
    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.getByText('Tariffs')).toBeInTheDocument()
    
    // Act: Simulate user interaction.
    fireEvent.click(screen.getByText('Tariffs'))
    // Assert: The selected tab is reported to the parent.
    expect(onTabChange).toHaveBeenCalledWith('tariffs')
  })
})
