import { BatteryCharging, Loader2, LogOut, Plus } from 'lucide-react'
import { useState, useEffect, lazy, Suspense, useCallback, useRef } from 'react'
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
import {
  retryActiveSyncRuntime,
  startSyncRuntime,
  ProviderConflictRecoveryDialog,
  SyncStatusIndicator,
  useProviderConflictRecovery,
  useSyncStatus,
} from '../features/offline-sync'
import { type ChargingSession } from '../infra/db'
import { MobileContextAction, Navigation } from '../shared/ui'
import { type NavigationTab } from '../shared/ui/Navigation/types'
import { AnalyticsPage } from '../features/analytics'
import {
  isOrdinaryTariffActivation,
  newTariffMarker,
  parseTariffLocation,
  readTariffHistoryMarker,
  tariffEditHref,
  withTariffHistoryMarker,
  withoutTariffHistoryMarker,
} from './tariffNavigation'

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

type TariffModalState = {
  isOpen: boolean;
  isPending: boolean;
}

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
  const handleRecoveryCommitted = useCallback(() => {
    retryActiveSyncRuntime()
  }, [])
  const providerConflictRecovery = useProviderConflictRecovery({
    userId: user?.id,
    onRecoveryCommitted: handleRecoveryCommitted,
  })
  const [activeTab, setActiveTab] = useState<NavigationTab>('sessions')
  const [sessionFormState, setSessionFormState] = useState<SessionFormState>({ mode: 'closed' })
  const [historyRestoreRequest, setHistoryRestoreRequest] = useState<HistoryRestoreRequest | null>(null)
  const [tariffFormState, setTariffFormState] = useState<TariffFormState>({ mode: 'closed' })
  const [tariffRestoreRequest, setTariffRestoreRequest] = useState<TariffRestoreRequest | null>(null)
  const [tariffModalState, setTariffModalState] = useState<TariffModalState>({ isOpen: false, isPending: false })
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const isSessionFormOpen = sessionFormState.mode !== 'closed'
  const historyScrollSnapshotRef = useRef(0)
  const tariffScrollSnapshotRef = useRef(0)
  const principalIdRef = useRef<string | null>(null)
  const activeTariffEditKeyRef = useRef<string | null>(null)
  const isTariffListVisibleRef = useRef(false)
  const tariffListEntryIdRef = useRef<string | null>(null)
  const userId = user?.id
  const visibleTariffModalState = activeTab === 'tariffs'
    ? tariffModalState
    : { isOpen: false, isPending: false }
  const providerRecoveryRequested = providerConflictRecovery.isOpen && providerConflictRecovery.state.kind !== 'closed'
  const recoveryExclusion = providerRecoveryRequested && !visibleTariffModalState.isPending
  const isProviderRecoveryVisible = providerRecoveryRequested && !visibleTariffModalState.isOpen

  const applyTariffLocation = useCallback(() => {
    const location = parseTariffLocation(window.location.hash)
    const marker = readTariffHistoryMarker(window.history.state)
    if (location.kind === 'malformed') {
      const replacementMarker = newTariffMarker('tariffs', { tariffListScrollY: 0 })
      window.history.replaceState(withTariffHistoryMarker(window.history.state, replacementMarker), '', '#tariffs')
      activeTariffEditKeyRef.current = null
      tariffListEntryIdRef.current = replacementMarker.entryId
      setActiveTab('tariffs')
      setTariffFormState({ mode: 'closed' })
      setTariffRestoreRequest(null)
      return
    }
    if (location.kind === 'edit') {
      const needsAdoption = marker == null || marker.tab !== 'tariffs'
      const shouldRefreshScroll = !needsAdoption
        && isTariffListVisibleRef.current
        && marker.tariffListScrollY !== tariffScrollSnapshotRef.current
      const nextMarker = needsAdoption
        ? newTariffMarker('tariffs', {
          tariffListPredecessorId: null,
          tariffListScrollY: 0,
        })
        : shouldRefreshScroll
          ? { ...marker, tariffListScrollY: tariffScrollSnapshotRef.current }
          : marker
      if (needsAdoption || shouldRefreshScroll) {
        window.history.replaceState(withTariffHistoryMarker(window.history.state, nextMarker), '', window.location.href)
      }
      if (nextMarker.tariffListPredecessorId == null) {
        tariffListEntryIdRef.current = null
      }
      isTariffListVisibleRef.current = false
      activeTariffEditKeyRef.current = location.logicalTariffKey
      setActiveTab('tariffs')
      setTariffRestoreRequest(null)
      setTariffFormState({ mode: 'edit', logicalTariffKey: location.logicalTariffKey })
      return
    }
    if (location.kind === 'list') {
      const needsAdoption = marker == null
        || marker.tab !== 'tariffs'
        || marker.tariffListPredecessorId != null
      const nextMarker = needsAdoption
        ? newTariffMarker('tariffs', { tariffListScrollY: 0 })
        : marker
      if (needsAdoption) {
        window.history.replaceState(withTariffHistoryMarker(window.history.state, nextMarker), '', window.location.href)
      }
      const focusTariffKey = activeTariffEditKeyRef.current
      const scrollY = nextMarker.tariffListScrollY ?? 0
      tariffScrollSnapshotRef.current = scrollY
      tariffListEntryIdRef.current = nextMarker.entryId
      isTariffListVisibleRef.current = true
      setActiveTab('tariffs')
      setTariffFormState({ mode: 'closed' })
      setTariffRestoreRequest(focusTariffKey == null
        ? null
        : { type: 'position', scrollY, focusTariffKey })
      return
    }
    activeTariffEditKeyRef.current = null
    tariffListEntryIdRef.current = null
    isTariffListVisibleRef.current = false
    setActiveTab(window.location.hash === '' ? marker?.tab ?? 'sessions' : 'sessions')
    setTariffFormState({ mode: 'closed' })
    setTariffRestoreRequest(null)
  }, [])

  useEffect(() => {
    window.addEventListener('popstate', applyTariffLocation)
    return () => window.removeEventListener('popstate', applyTariffLocation)
  }, [applyTariffLocation])

  useEffect(() => {
    const isActiveTariffList = activeTab === 'tariffs'
      && tariffFormState.mode === 'closed'
      && parseTariffLocation(window.location.hash).kind === 'list'
    if (!isActiveTariffList) {
      return
    }

    const persistTariffListScroll = () => {
      const marker = readTariffHistoryMarker(window.history.state)
      if (marker?.tab !== 'tariffs' || marker.tariffListScrollY === window.scrollY) {
        return
      }
      tariffScrollSnapshotRef.current = window.scrollY
      window.history.replaceState(
        withTariffHistoryMarker(window.history.state, { ...marker, tariffListScrollY: window.scrollY }),
        '',
        window.location.href,
      )
    }

    window.addEventListener('scroll', persistTariffListScroll)
    return () => window.removeEventListener('scroll', persistTariffListScroll)
  }, [activeTab, tariffFormState.mode])

  useEffect(() => {
    if (loading) return
    const previousUserId = principalIdRef.current
    if (!userId) {
      if (previousUserId) {
        window.history.replaceState(
          withoutTariffHistoryMarker(window.history.state),
          '',
          `${window.location.pathname}${window.location.search}`,
        )
      }
      principalIdRef.current = null
      activeTariffEditKeyRef.current = null
      tariffListEntryIdRef.current = null
      isTariffListVisibleRef.current = false
      tariffScrollSnapshotRef.current = 0
      window.dispatchEvent(new PopStateEvent('popstate'))
      return
    }

    if (previousUserId && previousUserId !== userId) {
      const location = parseTariffLocation(window.location.hash)
      const replacement = location.kind === 'edit'
        ? withTariffHistoryMarker(
          withoutTariffHistoryMarker(window.history.state),
          newTariffMarker('tariffs', { tariffListPredecessorId: null, tariffListScrollY: 0 }),
        )
        : withoutTariffHistoryMarker(window.history.state)
      window.history.replaceState(replacement, '', window.location.href)
      activeTariffEditKeyRef.current = null
      tariffListEntryIdRef.current = null
      isTariffListVisibleRef.current = false
      tariffScrollSnapshotRef.current = 0
      setTariffRestoreRequest(null)
    }

    principalIdRef.current = userId
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [applyTariffLocation, loading, userId])

  useEffect(() => {
    // Runtime is auth-gated and manages initial hydration plus background outbox
    // processing for online and newly queued local writes.
    const disposeSyncRuntime = startSyncRuntime({ isAuthenticated: Boolean(user) });
    return () => {
      void disposeSyncRuntime();
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
    if (tab === activeTab) return
    const nextMarker = newTariffMarker(tab, { tariffListScrollY: tab === 'tariffs' ? 0 : undefined })
    window.history.pushState(withTariffHistoryMarker(window.history.state, nextMarker), '', tab === 'tariffs' ? '#tariffs' : `${window.location.pathname}${window.location.search}`)
    tariffListEntryIdRef.current = tab === 'tariffs' ? nextMarker.entryId : null
    setActiveTab(tab)

    if (tab !== 'sessions') {
      setSessionFormState({ mode: 'closed' })
      setHistoryRestoreRequest(null)
    }

    if (tab !== 'tariffs') {
      activeTariffEditKeyRef.current = null
      tariffListEntryIdRef.current = null
      isTariffListVisibleRef.current = false
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
        return
      }
      activeTariffEditKeyRef.current = null
      setTariffFormState({ mode: 'closed' })
      setTariffRestoreRequest(null)
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
    handleTabChange('sessions')
    handleOpenCreateSession()
  }

  const handleReviewTariffsFromAnalytics = () => {
    handleTabChange('tariffs')
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
    const currentMarker = readTariffHistoryMarker(window.history.state)
    const listMarker = currentMarker?.tab === 'tariffs'
      ? { ...currentMarker, tariffListScrollY: window.scrollY }
      : newTariffMarker('tariffs', { tariffListScrollY: window.scrollY })
    window.history.replaceState(
      withTariffHistoryMarker(window.history.state, listMarker),
      '',
      window.location.href,
    )
    window.history.pushState(
      withTariffHistoryMarker(
        window.history.state,
        newTariffMarker('tariffs', {
          tariffListPredecessorId: listMarker.entryId,
          tariffListScrollY: window.scrollY,
        }),
      ),
      '',
      tariffEditHref(logicalTariffKey),
    )
    tariffScrollSnapshotRef.current = window.scrollY
    activeTariffEditKeyRef.current = logicalTariffKey
    tariffListEntryIdRef.current = listMarker.entryId
    isTariffListVisibleRef.current = false
    setTariffRestoreRequest(null)
    setTariffFormState({ mode: 'edit', logicalTariffKey })
  }

  const handleCloseTariffForm = () => {
    const focusTariffKey = tariffFormState.mode === 'edit'
      ? tariffFormState.logicalTariffKey
      : null

    const marker = readTariffHistoryMarker(window.history.state)
    if (marker?.tariffListPredecessorId != null
      && marker.tariffListPredecessorId === tariffListEntryIdRef.current) {
      window.history.back()
    } else {
      const replacementMarker = newTariffMarker('tariffs', { tariffListPredecessorId: null })
      window.history.replaceState(withTariffHistoryMarker(window.history.state, replacementMarker), '', '#tariffs')
      tariffListEntryIdRef.current = replacementMarker.entryId
    }
    setTariffFormState({ mode: 'closed' })
    setTariffRestoreRequest({
      type: 'position',
      scrollY: tariffScrollSnapshotRef.current,
      focusTariffKey,
    })
  }

  const handleTariffSaveComplete = (logicalTariffKey: string) => {
    const replacementMarker = newTariffMarker('tariffs', { tariffListPredecessorId: null })
    window.history.replaceState(withTariffHistoryMarker(window.history.state, replacementMarker), '', '#tariffs')
    tariffListEntryIdRef.current = replacementMarker.entryId
    setTariffFormState({ mode: 'closed' })
    setTariffRestoreRequest({ type: 'position', scrollY: tariffScrollSnapshotRef.current, focusTariffKey: logicalTariffKey })
  }

  const blockingSyncRetryText = syncStatus.nextRetryAt != null
    ? syncStatus.nextRetryAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : null;
  const canResolveProviderConflict = syncStatus.blockingFailureKind === 'provider-name-conflict'
    && syncStatus.blockingOutboxId != null
    && syncStatus.blockingProviderId != null
  const isMobileContextActionVisible = activeTab === 'sessions' && !isSessionFormOpen
  const mobileMainPaddingClass = isMobileContextActionVisible
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
              {!syncStatus.isLoading && syncStatus.hasBlockingSyncError && (
                <div role="alert" className="mb-4 p-3 text-sm text-red-500 bg-red-500/10 rounded-lg">
                  <p className="font-semibold">
                    {syncStatus.blockingErrorKind === 'terminal' ? 'Sync paused' : 'Sync issue'}
                  </p>
                  <p>{syncStatus.blockingErrorMessage || 'A sync error occurred.'}</p>
                  {syncStatus.blockingErrorKind === 'terminal' ? (
                    <>
                      <p>Data is saved locally. Resolve this conflict before sync can continue.</p>
                      {canResolveProviderConflict && (
                        <button
                          type="button"
                          onClick={() => providerConflictRecovery.open({
                            terminalOutboxId: syncStatus.blockingOutboxId!,
                            stagedProviderId: syncStatus.blockingProviderId!,
                          })}
                          className="mt-3 min-h-[44px] rounded-xl bg-accent px-4 py-2 font-bold text-white"
                        >
                          Resolve provider conflict
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <p>Data is saved locally and will retry automatically.</p>
                      {blockingSyncRetryText && (
                        <p>Next retry after {blockingSyncRetryText}.</p>
                      )}
                    </>
                  )}
                </div>
              )}
              {activeTab === 'analytics' ? (
                <AnalyticsPage
                  onAddSession={handleAddSessionFromAnalytics}
                  onReviewTariffs={handleReviewTariffsFromAnalytics}
                />
              ) : activeTab === 'tariffs' ? (
                <Suspense
                  fallback={(
                    <div className="min-h-[200px] flex items-center justify-center">
                      <Loader2 className="w-6 h-6 text-accent animate-spin" />
                    </div>
                  )}
                >
                  <TariffList
                    key={userId}
                    tariffFormState={tariffFormState}
                    restorationRequest={tariffRestoreRequest ?? undefined}
                    onCreateTariff={handleOpenCreateTariff}
                    getTariffEditHref={tariffEditHref}
                    onEditTariff={(logicalTariffKey, event) => {
                      if (!isOrdinaryTariffActivation(event)) return
                      event?.preventDefault()
                      handleOpenEditTariff(logicalTariffKey)
                    }}
                    tariffLocationHydration={{
                      providers: syncStatus.hydration.providers,
                      chargingPlans: syncStatus.hydration.charging_plans,
                      onRetry: retryActiveSyncRuntime,
                    }}
                    onCloseForm={handleCloseTariffForm}
                    onSaveComplete={handleTariffSaveComplete}
                    onRestorationComplete={() => setTariffRestoreRequest(null)}
                    recoveryExclusion={recoveryExclusion}
                    onModalStateChange={setTariffModalState}
                  />
                </Suspense>
              ) : (
                <div className="space-y-6">
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
                      hydrationState={syncStatus.hydration.sessions}
                      onRetryHydration={retryActiveSyncRuntime}
                    />
                  )}
                </div>
              )}
            </div>
          </main>
          {isProviderRecoveryVisible && providerConflictRecovery.state.kind !== 'closed' && (
            <ProviderConflictRecoveryDialog
              state={providerConflictRecovery.state}
              isPending={providerConflictRecovery.isPending}
              onCancel={providerConflictRecovery.cancel}
              onConfirm={() => void providerConflictRecovery.confirm()}
              onAcknowledge={providerConflictRecovery.acknowledge}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default App
