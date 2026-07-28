import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Slab } from '../../../shared/ui';
import { formatUtcDate } from '../model/logicalTariffs';

interface PaidTariffSwitchDialogProps {
  providerName: string;
  incumbentName: string;
  candidateStart: Date;
  restoreFocusElement?: HTMLElement | null;
  resolveRestoreFocusElement?: () => HTMLElement | null;
  isPending: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirms replacing one earlier paid tariff with a new effective version. */
export function PaidTariffSwitchDialog({
  providerName,
  incumbentName,
  candidateStart,
  restoreFocusElement,
  resolveRestoreFocusElement,
  isPending,
  error,
  onCancel,
  onConfirm,
}: PaidTariffSwitchDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCancelRef = useRef(onCancel);
  const isPendingRef = useRef(isPending);
  const [portalElement] = useState(() => document.createElement('div'));

  useEffect(() => {
    onCancelRef.current = onCancel;
    isPendingRef.current = isPending;
  }, [isPending, onCancel]);

  useEffect(() => {
    portalElement.setAttribute('data-paid-tariff-switch-dialog', 'true');
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

    const previouslyFocused = restoreFocusElement ?? (
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    );
    cancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isPendingRef.current) {
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
      const resolvedFocusTarget = resolveRestoreFocusElement?.();
      const restoreFocusTarget = resolvedFocusTarget?.isConnected
        ? resolvedFocusTarget
        : previouslyFocused;
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
      if (restoreFocusTarget?.isConnected) restoreFocusTarget.focus();
    };
  }, [portalElement, resolveRestoreFocusElement, restoreFocusElement]);

  useEffect(() => {
    const activeElement = document.activeElement;
    const activeElementDisabled = activeElement instanceof HTMLButtonElement && activeElement.disabled;
    if (isPending && (!dialogRef.current?.contains(activeElement) || activeElementDisabled)) {
      dialogRef.current?.focus();
    }
  }, [isPending]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="paid-tariff-switch-heading"
        aria-describedby="paid-tariff-switch-description"
        className="w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto"
      >
        <Slab className="w-full space-y-4 p-6">
          <div className="space-y-2">
            <h2 id="paid-tariff-switch-heading" className="text-xl font-semibold text-primary">
              Replace active paid tariff?
            </h2>
            <p id="paid-tariff-switch-description" className="text-sm text-secondary">
              {providerName}: replace current tariff <strong>{incumbentName}</strong> with the new tariff effective on{' '}
              <strong>{formatUtcDate(candidateStart)}</strong>?
            </p>
          </div>
          {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              ref={cancelRef}
              type="button"
              onClick={onCancel}
              disabled={isPending}
              className="min-h-[44px] rounded-xl bg-secondary/10 px-4 py-2 font-bold text-primary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isPending}
              className="min-h-[44px] rounded-xl bg-accent px-4 py-2 font-bold text-white"
            >
              {isPending ? 'Switching…' : 'Confirm switch'}
            </button>
          </div>
        </Slab>
      </div>
    </div>,
    portalElement,
  );
}
