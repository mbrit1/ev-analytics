import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { useAuth } from '../features/auth';
import { useSyncStatus } from '../features/offline-sync';

vi.mock('../features/auth', () => ({
  useAuth: vi.fn(),
  LoginForm: () => <div data-testid="login-form">Login Form</div>,
}));
vi.mock('../features/charging-plans/components/TariffList', () => ({
  TariffList: ({
    tariffFormState,
    restorationRequest,
    onCreateTariff,
    onEditTariff,
    onCloseForm,
    onSaveComplete,
    onRestorationComplete,
    onFormOpenChange,
  }: {
    tariffFormState: { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; logicalTariffKey: string };
    restorationRequest?: { type: 'position'; scrollY: number; focusTariffKey?: string | null } | { type: 'tariff'; tariffKey: string };
    onCreateTariff: () => void;
    onEditTariff: (logicalTariffKey: string, event: React.MouseEvent<HTMLButtonElement>) => void;
    onCloseForm: () => void;
    onSaveComplete: (logicalTariffKey: string) => void;
    onRestorationComplete: () => void;
    onFormOpenChange?: (isOpen: boolean) => void;
  }) => {
    const [currentTariffKey, setCurrentTariffKey] = React.useState('provider-1::lidl');
    const [focusTariffKey, setFocusTariffKey] = React.useState<string | null>(null);
    const editButtonRef = React.useRef<HTMLButtonElement | null>(null);

    React.useEffect(() => {
      if (!restorationRequest) {
        return;
      }

      if (restorationRequest.type === 'position') {
        window.scrollTo({ top: restorationRequest.scrollY, behavior: 'auto' });
        setFocusTariffKey(restorationRequest.focusTariffKey ?? null);
        editButtonRef.current?.focus();
      } else {
        setCurrentTariffKey(restorationRequest.tariffKey);
        setFocusTariffKey(restorationRequest.tariffKey);
      }

      onRestorationComplete();
    }, [onRestorationComplete, restorationRequest]);

    React.useEffect(() => {
      if (focusTariffKey !== currentTariffKey) {
        return;
      }

      editButtonRef.current?.focus();
    }, [currentTariffKey, focusTariffKey]);

    const currentLabel = currentTariffKey === 'provider-1::lidl plus'
      ? 'Edit Ionity Lidl Plus'
      : 'Edit Ionity Lidl';

    return (
      <div>
        {tariffFormState.mode === 'closed' ? <h1>Tariffs</h1> : null}
        {tariffFormState.mode === 'closed' ? (
          <button type="button" onClick={() => onCreateTariff()}>
            Add Tariff
          </button>
        ) : null}
        {tariffFormState.mode === 'closed' ? (
          <button
            ref={editButtonRef}
            type="button"
            onClick={(event) => onEditTariff(currentTariffKey, event as never)}
          >
            {currentLabel}
          </button>
        ) : null}
        {tariffFormState.mode === 'edit' ? (
          <section aria-label="Tariff Form Surface">
            <h1>Edit Tariff</h1>
            <button
              type="button"
              onClick={() => {
                setCurrentTariffKey('provider-1::lidl plus');
                onSaveComplete('provider-1::lidl plus');
              }}
            >
              Save Tariff
            </button>
            <button type="button" onClick={onCloseForm}>
              Cancel
            </button>
          </section>
        ) : null}
        <div data-testid="form-open-state">{String(tariffFormState.mode !== 'closed')}</div>
        <button type="button" onClick={() => onFormOpenChange?.(tariffFormState.mode !== 'closed')}>
          Emit Form State
        </button>
      </div>
    );
  },
}));
vi.mock('../features/charging-sessions', () => ({
  ChargingHistory: () => <div>Charging History</div>,
  SessionForm: () => <div>Session Form</div>,
  saveSession: vi.fn(),
  saveSessionWithPlanSelection: vi.fn(),
  updateSession: vi.fn(),
  updateSessionWithPlanSelection: vi.fn(),
}));
vi.mock('../features/analytics', () => ({ AnalyticsPage: () => <div>Analytics</div> }));
vi.mock('../shared/ui', () => ({
  Navigation: ({
    activeTab,
    onTabChange,
  }: {
    activeTab: 'sessions' | 'tariffs' | 'analytics';
    onTabChange: (tab: 'sessions' | 'tariffs' | 'analytics') => void;
  }) => (
    <nav aria-label="Primary app navigation">
      <button type="button" aria-pressed={activeTab === 'sessions'} onClick={() => onTabChange('sessions')}>
        Sessions
      </button>
      <button type="button" aria-pressed={activeTab === 'tariffs'} onClick={() => onTabChange('tariffs')}>
        Tariffs
      </button>
      <button type="button" aria-pressed={activeTab === 'analytics'} onClick={() => onTabChange('analytics')}>
        Analytics
      </button>
    </nav>
  ),
  MobileContextAction: () => null,
  Slab: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../features/offline-sync', () => ({
  SyncStatusIndicator: () => <div>Sync Status</div>,
  useProviderConflictRecovery: vi.fn(() => ({
    state: { kind: 'closed' },
    isOpen: false,
    isPending: false,
    open: vi.fn(),
    cancel: vi.fn(),
    confirm: vi.fn(async () => undefined),
    acknowledge: vi.fn(),
  })),
  useSyncStatus: vi.fn(() => ({
    queueLength: 0,
    hasPendingSync: false,
    pendingByTable: {
      providers: 0,
      charging_plans: 0,
      sessions: 0,
      provider_plan_selections: 0,
    },
    hasBlockingSyncError: false,
    blockingErrorMessage: undefined,
    retryCount: undefined,
    nextRetryAt: undefined,
    oldestPendingAt: undefined,
    hydration: {
      providers: { status: 'ready' },
      charging_plans: { status: 'ready' },
      sessions: { status: 'ready' },
    },
    hasHydrationFailure: false,
    isHydrating: false,
    displayState: 'synced',
    isLoading: false,
  })),
  startSyncRuntime: vi.fn(() => vi.fn()),
  retryActiveSyncRuntime: vi.fn(),
}));

