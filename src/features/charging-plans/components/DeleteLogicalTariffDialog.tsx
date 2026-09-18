import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Slab } from '../../../shared/ui';

interface DeleteLogicalTariffDialogProps {
  logicalTariffLabel: string;
  restoreFocusElement?: HTMLElement | null;
  resolveRestoreFocusElement?: () => HTMLElement | null;
  suppressFocusRestore?: boolean;
  isDeleting: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

/**
 * Confirmation dialog for deleting all versions of a logical tariff together.
 */
export function DeleteLogicalTariffDialog({
  logicalTariffLabel,
  restoreFocusElement,
  resolveRestoreFocusElement,
  suppressFocusRestore = false,
  isDeleting,
  onConfirm,
  onCancel,
}: DeleteLogicalTariffDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCancelRef = useRef(onCancel);
  const isDeletingRef = useRef(isDeleting);
  const suppressFocusRestoreRef = useRef(suppressFocusRestore);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [portalElement] = useState(() => document.createElement('div'));

  useEffect(() => {
    onCancelRef.current = onCancel;
    isDeletingRef.current = isDeleting;
  }, [isDeleting, onCancel]);

  useEffect(() => {
    suppressFocusRestoreRef.current = suppressFocusRestore;
  }, [suppressFocusRestore]);

  useEffect(() => {
    portalElement.setAttribute('data-delete-logical-tariff-dialog', 'true');
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
      if (event.key === 'Escape' && !isDeletingRef.current) {
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
      if (!suppressFocusRestoreRef.current && restoreFocusTarget?.isConnected) restoreFocusTarget.focus();
    };
  }, [portalElement, resolveRestoreFocusElement, restoreFocusElement]);

  useEffect(() => {
    const activeElement = document.activeElement;
    const activeElementDisabled = activeElement instanceof HTMLButtonElement && activeElement.disabled;
    if (isDeleting && (!dialogRef.current?.contains(activeElement) || activeElementDisabled)) {
      dialogRef.current?.focus();
    }
  }, [isDeleting]);

  const handleConfirm = async () => {
    setErrorMessage(null);

    try {
      await onConfirm();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Unable to delete the tariff. Please try again.',
      );
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-logical-tariff-heading"
        className="w-full max-w-xl max-h-[calc(100vh-2rem)] overflow-y-auto"
      >
        <Slab className="w-full space-y-5 p-6">
          <div className="space-y-2">
            <h2 id="delete-logical-tariff-heading" className="text-2xl font-bold text-primary">
              Delete tariff
            </h2>
            <p className="text-sm text-secondary">{logicalTariffLabel}</p>
          </div>
          <p className="text-sm text-primary">
            This removes the complete logical tariff, including all scheduled changes and promotions.
          </p>
          <p className="text-sm text-primary">
            Historical charging sessions will keep their saved prices and tariff snapshots.
          </p>
          {errorMessage && (
            <p role="alert" className="text-sm font-medium text-red-500">
              {errorMessage}
            </p>
          )}
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              ref={cancelRef}
              type="button"
              onClick={onCancel}
              disabled={isDeleting}
              className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-secondary/10 px-4 py-3 font-bold text-primary transition-colors hover:bg-secondary/20"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isDeleting}
              onClick={handleConfirm}
              className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-red-600 px-4 py-3 font-bold text-white transition-opacity hover:bg-red-700 disabled:opacity-50"
            >
              Delete complete tariff
            </button>
          </div>
        </Slab>
      </div>
    </div>,
    portalElement,
  );
}
