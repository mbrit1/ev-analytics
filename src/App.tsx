import { BatteryCharging, Loader2, LogOut, Plus } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useAuth } from './features/auth/hooks/useAuth'
import { LoginForm } from './features/auth/components/LoginForm'
import { TariffList } from './features/tariffs/components/TariffList'
import { ChargingHistory } from './features/charging-sessions/components/ChargingHistory'
import { SessionForm } from './features/charging-sessions/components/SessionForm'
import { saveSession } from './features/charging-sessions/services/sessionService'
import { startSyncRuntime } from './features/offline-sync/services/syncRuntime'
import { type ChargingSession } from './lib/db'
import { Navigation } from './components/ui/Navigation/Navigation'
import { SyncStatusIndicator } from './features/offline-sync/components/SyncStatusIndicator'

/**
 * Root application shell for the authenticated EV Analytics experience.
 *
 * Coordinates auth gating, initial remote-to-local sync after login, top-level
 * navigation, and create-session flow while keeping data entry available from
 * the local Dexie-backed feature services.
 */
function App() {
  const { user, loading, signOut } = useAuth()
  const [activeTab, setActiveTab] = useState<'sessions' | 'tariffs'>('sessions')
  const [isSessionFormOpen, setIsSessionFormOpen] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)

  useEffect(() => {
    // Runtime is auth-gated and manages initial hydration plus background outbox
    // processing for online and newly queued local writes.
    const disposeSyncRuntime = startSyncRuntime({ isAuthenticated: Boolean(user) });
    return () => {
      disposeSyncRuntime();
    };
  }, [user]);

  const handleLogout = async () => {
    setLogoutError(null)
    try {
      const { error } = await signOut()
      if (error) {
        setLogoutError(error.message || 'Sign-out failed. Please try again.')
        console.error('Sign-out failed:', error)
      }
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : 'Sign-out failed. Please try again.'
      setLogoutError(message)
      console.error('Sign-out failed:', error)
    }
  }

  const handleSessionSubmit = async (session: ChargingSession) => {
    // saveSession persists locally and queues remote sync, so the form can close
    // immediately after the local transaction succeeds.
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
    <div className="min-h-screen bg-environment">
      <div className="max-w-[1440px] mx-auto flex md:flex-row flex-col min-h-screen">
        {/* Navigation (Sidebar on Desktop, BottomNav on Mobile) */}
        <Navigation activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Main Content Wrapper */}
        <div className="flex-1 flex flex-col min-w-0 bg-environment">
          {/* Mobile Header (Hidden on Desktop since Sidebar has the brand) */}
          <header className="md:hidden bg-surface/80 backdrop-blur-md border-b border-secondary/10 sticky top-0 z-10">
            <div className="px-4 h-16 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BatteryCharging className="w-6 h-6 text-accent" />
                <span className="font-bold tracking-tight text-primary">EV Analytics</span>
              </div>
              <div className="flex items-center gap-3">
                <SyncStatusIndicator />
                <button
                  onClick={handleLogout}
                  className="p-2 text-secondary hover:text-primary transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                  aria-label="Sign Out"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            </div>
          </header>

          {/* Desktop Header (Only Logout button, right aligned) */}
          <header className="hidden md:flex bg-surface/80 backdrop-blur-md sticky top-0 z-10 border-b border-secondary/10">
             <div className="flex-1 px-8 h-16 flex items-center justify-end gap-4">
                <SyncStatusIndicator />
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 p-2 text-secondary hover:text-primary transition-colors min-h-[44px]"
                  aria-label="Sign Out"
                >
                  <span className="font-bold">Sign Out</span>
                  <LogOut className="w-5 h-5" />
                </button>
             </div>
          </header>

          {/* Main Content */}
          <main className="flex-1 w-full p-4 md:p-8 pb-32 md:pb-8">
            <div className="max-w-2xl mx-auto">
              {logoutError && (
                <div role="alert" className="mb-4 p-3 text-sm text-red-500 bg-red-500/10 rounded-lg">
                  {logoutError}
                </div>
              )}
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
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

export default App
