import type { ChargingSession, ProviderPlanSelection } from '../../../infra/db';
import { createCanonicalSerialization } from '../model/canonicalSerialization';

export function toRemoteProviderPlanSelections(data: unknown, userId: string): ProviderPlanSelection[] | null {
  if (!Array.isArray(data)) return null;
  const selections: ProviderPlanSelection[] = [];
  for (const value of data) {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    if (raw.user_id !== userId || typeof raw.id !== 'string'
      || typeof raw.provider_id !== 'string' || typeof raw.tariff_plan_id !== 'string'
      || !isTariffPriceSnapshot(raw.price_snapshot)) {
      return null;
    }
    const validFrom = asDate(raw.valid_from);
    const createdAt = asDate(raw.created_at);
    const updatedAt = asDate(raw.updated_at);
    const validTo = raw.valid_to == null ? raw.valid_to : asDate(raw.valid_to);
    const deletedAt = raw.deleted_at == null ? raw.deleted_at : asDate(raw.deleted_at);
    if (!validFrom || !createdAt || !updatedAt
      || (raw.valid_to != null && !validTo) || (raw.deleted_at != null && !deletedAt)) {
      return null;
    }
    selections.push({
      id: raw.id,
      user_id: userId,
      provider_id: raw.provider_id,
      tariff_plan_id: raw.tariff_plan_id,
      valid_from: validFrom,
      valid_to: validTo as Date | null | undefined,
      price_snapshot: raw.price_snapshot,
      created_at: createdAt,
      updated_at: updatedAt,
      deleted_at: deletedAt as Date | undefined,
    });
  }
  return selections;
}

export function areCompatibleRemoteSelections(
  localSelections: readonly ProviderPlanSelection[],
  remoteSelections: readonly ProviderPlanSelection[],
  canonicalProviderId: string,
  coveredLocalIds: ReadonlySet<string> = new Set(),
): boolean {
  return areCompatibleRemoteRows(
    localSelections,
    remoteSelections,
    canonicalProviderId,
    coveredLocalIds,
    toCanonicalRemoteSelectionShape,
  );
}

function toCanonicalRemoteSelectionShape(selection: ProviderPlanSelection): Record<string, unknown> {
  return {
    id: selection.id,
    user_id: selection.user_id,
    provider_id: selection.provider_id,
    tariff_plan_id: selection.tariff_plan_id,
    valid_from: selection.valid_from,
    valid_to: selection.valid_to ?? null,
    price_snapshot: selection.price_snapshot,
    created_at: selection.created_at,
    updated_at: selection.updated_at,
    deleted_at: selection.deleted_at ?? null,
  };
}

export function toRemotePlanModeSessions(
  data: unknown,
  userId: string,
): Array<Extract<ChargingSession, { session_mode: 'plan' }>> | null {
  if (!Array.isArray(data)) return null;
  const sessions: Array<Extract<ChargingSession, { session_mode: 'plan' }>> = [];
  for (const value of data) {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    if (raw.user_id !== userId || raw.session_mode !== 'plan'
      || typeof raw.id !== 'string' || typeof raw.provider_id !== 'string'
      || typeof raw.tariff_plan_id !== 'string' || typeof raw.provider_name_snapshot !== 'string'
      || (raw.charging_type !== 'AC' && raw.charging_type !== 'DC')
      || typeof raw.kwh_billed !== 'number' || typeof raw.total_cost !== 'number'
      || typeof raw.applied_session_fee !== 'number'
      || (raw.plan_selection_id != null && typeof raw.plan_selection_id !== 'string')
      || (raw.charging_plan_name_snapshot != null && typeof raw.charging_plan_name_snapshot !== 'string')) {
      return null;
    }
    const sessionTimestamp = asDate(raw.session_timestamp);
    const createdAt = asDate(raw.created_at);
    const updatedAt = asDate(raw.updated_at);
    const deletedAt = raw.deleted_at == null ? raw.deleted_at : asDate(raw.deleted_at);
    if (!sessionTimestamp || !createdAt || !updatedAt || (raw.deleted_at != null && !deletedAt)) {
      return null;
    }
    sessions.push({
      ...raw,
      id: raw.id,
      user_id: userId,
      session_mode: 'plan',
      provider_id: raw.provider_id,
      tariff_plan_id: raw.tariff_plan_id,
      provider_name_snapshot: raw.provider_name_snapshot,
      charging_type: raw.charging_type,
      kwh_billed: raw.kwh_billed,
      total_cost: raw.total_cost,
      applied_session_fee: raw.applied_session_fee,
      session_timestamp: sessionTimestamp,
      created_at: createdAt,
      updated_at: updatedAt,
      deleted_at: deletedAt as Date | undefined,
    } as Extract<ChargingSession, { session_mode: 'plan' }>);
  }
  return sessions;
}

