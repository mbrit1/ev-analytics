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

describe('Navigation', () => {
  it('renders both Sidebar and BottomNav with correct props', () => {
    const onTabChange = vi.fn()
    render(<Navigation activeTab="sessions" onTabChange={onTabChange} />)

    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('bottom-nav')).toBeInTheDocument()
    expect(screen.getByText(/Sidebar: sessions/)).toBeInTheDocument()
    expect(screen.getByText(/BottomNav: sessions/)).toBeInTheDocument()
  })

  it('passes onTabChange handler to children', async () => {
    const onTabChange = vi.fn()
    render(<Navigation activeTab="sessions" onTabChange={onTabChange} />)

    const button = screen.getByText('Change to Tariffs')
    button.click()

    expect(onTabChange).toHaveBeenCalledWith('tariffs')
  })
})
