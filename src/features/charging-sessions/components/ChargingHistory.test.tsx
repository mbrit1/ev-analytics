import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { ChargingHistory } from './ChargingHistory';
import { db, type ChargingSession } from '../../../infra/db';
import { saveSession } from '../services/sessionService';

vi.mock('../../auth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

/**
 * Test suite for the charging history UI.
 *
 * Ensures newly saved sessions appear without a full reload, retain the
 * existing empty state, and render under stable month-group summaries derived
 * from the Dexie live-query subscription used by {@link useSessions}.
 */
describe('ChargingHistory', () => {
  type SessionOverrides =
    | Partial<Extract<ChargingSession, { session_mode: 'plan' }>>
    | Partial<Extract<ChargingSession, { session_mode: 'ad_hoc' }>>;

  const scrollIntoViewMock = vi.fn();
  const scrollToMock = vi.fn();
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  const originalScrollTo = window.scrollTo;

  function buildSession(
    id: string,
    sessionTimestamp: string,
    overrides: SessionOverrides = {}
  ): ChargingSession {
    const timestamp = new Date(sessionTimestamp);

    return {
      id,
      user_id: 'user-1',
      session_timestamp: timestamp,
      provider_id: 'provider-1',
      provider_name_snapshot: 'Tesla',
      charging_plan_name_snapshot: 'Standard',
      charging_type: 'AC',
      kwh_billed: 12.5,
      total_cost: 5000,
      session_mode: 'plan',
      tariff_plan_id: 'plan-1',
      plan_selection_id: 'sel-1',
      price_snapshot: { label: 'Tesla Standard', kWhPrice: 40, sessionFee: 0 },
      pricing_context: 'standard',
      applied_price_per_kwh: 40,
      applied_ac_price_per_kwh: 40,
      applied_dc_price_per_kwh: 40,
      applied_roaming_ac_price_per_kwh: undefined,
      applied_roaming_dc_price_per_kwh: undefined,
      applied_monthly_base_fee: undefined,
      applied_session_fee: 0,
      created_at: timestamp,
      updated_at: timestamp,
      ...overrides,
    } as unknown as ChargingSession;
  }

  beforeEach(async () => {
    // Arrange: Start each test from a clean IndexedDB state.
    await db.delete();
    await db.open();
    scrollIntoViewMock.mockReset();
    scrollToMock.mockReset();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock,
    });
    vi.stubGlobal('scrollTo', scrollToMock);
  });

  afterEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: originalScrollIntoView,
    });
    vi.stubGlobal('scrollTo', originalScrollTo);
  });

  it('keeps the empty state unchanged when there are no sessions', async () => {
    // Arrange: Render the history with an empty database.
    render(<ChargingHistory />);

    // Act: Wait for the empty state to appear.
    const emptyHeading = await screen.findByText('No Sessions Yet');

    // Assert: The existing empty state copy remains visible.
    expect(emptyHeading).toBeInTheDocument();
    expect(
      screen.getByText('Your charging history will appear here once you log your first session.')
    ).toBeInTheDocument();
  });

  it.each(['idle', 'loading'] as const)('keeps the empty history on its %s skeleton while sessions hydrate', async (status) => {
    // Arrange: render an empty local cache before or during remote session hydration.
    render(<ChargingHistory hydrationState={{ status }} />);

    // Act: wait for the local live query to settle.
    await waitFor(() => {
      expect(screen.queryByText('No Sessions Yet')).not.toBeInTheDocument();
    });

    // Assert: an unfinished hydration cannot be presented as a confirmed empty history.
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a retryable error instead of an empty history when session hydration fails', async () => {
    // Arrange: render an empty local cache with a failed remote session hydration.
    const onRetryHydration = vi.fn();
    const user = userEvent.setup();
    render(
      <ChargingHistory
        hydrationState={{ status: 'failed', failureKind: 'invalid_data' }}
        onRetryHydration={onRetryHydration}
      />
    );

    // Act: wait for the failure state and request another attempt.
    const alert = await screen.findByRole('alert');
    const retryButton = screen.getByRole('button', { name: 'Try again' });
    await user.click(retryButton);

    // Assert: the user receives actionable, non-technical feedback instead of the normal empty state.
    expect(alert).toHaveTextContent('Sessions couldn’t be loaded');
    expect(alert).toHaveTextContent(
      'Your charging history is currently unavailable. Your saved data has not been changed. Try again, or check back later if the problem continues.'
    );
    expect(screen.queryByText('No Sessions Yet')).not.toBeInTheDocument();
    expect(retryButton).toHaveClass('min-h-[44px]');
    expect(onRetryHydration).toHaveBeenCalledTimes(1);
  });

  it('keeps cached sessions visible and warns when a refresh fails', async () => {
    // Arrange: save a local session before simulating a failed remote refresh.
    const onRetryHydration = vi.fn();
    const user = userEvent.setup();
    await act(async () => {
      await saveSession(buildSession('session-cached-failure', '2026-05-30T10:00:00.000Z'));
    });

    render(
      <ChargingHistory
        hydrationState={{ status: 'failed', failureKind: 'network' }}
        onRetryHydration={onRetryHydration}
      />
    );

    // Act: wait for the local session and invoke the available retry action.
    expect(await screen.findByText('Tesla')).toBeInTheDocument();
    const warning = screen.getByRole('status');
    const retryButton = screen.getByRole('button', { name: 'Try again' });
    await user.click(retryButton);

    // Assert: cached data remains usable while the stale-data warning is announced politely.
    expect(warning).toHaveAttribute('aria-live', 'polite');
    expect(warning).toHaveTextContent('Sessions couldn’t be refreshed');
    expect(warning).toHaveTextContent(
      'Showing sessions saved on this device. Recent changes from another device may not be available.'
    );
    expect(retryButton).toHaveClass('min-h-[44px]');
    expect(onRetryHydration).toHaveBeenCalledTimes(1);
  });

  it('keeps cached sessions visible without a warning while another refresh is loading', async () => {
    // Arrange: save one local session while a new remote hydration attempt is in progress.
    await act(async () => {
      await saveSession(buildSession('session-cached-loading', '2026-05-30T10:00:00.000Z'));
    });

    // Act: render the cached history in its loading state.
    render(<ChargingHistory hydrationState={{ status: 'loading' }} />);

    // Assert: a usable cache wins over the loading skeleton and no stale-data warning is needed.
    expect(await screen.findByText('Tesla')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders a saved session after saveSession commits', async () => {
    // Arrange: Render the empty history first.
    render(<ChargingHistory />);
    expect(await screen.findByText('No Sessions Yet')).toBeInTheDocument();

    const session = buildSession('session-1', '2026-05-30T10:00:00.000Z');

    // Act: Save a session after the component is already mounted.
    await act(async () => {
      await saveSession(session);
    });

    // Assert: The live query causes the history list to update.
    await waitFor(() => {
      expect(screen.getByText('Mai 2026')).toBeInTheDocument();
    });
    expect(screen.getByText('Tesla')).toBeInTheDocument();
    expect(screen.queryByText('Charging History')).not.toBeInTheDocument();
  });

  it('renders the billing provider as primary identity and a distinct CPO as secondary context', async () => {
    // Arrange: persist the real-world two-party ad-hoc identity example.
    const session = buildSession('session-cariqa', '2026-07-17T10:00:00.000Z', {
      session_mode: 'ad_hoc',
      provider_id: null,
      provider_name_snapshot: 'Cariqa',
      charging_plan_name_snapshot: 'Ad-Hoc',
      tariff_plan_id: null,
      plan_selection_id: null,
      pricing_context: 'ad_hoc',
      ad_hoc_pricing: {
        cpoName: 'TEAG',
        pricePerKwh: 59,
        pricePerSession: null,
        receiptUrl: null,
        notes: null,
      },
    });
    await act(async () => {
      await saveSession(session);
    });

    // Act: render the history card from local persistence.
    render(<ChargingHistory />);

    // Assert: commercial roles are presented with the required hierarchy and copy.
    expect(await screen.findByRole('heading', { name: 'Cariqa' })).toBeInTheDocument();
    expect(screen.getByText('Operated by TEAG')).toBeInTheDocument();
    expect(screen.queryByText(/^TEAG$/)).not.toBeInTheDocument();
  });

  it('omits unavailable or equivalent operator metadata without changing the billing identity', async () => {
    // Arrange: persist one missing-CPO session and one case/whitespace-equivalent session.
    await act(async () => {
      await saveSession(buildSession('session-no-cpo', '2026-07-17T10:00:00.000Z', {
        session_mode: 'ad_hoc',
        provider_id: null,
        provider_name_snapshot: 'Cariqa',
        charging_plan_name_snapshot: 'Ad-Hoc',
        tariff_plan_id: null,
        plan_selection_id: null,
        pricing_context: 'ad_hoc',
        ad_hoc_pricing: {
          cpoName: null,
          pricePerKwh: 59,
          pricePerSession: null,
          receiptUrl: null,
          notes: null,
        },
      }));
      await saveSession(buildSession('session-same-cpo', '2026-07-18T10:00:00.000Z', {
        session_mode: 'ad_hoc',
        provider_id: null,
        provider_name_snapshot: 'FastNet',
        charging_plan_name_snapshot: 'Ad-Hoc',
        tariff_plan_id: null,
        plan_selection_id: null,
        pricing_context: 'ad_hoc',
        ad_hoc_pricing: {
          cpoName: '  fastnet  ',
          pricePerKwh: 59,
          pricePerSession: null,
          receiptUrl: null,
          notes: null,
        },
      }));
    });

    // Act: render both canonical display cases.
    render(<ChargingHistory />);

    // Assert: no invented or duplicate operator line is shown.
    expect(await screen.findByRole('heading', { name: 'Cariqa' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'FastNet' })).toBeInTheDocument();
    expect(screen.queryByText(/Operated by/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Unknown/i)).not.toBeInTheDocument();
  });

  it('keeps a long billing-provider name readable within the history card', async () => {
    // Arrange: persist an ad-hoc session with a deliberately long primary identity.
    const longName = 'A very long billing provider name used for cross-border charging receipts';
    await act(async () => {
      await saveSession(buildSession('session-long-provider', '2026-07-19T10:00:00.000Z', {
        session_mode: 'ad_hoc',
        provider_id: null,
        provider_name_snapshot: longName,
        charging_plan_name_snapshot: 'Ad-Hoc',
        tariff_plan_id: null,
        plan_selection_id: null,
        pricing_context: 'ad_hoc',
        ad_hoc_pricing: {
          cpoName: null,
          pricePerKwh: 59,
          pricePerSession: null,
          receiptUrl: null,
          notes: null,
        },
      }));
    });

    // Act: render the long identity.
    render(<ChargingHistory />);

    // Assert: the complete name remains visible and may wrap instead of overflowing.
    const heading = await screen.findByRole('heading', { name: longName });
    expect(heading).toHaveClass('break-words');
    expect(heading.parentElement).toHaveClass('min-w-0');
  });

  it('renders month group labels and stable summaries while keeping session cards visible', async () => {
    // Arrange: Save sessions across two months, including explicit zero totals.
    render(<ChargingHistory />);
    expect(await screen.findByText('No Sessions Yet')).toBeInTheDocument();

    const maySession = buildSession('session-may', '2026-05-18T10:00:00.000Z', {
      total_cost: 2204,
      kwh_billed: 51.25,
    });
    const juneSessionOne = buildSession('session-june-1', '2026-06-01T10:00:00.000Z', {
      total_cost: 2200,
      kwh_billed: 51.75,
    });
    const juneSessionTwo = buildSession('session-june-2', '2026-06-03T10:00:00.000Z', {
      provider_name_snapshot: 'Ionity',
      total_cost: 0,
      kwh_billed: 0,
    });

    await act(async () => {
      await saveSession(maySession);
      await saveSession(juneSessionOne);
      await saveSession(juneSessionTwo);
    });

    // Act: Wait for grouped month headings to render.
    await waitFor(() => {
      expect(screen.getByText('Juni 2026')).toBeInTheDocument();
    });

    // Assert: Group labels, compact summaries, and existing cards all remain visible.
    expect(screen.getByText('Mai 2026')).toBeInTheDocument();
    expect(screen.getByText('51,75 kWh · 22,00 €')).toBeInTheDocument();
    expect(screen.getByText('51,25 kWh · 22,04 €')).toBeInTheDocument();
    expect(screen.queryByText('2 Sessions · 22,00 € · 51,75 kWh')).not.toBeInTheDocument();
    expect(screen.queryByText('1 Session · 22,04 € · 51,25 kWh')).not.toBeInTheDocument();
    expect(screen.queryByText('2 Sessions')).not.toBeInTheDocument();
    expect(screen.getAllByText('Tesla')).toHaveLength(2);
    expect(screen.getByText('Ionity')).toBeInTheDocument();
    expect(screen.getByText('22,00 €')).toBeInTheDocument();
    expect(screen.getByText('0,00 €')).toBeInTheDocument();
  });

  it('keeps session cards non-interactive when no selection handler is provided', async () => {
    // Arrange: render the history without an edit handler and persist one session.
    render(<ChargingHistory />);
    expect(await screen.findByText('No Sessions Yet')).toBeInTheDocument();

    const session = buildSession('session-static', '2026-05-30T10:00:00.000Z');
    await act(async () => {
      await saveSession(session);
    });

    // Act: wait for the saved card content to appear.
    await waitFor(() => {
      expect(screen.getByText('Mai 2026')).toBeInTheDocument();
    });

    // Assert: the card stays visible without exposing an inert button.
    expect(screen.queryByRole('button', {
      name: 'Edit session Tesla 30.05.2026',
    })).not.toBeInTheDocument();
    expect(screen.getByText('Tesla')).toBeInTheDocument();
  });

  it('emits the selected session when a history card is clicked', async () => {
    // Arrange: render and persist one visible session.
    const user = userEvent.setup();
    const onSelectSession = vi.fn();
    render(<ChargingHistory onSelectSession={onSelectSession} />);
    expect(await screen.findByText('No Sessions Yet')).toBeInTheDocument();

    const session = buildSession('session-click', '2026-05-30T10:00:00.000Z');
    await act(async () => {
      await saveSession(session);
    });

    const trigger = await screen.findByRole('button', {
      name: 'Edit session Tesla 30.05.2026',
    });

    // Act: inspect the interactive card shell, then activate it.
    const slab = trigger.parentElement;
    await user.click(trigger);

    // Assert: only the button owns card padding and the session is emitted.
    expect(slab).not.toHaveClass('p-8');
    expect(trigger).toHaveClass('p-6');
    expect(onSelectSession).toHaveBeenCalledWith(expect.objectContaining({
      id: 'session-click',
    }));
  });

  it('emits the selected session from an accessible card button with keyboard activation', async () => {
    // Arrange: render and persist one visible session.
    const user = userEvent.setup();
    const onSelectSession = vi.fn();
    render(<ChargingHistory onSelectSession={onSelectSession} />);
    expect(await screen.findByText('No Sessions Yet')).toBeInTheDocument();

    const session = buildSession('session-edit', '2026-05-30T10:00:00.000Z');
    await act(async () => {
      await saveSession(session);
    });

    const trigger = await screen.findByRole('button', {
      name: 'Edit session Tesla 30.05.2026',
    });

    // Act: focus with Tab and activate with Enter, then Space.
    await user.tab();
    expect(trigger).toHaveFocus();

    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    // Assert: native button behavior emits the exact selected session for both keys.
    expect(onSelectSession).toHaveBeenNthCalledWith(1, expect.objectContaining({
      id: 'session-edit',
    }));
    expect(onSelectSession).toHaveBeenNthCalledWith(2, expect.objectContaining({
      id: 'session-edit',
    }));
  });

  it('restores a requested session after the live query renders it, then completes once', async () => {
    // Arrange: render with a pending restore target before the session exists.
    const onRestorationComplete = vi.fn();
    render(
      <ChargingHistory
        onSelectSession={vi.fn()}
        restorationRequest={{
          type: 'session',
          sessionId: 'session-restore',
        }}
        onRestorationComplete={onRestorationComplete}
      />
    );
    expect(await screen.findByText('No Sessions Yet')).toBeInTheDocument();

    const session = buildSession('session-restore', '2026-05-30T10:00:00.000Z');

    // Act: save the target session after the component has already subscribed.
    await act(async () => {
      await saveSession(session);
    });

    const trigger = await screen.findByRole('button', {
      name: 'Edit session Tesla 30.05.2026',
    });

    // Assert: restoration waits for the card, avoids smooth scrolling, focuses it, and completes once.
    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalledWith({
        behavior: 'auto',
        block: 'center',
      });
    });
    expect(trigger).toHaveFocus();
    expect(onRestorationComplete).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveAttribute('data-session-id', 'session-restore');
  });

  it('does not complete restoration until the requested session exists', async () => {
    // Arrange: render with a restore target that is not yet present.
    const onRestorationComplete = vi.fn();
    render(
      <ChargingHistory
        restorationRequest={{
          type: 'session',
          sessionId: 'session-missing',
        }}
        onRestorationComplete={onRestorationComplete}
      />
    );
    expect(await screen.findByText('No Sessions Yet')).toBeInTheDocument();

    const otherSession = buildSession('session-other', '2026-05-30T10:00:00.000Z');

    // Act: save a different session so the list re-renders without the target.
    await act(async () => {
      await saveSession(otherSession);
    });

    await screen.findByText('Tesla');

    // Assert: nothing restores or completes until the requested target appears.
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    expect(onRestorationComplete).not.toHaveBeenCalled();
  });

  it('runs restoration once per request even if the same target re-renders again', async () => {
    // Arrange: save the target before mounting so the first render can restore immediately.
    const onRestorationComplete = vi.fn();
    const session = buildSession('session-once', '2026-05-30T10:00:00.000Z');
    await act(async () => {
      await saveSession(session);
    });

    const { rerender } = render(
      <ChargingHistory
        onSelectSession={vi.fn()}
        restorationRequest={{
          type: 'session',
          sessionId: 'session-once',
        }}
        onRestorationComplete={onRestorationComplete}
      />
    );

    await screen.findByRole('button', {
      name: 'Edit session Tesla 30.05.2026',
    });

    await waitFor(() => {
      expect(onRestorationComplete).toHaveBeenCalledTimes(1);
    });

    // Act: re-render with the same request object contents after the card already exists.
    rerender(
      <ChargingHistory
        onSelectSession={vi.fn()}
        restorationRequest={{
          type: 'session',
          sessionId: 'session-once',
        }}
        onRestorationComplete={onRestorationComplete}
      />
    );

    // Assert: the same restore request is not re-applied.
    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    });
    expect(onRestorationComplete).toHaveBeenCalledTimes(1);
  });

  it('allows a new implicit restoration request for the same session after the prior request is cleared', async () => {
    // Arrange: render one visible session and complete an initial implicit restoration.
    const onRestorationComplete = vi.fn();
    const session = buildSession('session-repeat', '2026-05-30T10:00:00.000Z');
    await act(async () => {
      await saveSession(session);
    });

    const { rerender } = render(
      <ChargingHistory
        onSelectSession={vi.fn()}
        restorationRequest={{
          type: 'session',
          sessionId: 'session-repeat',
        }}
        onRestorationComplete={onRestorationComplete}
      />
    );

    await screen.findByRole('button', {
      name: 'Edit session Tesla 30.05.2026',
    });
    await waitFor(() => {
      expect(onRestorationComplete).toHaveBeenCalledTimes(1);
    });

    // Act: clear the request, then issue a fresh implicit request for the same session.
    rerender(<ChargingHistory onSelectSession={vi.fn()} />);
    rerender(
      <ChargingHistory
        onSelectSession={vi.fn()}
        restorationRequest={{
          type: 'session',
          sessionId: 'session-repeat',
        }}
        onRestorationComplete={onRestorationComplete}
      />
    );

    // Assert: the second request is treated as a new attempt.
    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
    });
    expect(onRestorationComplete).toHaveBeenCalledTimes(2);
  });

  it('does not re-run an explicit restoration request key after a different request completes', async () => {
    // Arrange: save two sessions to exercise explicit dedupe across interleaved requests.
    const onRestorationComplete = vi.fn();
    await act(async () => {
      await saveSession(buildSession('session-a', '2026-05-30T10:00:00.000Z'));
      await saveSession(buildSession('session-b', '2026-05-31T10:00:00.000Z', {
        provider_name_snapshot: 'Ionity',
      }));
    });

    const { rerender } = render(
      <ChargingHistory
        onSelectSession={vi.fn()}
        restorationRequest={{
          type: 'session',
          sessionId: 'session-a',
          requestKey: 'restore-a',
        }}
        onRestorationComplete={onRestorationComplete}
      />
    );

    await screen.findByRole('button', {
      name: 'Edit session Tesla 30.05.2026',
    });
    await waitFor(() => {
      expect(onRestorationComplete).toHaveBeenCalledTimes(1);
    });

    rerender(
      <ChargingHistory
        onSelectSession={vi.fn()}
        restorationRequest={{
          type: 'session',
          sessionId: 'session-b',
          requestKey: 'restore-b',
        }}
        onRestorationComplete={onRestorationComplete}
      />
    );
    await waitFor(() => {
      expect(onRestorationComplete).toHaveBeenCalledTimes(2);
    });

    // Act: issue the original explicit request key again.
    rerender(
      <ChargingHistory
        onSelectSession={vi.fn()}
        restorationRequest={{
          type: 'session',
          sessionId: 'session-a',
          requestKey: 'restore-a',
        }}
        onRestorationComplete={onRestorationComplete}
      />
    );

    // Assert: explicit request keys are one-shot even after other requests complete.
    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
    });
    expect(onRestorationComplete).toHaveBeenCalledTimes(2);
  });

  it('restores a saved scroll position immediately and optionally focuses the prior session card', async () => {
    // Arrange: save one session so the focus target exists.
    const onRestorationComplete = vi.fn();
    const session = buildSession('session-position', '2026-05-30T10:00:00.000Z');
    await act(async () => {
      await saveSession(session);
    });

    // Act: render history with a position-based restoration request.
    render(
      <ChargingHistory
        onSelectSession={vi.fn()}
        restorationRequest={{
          type: 'position',
          scrollY: 640,
          focusSessionId: 'session-position',
        }}
        onRestorationComplete={onRestorationComplete}
      />
    );

    const trigger = await screen.findByRole('button', {
      name: 'Edit session Tesla 30.05.2026',
    });

    // Assert: the previous window offset is restored without smooth scrolling and the card regains focus.
    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledWith({ top: 640, behavior: 'auto' });
    });
    expect(trigger).toHaveFocus();
    expect(onRestorationComplete).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('waits for the requested focus card before running a position restoration', async () => {
    // Arrange: render with a pending position restore that also wants to refocus a session card.
    const onRestorationComplete = vi.fn();
    render(
      <ChargingHistory
        onSelectSession={vi.fn()}
        restorationRequest={{
          type: 'position',
          scrollY: 640,
          focusSessionId: 'session-delayed-focus',
        }}
        onRestorationComplete={onRestorationComplete}
      />
    );
    expect(await screen.findByText('No Sessions Yet')).toBeInTheDocument();

    // Assert: nothing restores until the focus target exists.
    expect(scrollToMock).not.toHaveBeenCalled();
    expect(onRestorationComplete).not.toHaveBeenCalled();

    // Act: save the requested session after the component has mounted.
    await act(async () => {
      await saveSession(buildSession('session-delayed-focus', '2026-05-30T10:00:00.000Z'));
    });

    const trigger = await screen.findByRole('button', {
      name: 'Edit session Tesla 30.05.2026',
    });

    // Assert: the request restores position only after the card can also take focus.
    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledWith({ top: 640, behavior: 'auto' });
    });
    expect(trigger).toHaveFocus();
    expect(onRestorationComplete).toHaveBeenCalledTimes(1);
  });

  it('completes a position-only restoration request after the loading state settles, even when history is empty', async () => {
    // Arrange: render with a position request before the live query has produced any cards.
    const onRestorationComplete = vi.fn();
    render(
      <ChargingHistory
        onSelectSession={vi.fn()}
        restorationRequest={{
          type: 'position',
          scrollY: 420,
        }}
        onRestorationComplete={onRestorationComplete}
      />
    );
    expect(await screen.findByText('No Sessions Yet')).toBeInTheDocument();

    // Assert: once loading settles, the request restores position and clears even without cards.
    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledWith({ top: 420, behavior: 'auto' });
    });
    expect(onRestorationComplete).toHaveBeenCalledTimes(1);
  });
});
