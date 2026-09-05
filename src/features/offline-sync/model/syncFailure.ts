import type { SyncFailureKind, SyncOutbox } from '../../../infra/db';

export const PROVIDER_NAME_CONFLICT_ERROR_MESSAGE =
  'Provider name already exists remotely (active, case-insensitive)';

/** Recognizes the approved conflict only while the raw Supabase response is live. */
export function getLiveSyncFailureKind(error: unknown): SyncFailureKind | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === '23505'
    && typeof candidate.message === 'string'
    && candidate.message.includes('providers_user_name_active_unique')
    ? 'provider-name-conflict'
    : undefined;
}

/** Returns whether a row is a typed terminal provider-name conflict. */
export function isTypedTerminalProviderNameConflict(item: SyncOutbox): boolean {
  return isTerminalProviderInsert(item)
    && item.failure_kind === 'provider-name-conflict';
}

/**
 * Quarantines legacy terminal rows without inferring a new durable failure kind
 * from their historical display message.
 */
export function isLegacyTerminalProviderNameConflict(item: SyncOutbox): boolean {
  return isTerminalProviderInsert(item)
    && item.failure_kind === undefined;
}

function isTerminalProviderInsert(item: SyncOutbox): boolean {
  return item.table_name === 'providers'
    && item.action === 'INSERT'
    && (item.retry_count ?? 0) > 0
    && item.last_attempt_at !== undefined
    && item.next_attempt_at === undefined;
}
