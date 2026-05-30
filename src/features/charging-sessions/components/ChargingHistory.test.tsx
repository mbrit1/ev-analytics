import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { ChargingHistory } from './ChargingHistory';
import { db, type ChargingSession } from '../../../infra/db';
import { saveSession } from '../services/sessionService';

/**
 * Test suite for the charging history UI.
 *
 * Ensures newly saved sessions appear without a full reload by relying on the
 * Dexie live-query subscription used by {@link useSessions}.
 */
describe('ChargingHistory', () => {
  beforeEach(async () => {
    // Arrange: Start each test from a clean IndexedDB state.
    await db.delete();
    await db.open();
  });

  it('renders a saved session after saveSession commits', async () => {
    // Arrange: Render the empty history first.
    render(<ChargingHistory />);
    expect(await screen.findByText('No Sessions Yet')).toBeInTheDocument();

    const now = new Date('2026-05-30T10:00:00.000Z');
    const session: ChargingSession = {
      id: 'session-1',
      user_id: 'user-1',
      session_timestamp: now,
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
      created_at: now,
      updated_at: now,
    };

    // Act: Save a session after the component is already mounted.
    await saveSession(session);

    // Assert: The live query causes the history list to update.
    await waitFor(() => {
      expect(screen.getByText('Charging History')).toBeInTheDocument();
    });
    expect(screen.getByText('Tesla')).toBeInTheDocument();
  });
});
