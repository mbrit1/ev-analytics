import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { calculateTariffActionPlacement } from './tariffActionPlacement';

/** An actionable Tariffs descriptor with its dispatch callback. */
export interface TariffActionPopoverAction {
  id: string;
  group: string;
  label: string;
  onSelect: () => void;
}

/** Props for the feature-owned anchored Tariffs action menu. */
export interface TariffActionPopoverProps {
  id?: string;
  open: boolean;
  label: string;
  actions: readonly TariffActionPopoverAction[];
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  dockExclusion: DOMRect | null;
  onDismiss: () => void;
}

function getLiveDockExclusion(): DOMRect | null {
  const dock = document.querySelector<HTMLElement>('[aria-label="Primary mobile actions"]');
  if (!dock || dock.getClientRects().length === 0) return null;

  const rect = dock.getBoundingClientRect();
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth);
  const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
  const intersectsViewport = rect.right > viewportLeft
    && rect.left < viewportRight
    && rect.bottom > viewportTop
    && rect.top < viewportBottom;

  return rect.width > 0 && rect.height > 0 && intersectsViewport ? rect : null;
}

/** Renders the regular fine-pointer Tariffs action surface in a body-level portal. */
export function TariffActionPopover({
  id,
  open,
  label,
  actions,
  triggerRef,
  dockExclusion,
  onDismiss,
}: TariffActionPopoverProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const hasDispatchedRef = useRef(false);
  const [style, setStyle] = useState<React.CSSProperties>({ position: 'fixed' });

  useEffect(() => {
    if (!open) return undefined;
    if (!triggerRef.current?.isConnected) {
      onDismiss();
      return undefined;
    }

    priorFocusRef.current = triggerRef.current;
    hasDispatchedRef.current = false;
    const updatePlacement = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger?.isConnected) {
        onDismiss();
        return;
      }
      if (!menu) return;

      const visualViewport = window.visualViewport;
      const placement = calculateTariffActionPlacement({
        trigger: trigger.getBoundingClientRect(),
        overlay: menu.getBoundingClientRect(),
        visualViewport: visualViewport
          ? {
            left: visualViewport.offsetLeft,
            top: visualViewport.offsetTop,
            width: visualViewport.width,
            height: visualViewport.height,
          }
          : null,
        edgeGap: 16,
        dockExclusion: dockExclusion ?? getLiveDockExclusion(),
      });
      setStyle({
        position: 'fixed',
        left: placement.left,
        top: placement.top,
        maxHeight: placement.maxHeight,
      });
      menu.style.left = `${placement.left}px`;
      menu.style.top = `${placement.top}px`;
      menu.style.maxHeight = placement.maxHeight == null ? '' : `${placement.maxHeight}px`;
    };
    const dismissForOutsideInteraction = (event: PointerEvent | FocusEvent) => {
      const target = event.target;
      if (target instanceof Node && (menuRef.current?.contains(target) || triggerRef.current?.contains(target))) {
        return;
      }
      onDismiss();
    };

    updatePlacement();
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement);
    window.visualViewport?.addEventListener('resize', updatePlacement);
    window.visualViewport?.addEventListener('scroll', updatePlacement);
    document.addEventListener('pointerdown', dismissForOutsideInteraction);
    document.addEventListener('focusin', dismissForOutsideInteraction);
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();

    return () => {
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement);
      window.visualViewport?.removeEventListener('resize', updatePlacement);
      window.visualViewport?.removeEventListener('scroll', updatePlacement);
      document.removeEventListener('pointerdown', dismissForOutsideInteraction);
      document.removeEventListener('focusin', dismissForOutsideInteraction);
      if (priorFocusRef.current?.isConnected) {
        window.setTimeout(() => {
          if (priorFocusRef.current?.isConnected) priorFocusRef.current.focus();
        }, 0);
      }
    };
  }, [dockExclusion, onDismiss, open, triggerRef]);

  if (!open) return null;

  const selectAction = (action: TariffActionPopoverAction) => {
    if (hasDispatchedRef.current) return;
    hasDispatchedRef.current = true;
    onDismiss();
    action.onSelect();
  };

  const focusMenuItem = (index: number) => {
    const menuItems = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    menuItems[index]?.focus();
  };

  const handleMenuItemKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onDismiss();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusMenuItem((index + 1) % actions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusMenuItem((index - 1 + actions.length) % actions.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusMenuItem(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusMenuItem(actions.length - 1);
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      id={id}
      role="menu"
      aria-label={label}
      style={style}
      className="z-50 min-w-[15rem] overflow-y-auto rounded-xl border border-secondary/10 bg-surface p-2 shadow-lg"
    >
      {actions.map((action, index) => (
        <div
          key={action.id}
          className={action.group === 'primary' ? '' : 'mt-2 border-t border-secondary/10 pt-2'}
        >
          <button
            type="button"
            role="menuitem"
            className={action.group === 'danger'
              ? 'flex min-h-[44px] w-full items-center rounded-lg px-3 py-2 text-left text-red-600 transition-colors hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface'
              : 'flex min-h-[44px] w-full items-center rounded-lg px-3 py-2 text-left text-primary transition-colors hover:bg-secondary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface'}
            onClick={() => selectAction(action)}
            onKeyDown={(event) => handleMenuItemKeyDown(event, index)}
          >
            {action.label}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