/**
 * Test suite for app-owned tariff create/edit mode.
 *
 * Verifies tariff editing replaces the list surface and restores list context
 * after cancel or save.
 */
describe('App tariff editing', () => {
  const mockScrollTo = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({ unrelated: 'keep-me' }, '', '/');
    vi.stubGlobal('scrollTo', mockScrollTo);
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      writable: true,
      value: 640,
    });
    vi.mocked(useSyncStatus).mockReturnValue({
      queueLength: 0,
      hasPendingSync: false,
      pendingByTable: {
        providers: 0,
        charging_plans: 0,
        sessions: 0,
        provider_plan_selections: 0,
      },
      hasBlockingSyncError: false,
      blockingErrorMessage: undefined,
      retryCount: undefined,
      nextRetryAt: undefined,
      oldestPendingAt: undefined,
      hydration: {
        providers: { status: 'ready' },
        charging_plans: { status: 'ready' },
        sessions: { status: 'ready' },
      },
      hasHydrationFailure: false,
      isHydrating: false,
      displayState: 'synced',
      isLoading: false,
    });
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: 'user-1',
        email: 'driver@example.com',
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString(),
      } as never,
      session: null,
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    });
  });

  it('hides the tariff list while edit mode is active and restores it on cancel', async () => {
    // Arrange: Render the authenticated app, switch to tariffs, and capture scroll.
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Tariffs' }));
    expect(await screen.findByRole('heading', { name: 'Tariffs' })).toBeInTheDocument();

    // Act: Click "Edit Ionity Lidl", then click "Cancel".
    await user.click(screen.getByRole('button', { name: 'Edit Ionity Lidl' }));
    expect(await screen.findByRole('heading', { name: 'Edit Tariff' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Tariffs' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    // Assert: "Edit Tariff" replaces "Tariffs", then "Tariffs" returns and focus is restored.
    expect(await screen.findByRole('heading', { name: 'Tariffs' })).toBeInTheDocument();
    await waitFor(() => {
      expect(mockScrollTo).toHaveBeenCalledWith({ top: 640, behavior: 'auto' });
      expect(screen.getByRole('button', { name: 'Edit Ionity Lidl' })).toHaveFocus();
    });
  });

  it('restores focus to the renamed tariff after save completes', async () => {
    // Arrange: Render tariffs with a logical tariff named "Lidl".
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Tariffs' }));
    expect(await screen.findByRole('heading', { name: 'Tariffs' })).toBeInTheDocument();

    // Act: Open edit and submit a mocked form payload that renames it to "Lidl Plus".
    await user.click(screen.getByRole('button', { name: 'Edit Ionity Lidl' }));
    await user.click(screen.getByRole('button', { name: 'Save Tariff' }));

    // Assert: List mode returns and focus lands on "Edit Ionity Lidl Plus".
    expect(await screen.findByRole('heading', { name: 'Tariffs' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit Ionity Lidl Plus' })).toHaveFocus();
    });
  });

  it('pushes an encoded app-owned edit entry from the current tariffs list without discarding unrelated history state', async () => {
    // Arrange: Open the Tariffs list from an entry that carries unrelated state.
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Tariffs' }));
    const historyLengthBeforeEdit = window.history.length;

    // Act: Activate the available tariff editor from the list.
    await user.click(screen.getByRole('button', { name: 'Edit Ionity Lidl' }));

    // Assert: The concrete edit destination is encoded and retains the foreign state namespace.
    expect(window.location.hash).toBe('#tariffs/edit/provider-1%3A%3Alidl');
    expect(window.history.length).toBe(historyLengthBeforeEdit + 1);
    expect(window.history.state).toMatchObject({
      unrelated: 'keep-me',
      evAnalytics: {
        tab: 'tariffs',
        tariffListPredecessorId: expect.any(String),
      },
    });
  });

  it('persists the changing list scroll across a complete edit Back/Forward/Back cycle', async () => {
    // Arrange: Enter the marked list at a known viewport position and observe browser writes after setup.
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Tariffs' }));
    Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 480 });
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const pushState = vi.spyOn(window.history, 'pushState');
    replaceState.mockClear();
    pushState.mockClear();

    // Act: Open edit. The outgoing list entry must be updated before the edit entry is pushed.
    await user.click(screen.getByRole('button', { name: 'Edit Ionity Lidl' }));

    // Assert: The current list marker records the actual position instead of leaving its initial zero snapshot.
    expect(replaceState).toHaveBeenCalledWith(
      expect.objectContaining({
        evAnalytics: expect.objectContaining({
          tab: 'tariffs',
          tariffListScrollY: 480,
        }),
      }),
      '',
      expect.stringMatching(/#tariffs$/),
    );
    expect(replaceState.mock.invocationCallOrder[0]).toBeLessThan(pushState.mock.invocationCallOrder[0]);

    // Act: Deterministically replay the prior list entry rather than relying on browser traversal timing.
    act(() => {
      window.history.replaceState({
        unrelated: 'keep-me',
        evAnalytics: { tab: 'tariffs', entryId: 'list-1', tariffListScrollY: 480 },
      }, '', '#tariffs');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    // Assert: Back restores the recorded list position and original edit trigger.
    expect(await screen.findByRole('heading', { name: 'Tariffs' })).toBeInTheDocument();
    await waitFor(() => {
      expect(mockScrollTo).toHaveBeenCalledWith({ top: 480, behavior: 'auto' });
      expect(screen.getByRole('button', { name: 'Edit Ionity Lidl' })).toHaveFocus();
    });
    const restorationCountAfterFirstBack = mockScrollTo.mock.calls.length;

    // Act: The user scrolls the restored list before following its existing Forward editor entry.
    Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 777 });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(window.history.state).toMatchObject({
      evAnalytics: { tab: 'tariffs', entryId: 'list-1', tariffListScrollY: 777 },
    });

    // Act: Replay the old Forward edit entry after the list snapshot changed.
    act(() => {
      window.history.replaceState({
        unrelated: 'keep-me',
        evAnalytics: {
          tab: 'tariffs',
          entryId: 'edit-1',
          tariffListPredecessorId: 'list-1',
          tariffListScrollY: 480,
        },
      }, '', '#tariffs/edit/provider-1%3A%3Alidl');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    // Assert: Forward reopens the editor, captures the new list position, and does not replay list restoration.
    expect(await screen.findByRole('heading', { name: 'Edit Tariff' })).toBeInTheDocument();
    expect(window.history.state).toMatchObject({
      evAnalytics: { tab: 'tariffs', entryId: 'edit-1', tariffListScrollY: 777 },
    });
    expect(mockScrollTo).toHaveBeenCalledTimes(restorationCountAfterFirstBack);

    // Act: Deterministically replay the updated list entry for a second Back transition.
    act(() => {
      window.history.replaceState({
        unrelated: 'keep-me',
        evAnalytics: { tab: 'tariffs', entryId: 'list-1', tariffListScrollY: 777 },
      }, '', '#tariffs');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    // Assert: The second Back restores the new position and the originating tariff focus.
    expect(await screen.findByRole('heading', { name: 'Tariffs' })).toBeInTheDocument();
    await waitFor(() => {
      expect(mockScrollTo).toHaveBeenCalledWith({ top: 777, behavior: 'auto' });
      expect(screen.getByRole('button', { name: 'Edit Ionity Lidl' })).toHaveFocus();
    });
    replaceState.mockRestore();
    pushState.mockRestore();
  });

  it('restores the prior tariffs list on browser Back and reopens the available editor on Forward', async () => {
    // Arrange: Enter the editor from an in-app Tariffs list entry.
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Tariffs' }));
    await user.click(screen.getByRole('button', { name: 'Edit Ionity Lidl' }));
    expect(screen.getByRole('heading', { name: 'Edit Tariff' })).toBeInTheDocument();

    // Act: Replay the browser locations for the list and then the editor.
    act(() => {
      window.history.replaceState({ evAnalytics: { tab: 'tariffs', entryId: 'list-1' } }, '', '#tariffs');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    // Assert: Back derives list mode from the location rather than retaining stale editor state.
    expect(screen.getByRole('heading', { name: 'Tariffs' })).toBeInTheDocument();
    act(() => {
      window.history.replaceState({
        evAnalytics: { tab: 'tariffs', entryId: 'edit-1', tariffListPredecessorId: 'list-1' },
      }, '', '#tariffs/edit/provider-1%3A%3Alidl');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByRole('heading', { name: 'Edit Tariff' })).toBeInTheDocument();
  });

  it('uses history only for an in-app edit predecessor and otherwise replaces a direct edit with the tariffs list on cancel', async () => {
    // Arrange: Load a direct edit location with no in-app list predecessor.
    window.history.replaceState({ unrelated: 'keep-me' }, '', '#tariffs/edit/provider-1%3A%3Alidl');
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Edit Tariff' })).toBeInTheDocument();

    // Act: Cancel the direct editor.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    // Assert: The app stays within its own Tariffs list instead of traversing an unknown predecessor.
    expect(window.location.hash).toBe('#tariffs');
    expect(window.history.state).toMatchObject({
      unrelated: 'keep-me',
      evAnalytics: { tab: 'tariffs', tariffListPredecessorId: null },
    });
  });

  it('returns renamed saves to the list hash, restores the captured position, and focuses the emitted logical key', async () => {
    // Arrange: Start from an in-app list and open the editable tariff.
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Tariffs' }));
    await user.click(screen.getByRole('button', { name: 'Edit Ionity Lidl' }));

    // Act: Save the renamed tariff.
    await user.click(screen.getByRole('button', { name: 'Save Tariff' }));

    // Assert: Save uses the list location and completes position-before-focus restoration for the new key.
    expect(window.location.hash).toBe('#tariffs');
    await waitFor(() => {
      expect(mockScrollTo).toHaveBeenCalledWith({ top: 640, behavior: 'auto' });
      expect(screen.getByRole('button', { name: 'Edit Ionity Lidl Plus' })).toHaveFocus();
    });
  });

  it('closes an editor and clears pending tariff restoration when the user leaves the Tariffs tab', async () => {
    // Arrange: Open a tariff editor from the list.
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Tariffs' }));
    await user.click(screen.getByRole('button', { name: 'Edit Ionity Lidl' }));

    // Act: Select another top-level tab.
    await user.click(screen.getByRole('button', { name: 'Analytics' }));

    // Assert: The editor cannot remain stale behind a marked non-Tariffs entry.
    expect(screen.queryByRole('heading', { name: 'Edit Tariff' })).not.toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(window.history.state).toMatchObject({ evAnalytics: { tab: 'analytics' } });
  });
});
