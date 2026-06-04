import { describe, expect, it, vi } from 'vitest';
import type { ChargingSession } from '../../../infra/db';
import { groupSessionsByMonth } from './groupSessionsByMonth';

/**
 * Test suite for month-grouped charging-session history.
 *
 * Verifies newest-first month grouping, per-month totals, local date handling,
 * and immutability of the original session input.
 */
describe('groupSessionsByMonth', () => {
  function buildSession(
    id: string,
    sessionTimestamp: string,
    createdAt: string,
    overrides: Partial<ChargingSession> = {}
  ): ChargingSession {
    return {
      id,
      user_id: 'user-1',
      session_timestamp: new Date(sessionTimestamp),
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
      created_at: new Date(createdAt),
      updated_at: new Date(createdAt),
      ...overrides,
    };
  }

  it('groups sessions by month with newest months first', () => {
    // Arrange: Mix sessions from three different months out of order.
    const sessions = [
      buildSession('may', '2026-05-18T10:00:00.000Z', '2026-05-18T10:05:00.000Z'),
      buildSession('june-early', '2026-06-01T10:00:00.000Z', '2026-06-01T10:05:00.000Z'),
      buildSession('april', '2026-04-12T10:00:00.000Z', '2026-04-12T10:05:00.000Z'),
      buildSession('june-late', '2026-06-03T10:00:00.000Z', '2026-06-03T10:05:00.000Z'),
    ];

    // Act: Group the sessions for history rendering.
    const groups = groupSessionsByMonth(sessions);

    // Assert: Groups are ordered from newest month to oldest.
    expect(groups.map((group) => group.label)).toEqual([
      'Juni 2026',
      'Mai 2026',
      'April 2026',
    ]);
    expect(groups.map((group) => group.monthKey)).toEqual(['2026-06', '2026-05', '2026-04']);
  });

  it('keeps newest sessions first within a month', () => {
    // Arrange: Provide one month in the wrong order.
    const sessions = [
      buildSession('session-1', '2026-06-01T10:00:00.000Z', '2026-06-01T10:05:00.000Z'),
      buildSession('session-3', '2026-06-03T10:00:00.000Z', '2026-06-03T10:05:00.000Z'),
      buildSession('session-2', '2026-06-02T10:00:00.000Z', '2026-06-02T10:05:00.000Z'),
    ];

    // Act: Group the sessions.
    const [juneGroup] = groupSessionsByMonth(sessions);

    // Assert: Sessions stay newest first inside the month.
    expect(juneGroup.sessions.map((session) => session.id)).toEqual([
      'session-3',
      'session-2',
      'session-1',
    ]);
  });

  it('calculates month totals from cost and billed kwh', () => {
    // Arrange: Use two sessions in the same month with different totals.
    const sessions = [
      buildSession('session-1', '2026-06-01T10:00:00.000Z', '2026-06-01T10:05:00.000Z', {
        total_cost: 2204,
        kwh_billed: 51.25,
      }),
      buildSession('session-2', '2026-06-03T10:00:00.000Z', '2026-06-03T10:05:00.000Z', {
        total_cost: 2200,
        kwh_billed: 51.75,
      }),
    ];

    // Act: Group the sessions.
    const [juneGroup] = groupSessionsByMonth(sessions);

    // Assert: Group totals include both sessions.
    expect(juneGroup.count).toBe(2);
    expect(juneGroup.totalCostCents).toBe(4404);
    expect(juneGroup.totalKwh).toBe(103);
  });

  it('returns an empty array for empty input', () => {
    // Arrange: Use no sessions.
    const sessions: ChargingSession[] = [];

    // Act: Group the empty list.
    const groups = groupSessionsByMonth(sessions);

    // Assert: No groups are returned.
    expect(groups).toEqual([]);
  });

  it('treats missing totals defensively as zero', () => {
    // Arrange: Use malformed data with missing totals.
    const sessions = [
      buildSession('session-1', '2026-06-03T10:00:00.000Z', '2026-06-03T10:05:00.000Z', {
        total_cost: undefined as unknown as number,
        kwh_billed: undefined as unknown as number,
      }),
    ];

    // Act: Group the malformed session.
    const [group] = groupSessionsByMonth(sessions);

    // Assert: Totals fall back to zero rather than crashing.
    expect(group.totalCostCents).toBe(0);
    expect(group.totalKwh).toBe(0);
    expect(group.count).toBe(1);
  });

  it('does not mutate the input array', () => {
    // Arrange: Capture original order before grouping.
    const sessions = [
      buildSession('session-1', '2026-06-01T10:00:00.000Z', '2026-06-01T10:05:00.000Z'),
      buildSession('session-3', '2026-06-03T10:00:00.000Z', '2026-06-03T10:05:00.000Z'),
      buildSession('session-2', '2026-06-02T10:00:00.000Z', '2026-06-02T10:05:00.000Z'),
    ];
    const originalIds = sessions.map((session) => session.id);

    // Act: Group the sessions into a new structure.
    groupSessionsByMonth(sessions);

    // Assert: Source order remains untouched.
    expect(sessions.map((session) => session.id)).toEqual(originalIds);
  });

  it('groups by the runtime-local displayed month instead of the utc month', async () => {
    // Arrange: Pin the runtime timezone to Europe/Berlin for a deterministic boundary case.
    const previousTimeZone = process.env.TZ;
    process.env.TZ = 'Europe/Berlin';
    vi.resetModules();

    try {
      const { groupSessionsByMonth: groupSessionsByMonthInBerlin } = await import(
        './groupSessionsByMonth'
      );
      const sessions = [
        buildSession(
          'boundary-late-may-utc',
          '2026-05-31T22:30:00.000Z',
          '2026-05-31T22:35:00.000Z'
        ),
        buildSession(
          'boundary-later-may-utc',
          '2026-05-31T23:30:00.000Z',
          '2026-05-31T23:35:00.000Z'
        ),
      ];

      // Act: Group the boundary sessions with the Berlin-local formatter loaded.
      const groups = groupSessionsByMonthInBerlin(sessions);

      // Assert: Both UTC-May timestamps render into the June 2026 local history group.
      expect(groups).toHaveLength(1);
      expect(groups[0]?.monthKey).toBe('2026-06');
      expect(groups[0]?.label).toBe('Juni 2026');
      expect(groups[0]?.sessions.map((session) => session.id)).toEqual([
        'boundary-later-may-utc',
        'boundary-late-may-utc',
      ]);
    } finally {
      // Assert: Restore the original timezone for any later tests in this process.
      if (previousTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimeZone;
      }
      vi.resetModules();
    }
  });
});
