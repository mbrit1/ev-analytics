import React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Save, X } from 'lucide-react';
import { type ChargingPlan } from '../../../infra/db';
import { formatCentsToDecimal, parseDecimalToCents } from '../../../shared/lib';
import { Slab, ThinInput } from '../../../shared/ui';
import { useProviders } from '../hooks/useProviders';

export interface TariffFormProps {
  onSubmit: (data: ChargingPlan) => Promise<void>;
  onCancel: () => void;
  initialValues?: Partial<ChargingPlan>;
}

const tariffFormSchema = z.object({
  plan_name: z.string().min(1, 'Tariff name is required'),
  provider_id: z.string().min(1, 'Provider is required'),
  valid_from: z.string().min(1, 'Valid from date is required'),
  valid_to: z.string().optional(),
  ac_price: z.string().optional(),
  dc_price: z.string().optional(),
  roaming_ac_price: z.string().optional(),
  roaming_dc_price: z.string().optional(),
  subscription_monthly: z.string().optional(),
  activation_fee: z.string().optional(),
  session_fee: z.string().optional(),
  card_fee: z.string().optional(),
  affiliation: z.string().optional(),
  other_fee_label: z.string().optional(),
  other_fee_amount: z.string().optional(),
  other_fee_notes: z.string().optional(),
  notes: z.string().optional(),
}).superRefine((values, ctx) => {
  const hasOtherLabel = (values.other_fee_label ?? '').trim().length > 0;
  const hasOtherAmount = (values.other_fee_amount ?? '').trim().length > 0;
  const hasOtherNotes = (values.other_fee_notes ?? '').trim().length > 0;
  const hasAnyOtherFee = hasOtherLabel || hasOtherAmount || hasOtherNotes;

  if (hasAnyOtherFee && !(hasOtherLabel && hasOtherAmount && hasOtherNotes)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Other fee requires label, amount, and notes',
      path: ['other_fee_label'],
    });
  }
});

type TariffFormSchemaValues = z.infer<typeof tariffFormSchema>;

