import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'

/**
 * Properties for the root Navigation component.
 */
interface NavigationProps {
  /** The identifier of the currently active tab. */
  activeTab: 'sessions' | 'tariffs'
  /** Callback fired when the user selects a different tab. */
  onTabChange: (tab: 'sessions' | 'tariffs') => void
}

/**
 * Root navigation wrapper.
 * 
 * This component delegates rendering to either the `Sidebar` (for desktop) 
 * or `BottomNav` (for mobile) based on CSS media queries present in those 
 * child components.
 *
 * @param props - Component properties ({@link NavigationProps})
 * @returns Fragment containing both mobile and desktop navigation elements.
 */
export function Navigation({ activeTab, onTabChange }: NavigationProps) {
  return (
    <>
      <Sidebar activeTab={activeTab} onTabChange={onTabChange} />
      <BottomNav activeTab={activeTab} onTabChange={onTabChange} />
    </>
  )
}
