import { type NavigationTab } from './types'

/**
 * Properties for the contextual mobile create action.
 */
interface MobileContextActionProps {
  /** The current active app tab. */
  activeTab: NavigationTab
  /** Opens the existing create-session flow. */
  onAddSession: () => void
  /** Opens the existing create-tariff flow. */
  onAddTariff: () => void
  /** Allows callers to suppress the pill for states like open forms. */
  isVisible?: boolean
}

/**
 * Mobile-only contextual create pill shown above the bottom dock.
 */
export function MobileContextAction({
  activeTab,
  onAddSession,
  onAddTariff,
  isVisible = true,
}: MobileContextActionProps) {
  if (!isVisible) {
    return null
  }

  if (activeTab === 'analytics') {
    return null
  }

  const isSessions = activeTab === 'sessions'
  const label = isSessions ? '+ Add Session' : '+ Tariff'
  const onClick = isSessions ? onAddSession : onAddTariff

  return (
    <div
      className="md:hidden fixed left-0 right-0 z-[45] px-4 pointer-events-none"
      style={{ bottom: 'var(--mobile-context-action-bottom)' }}
    >
      <div className="max-w-[1440px] mx-auto flex justify-center">
        <button
          type="button"
          onClick={onClick}
          className="pointer-events-auto min-h-[52px] min-w-[44px] rounded-full px-7 py-3 text-sm font-bold text-white bg-[#007AFF] hover:brightness-95 active:brightness-90 transition-[background-color,color,box-shadow,filter] motion-reduce:transition-none shadow-[0_12px_28px_rgba(0,122,255,0.26)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:ring-[#007AFF]/60 inline-flex items-center gap-2"
          aria-label={label}
        >
          <span>{label}</span>
        </button>
      </div>
    </div>
  )
}
