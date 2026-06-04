import type { ChargingSession } from '../../../infra/db';

function toEpoch(value: Date | string | number | undefined): number {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

/**
 * Returns a new session array sorted from newest history entry to oldest.
 *
 * Ordering is deterministic: session timestamp desc, then creation timestamp
 * desc, then id asc as a stable fallback.
 */
export function sortSessionsNewestFirst(sessions: ChargingSession[]): ChargingSession[] {
  return [...sessions].sort((left, right) => {
    const sessionTimestampDelta =
      toEpoch(right.session_timestamp) - toEpoch(left.session_timestamp);
    if (sessionTimestampDelta !== 0) {
      return sessionTimestampDelta;
    }

    const createdAtDelta = toEpoch(right.created_at) - toEpoch(left.created_at);
    if (createdAtDelta !== 0) {
      return createdAtDelta;
    }

    return left.id.localeCompare(right.id);
  });
}