export function areCompatibleRemoteSessions(
  localSessions: readonly Extract<ChargingSession, { session_mode: 'plan' }>[],
  remoteSessions: readonly Extract<ChargingSession, { session_mode: 'plan' }>[],
  canonicalProviderId: string,
  coveredLocalIds: ReadonlySet<string> = new Set(),
): boolean {
  return areCompatibleRemoteRows(
    localSessions,
    remoteSessions,
    canonicalProviderId,
    coveredLocalIds,
    toCanonicalRemoteSessionShape,
  );
}

function areCompatibleRemoteRows<T extends { id: string; provider_id: string }>(
  localRows: readonly T[],
  remoteRows: readonly T[],
  canonicalProviderId: string,
  coveredLocalIds: ReadonlySet<string>,
  toCanonicalShape: (row: T) => Record<string, unknown>,
): boolean {
  const localById = new Map(localRows.map((row) => [row.id, row]));
  const remoteById = new Map<string, T>();
  for (const remote of remoteRows) {
    if (remoteById.has(remote.id)) return false;
    remoteById.set(remote.id, remote);
  }

  const compatibleRemoteRows = remoteRows.every((remote) => {
    const local = localById.get(remote.id);
    return local !== undefined
      && remote.provider_id === canonicalProviderId
      && createCanonicalSerialization(toCanonicalShape({
        ...local,
        provider_id: canonicalProviderId,
      })) === createCanonicalSerialization(toCanonicalShape(remote));
  });
  if (!compatibleRemoteRows) return false;

  return localRows.every((local) => remoteById.has(local.id) || coveredLocalIds.has(local.id));
}

function toCanonicalRemoteSessionShape(
  session: Extract<ChargingSession, { session_mode: 'plan' }>,
): Record<string, unknown> {
  return {
    id: session.id,
    user_id: session.user_id,
    session_timestamp: session.session_timestamp,
    provider_id: session.provider_id,
    provider_name_snapshot: session.provider_name_snapshot,
    charging_plan_name_snapshot: session.charging_plan_name_snapshot ?? null,
    charging_type: session.charging_type,
    kwh_billed: session.kwh_billed,
    kwh_added: session.kwh_added ?? null,
    total_cost: session.total_cost,
    session_mode: session.session_mode,
    tariff_plan_id: session.tariff_plan_id,
    ad_hoc_pricing: null,
    plan_selection_id: session.plan_selection_id ?? null,
    price_snapshot: session.price_snapshot ?? null,
    odometer_km: session.odometer_km ?? null,
    start_soc_percentage: session.start_soc_percentage ?? null,
    end_soc_percentage: session.end_soc_percentage ?? null,
    notes: session.notes ?? null,
    applied_price_per_kwh: session.applied_price_per_kwh ?? null,
    applied_ac_price_per_kwh: session.applied_ac_price_per_kwh ?? null,
    applied_dc_price_per_kwh: session.applied_dc_price_per_kwh ?? null,
    applied_roaming_ac_price_per_kwh: session.applied_roaming_ac_price_per_kwh ?? null,
    applied_roaming_dc_price_per_kwh: session.applied_roaming_dc_price_per_kwh ?? null,
    applied_monthly_base_fee: session.applied_monthly_base_fee ?? null,
    applied_session_fee: session.applied_session_fee,
    created_at: session.created_at,
    updated_at: session.updated_at,
    deleted_at: session.deleted_at ?? null,
  };
}

function isTariffPriceSnapshot(value: unknown): value is ProviderPlanSelection['price_snapshot'] {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;
  return typeof snapshot.label === 'string'
    && typeof snapshot.kWhPrice === 'number'
    && (snapshot.sessionFee === undefined || typeof snapshot.sessionFee === 'number')
    && (snapshot.blockingFee === undefined || typeof snapshot.blockingFee === 'number');
}

function isDateLike(value: unknown): value is string | Date {
  return (typeof value === 'string' && !Number.isNaN(Date.parse(value))) || value instanceof Date;
}

export function asDate(value: unknown): Date | null {
  if (!isDateLike(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
