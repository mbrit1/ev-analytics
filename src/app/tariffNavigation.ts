import type { NavigationTab } from '../shared/ui/Navigation/types';
import type { MouseEvent } from 'react';

/** Parsed browser location for the app-owned Tariffs namespace. */
export type TariffLocation =
  | { kind: 'unknown' }
  | { kind: 'list' }
  | { kind: 'edit'; logicalTariffKey: string }
  | { kind: 'malformed' };

/** Namespaced state stored on browser history entries owned by Tariffs. */
export interface TariffHistoryMarker {
  tab: NavigationTab;
  entryId: string;
  tariffListScrollY?: number;
  tariffListPredecessorId?: string | null;
}

let entrySequence = 0;

/** Parses a Tariffs hash without claiming unrelated browser locations. */
export function parseTariffLocation(hash: string): TariffLocation {
  if (hash === '#tariffs') return { kind: 'list' };
  const prefix = '#tariffs/edit/';
  if (!hash.startsWith(prefix)) return { kind: 'unknown' };
  const rawKey = hash.slice(prefix.length);
  if (!rawKey || rawKey.includes('/')) return { kind: 'malformed' };
  try {
    return { kind: 'edit', logicalTariffKey: decodeURIComponent(rawKey) };
  } catch {
    return { kind: 'malformed' };
  }
}

/** Produces the loadable hash destination for a logical tariff editor. */
export function tariffEditHref(logicalTariffKey: string): string {
  return `#tariffs/edit/${encodeURIComponent(logicalTariffKey)}`;
}

/** Creates a unique history marker, optionally with Tariffs-specific state. */
export function newTariffMarker(tab: NavigationTab, overrides: Partial<TariffHistoryMarker> = {}): TariffHistoryMarker {
  entrySequence += 1;
  return { tab, entryId: `tariff-${entrySequence}`, ...overrides };
}

/** Preserves foreign history state while replacing the app-owned marker. */
export function withTariffHistoryMarker(state: unknown, marker: TariffHistoryMarker): Record<string, unknown> {
  const base = state != null && typeof state === 'object' ? state as Record<string, unknown> : {};
  return { ...base, evAnalytics: marker };
}

/** Reads a structurally valid app-owned marker from arbitrary history state. */
export function readTariffHistoryMarker(state: unknown): TariffHistoryMarker | null {
  if (state == null || typeof state !== 'object') return null;
  const marker = (state as { evAnalytics?: unknown }).evAnalytics;
  if (marker == null || typeof marker !== 'object') return null;
  const value = marker as Partial<TariffHistoryMarker>;
  return typeof value.entryId === 'string'
    && (value.tab === 'sessions' || value.tab === 'tariffs' || value.tab === 'analytics')
    ? value as TariffHistoryMarker
    : null;
}

/** Removes only the app-owned marker while retaining unrelated history state. */
export function withoutTariffHistoryMarker(state: unknown): Record<string, unknown> {
  const base = state != null && typeof state === 'object' ? state as Record<string, unknown> : {};
  return Object.fromEntries(
    Object.entries(base).filter(([key]) => key !== 'evAnalytics'),
  );
}

/** Returns whether an anchor event should remain in the current app context. */
export function isOrdinaryTariffActivation(event: MouseEvent<HTMLAnchorElement>): boolean {
  if (!event) return true;
  const anchor = event.currentTarget;
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
    && !anchor.download && (!anchor.target || anchor.target === '_self');
}
