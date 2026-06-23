import { MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface TariffVersionActionMenuProps {
  label: string;
  onPromotion: () => void;
  onDelete: () => void;
}

/**
 * Overflow menu for logical tariff actions that do not need a persistent button.
 */
export function TariffVersionActionMenu({
  label,
  onPromotion,
  onDelete,
}: TariffVersionActionMenuProps) {
  const triggerLabel = `Tariff actions for ${label}`;
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const closeIfOutside = (event: PointerEvent | FocusEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    document.addEventListener('pointerdown', closeIfOutside);
    document.addEventListener('focusin', closeIfOutside);

    return () => {
      document.removeEventListener('pointerdown', closeIfOutside);
      document.removeEventListener('focusin', closeIfOutside);
    };
  }, [isOpen]);

  const runAction = (action: () => void) => {
    setIsOpen(false);
    action();
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-label={triggerLabel}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setIsOpen(false);
          }
        }}
        className="flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-xl border border-secondary/10 bg-surface px-3 py-2 text-primary transition-all hover:bg-secondary/5"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
      </button>
      {isOpen && (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-10 min-w-[15rem] rounded-xl border border-secondary/10 bg-surface p-2 shadow-lg">
          <button
            type="button"
            onClick={() => runAction(onPromotion)}
            className="flex min-h-[44px] w-full items-center rounded-lg px-3 py-2 text-left text-primary transition-colors hover:bg-secondary/5"
          >
            Run temporary promotion
          </button>
          <button
            type="button"
            onClick={() => runAction(onDelete)}
            className="flex min-h-[44px] w-full items-center rounded-lg px-3 py-2 text-left text-primary transition-colors hover:bg-secondary/5"
          >
            Delete tariff
          </button>
        </div>
      )}
    </div>
  );
}
