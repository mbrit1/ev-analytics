import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  function buildSession(
    id: string,
    sessionTimestamp: string,
    overrides: Partial<ChargingSession> = {}
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
    };
  }

  beforeEach(async () => {
    // Arrange: Start each test from a clean IndexedDB state.
    await db.delete();
    await db.open();
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
});
