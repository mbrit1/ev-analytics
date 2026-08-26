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
  chargingPlanCount: number;
  selectionCount: number;
  sessionCount: number;
  outboxCount: number;
}

/** User-safe recovery result produced by the read-only preparation flow. */
export type ProviderConflictRecoveryPreparation =
  | {
    status: 'ready';
    descriptor: ProviderConflictRecoveryDescriptor;
    summary: ProviderConflictRecoverySummary;
  }
  | { status: 'already-reconciled' }
  | { status: 'blocked'; reason: string }
  | { status: 'retryable-error'; reason: string };

/**
 * Produces the opaque deterministic review token required to reject stale
 * confirmation after preparation has inspected local and remote state.
 */
export function createProviderConflictRecoveryReviewVersion(value: unknown): string {
  return createCanonicalSerialization(value);
}
import { createCanonicalSerialization } from './canonicalSerialization';
