import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'

interface NavigationProps {
  activeTab: 'sessions' | 'tariffs'
  onTabChange: (tab: 'sessions' | 'tariffs') => void
}

export function Navigation({ activeTab, onTabChange }: NavigationProps) {
  return (
    <>
      <Sidebar activeTab={activeTab} onTabChange={onTabChange} />
      <BottomNav activeTab={activeTab} onTabChange={onTabChange} />
    </>
  )
}
