import { History, Receipt } from 'lucide-react'

interface BottomNavProps {
  activeTab: 'sessions' | 'tariffs'
  onTabChange: (tab: 'sessions' | 'tariffs') => void
}

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-surface/90 backdrop-blur-lg border-t border-secondary/10 px-6 py-3 pb-[env(safe-area-inset-bottom,24px)] md:hidden flex justify-around items-center z-10">
      <button
        onClick={() => onTabChange('sessions')}
        className={`flex flex-col items-center gap-1 transition-colors min-h-[44px] min-w-[44px] justify-center ${
          activeTab === 'sessions' ? 'text-accent' : 'text-secondary hover:text-primary'
        }`}
        aria-label="Sessions"
      >
        <History className="w-6 h-6" />
        <span className="text-[10px] font-bold uppercase tracking-wider">Sessions</span>
      </button>
      <button
        onClick={() => onTabChange('tariffs')}
        className={`flex flex-col items-center gap-1 transition-colors min-h-[44px] min-w-[44px] justify-center ${
          activeTab === 'tariffs' ? 'text-accent' : 'text-secondary hover:text-primary'
        }`}
        aria-label="Tariffs"
      >
        <Receipt className="w-6 h-6" />
        <span className="text-[10px] font-bold uppercase tracking-wider">Tariffs</span>
      </button>
    </nav>
  )
}
