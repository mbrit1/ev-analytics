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
        className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs font-bold text-red-800 dark:text-red-300 max-md:gap-[6px]"
      >
        <AlertCircle aria-hidden="true" className="h-[14px] w-[14px] shrink-0" />
        <span className="[overflow-wrap:anywhere]">Sync issue</span>
      </span>
    );
  }

  if (status.displayState === 'syncing') {
    return (
      <span
        aria-label="Sync status syncing"
        className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs font-bold text-slab-secondary dark:text-zinc-300 max-md:gap-[6px]"
      >
        <Loader2 aria-hidden="true" className="h-[14px] w-[14px] shrink-0 animate-spin motion-reduce:animate-none" />
        <span className="[overflow-wrap:anywhere]">Syncing</span>
      </span>
    );
  }

  if (status.displayState === 'pending') {
    return (
      <span
        aria-label="Sync status pending"
        className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-300 max-md:gap-[6px]"
      >
        <Clock3 aria-hidden="true" className="h-[14px] w-[14px] shrink-0" />
        <span className="[overflow-wrap:anywhere]">Pending Sync</span>
      </span>
    );
  }

  return (
    <span
      aria-label="Sync status synced"
      className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs font-bold text-green-800 dark:text-green-300 max-md:gap-[6px]"
    >
      <CheckCircle2 aria-hidden="true" className="h-[14px] w-[14px] shrink-0" />
      <span className="[overflow-wrap:anywhere]">Synced</span>
    </span>
  );
}
