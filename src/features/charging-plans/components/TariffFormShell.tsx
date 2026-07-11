import type { FormEventHandler, ReactNode } from 'react';
import { Save, X } from 'lucide-react';
import { Slab } from '../../../shared/ui';

/** Shared visual and interaction shell for tariff mutation forms. */
export interface TariffFormShellProps {
  title: string;
  description: ReactNode;
  onCancel: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  isSubmitting: boolean;
  submitLabel: string;
  submitDisabled?: boolean;
  submitError?: string;
  children: ReactNode;
}

/** Renders consistent tariff form framing, errors, and submit actions. */
export function TariffFormShell({
  title,
  description,
  onCancel,
  onSubmit,
  isSubmitting,
  submitLabel,
  submitDisabled = false,
  submitError,
  children,
}: TariffFormShellProps): React.ReactElement {
  return (
    <Slab>
      <div className="flex items-center justify-between mb-8">
        <div className="flex flex-col">
          <h2 className="text-2xl font-bold text-primary">{title}</h2>
          <p className="text-sm text-secondary mt-1">{description}</p>
        </div>
        <button type="button" onClick={onCancel} aria-label="Cancel" className="p-2 text-secondary/40 hover:text-secondary rounded-full hover:bg-secondary/10 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center">
          <X className="w-6 h-6" />
        </button>
      </div>
      <form onSubmit={onSubmit} className="space-y-8" noValidate>
        {submitError && (
          <p role="alert" className="text-sm text-red-500 font-medium">{submitError}</p>
        )}
        {children}
        <div className="pt-6 flex flex-col sm:flex-row gap-4">
          <button
            type="submit"
            disabled={submitDisabled || isSubmitting}
            className="flex-1 flex items-center justify-center py-4 px-6 bg-accent text-white font-bold rounded-xl hover:opacity-90 transition-all disabled:opacity-50 min-h-[56px] shadow-lg shadow-accent/20"
          >
            <Save className="w-5 h-5 mr-2" />
            {submitLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-4 px-6 bg-secondary/10 text-primary font-bold rounded-xl hover:bg-secondary/20 transition-all min-h-[56px]"
          >
            Cancel
          </button>
        </div>
      </form>
    </Slab>
  );
}
