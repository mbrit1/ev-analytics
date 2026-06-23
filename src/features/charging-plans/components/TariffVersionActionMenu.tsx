import { MoreHorizontal } from 'lucide-react';
import type { MouseEvent } from 'react';

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

  const runAction = (
    event: MouseEvent<HTMLButtonElement>,
    action: () => void,
  ) => {
    const menu = event.currentTarget.closest('details');
    menu?.removeAttribute('open');
    action();
  };

  return (
    <details className="relative">
      <summary
        aria-label={triggerLabel}
        role="button"
        className="flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-xl border border-secondary/10 bg-surface px-3 py-2 text-primary transition-all hover:bg-secondary/5"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
      </summary>
      <div className="absolute right-0 top-[calc(100%+0.5rem)] z-10 min-w-[15rem] rounded-xl border border-secondary/10 bg-surface p-2 shadow-lg">
        <button
          type="button"
          onClick={(event) => runAction(event, onPromotion)}
          className="flex min-h-[44px] w-full items-center rounded-lg px-3 py-2 text-left text-primary transition-colors hover:bg-secondary/5"
        >
          Run temporary promotion
        </button>
        <button
          type="button"
          onClick={(event) => runAction(event, onDelete)}
          className="flex min-h-[44px] w-full items-center rounded-lg px-3 py-2 text-left text-primary transition-colors hover:bg-secondary/5"
        >
          Delete tariff
        </button>
      </div>
    </details>
  );
}
