import { BarChart3, History, Receipt } from 'lucide-react'
import { type NavigationTab } from './types'

/**
 * Properties for the mobile navigation dock.
 */
interface MobileNavigationDockProps {
  /** The identifier of the currently active tab. */
  activeTab: NavigationTab
  /** Callback fired when the user selects a different tab. */
  onTabChange: (tab: NavigationTab) => void
}

/**
 * Mobile floating slab that switches between primary app destinations.
 */
export function MobileNavigationDock({ activeTab, onTabChange }: MobileNavigationDockProps) {
  const dockTabClass = (isActive: boolean) =>
    `mobile-navigation-dock-tab dock-tab relative flex w-full min-h-[44px] min-w-0 items-center justify-center gap-[8px] rounded-full px-[12px] py-[8px] text-sm font-semibold transition-[background-color,color,box-shadow,transform] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:ring-accent/60 max-[359px]:gap-0 max-[359px]:px-1 max-[359px]:text-xs ${
      isActive
        ? 'bg-accent/14 text-primary font-bold shadow-[inset_0_0_0_1px_rgba(0,122,255,0.22),0_8px_18px_rgba(0,0,0,0.06)]'
        : 'text-slab-secondary hover:bg-black/4 hover:text-primary dark:hover:bg-white/8'
    }`

  return (
    <nav
      className="mobile-navigation-dock md:hidden fixed z-40"
      style={{
        left: 'max(var(--mobile-dock-side-gap), env(safe-area-inset-left, 0px))',
        right: 'max(var(--mobile-dock-side-gap), env(safe-area-inset-right, 0px))',
        bottom: 'var(--mobile-nav-dock-bottom)',
      }}
      aria-label="Primary mobile actions"
    >
      <div className="grid h-[var(--mobile-nav-dock-height)] w-full grid-cols-3 items-center gap-[8px] overflow-visible rounded-[28px] border border-slab-border bg-surface/90 px-[12px] py-[8px] shadow-slab backdrop-blur-xl">
        <button
          type="button"
          onClick={() => onTabChange('sessions')}
          className={dockTabClass(activeTab === 'sessions')}
          aria-label="Sessions"
          aria-current={activeTab === 'sessions' ? 'page' : undefined}
        >
          <span className="mobile-navigation-dock-tab-content flex min-w-0 items-center justify-center gap-[8px] max-[359px]:flex-col max-[359px]:gap-0">
            <History className="h-[16px] w-[16px] shrink-0" aria-hidden="true" />
            <span className="[overflow-wrap:anywhere]">Sessions</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => onTabChange('tariffs')}
          className={dockTabClass(activeTab === 'tariffs')}
          aria-label="Tariffs"
          aria-current={activeTab === 'tariffs' ? 'page' : undefined}
        >
          <span className="mobile-navigation-dock-tab-content flex min-w-0 items-center justify-center gap-[8px] max-[359px]:flex-col max-[359px]:gap-0">
            <Receipt className="h-[16px] w-[16px] shrink-0" aria-hidden="true" />
            <span className="[overflow-wrap:anywhere]">Tariffs</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => onTabChange('analytics')}
          className={dockTabClass(activeTab === 'analytics')}
          aria-label="Analytics"
          aria-current={activeTab === 'analytics' ? 'page' : undefined}
        >
          <span className="mobile-navigation-dock-tab-content flex min-w-0 items-center justify-center gap-[8px] max-[359px]:flex-col max-[359px]:gap-0">
            <BarChart3 className="h-[16px] w-[16px] shrink-0" aria-hidden="true" />
            <span className="[overflow-wrap:anywhere]">Analytics</span>
          </span>
        </button>
      </div>
    </nav>
  )
}
