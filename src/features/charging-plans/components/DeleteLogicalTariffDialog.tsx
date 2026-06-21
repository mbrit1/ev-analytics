import { useState } from 'react';
import { Slab } from '../../../shared/ui';

interface DeleteLogicalTariffDialogProps {
  logicalTariffLabel: string;
  isDeleting: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

/**
 * Confirmation dialog for deleting all versions of a logical tariff together.
 */
export function DeleteLogicalTariffDialog({
  logicalTariffLabel,
  isDeleting,
  onConfirm,
  onCancel,
}: DeleteLogicalTariffDialogProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-logical-tariff-heading"
      className="fixed inset-0 z-20 flex items-center justify-center bg-primary/20 p-4"
    >
      <Slab className="w-full max-w-xl space-y-5 p-6">
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
            type="button"
            onClick={onCancel}
            className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-secondary/10 px-4 py-3 font-bold text-primary transition-colors hover:bg-secondary/20"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isDeleting}
            onClick={handleConfirm}
            className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-accent px-4 py-3 font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Delete complete tariff
          </button>
        </div>
      </Slab>
    </div>
  );
}