function formatDateInputValue(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateInputAsUtc(dateInput: string): Date {
  const [year, month, day] = dateInput.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Minimal tariff form backed by charging-plan persistence fields.
 */
export const TariffForm: React.FC<TariffFormProps> = ({ onSubmit, onCancel, initialValues }) => {
  const { providers } = useProviders();
  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<TariffFormSchemaValues>({
    resolver: zodResolver(tariffFormSchema),
    defaultValues: {
      plan_name: initialValues?.plan_name ?? '',
      provider_id: initialValues?.provider_id ?? '',
      valid_from: initialValues?.validity?.from ? formatDateInputValue(initialValues.validity.from) : formatDateInputValue(new Date()),
      valid_to: initialValues?.validity?.to ? formatDateInputValue(initialValues.validity.to) : '',
      ac_price: initialValues?.prices?.domestic.ac != null ? formatCentsToDecimal(initialValues.prices.domestic.ac) : '',
      dc_price: initialValues?.prices?.domestic.dc != null ? formatCentsToDecimal(initialValues.prices.domestic.dc) : '',
      roaming_ac_price: initialValues?.prices?.roaming?.ac != null ? formatCentsToDecimal(initialValues.prices.roaming.ac) : '',
      roaming_dc_price: initialValues?.prices?.roaming?.dc != null ? formatCentsToDecimal(initialValues.prices.roaming.dc) : '',
      subscription_monthly: initialValues?.fees?.subscriptionMonthly != null ? formatCentsToDecimal(initialValues.fees.subscriptionMonthly) : '',
      activation_fee: initialValues?.fees?.activationOneTime != null ? formatCentsToDecimal(initialValues.fees.activationOneTime) : '',
      session_fee: initialValues?.fees?.sessionFixed != null ? formatCentsToDecimal(initialValues.fees.sessionFixed) : '',
      card_fee: initialValues?.fees?.cardFee != null ? formatCentsToDecimal(initialValues.fees.cardFee) : '',
      affiliation: initialValues?.affiliation ?? '',
      other_fee_label: initialValues?.fees?.other?.[0]?.label ?? '',
      other_fee_amount: initialValues?.fees?.other?.[0]?.amount != null ? formatCentsToDecimal(initialValues.fees.other[0].amount) : '',
      other_fee_notes: initialValues?.fees?.other?.[0]?.notes ?? '',
      notes: initialValues?.notes ?? '',
    }
  });

  const handleFormSubmit = async (values: TariffFormSchemaValues) => {
    const now = new Date();
    await onSubmit({
      id: initialValues?.id ?? crypto.randomUUID(),
      user_id: initialValues?.user_id ?? '',
      provider_id: values.provider_id,
      plan_name: values.plan_name,
      validity: {
        from: parseDateInputAsUtc(values.valid_from),
        to: values.valid_to ? parseDateInputAsUtc(values.valid_to) : undefined
      },
      prices: {
        domestic: {
          ac: values.ac_price ? parseDecimalToCents(values.ac_price) : undefined,
          dc: values.dc_price ? parseDecimalToCents(values.dc_price) : undefined,
        },
        roaming: {
          ac: values.roaming_ac_price ? parseDecimalToCents(values.roaming_ac_price) : undefined,
          dc: values.roaming_dc_price ? parseDecimalToCents(values.roaming_dc_price) : undefined,
        },
      },
      fees: {
        subscriptionMonthly: values.subscription_monthly ? parseDecimalToCents(values.subscription_monthly) : undefined,
        activationOneTime: values.activation_fee ? parseDecimalToCents(values.activation_fee) : undefined,
        sessionFixed: values.session_fee ? parseDecimalToCents(values.session_fee) : undefined,
        cardFee: values.card_fee ? parseDecimalToCents(values.card_fee) : undefined,
        other: values.other_fee_label && values.other_fee_amount && values.other_fee_notes
          ? [{
            label: values.other_fee_label.trim(),
            amount: parseDecimalToCents(values.other_fee_amount),
            notes: values.other_fee_notes.trim(),
          }]
          : undefined,
      },
      affiliation: values.affiliation || undefined,
      notes: values.notes || undefined,
      created_at: initialValues?.created_at ?? now,
      updated_at: now,
      deleted_at: initialValues?.deleted_at,
    });
  };

  return (
    <Slab>
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-primary">{initialValues?.id ? 'Edit Tariff' : 'New Tariff'}</h2>
        <button type="button" onClick={onCancel} aria-label="Cancel" className="p-2 text-secondary/40 hover:text-secondary rounded-full hover:bg-secondary/10 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center">
          <X className="w-6 h-6" />
        </button>
      </div>
      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-8" noValidate>
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-primary">Identity</h3>
          <ThinInput label="Tariff Name" type="text" {...register('plan_name')} error={errors.plan_name?.message} />
          <div className="flex flex-col">
            <label htmlFor="provider_id" className="text-[13px] font-medium text-secondary uppercase tracking-wider mb-1">Provider</label>
            <Controller
              name="provider_id"
              control={control}
              render={({ field }) => (
                <select
                  id="provider_id"
                  aria-label="Provider"
                  aria-invalid={errors.provider_id ? 'true' : 'false'}
                  aria-describedby={errors.provider_id ? 'provider_id_error' : undefined}
                  value={field.value}
                  onChange={field.onChange}
                  className="w-full px-0 py-2 border-b border-secondary/20 focus:border-accent outline-none bg-transparent text-xl font-medium min-h-[44px] transition-colors"
                >
                  <option value="">Select Provider</option>
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.name}</option>
                  ))}
                </select>
              )}
            />
            {errors.provider_id && <p id="provider_id_error" className="text-sm text-red-500 font-medium mt-1.5">{errors.provider_id.message}</p>}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ThinInput label="Valid From" type="date" {...register('valid_from')} error={errors.valid_from?.message} />
            <ThinInput label="Valid To" type="date" {...register('valid_to')} />
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-primary">Charging Prices</h3>
          <ThinInput label="AC Price" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('ac_price')} />
          <ThinInput label="DC Price" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('dc_price')} />
        </section>

        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-primary">Roaming Prices</h3>
          <ThinInput label="Roaming AC Price" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('roaming_ac_price')} />
          <ThinInput label="Roaming DC Price" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('roaming_dc_price')} />
        </section>

        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-primary">Additional Fees</h3>
          <ThinInput label="Subscription" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('subscription_monthly')} />
          <ThinInput label="Activation Fee" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('activation_fee')} />
          <ThinInput label="Session Fee" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('session_fee')} />
          <ThinInput label="Card Fee" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('card_fee')} />
        </section>

        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-primary">Advanced</h3>
          <ThinInput label="Affiliation" type="text" {...register('affiliation')} />
          <ThinInput label="Other Fee Label" type="text" {...register('other_fee_label')} error={errors.other_fee_label?.message} />
          <ThinInput label="Other Fee Amount" unit="€" inputMode="decimal" placeholder="0,00" className="tabular-nums" {...register('other_fee_amount')} />
          <ThinInput label="Other Fee Notes" type="text" {...register('other_fee_notes')} />
          <ThinInput label="Notes" type="text" {...register('notes')} />
        </section>

        <div className="flex gap-3">
          <button type="submit" disabled={isSubmitting} className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-surface rounded-md disabled:opacity-60">
            <Save className="w-4 h-4" />
            Save Tariff
          </button>
          <button type="button" onClick={onCancel} className="px-4 py-2 border border-secondary/20 rounded-md">
            Cancel
          </button>
        </div>
      </form>
    </Slab>
  );
};
