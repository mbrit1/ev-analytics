import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/** An actionable Tariffs descriptor with its dispatch callback. */
export interface TariffActionSheetAction {
  id: string;
  group: string;
  label: string;
  onSelect: () => void;
}

/** Props for the feature-owned compact Tariffs action sheet. */
export interface TariffActionSheetProps {
  id?: string;
  open: boolean;
  label: string;
  actions: readonly TariffActionSheetAction[];
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onDismiss: () => void;
}

interface InertSnapshot {
  element: HTMLElement;
  inert: boolean;
  hadInertAttribute: boolean;
  inertAttribute: string | null;
}

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
  ));
}

/** Renders the compact, modal Tariffs action surface in a body-level portal. */
export function TariffActionSheet({
  id,
  open,
  label,
  actions,
  triggerRef,
  onDismiss,
}: TariffActionSheetProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const hasDispatchedRef = useRef(false);

  useEffect(() => {
    if (!open || !rootRef.current) return undefined;

    const root = rootRef.current;
    const bodyOverflow = document.body.style.overflow;
    const bodyPaddingRight = document.body.style.paddingRight;
    const layoutViewportWidth = document.documentElement.clientWidth;
    const scrollbarWidth = layoutViewportWidth > 0
      ? Math.max(0, window.innerWidth - layoutViewportWidth)
      : 0;
    const priorSiblings: InertSnapshot[] = Array.from(document.body.children)
      .filter((child): child is HTMLElement => child !== root)
      .map((element) => ({
        element,
        inert: element.inert,
        hadInertAttribute: element.hasAttribute('inert'),
        inertAttribute: element.getAttribute('inert'),
      }));

    priorFocusRef.current = triggerRef.current?.isConnected
      ? triggerRef.current
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    hasDispatchedRef.current = false;
    priorSiblings.forEach(({ element }) => {
      element.inert = true;
      element.setAttribute('inert', '');
    });
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `calc(${window.getComputedStyle(document.body).paddingRight} + ${scrollbarWidth}px)`;
    }

    const dismissForOutsideInteraction = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.contains(event.target)) onDismiss();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismiss();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements(root);
      if (focusable.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', dismissForOutsideInteraction);
    root.querySelector<HTMLElement>('[data-autofocus]')?.focus();

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', dismissForOutsideInteraction);
      document.body.style.overflow = bodyOverflow;
      document.body.style.paddingRight = bodyPaddingRight;
      priorSiblings.forEach(({ element, inert, hadInertAttribute, inertAttribute }) => {
        element.inert = inert;
        if (hadInertAttribute) {
          element.setAttribute('inert', inertAttribute ?? '');
        } else {
          element.removeAttribute('inert');
        }
      });
      if (priorFocusRef.current?.isConnected) priorFocusRef.current.focus();
    };
  }, [onDismiss, open, triggerRef]);

  if (!open) return null;

  const selectAction = (action: TariffActionSheetAction) => {
    if (hasDispatchedRef.current) return;
    hasDispatchedRef.current = true;
    onDismiss();
    action.onSelect();
  };

  return createPortal(
    <div
      ref={rootRef}
      className="fixed inset-0 z-50 flex items-end bg-black/40"
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <section
        id={id}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="max-h-[calc(100dvh-1rem)] w-full overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-lg"
      >
        <button
          type="button"
          aria-label="Dismiss tariff actions"
          data-autofocus
          className="mb-2 min-h-[44px] rounded-lg px-3 text-primary transition-colors hover:bg-secondary/5"
          onClick={onDismiss}
        >
          Dismiss
        </button>
        {(['primary', 'separated', 'danger'] as const).map((group) => {
          const groupedActions = actions.filter((action) => action.group === group);
          if (groupedActions.length === 0) return null;

          return (
            <div
              key={group}
              className={group === 'primary' ? 'space-y-1' : 'mt-3 border-t border-secondary/10 pt-3 space-y-1'}
            >
              {groupedActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className={group === 'danger'
                    ? 'flex min-h-[44px] w-full items-center rounded-lg px-3 py-2 text-left text-red-600 transition-colors hover:bg-red-500/10'
                    : 'flex min-h-[44px] w-full items-center rounded-lg px-3 py-2 text-left text-primary transition-colors hover:bg-secondary/5'}
                  onClick={() => selectAction(action)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          );
        })}
        <div className="mt-3 border-t border-secondary/10 pt-3">
          <button
            type="button"
            className="min-h-[44px] rounded-lg px-3 text-primary transition-colors hover:bg-secondary/5"
            onClick={onDismiss}
          >
            Cancel
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
