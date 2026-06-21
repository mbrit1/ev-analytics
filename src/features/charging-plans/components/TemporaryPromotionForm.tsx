import React from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Save, X } from 'lucide-react';
import type { ChargingPlan } from '../../../infra/db';
import { Slab, ThinInput } from '../../../shared/ui';
import { parseUtcDateInput } from '../model/logicalTariffs';
import type { TariffPriceInput } from '../services/planService';
import {
  getEarliestVersionStart,
  priceFields,
  toTariffPriceInput,
  useVersionBaselinePrefill,
  type VersionPriceFormFields,
} from './versionFormShared';

/**
 * Props for scheduling a temporary tariff promotion from logical history.
 */
export interface TemporaryPromotionFormProps {
  versions: ChargingPlan[];
  onSubmit: (data: TemporaryPromotionSubmit) => Promise<void>;
  onCancel: () => void;
}

/**
 * Submitted values for a temporary tariff promotion window.
 */
export interface TemporaryPromotionSubmit {
  promoStart: Date;
  promoEndInclusive: Date;
  prices: TariffPriceInput;
}

const temporaryPromotionSchema = z.object({
  promo_start: z.string().min(1, 'Promo start date is required'),
  promo_end: z.string().min(1, 'Promo end date is required'),
  ...priceFields,
}).superRefine((values, ctx) => {
  if (values.promo_start && values.promo_end && values.promo_end < values.promo_start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['promo_end'],
      message: 'Promo end must be on or after promo start',
    });
  }

  const prices = toTariffPriceInput(values);
  const hasMeaningfulPricing = [
    prices.ac_price_per_kwh,
    prices.dc_price_per_kwh,
    prices.roaming_ac_price_per_kwh,
    prices.roaming_dc_price_per_kwh,
  ].some((value) => value != null)
    || prices.monthly_base_fee > 0
    || prices.session_fee > 0;

  if (!hasMeaningfulPricing) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['monthly_base_fee'],
      message: 'Enter at least one price or positive fee',
    });
  }
});

type TemporaryPromotionFormValues = z.infer<typeof temporaryPromotionSchema> & VersionPriceFormFields;

/**
 * Form for scheduling a temporary promotion window and restoring the prior pricing afterward.
 */
export const TemporaryPromotionForm: React.FC<TemporaryPromotionFormProps> = ({
  versions,
  onSubmit,
  onCancel,
}) => {
  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<TemporaryPromotionFormValues>({
    resolver: zodResolver(temporaryPromotionSchema),
    defaultValues: {
      promo_start: '',
      promo_end: '',
      ac_price: '',
      dc_price: '',
      roaming_ac_price: '',
      roaming_dc_price: '',
      monthly_base_fee: '0,00',
      session_fee: '0,00',
    },
  });

  const selectedStart = useWatch({ control, name: 'promo_start' });
  const { baseline, isStartAfterBaseline } = useVersionBaselinePrefill({
    versions,
    selectedStart,
    startFieldName: 'promo_start',
    sameStartErrorMessage: 'Choose a promo start after the current tariff starts',
    setValue,
    setError,
    clearErrors,
  });

  const handleFormSubmit = async (values: TemporaryPromotionFormValues) => {
    clearErrors('root.submit');

    try {
      await onSubmit({
        promoStart: parseUtcDateInput(values.promo_start),
        promoEndInclusive: parseUtcDateInput(values.promo_end),
        prices: toTariffPriceInput(values),
      });
    } catch (error) {
      setError('root.submit', {
        type: 'server',
        message: error instanceof Error ? error.message : 'Unable to save promotion. Please try again.',
      });
    }
  };

  const submitDisabled = !selectedStart || !baseline || !isStartAfterBaseline;
  const earliestVersionStart = getEarliestVersionStart(versions);

  return (
    <Slab>
      <div className="flex items-center justify-between mb-8">
        <div className="flex flex-col">
          <h2 className="text-2xl font-bold text-primary">Temporary Promotion</h2>
          <p className="text-sm text-secondary mt-1">
            This creates a temporary price and restores the previous price on the day after the promotion ends.
          </p>
        </div>
        <button type="button" onClick={onCancel} aria-label="Cancel" className="p-2 text-secondary/40 hover:text-secondary rounded-full hover:bg-secondary/10 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center">
          <X className="w-6 h-6" />
        </button>
      </div>
      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-8" noValidate>
        {errors.root?.submit?.message && (
          <p role="alert" className="text-sm text-red-500 font-medium">
            {errors.root.submit.message}
          </p>
        )}
        <section className="space-y-6" aria-labelledby="promotion-section">
          <h3 id="promotion-section" className="text-[13px] font-semibold text-secondary uppercase tracking-wider">Promotion Window</h3>
          <ThinInput label="Promo Start" requiredIndicator type="date" min={earliestVersionStart} {...register('promo_start')} error={errors.promo_start?.message} />
          <ThinInput label="Promo End" requiredIndicator type="date" {...register('promo_end')} error={errors.promo_end?.message} />
          <ThinInput label="AC Price" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('ac_price')} error={errors.ac_price?.message} />
          <ThinInput label="DC Price" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('dc_price')} error={errors.dc_price?.message} />
          <ThinInput label="Roaming AC Price" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('roaming_ac_price')} error={errors.roaming_ac_price?.message} />
          <ThinInput label="Roaming DC Price" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('roaming_dc_price')} error={errors.roaming_dc_price?.message} />
          <ThinInput label="Monthly Base Fee" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('monthly_base_fee')} error={errors.monthly_base_fee?.message} />
          <ThinInput label="Session Fee" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('session_fee')} error={errors.session_fee?.message} />
        </section>
        <div className="pt-6 flex flex-col sm:flex-row gap-4">
          <button
            type="submit"
            disabled={submitDisabled || isSubmitting}
            className="flex-1 flex items-center justify-center py-4 px-6 bg-accent text-white font-bold rounded-xl hover:opacity-90 transition-all disabled:opacity-50 min-h-[56px] shadow-lg shadow-accent/20"
          >
            <Save className="w-5 h-5 mr-2" />
            Save promotion
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
};
