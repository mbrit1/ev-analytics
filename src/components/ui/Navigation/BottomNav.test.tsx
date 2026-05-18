import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BottomNav } from './BottomNav'

describe('BottomNav', () => {
  it('renders navigation items and handles clicks', () => {
    const onTabChange = vi.fn()
    render(<BottomNav activeTab="sessions" onTabChange={onTabChange} />)
    
    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.getByText('Tariffs')).toBeInTheDocument()
    
    fireEvent.click(screen.getByText('Tariffs'))
    expect(onTabChange).toHaveBeenCalledWith('tariffs')
  })
})
