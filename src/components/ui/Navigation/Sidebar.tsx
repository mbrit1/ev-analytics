import React, { useState, useEffect } from 'react'
import { 
  BatteryCharging, 
  History, 
  Receipt, 
  ChevronLeft, 
  ChevronRight 
} from 'lucide-react'

/**
 * Properties for the Sidebar component.
 */
interface SidebarProps {
  /** The identifier of the currently active tab. */
  activeTab: 'sessions' | 'tariffs'
  /** Callback fired when the user selects a different tab. */
  onTabChange: (tab: 'sessions' | 'tariffs') => void
}

const NAV_ITEMS = [
  { 
    id: 'sessions', 
    label: 'Sessions', 
    icon: History, 
    ariaLabel: 'Navigate to Sessions' 
  },
  { 
    id: 'tariffs', 
    label: 'Tariffs', 
    icon: Receipt, 
    ariaLabel: 'Navigate to Tariffs' 
  },
] as const

/**
 * Desktop-first sidebar navigation menu.
 * 
 * This component is fixed to the left of the viewport and is only visible 
 * on medium screens and larger (`md:flex`). It supports a collapsible "rail" 
 * mode to save screen space, persisting the user's preference in localStorage.
 *
 * @param props - Component properties ({@link SidebarProps})
 * @returns The rendered sidebar element.
 */
export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange }) => {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem('sidebar-collapsed')
      return saved ? JSON.parse(saved) : false
    } catch {
      return false
    }
  })

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', JSON.stringify(isCollapsed))
  }, [isCollapsed])

  return (
    <aside 
      className={`hidden md:flex flex-col bg-surface/80 backdrop-blur-md border-r border-secondary/10 transition-all duration-300 ease-in-out h-screen sticky top-0 ${
        isCollapsed ? 'w-[72px]' : 'w-[240px]'
      }`}
    >
      {/* Brand Header */}
      <div className="flex items-center h-16 px-4 border-b border-secondary/10 overflow-hidden shrink-0">
        <BatteryCharging className="w-8 h-8 text-accent shrink-0" />
        <span className={`ml-3 font-bold text-lg text-primary overflow-hidden whitespace-nowrap transition-all duration-300 ${
          isCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
        }`}>
          EV Analytics
        </span>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 py-4 px-2 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = activeTab === item.id
          
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              aria-label={item.ariaLabel}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center justify-center w-full py-3 rounded-xl group relative min-h-[44px] ${
                isActive 
                  ? 'bg-accent/10 text-accent hover:bg-accent/20' 
                  : 'text-secondary hover:bg-secondary/5 hover:text-primary focus-visible:bg-secondary/5 focus-visible:text-primary outline-none'
              }`}
            >
              {isCollapsed ? (
                <Icon className="w-6 h-6 shrink-0" />
              ) : (
                <div className="flex items-center w-full px-1">
                  <Icon className="w-6 h-6 shrink-0" />
                  <span className={`ml-3 font-bold overflow-hidden whitespace-nowrap transition-[width,opacity] duration-300 ${
                    isCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
                  }`}>
                    {item.label}
                  </span>
                </div>
              )}
              
              {isCollapsed && (
                <div className="absolute left-16 bg-primary text-surface px-3 py-1.5 rounded-lg text-sm font-bold opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 pointer-events-none transition-opacity duration-300 whitespace-nowrap z-50 shadow-lg border border-secondary/10">
                  {item.label}
                </div>
              )}
            </button>
          )
        })}
      </nav>

      {/* Toggle Button */}
      <div className="p-2 border-t border-secondary/10 shrink-0">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          aria-label="Toggle Sidebar"
          className="flex items-center justify-center w-full py-3 text-secondary hover:text-primary hover:bg-secondary/5 focus-visible:bg-secondary/5 focus-visible:text-primary outline-none rounded-xl"
        >
          {isCollapsed ? (
            <ChevronRight className="w-6 h-6" />
          ) : (
            <div className="flex items-center w-full px-1">
              <ChevronLeft className="w-6 h-6 shrink-0" />
              <span className="ml-3 font-bold">Collapse</span>
            </div>
          )}
        </button>
      </div>
    </aside>
  )
}
