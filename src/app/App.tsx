import { BatteryCharging, Loader2, LogOut, Plus } from 'lucide-react'
import { useState, useEffect, lazy, Suspense, useRef } from 'react'
import { useAuth, LoginForm } from '../features/auth'
import {
  ChargingHistory,
  SessionForm,
  saveSession,
  saveSessionWithPlanSelection,
  type SessionPersistenceRequest,
  updateSession,
  updateSessionWithPlanSelection,
} from '../features/charging-sessions'
import { startSyncRuntime, SyncStatusIndicator, useSyncStatus } from '../features/offline-sync'
import { type ChargingSession } from '../infra/db'
import { MobileContextAction, Navigation } from '../shared/ui'
import { type NavigationTab } from '../shared/ui/Navigation/types'
import { AnalyticsPage } from '../features/analytics'

const TariffList = lazy(async () => {
  const module = await import('../features/charging-plans/components/TariffList')
  return { default: module.TariffList }
})

type SessionFormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; session: ChargingSession }

type HistoryRestoreRequest =
  | { type: 'position'; scrollY: number; focusSessionId?: string | null }
  | { type: 'session'; sessionId: string }

type TariffFormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; logicalTariffKey: string }

type TariffRestoreRequest =
  | { type: 'position'; scrollY: number; focusTariffKey?: string | null }
  | { type: 'tariff'; tariffKey: string }

/**
 * Root application shell for the authenticated EV Analytics experience.
 *
 * Coordinates auth gating, initial remote-to-local sync after login, top-level
 * navigation, and create-session flow while keeping data entry available from
 * the local Dexie-backed feature services.
 */
