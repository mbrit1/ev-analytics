import { Sidebar } from './Sidebar'
import { MobileNavigationDock } from './MobileNavigationDock'
import { type NavigationTab } from './types'

/**
 * Properties for the root Navigation component.
 */
interface NavigationProps {
  /** The identifier of the currently active tab. */
  activeTab: NavigationTab
  /** Callback fired when the user selects a different tab. */
  onTabChange: (tab: NavigationTab) => void
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
      <MobileNavigationDock activeTab={activeTab} onTabChange={onTabChange} />
    </>
  )
}
