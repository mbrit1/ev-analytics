import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Slab } from '../../../shared/ui';
import type {
  ProviderConflictBlockReason,
  ProviderConflictRecoverySummary,
} from '../model/providerConflictRecovery';

type ProviderConflictRecoveryDialogSummary = Pick<
  ProviderConflictRecoverySummary,
  'chargingPlanCount' | 'selectionCount' | 'sessionCount' | 'outboxCount'
>;

type ProviderConflictRecoveryDialogState =
  | { kind: 'loading' }
  | {
    kind: 'ready';
    stagedProviderName: ProviderConflictRecoverySummary['stagedProviderName'];
    canonicalProviderName: ProviderConflictRecoverySummary['canonicalProviderName'];
    summary: ProviderConflictRecoveryDialogSummary;
  }
  | {
    kind: 'blocked';
    reason: ProviderConflictBlockReason;
    message: string;
  }
  | { kind: 'retryable-error'; message: string }
  | { kind: 'stale-review'; message: string }
  | { kind: 'success' };

interface ProviderConflictRecoveryDialogProps {
  state: ProviderConflictRecoveryDialogState;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onAcknowledge: () => void;
}

/** Presents the reviewed provider-conflict recovery before any local mutation is requested. */
export function ProviderConflictRecoveryDialog({
  state,
  isPending,
  onCancel,
  onConfirm,
  onAcknowledge,
}: ProviderConflictRecoveryDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCancelRef = useRef(onCancel);
  const isPendingRef = useRef(isPending);
  const stateKindRef = useRef(state.kind);
  const [portalElement] = useState(() => document.createElement('div'));

  useEffect(() => {
    onCancelRef.current = onCancel;
    isPendingRef.current = isPending;
    stateKindRef.current = state.kind;
  }, [isPending, onCancel, state.kind]);

  useEffect(() => {
    portalElement.setAttribute('data-provider-conflict-recovery-dialog', 'true');
    document.body.appendChild(portalElement);
    const bodyOverflow = document.body.style.overflow;
    const priorSiblings = Array.from(document.body.children)
      .filter((child): child is HTMLElement => child !== portalElement)
      .map((element) => ({
        element,
        inert: element.inert,
        hadInertAttribute: element.hasAttribute('inert'),
        inertAttribute: element.getAttribute('inert'),
      }));
    priorSiblings.forEach(({ element }) => {
      element.inert = true;
      element.setAttribute('inert', '');
    });
    document.body.style.overflow = 'hidden';

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    cancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isPendingRef.current && stateKindRef.current !== 'success') {
        onCancelRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const actions = Array.from(dialogRef.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      if (actions.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = actions[0];
      const last = actions[actions.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = bodyOverflow;
      priorSiblings.forEach(({ element, inert, hadInertAttribute, inertAttribute }) => {
        element.inert = inert;
        if (hadInertAttribute) {
          element.setAttribute('inert', inertAttribute ?? '');
        } else {
          element.removeAttribute('inert');
        }
      });
      portalElement.remove();
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [portalElement]);

  useEffect(() => {
    const activeElement = document.activeElement;
    const activeElementDisabled = activeElement instanceof HTMLButtonElement && activeElement.disabled;
    if (isPending && (!dialogRef.current?.contains(activeElement) || activeElementDisabled)) {
      dialogRef.current?.focus();
    }
  }, [isPending]);

  const actionClassName = 'min-h-[44px] rounded-xl px-4 py-2 font-bold';
  const cancelAction = (
    <button
      ref={cancelRef}
      type="button"
      onClick={onCancel}
      disabled={isPending}
      className={`${actionClassName} bg-secondary/10 text-primary`}
    >
      Cancel
    </button>
  );
  const retryAction = (label: 'Retry review' | 'Review again') => (
    <button
      type="button"
      onClick={onConfirm}
      disabled={isPending}
      className={`${actionClassName} bg-accent text-white`}
    >
      {label}
    </button>
  );

  let content: React.ReactNode;
  let actions: React.ReactNode;

  switch (state.kind) {
    case 'loading':
      content = (
        <>
          <p className="text-sm font-semibold text-primary">Reviewing provider conflict</p>
          <p className="text-sm text-secondary">No changes have been made while this safe review is in progress.</p>
        </>
      );
      actions = cancelAction;
      break;
    case 'ready':
      content = (
        <>
          <p className="text-sm text-secondary">
            Replace staged provider <strong>{state.stagedProviderName}</strong> with existing provider{' '}
            <strong>{state.canonicalProviderName}</strong>.
          </p>
          <ul className="space-y-1 text-sm text-secondary" aria-label="Affected data">
            <li>{state.summary.chargingPlanCount} charging plans</li>
            <li>{state.summary.selectionCount} {state.summary.selectionCount === 1 ? 'selection' : 'selections'}</li>
            <li>{state.summary.sessionCount} sessions</li>
            <li>{state.summary.outboxCount} pending mutations</li>
          </ul>
          <p className="text-sm text-secondary">Tariffs, sessions, and historical prices will be retained.</p>
        </>
      );
      actions = (
        <>
          {cancelAction}
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className={`${actionClassName} bg-accent text-white`}
          >
            {isPending ? 'Using existing provider' : 'Use existing provider'}
          </button>
        </>
      );
      break;
    case 'retryable-error':
      content = (
        <>
          <p role="alert" className="text-sm text-red-500">{state.message}</p>
          <p className="text-sm text-secondary">No changes have been made. Retry the review when your connection is available.</p>
        </>
      );
      actions = <>{cancelAction}{retryAction('Retry review')}</>;
      break;
    case 'blocked':
      content = (
        <>
          <p role="alert" className="text-sm text-red-500">{state.message}</p>
          <p className="text-sm text-secondary">
            {state.reason === 'tariff-ambiguity'
              ? 'Open Tariffs to repair dates or tariff identity before retrying.'
              : 'No changes have been made. ' + state.message}
          </p>
        </>
      );
      actions = cancelAction;
      break;
    case 'stale-review':
      content = <p role="alert" className="text-sm text-red-500">{state.message}</p>;
      actions = <>{cancelAction}{retryAction('Review again')}</>;
      break;
    case 'success':
      content = <p role="status" className="text-sm text-secondary">Provider conflict resolved</p>;
      actions = (
        <button
          ref={cancelRef}
          type="button"
          onClick={onAcknowledge}
          disabled={isPending}
          className={`${actionClassName} bg-accent text-white`}
        >
          Done
        </button>
      );
      break;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-conflict-recovery-heading"
        aria-describedby="provider-conflict-recovery-description"
        className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto"
      >
        <Slab className="w-full space-y-4 p-6">
          <h2 id="provider-conflict-recovery-heading" className="text-xl font-semibold text-primary">
            Resolve provider conflict
          </h2>
          <div id="provider-conflict-recovery-description" className="space-y-3">
            {content}
          </div>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            {actions}
          </div>
        </Slab>
      </div>
    </div>,
    portalElement,
  );
}
