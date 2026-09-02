import { useEffect, useRef, useState } from 'react';
import type {
  ProviderConflictBlockReason,
  ProviderConflictRecoveryDescriptor,
  ProviderConflictRecoverySummary,
} from '../model/providerConflictRecovery';
import {
  getProviderConflictBlockMessage,
  getProviderConflictStaleReviewMessage,
} from '../model/providerConflictRecovery';
import {
  confirmProviderConflictRecovery,
  prepareProviderConflictRecovery,
} from '../services/providerConflictRecoveryService';

/** Stable sync-status identities required to begin provider-conflict recovery. */
export interface ProviderConflictRecoveryOpenInput {
  /** Local terminal provider INSERT selected by the sync-status hook. */
  terminalOutboxId: number;
  /** Staged local provider referenced by the typed terminal row. */
  stagedProviderId: string;
}

/** User-visible state owned by the provider-conflict recovery controller. */
export type ProviderConflictRecoveryControllerState =
  | { kind: 'closed' }
  | { kind: 'loading' }
  | {
    kind: 'ready';
    stagedProviderName: string;
    canonicalProviderName: string;
    summary: ProviderConflictRecoverySummary;
  }
  | { kind: 'blocked'; reason: ProviderConflictBlockReason; message: string }
  | { kind: 'retryable-error'; message: string }
  | { kind: 'stale-review'; message: string }
  | { kind: 'success' };

/** Auth and post-commit app boundaries supplied to the recovery controller. */
export interface UseProviderConflictRecoveryOptions {
  /** Currently authenticated owner, or undefined after logout. */
  userId?: string;
  /** Requests ordinary sync after a committed recovery has released exclusion. */
  onRecoveryCommitted: () => void;
}

/** Minimal workflow API consumed by the app shell and recovery dialog. */
export interface ProviderConflictRecoveryController {
  /** Current presentation state; closed means no recovery UI is mounted. */
  state: ProviderConflictRecoveryControllerState;
  /** Whether the recovery dialog should be rendered. */
  isOpen: boolean;
  /** Whether preparation or confirmation is awaiting completion. */
  isPending: boolean;
  /** Begins a read-only review for a typed terminal provider conflict. */
  open: (input: ProviderConflictRecoveryOpenInput) => void;
  /** Closes the workflow without confirming a local mutation. */
  cancel: () => void;
  /** Confirms a ready review or retries a stale/retryable review. */
  confirm: () => Promise<void>;
  /** Closes the success view without controlling ordinary sync. */
  acknowledge: () => void;
}

/** Owns the provider-conflict review lifecycle and safe confirmation boundary. */
export function useProviderConflictRecovery(
  { userId, onRecoveryCommitted }: UseProviderConflictRecoveryOptions,
): ProviderConflictRecoveryController {
  const [state, setState] = useState<ProviderConflictRecoveryControllerState>({ kind: 'closed' });
  const [isPending, setIsPending] = useState(false);
  const [workflowOwnerId, setWorkflowOwnerId] = useState<string | undefined>(undefined);
  const descriptorRef = useRef<ProviderConflictRecoveryDescriptor | undefined>(undefined);
  const inputRef = useRef<ProviderConflictRecoveryOpenInput | undefined>(undefined);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const userIdRef = useRef(userId);

  const invalidate = () => {
    generationRef.current += 1;
    descriptorRef.current = undefined;
    inputRef.current = undefined;
    setWorkflowOwnerId(undefined);
    setIsPending(false);
    setState({ kind: 'closed' });
  };

  const prepare = async (input: ProviderConflictRecoveryOpenInput, ownerId: string) => {
    const generation = ++generationRef.current;
    descriptorRef.current = undefined;
    inputRef.current = input;
    setWorkflowOwnerId(ownerId);
    setState({ kind: 'loading' });
    setIsPending(true);

    try {
      const preparation = await prepareProviderConflictRecovery({
        userId: ownerId,
        terminalOutboxId: input.terminalOutboxId,
      });
      if (!mountedRef.current || generation !== generationRef.current || userIdRef.current !== ownerId) return;

      switch (preparation.status) {
        case 'ready':
          descriptorRef.current = preparation.descriptor;
          setState({
            kind: 'ready',
            stagedProviderName: preparation.summary.stagedProviderName,
            canonicalProviderName: preparation.summary.canonicalProviderName,
            summary: preparation.summary,
          });
          break;
        case 'already-reconciled':
          setState({ kind: 'success' });
          break;
        case 'blocked':
          setState({
            kind: 'blocked',
            reason: preparation.reason,
            message: getProviderConflictBlockMessage(preparation.reason),
          });
          break;
        case 'retryable-error':
          setState({ kind: 'retryable-error', message: preparation.reason });
          break;
      }
    } catch {
      if (!mountedRef.current || generation !== generationRef.current || userIdRef.current !== ownerId) return;
      setState({
        kind: 'retryable-error',
        message: 'Provider conflict verification could not be completed. Please try again.',
      });
    } finally {
      if (mountedRef.current && generation === generationRef.current && userIdRef.current === ownerId) {
        setIsPending(false);
      }
    }
  };

  useEffect(() => () => {
    mountedRef.current = false;
    generationRef.current += 1;
  }, []);

  useEffect(() => {
    if (userIdRef.current !== userId) {
      generationRef.current += 1;
      descriptorRef.current = undefined;
      inputRef.current = undefined;
      setWorkflowOwnerId(undefined);
      setIsPending(false);
      setState({ kind: 'closed' });
    }
    userIdRef.current = userId;
  }, [userId]);

  const open = (input: ProviderConflictRecoveryOpenInput) => {
    if (!userId) return;
    void prepare(input, userId);
  };

  const cancel = () => {
    invalidate();
  };

  const confirm = async () => {
    if (!userId || isPending) return;
    if (state.kind === 'retryable-error' || state.kind === 'stale-review') {
      const input = inputRef.current;
      if (input) await prepare(input, userId);
      return;
    }
    if (state.kind !== 'ready') return;

    const descriptor = descriptorRef.current;
    if (!descriptor) return;
    const generation = ++generationRef.current;
    descriptorRef.current = undefined;
    setIsPending(true);
    try {
      const confirmation = await confirmProviderConflictRecovery(descriptor);
      if (!mountedRef.current || generation !== generationRef.current || userIdRef.current !== userId) return;

      switch (confirmation.status) {
        case 'reconciled':
          onRecoveryCommitted();
          setState({ kind: 'success' });
          break;
        case 'already-reconciled':
          setState({ kind: 'success' });
          break;
        case 'blocked':
          setState({ kind: 'stale-review', message: getProviderConflictStaleReviewMessage() });
          break;
        case 'retryable-error':
          setState({ kind: 'retryable-error', message: confirmation.reason });
          break;
      }
    } catch {
      if (!mountedRef.current || generation !== generationRef.current || userIdRef.current !== userId) return;
      setState({
        kind: 'retryable-error',
        message: 'Provider conflict verification could not be completed. Please try again.',
      });
    } finally {
      if (mountedRef.current && generation === generationRef.current && userIdRef.current === userId) {
        setIsPending(false);
      }
    }
  };

  const isCurrentWorkflow = userId != null && workflowOwnerId === userId;
  const visibleState = isCurrentWorkflow ? state : { kind: 'closed' } as const;

  return {
    state: visibleState,
    isOpen: isCurrentWorkflow && state.kind !== 'closed',
    isPending: isCurrentWorkflow && isPending,
    open,
    cancel,
    confirm,
    acknowledge: invalidate,
  };
}
