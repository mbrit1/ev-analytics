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
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    )
  }

  if (!user) {
    return <LoginForm />
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-1.5 rounded-lg">
              <BatteryCharging className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-slate-900">EV Analytics</span>
          </div>
          <button
            onClick={handleLogout}
            className="p-2 text-slate-400 hover:text-slate-600 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Sign Out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 pb-24">
        {activeTab === 'tariffs' ? (
          <TariffList />
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold text-slate-900">Sessions</h1>
              {!isSessionFormOpen && (
                <button
                  onClick={() => setIsSessionFormOpen(true)}
                  className="flex items-center px-4 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors min-h-[44px]"
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
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-3 pb-8 md:pb-3 flex justify-around items-center z-10">
        <button
          onClick={() => setActiveTab('sessions')}
          className={`flex flex-col items-center gap-1 transition-colors ${
            activeTab === 'sessions' ? 'text-blue-600' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <History className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Sessions</span>
        </button>
        <button
          onClick={() => setActiveTab('tariffs')}
          className={`flex flex-col items-center gap-1 transition-colors ${
            activeTab === 'tariffs' ? 'text-blue-600' : 'text-slate-500 hover:text-slate-700'
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
