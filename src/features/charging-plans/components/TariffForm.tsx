import React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { type ChargingPlan } from '../../../infra/db';
import { formatCentsToDecimal } from '../../../shared/lib';
import { DatePicker, ThinInput } from '../../../shared/ui';
import { useProviders } from '../hooks/useProviders';
import {
  tariffPriceFields,
  toTariffPriceInput,
} from './tariffMoney';
import { TariffFormShell } from './TariffFormShell';

interface TariffLogicalIdentity {
  providerId: string;
  name: string;
}

export type TariffFormSubmit =
  | { intent: 'create'; plan: ChargingPlan }
  | {
      intent: 'update_current';
      plan: ChargingPlan;
      logicalIdentity: TariffLogicalIdentity;
      originalValidFrom: Date;
    }
  | {
      intent: 'create_successor';
      plan: ChargingPlan;
      logicalIdentity: TariffLogicalIdentity;
      originalValidFrom: Date;
    };

export interface TariffFormProps {
  mode?: 'create' | 'edit';
  onSubmit: (data: TariffFormSubmit) => Promise<void>;
  onCancel: () => void;
  initialValues?: Partial<ChargingPlan>;
}

const tariffFormSchema = z.object({
  name: z.string().optional(),
  provider_id: z.string().min(1, 'Provider is required'),
  valid_from: z.string().min(1, 'Valid from date is required'),
  valid_to: z.string().optional(),
  ...tariffPriceFields,
  affiliation: z.string().optional(),
  notes: z.string().optional(),
});

type TariffFormSchemaValues = z.infer<typeof tariffFormSchema>;

/**
 * Coerces values that may have been rehydrated from storage into `Date` instances.
 *
 * This form expects `ChargingPlan.valid_from/valid_to` to be `Date` objects, but
 * persisted records (or JSON serialization) can yield ISO strings or timestamps.
 * Returning `null` allows callers to gracefully fall back without throwing.
 */
function coerceDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/**
 * Converts a value into a `YYYY-MM-DD` string for the shared date picker.
 *
 * Uses UTC to keep the stored UTC semantics stable across local time zones.
 * Returns an empty string when the input cannot be parsed into a valid date.
 */
