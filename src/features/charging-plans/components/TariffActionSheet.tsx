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
  displayIdentity: string;
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
  displayIdentity,
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
      className="fixed inset-0 z-50 isolate flex items-end justify-center px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:px-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/50"
        onClick={onDismiss}
      />
      <div
        id={id}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Tariff actions for ${label}`}
        className="relative z-10 flex max-h-[calc(100dvh-0.5rem-env(safe-area-inset-bottom))] w-full max-w-[520px] flex-col gap-2 overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <section className="rounded-[24px] border border-slab-border bg-surface p-4 shadow-slab">
          <header className="mb-3 px-3">
            <h2 className="text-base font-semibold text-primary">{displayIdentity}</h2>
            <p className="text-sm text-secondary">Tariff actions</p>
          </header>
          <div className="space-y-1">
            {actions.filter((action) => action.group === 'primary').map((action) => (
              <button
                key={action.id}
                type="button"
                data-autofocus={action.id === 'promotion' ? true : undefined}
                className="flex min-h-[44px] w-full items-center rounded-lg px-3 py-2 text-left text-primary transition-colors hover:bg-secondary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                onClick={() => selectAction(action)}
              >
                {action.label}
              </button>
            ))}
          </div>
          {actions.some((action) => action.group !== 'primary') && (
            <div className="mt-3 border-t border-secondary/10 pt-3">
              <div className="space-y-1">
                {actions.filter((action) => action.group !== 'primary').map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className={action.group === 'danger'
                      ? 'flex min-h-[44px] w-full items-center rounded-lg px-3 py-2 text-left text-red-600 transition-colors hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface'
                      : 'flex min-h-[44px] w-full items-center rounded-lg px-3 py-2 text-left text-primary transition-colors hover:bg-secondary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface'}
                    onClick={() => selectAction(action)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
        <section className="flex min-h-[60px] items-center justify-center rounded-[24px] border border-slab-border bg-surface px-4 py-2 shadow-slab">
          <button
            type="button"
            className="min-h-[44px] rounded-lg px-3 text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            onClick={onDismiss}
          >
            Cancel
          </button>
        </section>
      </div>
    </div>,
    document.body,
  );
}