function App() {
  const { user, loading, signOut } = useAuth()
  const syncStatus = useSyncStatus()
  const [activeTab, setActiveTab] = useState<NavigationTab>('sessions')
  const [sessionFormState, setSessionFormState] = useState<SessionFormState>({ mode: 'closed' })
  const [historyRestoreRequest, setHistoryRestoreRequest] = useState<HistoryRestoreRequest | null>(null)
  const [tariffFormState, setTariffFormState] = useState<TariffFormState>({ mode: 'closed' })
  const [tariffRestoreRequest, setTariffRestoreRequest] = useState<TariffRestoreRequest | null>(null)
  const [isTariffFormOpen, setIsTariffFormOpen] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const isSessionFormOpen = sessionFormState.mode !== 'closed'
  const isTariffFormVisible = tariffFormState.mode !== 'closed'
  const historyScrollSnapshotRef = useRef(0)
  const tariffScrollSnapshotRef = useRef(0)

  useEffect(() => {
    // Runtime is auth-gated and manages initial hydration plus background outbox
    // processing for online and newly queued local writes.
    const disposeSyncRuntime = startSyncRuntime({ isAuthenticated: Boolean(user) });
    return () => {
      disposeSyncRuntime();
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      return
    }

    const prefetchTariffs = () => {
      void import('../features/charging-plans/components/TariffList')
    }

    if ('requestIdleCallback' in window) {
      const idleCallbackId = window.requestIdleCallback(prefetchTariffs, { timeout: 1500 })
      return () => window.cancelIdleCallback(idleCallbackId)
    }

    const timeoutId = setTimeout(prefetchTariffs, 800)
    return () => clearTimeout(timeoutId)
  }, [user])

  const handleTabChange = (tab: NavigationTab) => {
    setActiveTab(tab)

    if (tab !== 'sessions') {
      setSessionFormState({ mode: 'closed' })
      setHistoryRestoreRequest(null)
    }

    if (tab !== 'tariffs') {
      setTariffFormState({ mode: 'closed' })
      setTariffRestoreRequest(null)
    }
  }

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

  const handleOpenCreateSession = () => {
    historyScrollSnapshotRef.current = window.scrollY
    setHistoryRestoreRequest(null)
    setSessionFormState({ mode: 'create' })
  }

  const handleAddSessionFromAnalytics = () => {
    setActiveTab('sessions')
    handleOpenCreateSession()
  }

  const handleOpenEditSession = (session: ChargingSession) => {
    historyScrollSnapshotRef.current = window.scrollY
    setHistoryRestoreRequest(null)
    setSessionFormState({ mode: 'edit', session })
  }

  const handleCloseSessionForm = () => {
    const focusSessionId = sessionFormState.mode === 'edit'
      ? sessionFormState.session.id
      : null
    setSessionFormState({ mode: 'closed' })

    if (focusSessionId == null && historyScrollSnapshotRef.current <= 0) {
      setHistoryRestoreRequest(null)
      return
    }

    setHistoryRestoreRequest({
      type: 'position',
      scrollY: historyScrollSnapshotRef.current,
      focusSessionId,
    })
  }

  const handleSessionSubmit = async (request: SessionPersistenceRequest) => {
    // Session writes persist locally and queue remote sync, so the form can
    // close immediately after the local transaction succeeds.
    if (sessionFormState.mode === 'edit') {
      if (request.planSelectionChange) {
        await updateSessionWithPlanSelection(request)
      } else {
        await updateSession(request.session)
      }
    } else {
      if (request.planSelectionChange) {
        await saveSessionWithPlanSelection(request)
      } else {
        await saveSession(request.session)
      }
    }
    setSessionFormState({ mode: 'closed' })
    setHistoryRestoreRequest({ type: 'session', sessionId: request.session.id })
  }

  const handleOpenCreateTariff = () => {
    tariffScrollSnapshotRef.current = window.scrollY
    setTariffRestoreRequest(null)
    setTariffFormState({ mode: 'create' })
  }

  const handleOpenEditTariff = (logicalTariffKey: string) => {
    tariffScrollSnapshotRef.current = window.scrollY
    setTariffRestoreRequest(null)
    setTariffFormState({ mode: 'edit', logicalTariffKey })
  }

  const handleCloseTariffForm = () => {
    const focusTariffKey = tariffFormState.mode === 'edit'
      ? tariffFormState.logicalTariffKey
      : null

    setTariffFormState({ mode: 'closed' })
    setTariffRestoreRequest({
      type: 'position',
      scrollY: tariffScrollSnapshotRef.current,
      focusTariffKey,
    })
  }

  const handleTariffSaveComplete = (logicalTariffKey: string) => {
    setTariffFormState({ mode: 'closed' })
    setTariffRestoreRequest({ type: 'tariff', tariffKey: logicalTariffKey })
  }

  const blockingSyncRetryText = syncStatus.nextRetryAt != null
    ? syncStatus.nextRetryAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : null;
  const isMobileContextActionVisible =
    (activeTab === 'sessions' && !isSessionFormOpen) ||
    (activeTab === 'tariffs' && !isTariffFormVisible && !isTariffFormOpen)
  const mobileMainPaddingClass = activeTab === 'analytics'
    ? 'pb-[calc(var(--mobile-dock-height)+env(safe-area-inset-bottom)+32px)]'
    : isMobileContextActionVisible
      ? 'pb-[var(--mobile-content-clearance-with-action)]'
      : 'pb-[var(--mobile-content-clearance-dock-only)]'

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-environment">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  if (!user) {
    return <LoginForm />
  }

  return (
    <div className="min-h-[100dvh] bg-environment">
      <div className="max-w-[1440px] mx-auto flex md:flex-row flex-col min-h-[100dvh]">
        {/* Navigation (Sidebar on Desktop, BottomNav on Mobile) */}
        <Navigation
          activeTab={activeTab}
          onTabChange={handleTabChange}
        />
        <MobileContextAction
          activeTab={activeTab}
          onAddSession={handleOpenCreateSession}
          onAddTariff={() => {
            setActiveTab('tariffs')
            handleOpenCreateTariff()
          }}
          isVisible={isMobileContextActionVisible}
        />

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
          <main
            className={`flex-1 w-full p-4 md:p-8 ${mobileMainPaddingClass} md:pb-8`}
            data-has-mobile-context-action={isMobileContextActionVisible}
          >
            <div
              className={activeTab === 'analytics'
                ? 'mx-auto w-full max-w-2xl min-[900px]:!max-w-[760px]'
                : 'mx-auto max-w-2xl'}
            >
              {logoutError && (
                <div role="alert" className="mb-4 p-3 text-sm text-red-500 bg-red-500/10 rounded-lg">
                  {logoutError}
                </div>
              )}
              {activeTab === 'analytics' ? (
                <AnalyticsPage onAddSession={handleAddSessionFromAnalytics} />
              ) : activeTab === 'tariffs' ? (
                <Suspense
                  fallback={(
                    <div className="min-h-[200px] flex items-center justify-center">
                      <Loader2 className="w-6 h-6 text-accent animate-spin" />
                    </div>
                  )}
                >
                  <TariffList
                    tariffFormState={tariffFormState}
                    restorationRequest={tariffRestoreRequest ?? undefined}
                    onCreateTariff={handleOpenCreateTariff}
                    onEditTariff={handleOpenEditTariff}
                    onCloseForm={handleCloseTariffForm}
                    onSaveComplete={handleTariffSaveComplete}
                    onRestorationComplete={() => setTariffRestoreRequest(null)}
                    onFormOpenChange={setIsTariffFormOpen}
                  />
                </Suspense>
              ) : (
                <div className="space-y-6">
                  {!syncStatus.isLoading && syncStatus.hasBlockingSyncError && (
                    <div role="alert" className="mb-4 p-3 text-sm text-red-500 bg-red-500/10 rounded-lg">
                      <p className="font-semibold">Sync issue</p>
                      <p>{syncStatus.blockingErrorMessage || 'A sync error occurred.'}</p>
                      <p>Data is saved locally and will retry automatically.</p>
                      {blockingSyncRetryText && (
                        <p>Next retry after {blockingSyncRetryText}.</p>
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-bold tracking-tight text-primary">Charging History</h1>
                    {!isSessionFormOpen && (
                      <button
                        onClick={handleOpenCreateSession}
                        className="hidden md:flex items-center px-4 py-2 bg-accent text-white font-bold rounded-xl hover:opacity-90 transition-all shadow-md shadow-accent/20 min-h-[44px]"
                      >
                        <Plus className="w-5 h-5 mr-2" />
                        Add Session
                      </button>
                    )}
                  </div>

                  {isSessionFormOpen ? (
                    <SessionForm
                      onSubmit={handleSessionSubmit}
                      onCancel={handleCloseSessionForm}
                      initialValues={sessionFormState.mode === 'edit' ? sessionFormState.session : undefined}
                    />
                  ) : (
                    <ChargingHistory
                      onSelectSession={handleOpenEditSession}
                      restorationRequest={historyRestoreRequest ?? undefined}
                      onRestorationComplete={() => setHistoryRestoreRequest(null)}
                    />
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
