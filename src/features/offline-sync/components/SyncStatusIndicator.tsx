import { AlertCircle, CheckCircle2, Clock3, Loader2 } from 'lucide-react';
import { useSyncStatus } from '../hooks/useSyncStatus';

/**
 * Renders a compact, non-interactive summary of the local outbox sync status.
 */
export function SyncStatusIndicator() {
  const status = useSyncStatus();

  if (status.displayState === 'sync-issue') {
    return (
      <span
        aria-label="Sync status issue"
        className="flex items-center gap-1.5 text-xs font-bold text-red-500"
      >
        <AlertCircle aria-hidden="true" className="h-3.5 w-3.5" />
        Sync issue
      </span>
    );
  }

  if (status.displayState === 'syncing') {
    return (
      <span
        aria-label="Sync status syncing"
        className="flex items-center gap-1.5 text-xs font-bold text-secondary"
      >
        <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
        Syncing
      </span>
    );
  }

  if (status.displayState === 'pending') {
    return (
      <span
        aria-label="Sync status pending"
        className="flex items-center gap-1.5 text-xs font-bold text-amber-600"
      >
        <Clock3 aria-hidden="true" className="h-3.5 w-3.5" />
        Pending Sync
      </span>
    );
  }

  return (
    <span
      aria-label="Sync status synced"
      className="flex items-center gap-1.5 text-xs font-bold text-green-600"
    >
      <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
      Synced
    </span>
  );
}
