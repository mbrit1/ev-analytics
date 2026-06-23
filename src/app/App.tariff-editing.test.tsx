import { render, screen, waitFor } from '@testing-library/react';
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
    onEditTariff: (logicalTariffKey: string) => void;
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
            onClick={() => onEditTariff(currentTariffKey)}
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
    isLoading: false,
  })),
  startSyncRuntime: vi.fn(() => vi.fn()),
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
});
