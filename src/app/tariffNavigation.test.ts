import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { useAuth } from '../features/auth'
import { useSyncStatus } from '../features/offline-sync'
import { isOrdinaryTariffActivation } from './tariffNavigation'

vi.mock('../features/auth', () => ({
  useAuth: vi.fn(),
  LoginForm: () => React.createElement('div', null, 'Login'),
}))
vi.mock('../features/charging-plans/components/TariffList', () => ({
  TariffList: ({ tariffFormState }: { tariffFormState: { mode: string; logicalTariffKey?: string } }) => (
    React.createElement(
      'section',
      { 'aria-label': 'Tariff location surface' },
      React.createElement('h1', null, 'Tariffs'),
      React.createElement('p', { 'data-testid': 'tariff-form-state' }, tariffFormState.mode),
      React.createElement('p', { 'data-testid': 'tariff-key' }, tariffFormState.logicalTariffKey ?? ''),
    )
  ),
}))
vi.mock('../features/charging-sessions', () => ({
  ChargingHistory: () => React.createElement('h1', null, 'Sessions'),
  SessionForm: () => React.createElement('div', null, 'Session form'),
  saveSession: vi.fn(), saveSessionWithPlanSelection: vi.fn(), updateSession: vi.fn(), updateSessionWithPlanSelection: vi.fn(),
}))
vi.mock('../features/analytics', () => ({ AnalyticsPage: () => React.createElement('h1', null, 'Analytics') }))
vi.mock('../shared/ui', () => ({
  Navigation: ({ activeTab, onTabChange }: { activeTab: string; onTabChange: (tab: 'sessions' | 'tariffs' | 'analytics') => void }) => React.createElement(
    'nav',
    { 'aria-label': 'Primary navigation' },
    React.createElement('button', { type: 'button', 'aria-pressed': activeTab === 'sessions', onClick: () => onTabChange('sessions') }, 'Sessions'),
    React.createElement('button', { type: 'button', 'aria-pressed': activeTab === 'tariffs', onClick: () => onTabChange('tariffs') }, 'Tariffs'),
    React.createElement('button', { type: 'button', 'aria-pressed': activeTab === 'analytics', onClick: () => onTabChange('analytics') }, 'Analytics'),
  ),
  MobileContextAction: () => null,
}))
vi.mock('../features/offline-sync', () => ({
  SyncStatusIndicator: () => null,
  ProviderConflictRecoveryDialog: () => null,
  useProviderConflictRecovery: () => ({ state: { kind: 'closed' }, isOpen: false, isPending: false }),
  useSyncStatus: vi.fn(), startSyncRuntime: vi.fn(() => vi.fn()), retryActiveSyncRuntime: vi.fn(),
}))

/**
 * Test suite for the app-owned Tariffs browser-location contract.
 *
 * Exercises locations as browser-observable state so the adapter remains
 * independent from feature persistence and routing-library implementation.
 */
