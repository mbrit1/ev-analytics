import React from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { ChargingPlan } from '../../../infra/db';
import { DatePicker, ThinInput } from '../../../shared/ui';
import { parseUtcDateInput } from '../model/logicalTariffs';
import type { TariffPriceInput } from '../services/planService';
import {
  getEarliestVersionStart,
  useVersionBaselinePrefill,
} from './versionFormShared';
import {
  hasMeaningfulTariffPricing,
  tariffPriceFields,
  toTariffPriceInput,
  type TariffMoneyFormFields,
} from './tariffMoney';
import { TariffFormShell } from './TariffFormShell';

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
  ...tariffPriceFields,
}).superRefine((values, ctx) => {
  if (values.promo_start && values.promo_end && values.promo_end < values.promo_start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['promo_end'],
      message: 'Promo end must be on or after promo start',
    });
  }

  if (!hasMeaningfulTariffPricing(values)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['monthly_base_fee'],
      message: 'Enter at least one price or positive fee',
    });
  }
});

type TemporaryPromotionFormValues = z.infer<typeof temporaryPromotionSchema> & TariffMoneyFormFields;

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
    <TariffFormShell
      title="Temporary Promotion"
      description="This creates a temporary price and restores the previous price on the day after the promotion ends."
      onCancel={onCancel}
      onSubmit={handleSubmit(handleFormSubmit)}
      isSubmitting={isSubmitting}
      submitLabel="Save promotion"
      submitDisabled={submitDisabled}
      submitError={errors.root?.submit?.message}
    >
        <section className="space-y-6" aria-labelledby="promotion-section">
          <h3 id="promotion-section" className="text-[13px] font-semibold text-secondary uppercase tracking-wider">Promotion Window</h3>
          <Controller
            name="promo_start"
            control={control}
            render={({ field }) => (
              <DatePicker
                label="Promo Start"
                value={field.value}
                onChange={field.onChange}
                required
                requiredIndicator
                min={earliestVersionStart}
                error={errors.promo_start?.message}
              />
            )}
          />
          <Controller
            name="promo_end"
            control={control}
            render={({ field }) => (
              <DatePicker
                label="Promo End"
                value={field.value}
                onChange={field.onChange}
                required
                requiredIndicator
                error={errors.promo_end?.message}
              />
            )}
          />
          <ThinInput label="AC Price" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('ac_price')} error={errors.ac_price?.message} />
          <ThinInput label="DC Price" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('dc_price')} error={errors.dc_price?.message} />
          <ThinInput label="Roaming AC Price" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('roaming_ac_price')} error={errors.roaming_ac_price?.message} />
          <ThinInput label="Roaming DC Price" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('roaming_dc_price')} error={errors.roaming_dc_price?.message} />
          <ThinInput label="Monthly Base Fee" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('monthly_base_fee')} error={errors.monthly_base_fee?.message} />
          <ThinInput label="Session Fee" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('session_fee')} error={errors.session_fee?.message} />
        </section>
    </TariffFormShell>
  );
};
