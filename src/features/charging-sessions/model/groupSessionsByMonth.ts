import type { ChargingSession } from '../../../infra/db';
import { sortSessionsNewestFirst } from './sortSessionsNewestFirst';

/**
 * Aggregated history data for one runtime-local calendar month of sessions.
 */
export type SessionMonthGroup = {
  monthKey: string;
  label: string;
  sessions: ChargingSession[];
  count: number;
  totalCostCents: number;
  totalKwh: number;
};

const monthFormatter = new Intl.DateTimeFormat('de-DE', {
  month: 'long',
  year: 'numeric',
});

function toDisplayDate(value: Date | string | number | undefined): Date {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? new Date(0) : value;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
  }

  return new Date(0);
}

function toMonthKey(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Groups charging sessions by locally displayed month while preserving the
 * shared newest-first history ordering.
 */
export function groupSessionsByMonth(sessions: ChargingSession[]): SessionMonthGroup[] {
  const sortedSessions = sortSessionsNewestFirst(sessions);
  const groups = new Map<string, SessionMonthGroup>();

  for (const session of sortedSessions) {
    const displayDate = toDisplayDate(session.session_timestamp);
    const monthKey = toMonthKey(displayDate);
    const existingGroup = groups.get(monthKey);

    if (existingGroup) {
      existingGroup.sessions.push(session);
      existingGroup.count += 1;
      existingGroup.totalCostCents += session.total_cost ?? 0;
      existingGroup.totalKwh += session.kwh_billed ?? 0;
      continue;
    }

    groups.set(monthKey, {
      monthKey,
      label: monthFormatter.format(displayDate),
      sessions: [session],
      count: 1,
      totalCostCents: session.total_cost ?? 0,
      totalKwh: session.kwh_billed ?? 0,
    });
  }

  return Array.from(groups.values());
}