describe('app-owned tariff navigation', () => {
  it.each([
    ['ordinary primary', { button: 0 }, {}, true],
    ['ctrl click', { button: 0, ctrlKey: true }, {}, false],
    ['meta click', { button: 0, metaKey: true }, {}, false],
    ['shift click', { button: 0, shiftKey: true }, {}, false],
    ['alt click', { button: 0, altKey: true }, {}, false],
    ['middle click', { button: 1 }, {}, false],
    ['download', { button: 0 }, { download: 'tariff.csv' }, false],
    ['new target', { button: 0 }, { target: '_blank' }, false],
  ])('owns only %s anchor activation', (_label, eventOverrides, anchorProperties, expected) => {
    const anchor = document.createElement('a')
    Object.assign(anchor, anchorProperties)
    const event = Object.assign({
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      currentTarget: anchor,
    }, eventOverrides) as Pick<React.MouseEvent<HTMLAnchorElement>, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'currentTarget'>

    expect(isOrdinaryTariffActivation(event as React.MouseEvent<HTMLAnchorElement>)).toBe(expected)
  })
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({ unrelated: { source: 'host' } }, '', '/')
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-1', email: 'driver@example.com' } as never,
      session: null, loading: false, signIn: vi.fn(), signOut: vi.fn(),
    })
    vi.mocked(useSyncStatus).mockReturnValue({
      queueLength: 0, hasPendingSync: false,
      pendingByTable: { providers: 0, charging_plans: 0, sessions: 0, provider_plan_selections: 0 },
      hasBlockingSyncError: false, blockingErrorMessage: undefined, retryCount: undefined, nextRetryAt: undefined,
      oldestPendingAt: undefined,
      hydration: { providers: { status: 'ready' }, charging_plans: { status: 'ready' }, sessions: { status: 'ready' } },
      hasHydrationFailure: false, isHydrating: false, displayState: 'synced', isLoading: false,
    })
  })

  it('adopts a recognized list hash with replaceState while preserving foreign history state', async () => {
    // Arrange: Start on the unmarked, loadable Tariffs list hash.
    window.history.replaceState({ unrelated: { source: 'host' } }, '', '#tariffs')
    const historyLengthBeforeBoot = window.history.length

    // Act: Boot the app at that location.
    render(React.createElement(App))

    // Assert: Adoption keeps the same entry and namespaces app metadata without losing foreign state.
    expect(await screen.findByRole('heading', { name: 'Tariffs' })).toBeInTheDocument()
    expect(window.history.state).toMatchObject({
      unrelated: { source: 'host' }, evAnalytics: { tab: 'tariffs', entryId: expect.any(String), tariffListScrollY: 0 },
    })
    expect(window.history.length).toBe(historyLengthBeforeBoot)
  })

  it.each([
    ['list', '#tariffs', 'closed'],
    ['direct edit', '#tariffs/edit/provider-1%3A%3Alidl', 'edit'],
  ] as const)('replaces a stale %s marker when the recognized hash is authoritative', async (_label, hash, expectedFormState) => {
    // Arrange: A structurally valid marker from another tab must not override the Tariffs-owned hash.
    window.history.replaceState({
      unrelated: { source: 'host' },
      evAnalytics: {
        tab: 'analytics',
        entryId: 'stale-analytics-entry',
        tariffListPredecessorId: 'stale-edit-predecessor',
        tariffListScrollY: 640,
      },
    }, '', hash)

    // Act: Boot at the recognized Tariffs location.
    render(React.createElement(App))

    // Assert: The hash wins, foreign state remains, and no stale edit predecessor is retained.
    expect(await screen.findByTestId('tariff-form-state')).toHaveTextContent(expectedFormState)
    expect(window.history.state).toMatchObject({
      unrelated: { source: 'host' },
      evAnalytics: { tab: 'tariffs', entryId: expect.any(String) },
    })
    if (expectedFormState === 'edit') {
      expect(window.history.state.evAnalytics.tariffListPredecessorId).toBeNull()
    } else {
      expect(window.history.state.evAnalytics.tariffListPredecessorId).toBeUndefined()
    }
  })

  it.each([
    ['encoded slash', 'provider%2Fone%3A%3Aplan'],
    ['encoded hash and query', 'provider%23one%3Ftwo%3A%3Aplan'],
    ['encoded percent', 'provider%2525%3A%3Aplan'],
  ])('isolates and decodes the %s suffix exactly once', async (_label, rawSuffix) => {
    // Arrange: Load one recognized edit location whose key needs a single decode.
    window.history.replaceState({}, '', `#tariffs/edit/${rawSuffix}`)

    // Act: Boot the app on the direct editor entry.
    render(React.createElement(App))

    // Assert: The editor receives the literal logical key and direct entries have no list predecessor.
    expect(await screen.findByTestId('tariff-form-state')).toHaveTextContent('edit')
    expect(screen.getByTestId('tariff-key')).toHaveTextContent(decodeURIComponent(rawSuffix))
    expect(window.history.state).toMatchObject({ evAnalytics: { tariffListPredecessorId: null } })
  })

  it.each([
    ['literal extra slash', '#tariffs/edit/provider-1%3A%3Alidl/extra'],
    ['empty suffix', '#tariffs/edit/'],
    ['invalid escape', '#tariffs/edit/%E0%A4%A'],
  ])('normalizes malformed recognized locations for %s without adding a history entry', async (_label, hash) => {
    // Arrange: Start at a malformed but Tariffs-owned hash.
    window.history.replaceState({ unrelated: true }, '', hash)
    const historyLengthBeforeBoot = window.history.length

    // Act: Boot the application.
    render(React.createElement(App))

    // Assert: The bad recognized location is replaced with the safe list destination.
    expect(await screen.findByRole('heading', { name: 'Tariffs' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#tariffs')
    expect(window.history.length).toBe(historyLengthBeforeBoot)
  })

  it('leaves an unknown hash unowned and retains the default Sessions entry', () => {
    // Arrange: Use a hash outside the Tariffs namespace.
    window.history.replaceState({ unrelated: true }, '', '#external/view')

    // Act: Boot the app.
    render(React.createElement(App))

    // Assert: The app neither rewrites the foreign hash nor activates Tariffs.
    expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#external/view')
  })

  it('does not push for the selected tab and pushes one marked entry for a different tab', async () => {
    // Arrange: Render the default Sessions entry and remember its history depth.
    const user = userEvent.setup()
    render(React.createElement(App))
    const beforeReselect = window.history.length

    // Act: Reselect Sessions, then move to Tariffs.
    await user.click(screen.getByRole('button', { name: 'Sessions' }))
    const afterReselect = window.history.length
    await user.click(screen.getByRole('button', { name: 'Tariffs' }))

    // Assert: Only the actual tab transition owns a new marked browser entry.
    expect(afterReselect).toBe(beforeReselect)
    expect(window.history.length).toBe(beforeReselect + 1)
    expect(window.location.hash).toBe('#tariffs')
  })

  it('derives marked non-Tariffs tabs from browser Back and Forward traversal', async () => {
    // Arrange: Create two marked hashless entries for Sessions and Analytics.
    window.history.replaceState({ evAnalytics: { tab: 'sessions', entryId: 'sessions-1' } }, '', '/')
    window.history.pushState({ evAnalytics: { tab: 'analytics', entryId: 'analytics-1' } }, '', '/')
    render(React.createElement(App))

    // Act: Traverse back to Sessions and forward to Analytics.
    act(() => {
      window.history.back()
    })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument())
    act(() => {
      window.history.forward()
    })

    // Assert: Forward restores the marked Analytics destination without a new click.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Analytics' })).toBeInTheDocument())
  })
})
