import { describe, it, expect } from 'vitest';
import type { ChargingSession } from '../../../infra/db';
import { sortSessionsNewestFirst } from './sortSessionsNewestFirst';

/**
 * Test suite for deterministic charging-session history ordering.
 *
 * Verifies newest-first sorting by session timestamp, then creation timestamp,
 * while preserving input immutability and a stable id fallback.
 */
describe('sortSessionsNewestFirst', () => {
  function buildSession(
    id: string,
    sessionTimestamp: string,
    createdAt: string
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
    };
  }

  it('sorts sessions by session timestamp descending', () => {
    // Arrange: Provide sessions in a mixed order.
    const sessions = [
      buildSession('session-1', '2026-06-01T10:00:00.000Z', '2026-06-01T10:05:00.000Z'),
      buildSession('session-3', '2026-06-03T10:00:00.000Z', '2026-06-03T10:05:00.000Z'),
      buildSession('session-2', '2026-06-02T10:00:00.000Z', '2026-06-02T10:05:00.000Z'),
    ];

    // Act: Sort using the shared history utility.
    const sortedSessions = sortSessionsNewestFirst(sessions);

    // Assert: Newest session dates appear first.
    expect(sortedSessions.map((session) => session.id)).toEqual([
      'session-3',
      'session-2',
      'session-1',
    ]);
  });

  it('uses created_at descending when session timestamps match', () => {
    // Arrange: Keep the session timestamp equal while varying creation time.
    const sessions = [
      buildSession('session-older-create', '2026-06-03T10:00:00.000Z', '2026-06-03T10:01:00.000Z'),
      buildSession('session-newer-create', '2026-06-03T10:00:00.000Z', '2026-06-03T10:02:00.000Z'),
    ];

    // Act: Sort the tied sessions.
    const sortedSessions = sortSessionsNewestFirst(sessions);

    // Assert: The more recently created record wins the tie.
    expect(sortedSessions.map((session) => session.id)).toEqual([
      'session-newer-create',
      'session-older-create',
    ]);
  });

  it('uses id as a deterministic fallback when timestamps are equal', () => {
    // Arrange: Create fully tied sessions that need a stable fallback.
    const sessions = [
      buildSession('session-b', '2026-06-03T10:00:00.000Z', '2026-06-03T10:02:00.000Z'),
      buildSession('session-a', '2026-06-03T10:00:00.000Z', '2026-06-03T10:02:00.000Z'),
    ];

    // Act: Sort the fully tied sessions.
    const sortedSessions = sortSessionsNewestFirst(sessions);

    // Assert: The fallback order is deterministic.
    expect(sortedSessions.map((session) => session.id)).toEqual([
      'session-a',
      'session-b',
    ]);
  });

  it('returns an empty array for empty input', () => {
    // Arrange: Use no sessions.
    const sessions: ChargingSession[] = [];

    // Act: Sort the empty list.
    const sortedSessions = sortSessionsNewestFirst(sessions);

    // Assert: The result remains empty.
    expect(sortedSessions).toEqual([]);
  });

  it('returns a single session unchanged', () => {
    // Arrange: Use a single session.
    const session = buildSession(
      'session-1',
      '2026-06-03T10:00:00.000Z',
      '2026-06-03T10:02:00.000Z'
    );

    // Act: Sort a one-item list.
    const sortedSessions = sortSessionsNewestFirst([session]);

    // Assert: The single item is preserved.
    expect(sortedSessions).toEqual([session]);
  });

  it('does not mutate the input array', () => {
    // Arrange: Capture the original order before sorting.
    const sessions = [
      buildSession('session-1', '2026-06-01T10:00:00.000Z', '2026-06-01T10:05:00.000Z'),
      buildSession('session-3', '2026-06-03T10:00:00.000Z', '2026-06-03T10:05:00.000Z'),
      buildSession('session-2', '2026-06-02T10:00:00.000Z', '2026-06-02T10:05:00.000Z'),
    ];
    const originalIds = sessions.map((session) => session.id);

    // Act: Sort into a new array.
    const sortedSessions = sortSessionsNewestFirst(sessions);

    // Assert: The returned order changes without mutating the source array.
    expect(sortedSessions.map((session) => session.id)).toEqual([
      'session-3',
      'session-2',
      'session-1',
    ]);
    expect(sessions.map((session) => session.id)).toEqual(originalIds);
  });
});
