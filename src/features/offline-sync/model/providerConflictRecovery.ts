/** Authenticated identity and terminal outbox row selected for recovery review. */
export interface PrepareProviderConflictRecoveryInput {
  userId: string;
  terminalOutboxId: number;
}

/** Stable local identities that confirmation must revalidate before mutation. */
export interface ProviderConflictRecoveryDescriptor {
  userId: string;
  terminalOutboxId: number;
  stagedProviderId: string;
  canonicalProviderId: string;
  affectedRowIds: {
    chargingPlanIds: readonly string[];
    selectionIds: readonly string[];
    sessionIds: readonly string[];
  };
  affectedOutboxIds: readonly number[];
  reviewVersion: string;
}

/** Counts that a recovery dialog may display without exposing graph contents. */
export interface ProviderConflictRecoverySummary {
  /** Staged local provider name shown in the reviewed recovery dialog. */
  stagedProviderName: string;
  /** Existing canonical provider name shown in the reviewed recovery dialog. */
  canonicalProviderName: string;
  chargingPlanCount: number;
  selectionCount: number;
  sessionCount: number;
  outboxCount: number;
}

/** Stable safe-recovery block categories used by service and presentation state. */
export type ProviderConflictBlockReason =
  | 'no-canonical-match'
  | 'multiple-canonical-matches'
  | 'tariff-ambiguity'
  | 'malformed-graph';

/** Returns the approved user-safe explanation for a blocked recovery review. */
export function getProviderConflictBlockMessage(reason: ProviderConflictBlockReason): string {
  switch (reason) {
    case 'no-canonical-match':
      return 'The matching provider is no longer available remotely. Sync normally and try again.';
    case 'multiple-canonical-matches':
      return 'More than one matching provider was found. Resolve this provider integrity issue before retrying.';
    case 'tariff-ambiguity':
      return 'Tariff history cannot be reconciled safely.';
    case 'malformed-graph':
      return 'Recovery cannot safely continue because related local data is incomplete.';
  }
}

/** Returns the approved copy when final confirmation invalidates a prior review. */
export function getProviderConflictStaleReviewMessage(): string {
  return 'Your data changed while you were reviewing it. Review the provider conflict again before confirming.';
}

/** User-safe recovery result produced by the read-only preparation flow. */
export type ProviderConflictRecoveryPreparation =
  | {
    status: 'ready';
    descriptor: ProviderConflictRecoveryDescriptor;
    summary: ProviderConflictRecoverySummary;
  }
  | { status: 'already-reconciled' }
  | { status: 'blocked'; reason: ProviderConflictBlockReason }
  | { status: 'retryable-error'; reason: string };

/**
 * Produces the opaque deterministic review token required to reject stale
 * confirmation after preparation has inspected local and remote state.
 */
export function createProviderConflictRecoveryReviewVersion(value: unknown): string {
  return createCanonicalSerialization(value);
}
import { createCanonicalSerialization } from './canonicalSerialization';