function formatDateInputValue(dateLike: unknown): string {
  const date = coerceDate(dateLike);
  if (!date) return '';
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parses a `YYYY-MM-DD` date input string into a UTC `Date`.
 *
 * This avoids local time zone offsets when persisting plan validity boundaries.
 */
function parseDateInputAsUtc(dateInput: string): Date {
  const [year, month, day] = dateInput.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

interface ProviderSelectProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}

function ProviderSelect({
  value,
  onChange,
  error,
  disabled = false,
}: ProviderSelectProps): React.ReactElement {
  const { providers } = useProviders();

  return (
    <div className="flex flex-col">
      <label htmlFor="provider_id" className="text-[13px] font-medium text-secondary uppercase tracking-wider mb-1">
        Provider <span className="text-primary" aria-hidden="true">*</span>
      </label>
      <select
        id="provider_id"
        aria-label="Provider"
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={error ? 'provider_id_error' : undefined}
        required
        aria-required="true"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full px-0 py-2 border-b border-secondary/20 focus:border-accent outline-none bg-transparent text-xl font-medium min-h-[44px] transition-colors disabled:opacity-70"
      >
        <option value="">Select Provider</option>
        {providers.map((provider) => (
          <option key={provider.id} value={provider.id}>{provider.name}</option>
        ))}
      </select>
      {error && <p id="provider_id_error" className="text-sm text-red-500 font-medium mt-1.5">{error}</p>}
    </div>
  );
}

function StandardTariffForm({
  mode,
  onSubmit,
  onCancel,
  initialValues,
}: TariffFormProps): React.ReactElement {
  const resolvedMode = mode ?? (initialValues?.id ? 'edit' : 'create');
  const { register, handleSubmit, control, setError, clearErrors, formState: { errors, isSubmitting } } = useForm<TariffFormSchemaValues>({
    resolver: zodResolver(tariffFormSchema),
    defaultValues: {
      name: initialValues?.name ?? '',
      provider_id: initialValues?.provider_id ?? '',
      valid_from: formatDateInputValue(initialValues?.valid_from ?? new Date()),
      valid_to: initialValues?.valid_to ? formatDateInputValue(initialValues.valid_to) : '',
      ac_price: initialValues?.ac_price_per_kwh != null ? formatCentsToDecimal(initialValues.ac_price_per_kwh) : '',
      dc_price: initialValues?.dc_price_per_kwh != null ? formatCentsToDecimal(initialValues.dc_price_per_kwh) : '',
      roaming_ac_price: initialValues?.roaming_ac_price_per_kwh != null ? formatCentsToDecimal(initialValues.roaming_ac_price_per_kwh) : '',
      roaming_dc_price: initialValues?.roaming_dc_price_per_kwh != null ? formatCentsToDecimal(initialValues.roaming_dc_price_per_kwh) : '',
      monthly_base_fee: initialValues?.monthly_base_fee != null ? formatCentsToDecimal(initialValues.monthly_base_fee) : '0,00',
      session_fee: initialValues?.session_fee != null ? formatCentsToDecimal(initialValues.session_fee) : '0,00',
      affiliation: initialValues?.affiliation ?? '',
      notes: initialValues?.notes ?? '',
    },
  });

  const handleFormSubmit = async (values: TariffFormSchemaValues) => {
    const now = new Date();
    const normalizedPlanName = (values.name ?? '').trim();
    const originalValidFrom = initialValues?.valid_from ? coerceDate(initialValues.valid_from) : null;
    const submittedValidFrom = parseDateInputAsUtc(values.valid_from);
    clearErrors('root.submit');

    if (resolvedMode === 'edit' && originalValidFrom == null) {
      setError('root.submit', {
        type: 'server',
        message: 'Unable to resolve the original tariff start date.',
      });
      return;
    }

    const resolvedOriginalValidFrom = resolvedMode === 'edit'
      ? originalValidFrom
      : null;
    const isSameValidFrom = resolvedMode === 'edit' && resolvedOriginalValidFrom != null
      ? submittedValidFrom.getTime() === resolvedOriginalValidFrom.getTime()
      : false;
    const prices = toTariffPriceInput(values);
    const plan: ChargingPlan = {
      id: resolvedMode === 'edit' && isSameValidFrom
        ? initialValues?.id ?? crypto.randomUUID()
        : crypto.randomUUID(),
      user_id: initialValues?.user_id ?? '',
      provider_id: values.provider_id,
      name: normalizedPlanName,
      valid_from: submittedValidFrom,
      valid_to: values.valid_to ? parseDateInputAsUtc(values.valid_to) : null,
      ...prices,
      affiliation: values.affiliation || undefined,
      notes: values.notes || undefined,
      created_at: initialValues?.created_at ?? now,
      updated_at: now,
      deleted_at: initialValues?.deleted_at,
    };

    try {
      if (resolvedMode === 'create') {
        await onSubmit({
          intent: 'create',
          plan,
        });
        return;
      }

      await onSubmit({
        intent: isSameValidFrom ? 'update_current' : 'create_successor',
        plan,
        logicalIdentity: {
          providerId: initialValues?.provider_id ?? plan.provider_id,
          name: initialValues?.name ?? '',
        },
        originalValidFrom: resolvedOriginalValidFrom as Date,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save tariff. Please try again.';
      setError('root.submit', {
        type: 'server',
        message,
      });
    }
  };

  return (
    <TariffFormShell
      title={resolvedMode === 'edit' ? 'Edit Tariff' : 'New Tariff'}
      description={<><span className="text-primary font-medium" aria-hidden="true">*</span> Required fields</>}
      onCancel={onCancel}
      onSubmit={handleSubmit(handleFormSubmit)}
      isSubmitting={isSubmitting}
      submitLabel="Save Tariff"
      submitError={errors.root?.submit?.message}
    >
      <section className="space-y-6" aria-labelledby="tariff-section-identity">
        <h3 id="tariff-section-identity" className="text-[13px] font-semibold text-secondary uppercase tracking-wider">Identity</h3>
        <ThinInput label="Tariff Name (Optional)" type="text" {...register('name')} error={errors.name?.message} />
        <Controller
          name="provider_id"
          control={control}
          render={({ field }) => (
            <ProviderSelect
              value={field.value}
              onChange={field.onChange}
              error={errors.provider_id?.message}
              disabled={resolvedMode === 'edit'}
            />
          )}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Controller
            name="valid_from"
            control={control}
            render={({ field }) => (
              <DatePicker
                label="Valid From"
                value={field.value}
                onChange={field.onChange}
                required
                requiredIndicator
                error={errors.valid_from?.message}
              />
            )}
          />
          <Controller
            name="valid_to"
            control={control}
            render={({ field }) => (
              <DatePicker
                label="Valid To"
                value={field.value ?? ''}
                onChange={field.onChange}
                allowEmpty
                emptyLabel="Open-ended"
              />
            )}
          />
        </div>
      </section>

      <section className="space-y-6" aria-labelledby="tariff-section-charging-prices">
        <h3 id="tariff-section-charging-prices" className="text-[13px] font-semibold text-secondary uppercase tracking-wider">Charging Prices</h3>
        <ThinInput label="AC Price" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('ac_price')} error={errors.ac_price?.message} />
        <ThinInput label="DC Price" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('dc_price')} error={errors.dc_price?.message} />
      </section>

      <section className="space-y-6" aria-labelledby="tariff-section-roaming-prices">
        <h3 id="tariff-section-roaming-prices" className="text-[13px] font-semibold text-secondary uppercase tracking-wider">Roaming Prices</h3>
        <ThinInput label="Roaming AC Price" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('roaming_ac_price')} error={errors.roaming_ac_price?.message} />
        <ThinInput label="Roaming DC Price" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('roaming_dc_price')} error={errors.roaming_dc_price?.message} />
      </section>

      <section className="space-y-6" aria-labelledby="tariff-section-additional-fees">
        <h3 id="tariff-section-additional-fees" className="text-[13px] font-semibold text-secondary uppercase tracking-wider">Additional Fees</h3>
        <ThinInput label="Monthly Base Fee" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('monthly_base_fee')} error={errors.monthly_base_fee?.message} />
        <ThinInput label="Session Fee" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('session_fee')} error={errors.session_fee?.message} />
      </section>

      <section className="space-y-6" aria-labelledby="tariff-section-advanced">
        <h3 id="tariff-section-advanced" className="text-[13px] font-semibold text-secondary uppercase tracking-wider">Advanced</h3>
        <ThinInput label="Affiliation" type="text" {...register('affiliation')} />
        <ThinInput label="Notes" type="text" {...register('notes')} />
      </section>
    </TariffFormShell>
  );
}

/**
 * Tariff form for creating new tariff versions or editing the current version.
 */
export const TariffForm: React.FC<TariffFormProps> = (props) => {
  return <StandardTariffForm {...props} />;
};
