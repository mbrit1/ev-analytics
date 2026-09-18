import { MoreHorizontal } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TariffActionPopover } from './TariffActionPopover';
import { TariffActionSheet } from './TariffActionSheet';

type PointerCapability = 'fine' | 'coarse' | 'unavailable' | 'ambiguous';
type HoverCapability = 'hover' | 'none' | 'unavailable' | 'ambiguous';

/** A feature-owned exceptional tariff action and its visual group. */
export interface TariffActionDescriptor {
  id: 'promotion' | 'retire' | 'delete';
  group: 'primary' | 'separated' | 'danger';
  label: string;
}

/** Input capability snapshot used by the responsive Tariffs action policy. */
export interface TariffActionCapabilitySnapshot {
  width: number;
  pointer: PointerCapability;
  hover: HoverCapability;
}

/** Resolves the ordered exceptional actions available for one logical tariff. */
// eslint-disable-next-line react-refresh/only-export-components -- Task 10 specifies this feature policy beside its consumer.
export function getTariffActionDescriptors({
  canRetire,
}: {
  canRetire: boolean;
}): readonly TariffActionDescriptor[] {
  return [
    { id: 'promotion', group: 'primary', label: 'Run temporary promotion' },
    ...(canRetire
      ? [{ id: 'retire', group: 'separated', label: 'Retire tariff' } satisfies TariffActionDescriptor]
      : []),
    { id: 'delete', group: 'danger', label: 'Delete tariff' },
  ];
}

/** Chooses the one Tariffs action presentation permitted by the capability snapshot. */
// eslint-disable-next-line react-refresh/only-export-components -- Task 10 specifies this feature policy beside its consumer.
export function selectTariffActionPresentation(
  input: TariffActionCapabilitySnapshot,
): 'sheet' | 'menu' {
  return input.width >= 768 && input.pointer === 'fine' && input.hover === 'hover'
    ? 'menu'
    : 'sheet';
}

function readPointerCapability(): PointerCapability {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'unavailable';
  }

  const hasFinePointer = window.matchMedia('(pointer: fine)').matches;
  const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
  if (hasFinePointer === hasCoarsePointer) {
    return hasFinePointer ? 'ambiguous' : 'unavailable';
  }

  return hasFinePointer ? 'fine' : 'coarse';
}

function readHoverCapability(): HoverCapability {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'unavailable';
  }

  const hasHover = window.matchMedia('(hover: hover)').matches;
  const hasNoHover = window.matchMedia('(hover: none)').matches;
  if (hasHover === hasNoHover) {
    return hasHover ? 'ambiguous' : 'unavailable';
  }

  return hasHover ? 'hover' : 'none';
}

function readCapabilitySnapshot(): TariffActionCapabilitySnapshot {
  return {
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    pointer: readPointerCapability(),
    hover: readHoverCapability(),
  };
}

function useTariffActionCapabilities(): TariffActionCapabilitySnapshot {
  const [capabilities, setCapabilities] = useState(readCapabilitySnapshot);

  useEffect(() => {
    const refresh = () => setCapabilities(readCapabilitySnapshot());
    const queries = typeof window.matchMedia === 'function'
      ? [
        window.matchMedia('(pointer: fine)'),
        window.matchMedia('(pointer: coarse)'),
        window.matchMedia('(hover: hover)'),
        window.matchMedia('(hover: none)'),
      ]
      : [];

    window.addEventListener('resize', refresh);
    queries.forEach((query) => query.addEventListener('change', refresh));
    return () => {
      window.removeEventListener('resize', refresh);
      queries.forEach((query) => query.removeEventListener('change', refresh));
    };
  }, []);

  return capabilities;
}

interface TariffVersionActionMenuProps {
  label: string;
  onRetire?: () => void;
  onPromotion: () => void;
  onDelete: () => void;
  disabled?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
}

interface InertSnapshot {
  inert: boolean;
  hadInertAttribute: boolean;
  inertAttribute: string | null;
}

