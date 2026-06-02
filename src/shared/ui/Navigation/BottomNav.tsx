import { MobileNavigationDock } from './MobileNavigationDock'
import { type NavigationTab } from './types'

/**
 * Properties for the BottomNav component.
 */
interface BottomNavProps {
  /** The identifier of the currently active tab. */
  activeTab: NavigationTab
  /** Callback fired when the user selects a different tab. */
  onTabChange: (tab: NavigationTab) => void
}

/**
 * Backwards-compatible alias for the mobile navigation dock.
 */
export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  return <MobileNavigationDock activeTab={activeTab} onTabChange={onTabChange} />
}
