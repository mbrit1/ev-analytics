import { BatteryCharging, Loader2, LogOut, Receipt, History, Plus } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useAuth } from './features/auth/hooks/useAuth'
import { LoginForm } from './features/auth/components/LoginForm'
import { supabase } from './lib/supabase'
import { TariffList } from './features/tariffs/components/TariffList'
import { ChargingHistory } from './features/charging-sessions/components/ChargingHistory'
import { SessionForm } from './features/charging-sessions/components/SessionForm'
import { saveSession } from './features/charging-sessions/services/sessionService'
import { initialSync } from './features/offline-sync/services/syncEngine'
import { type ChargingSession } from './lib/db'

function App() {
  const { user, loading } = useAuth()
  const [activeTab, setActiveTab] = useState<'sessions' | 'tariffs'>('sessions')
  const [isSessionFormOpen, setIsSessionFormOpen] = useState(false)

  useEffect(() => {
    if (user) {
      initialSync().catch(console.error);
    }
  }, [user]);

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  const handleSessionSubmit = async (session: ChargingSession) => {
    await saveSession(session);
    setIsSessionFormOpen(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-environment">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  if (!user) {
    return <LoginForm />
  }

  return (
    <div className="min-h-screen bg-environment flex flex-col">
      {/* Header */}
      <header className="bg-surface/80 backdrop-blur-md border-b border-secondary/10 sticky top-0 z-10">
        <div className="max-w-[1024px] mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BatteryCharging className="w-6 h-6 text-accent" />
            <span className="font-bold tracking-tight text-primary">EV Analytics</span>
          </div>
          <button
            onClick={handleLogout}
            className="p-2 text-secondary hover:text-primary transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Sign Out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-[1024px] w-full mx-auto p-4 pb-32">
        {activeTab === 'tariffs' ? (
          <TariffList />
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold tracking-tight text-primary">Sessions</h1>
              {!isSessionFormOpen && (
                <button
                  onClick={() => setIsSessionFormOpen(true)}
                  className="flex items-center px-4 py-2 bg-accent text-white font-bold rounded-xl hover:opacity-90 transition-all shadow-md shadow-accent/20 min-h-[44px]"
                >
                  <Plus className="w-5 h-5 mr-2" />
                  Add Session
                </button>
              )}
            </div>

            {isSessionFormOpen ? (
              <SessionForm 
                onSubmit={handleSessionSubmit} 
                onCancel={() => setIsSessionFormOpen(false)} 
              />
            ) : (
              <ChargingHistory />
            )}
          </div>
        )}
      </main>

      {/* Bottom Navigation (Mobile-first) */}
      <nav className="fixed bottom-0 left-0 right-0 bg-surface/90 backdrop-blur-lg border-t border-secondary/10 px-6 py-3 pb-[env(safe-area-inset-bottom,24px)] md:pb-6 flex justify-around items-center z-10">
        <button
          onClick={() => setActiveTab('sessions')}
          className={`flex flex-col items-center gap-1 transition-colors min-h-[44px] min-w-[44px] justify-center ${
            activeTab === 'sessions' ? 'text-accent' : 'text-secondary hover:text-primary'
          }`}
        >
          <History className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Sessions</span>
        </button>
        <button
          onClick={() => setActiveTab('tariffs')}
          className={`flex flex-col items-center gap-1 transition-colors min-h-[44px] min-w-[44px] justify-center ${
            activeTab === 'tariffs' ? 'text-accent' : 'text-secondary hover:text-primary'
          }`}
        >
          <Receipt className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Tariffs</span>
        </button>
      </nav>
    </div>
  )
}

export default App