/** Opens the feature-owned responsive exceptional-action surface for one tariff. */
export function TariffVersionActionMenu({
  label,
  onRetire,
  onPromotion,
  onDelete,
  disabled = false,
  onOpenChange,
}: TariffVersionActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  const triggerInertSnapshotRef = useRef<InertSnapshot | null>(null);
  const restoreTriggerInertTimeoutRef = useRef<number | null>(null);
  const capabilities = useTariffActionCapabilities();
  const presentation = selectTariffActionPresentation(capabilities);
  const previousPresentationRef = useRef(presentation);
  const overlayId = `tariff-actions-${useId().replaceAll(':', '')}`;
  const triggerLabel = `Tariff actions for ${label}`;
  const overlayOpen = isOpen && !disabled;
  const dismiss = useCallback(() => setIsOpen(false), []);
  const restoreTriggerInertState = useCallback(() => {
    const trigger = triggerRef.current;
    const snapshot = triggerInertSnapshotRef.current;
    triggerInertSnapshotRef.current = null;
    restoreTriggerInertTimeoutRef.current = null;
    if (!trigger || !snapshot) return;
    trigger.inert = snapshot.inert;
    if (snapshot.hadInertAttribute) {
      trigger.setAttribute('inert', snapshot.inertAttribute ?? '');
    } else {
      trigger.removeAttribute('inert');
    }
  }, []);
  const suppressTriggerFocusRestore = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || triggerInertSnapshotRef.current) return;

    triggerInertSnapshotRef.current = {
      inert: trigger.inert,
      hadInertAttribute: trigger.hasAttribute('inert'),
      inertAttribute: trigger.getAttribute('inert'),
    };
    trigger.inert = true;
    trigger.setAttribute('inert', '');
    restoreTriggerInertTimeoutRef.current = window.setTimeout(() => {
      restoreTriggerInertTimeoutRef.current = window.setTimeout(restoreTriggerInertState, 0);
    }, 0);
  }, [restoreTriggerInertState]);
  const actions = useMemo(() => getTariffActionDescriptors({ canRetire: Boolean(onRetire) }).map((action) => {
    const onSelect = action.id === 'promotion'
      ? onPromotion
      : action.id === 'retire'
        ? onRetire ?? (() => undefined)
        : onDelete;
    return {
      ...action,
      onSelect: action.id === 'retire' || action.id === 'delete'
        ? () => {
          suppressTriggerFocusRestore();
          pendingActionRef.current = onSelect;
          setIsOpen(false);
        }
        : onSelect,
    };
  }), [onDelete, onPromotion, onRetire, suppressTriggerFocusRestore]);

  useEffect(() => {
    if (previousPresentationRef.current !== presentation) {
      previousPresentationRef.current = presentation;
      setIsOpen(false);
    }
  }, [presentation]);

  useEffect(() => {
    onOpenChange?.(overlayOpen);
  }, [onOpenChange, overlayOpen]);

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  useEffect(() => () => {
    onOpenChangeRef.current?.(false);
  }, []);

  useEffect(() => () => {
    if (restoreTriggerInertTimeoutRef.current != null) {
      window.clearTimeout(restoreTriggerInertTimeoutRef.current);
    }
    restoreTriggerInertState();
  }, [restoreTriggerInertState]);

  useLayoutEffect(() => {
    if (!disabled || !isOpen) return;
    suppressTriggerFocusRestore();
  }, [disabled, isOpen, suppressTriggerFocusRestore]);

  useEffect(() => {
    if (!disabled || !isOpen) return;
    const closeOverlayTaskId = window.setTimeout(() => setIsOpen(false), 0);
    return () => window.clearTimeout(closeOverlayTaskId);
  }, [disabled, isOpen]);

  useEffect(() => {
    if (isOpen || pendingActionRef.current == null) return;
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    triggerRef.current?.blur();
    action();
  }, [isOpen]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={triggerLabel}
        aria-expanded={overlayOpen}
        aria-controls={overlayId}
        aria-haspopup={presentation === 'menu' ? 'menu' : 'dialog'}
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setIsOpen(false);
        }}
        className="flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-xl border border-secondary/10 bg-surface px-3 py-2 text-primary transition-all hover:bg-secondary/5"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
      </button>
      {presentation === 'menu' ? (
        <TariffActionPopover
          id={overlayId}
          open={overlayOpen}
          label={triggerLabel}
          actions={actions}
          triggerRef={triggerRef}
          dockExclusion={null}
          onDismiss={dismiss}
        />
      ) : (
        <TariffActionSheet
          id={overlayId}
          open={overlayOpen}
          label={triggerLabel}
          actions={actions}
          triggerRef={triggerRef}
          onDismiss={dismiss}
        />
      )}
    </>
  );
}
