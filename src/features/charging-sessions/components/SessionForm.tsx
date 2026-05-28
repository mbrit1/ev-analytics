import React from 'react';
import { useForm, Controller, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Save, X, Calendar, FileText } from 'lucide-react';
import { getActivePlanSelectionAt, setActivePlanSelection, useChargingPlans, useProviders } from '../../charging-plans';
import { useAuth } from '../../auth';
import { type ChargingPlan, type ChargingSession, type TariffPriceSnapshot } from '../../../infra/db';
import { prepareSession } from '../services/sessionService';
import { Slab } from '../../../shared/ui';
import { ThinInput } from '../../../shared/ui';
import { TactileMatrix } from '../../../shared/ui';

/**
 * Browser form values are kept as strings so react-hook-form can preserve
 * partially typed decimal input before validation converts it to domain data.
 */
const sessionSchema = z.object({
  /** Date-only input; converted to a Date when the session is prepared. */
  session_timestamp: z.string().min(1, 'Date is required'),
  /** Selected provider determines the available tariff options in plan mode. */
  provider_id: z.string().optional(),
  pricing_source: z.enum(['chargingPlan', 'adHoc']),
  /** Selected plan supplies the price snapshots used for cost calculation. */
  charging_plan_id: z.string().optional(),
  charging_type: z.enum(['AC', 'DC']),
  pricing_mode: z.enum(['standard', 'roaming']),
  /** Required billed energy; accepts comma or period decimal separators. */
  kwh_billed: z.string().regex(/^\d+([,.]\d{1,4})?$/, 'Invalid kWh format'),
  /** Optional battery-added energy, useful when it differs from billed energy. */
  kwh_added: z.string().regex(/^\d+([,.]\d{1,4})?$/, 'Invalid kWh format').optional().or(z.literal('')),
  /** Starting state of charge as a whole-number percentage. */
  start_soc_percentage: z
    .string()
    .regex(/^$|^\d{1,3}$/, '0-100')
    .refine(v => {
      if (v === '') return true;
      const n = parseInt(v);
      return !isNaN(n) && n >= 0 && n <= 100;
    }, 'Must be 0-100'),
  /** Ending state of charge as a whole-number percentage. */
  end_soc_percentage: z
    .string()
    .regex(/^$|^\d{1,3}$/, '0-100')
    .refine(v => {
      if (v === '') return true;
      const n = parseInt(v);
      return !isNaN(n) && n >= 0 && n <= 100;
    }, 'Must be 0-100'),
  /** Optional odometer reading captured at the session date. */
  odometer_km: z.string().regex(/^\d*$/, 'Invalid number').optional(),
  /** Free-form notes for receipt details, charger notes, or trip context. */
  notes: z.string().optional(),
  cpo_name: z.string().optional(),
  ad_hoc_price_per_kwh: z.string().regex(/^$|^\d+([,.]\d{1,4})?$/, 'Invalid price format').optional(),
  ad_hoc_session_fee: z.string().optional(),
  ad_hoc_receipt_url: z.string().url('Invalid URL').optional().or(z.literal('')),
  ad_hoc_other_fees: z.string().optional(),
}).superRefine((values, ctx) => {
  if (values.pricing_source === 'chargingPlan') {
    if (!values.provider_id?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['provider_id'],
        message: 'Charging provider is required',
      });
    }
    if (!values.charging_plan_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['charging_plan_id'],
        message: 'Plan is required',
      });
    }
    return;
  }

  if (!values.cpo_name?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cpo_name'],
      message: 'CPO/Operator is required',
    });
  }

  if (!values.ad_hoc_price_per_kwh?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ad_hoc_price_per_kwh'],
      message: 'Price per kWh is required',
    });
  }
});

type SessionFormValues = z.infer<typeof sessionSchema>;

type LegacySessionInitialValues = Partial<ChargingSession> & {
  tariff_id?: string;
  pricing_context?: ChargingSession['pricing_context'];
};

function formatDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateInputAsUtc(dateInput: string): Date {
  const [year, month, day] = dateInput.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function resolveInitialPlanId(initialValues?: LegacySessionInitialValues): string {
  return initialValues?.charging_plan_id ?? initialValues?.tariff_id ?? '';
}

function resolveInitialPricingSource(initialValues?: LegacySessionInitialValues): SessionFormValues['pricing_source'] {
  if (initialValues?.pricing_source) {
    return initialValues.pricing_source;
  }
  if (initialValues?.pricing_context === 'ad_hoc') {
    return 'adHoc';
  }
  return 'chargingPlan';
}

function resolveInitialPricingMode(initialValues?: LegacySessionInitialValues): SessionFormValues['pricing_mode'] {
  if (resolveInitialPricingSource(initialValues) === 'adHoc') {
    return 'standard';
  }
  if (initialValues?.pricing_context != null) {
    return initialValues.pricing_context === 'roaming' ? 'roaming' : 'standard';
  }
  return 'standard';
}

function parseDecimalToCents(value?: string): number | undefined {
  if (!value?.trim()) return undefined;
  const normalized = value.replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.round(parsed * 100);
}

function resolvePlanSnapshotKwhPrice(
  chargingPlan: ChargingPlan,
  pricingMode: SessionFormValues['pricing_mode'],
  chargingType: SessionFormValues['charging_type']
): number {
  if (pricingMode === 'roaming') {
    const roamingPrice = chargingType === 'AC'
      ? chargingPlan.prices.roaming?.ac
      : chargingPlan.prices.roaming?.dc;
    if (roamingPrice == null) {
      throw new Error(`No matching roaming ${chargingType} price for selected charging plan`);
    }
    return roamingPrice;
  }

  const domesticPrice = chargingType === 'AC'
    ? chargingPlan.prices.domestic.ac
    : chargingPlan.prices.domestic.dc;
  if (domesticPrice == null) {
    throw new Error(`No matching domestic ${chargingType} price for selected charging plan`);
  }
  return domesticPrice;
}

function buildTariffPriceSnapshot(
  chargingPlan: ChargingPlan,
  providerName: string,
  pricingMode: SessionFormValues['pricing_mode'],
  chargingType: SessionFormValues['charging_type']
): TariffPriceSnapshot {
  return {
    label: `${providerName} ${chargingPlan.plan_name}`,
    kWhPrice: resolvePlanSnapshotKwhPrice(chargingPlan, pricingMode, chargingType),
    sessionFee: chargingPlan.fees.sessionFixed ?? undefined
  };
}

interface SessionFormProps {
  /** Persists the fully prepared charging session. */
  onSubmit: (session: ChargingSession) => Promise<void>;
  /** Closes the form without saving changes. */
  onCancel: () => void;
  /** Existing values used when editing a previously saved session. */
  initialValues?: Partial<ChargingSession>;
}

/**
 * Captures charging-session details and converts validated form strings into a
 * complete domain session.
 *
 * The form looks up the chosen provider and tariff before calling
 * {@link prepareSession}, ensuring saved sessions include price/name snapshots
 * as well as calculated total cost.
 */
export const SessionForm: React.FC<SessionFormProps> = ({ onSubmit, onCancel, initialValues }) => {
  const legacyInitialValues = initialValues as LegacySessionInitialValues | undefined;
  const { user } = useAuth();
  const { chargingPlans } = useChargingPlans();
  const { providers } = useProviders();
  const hiddenDateInputRef = React.useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<SessionFormValues>({
    resolver: zodResolver(sessionSchema),
    defaultValues: {
      session_timestamp: initialValues?.session_timestamp 
        ? formatDateInputValue(initialValues.session_timestamp)
        : formatDateInputValue(new Date()),
      charging_type: (initialValues?.charging_type as SessionFormValues['charging_type']) || 'AC',
      pricing_source: resolveInitialPricingSource(legacyInitialValues),
      pricing_mode: resolveInitialPricingMode(legacyInitialValues),
      start_soc_percentage: initialValues?.start_soc_percentage?.toString() || '',
      end_soc_percentage: initialValues?.end_soc_percentage?.toString() || '',
      provider_id: initialValues?.provider_id || '',
      charging_plan_id: resolveInitialPlanId(legacyInitialValues),
      kwh_billed: initialValues?.kwh_billed?.toString() || '',
      kwh_added: initialValues?.kwh_added?.toString() || '',
      odometer_km: initialValues?.odometer_km?.toString() || '',
      notes: initialValues?.notes || '',
      cpo_name: initialValues?.ad_hoc_pricing?.cpoName || '',
      ad_hoc_price_per_kwh: initialValues?.ad_hoc_pricing?.pricePerKwh != null
        ? (initialValues.ad_hoc_pricing.pricePerKwh / 100).toFixed(2).replace('.', ',')
        : '',
      ad_hoc_session_fee: initialValues?.ad_hoc_pricing?.pricePerSession != null
        ? (initialValues.ad_hoc_pricing.pricePerSession / 100).toFixed(2).replace('.', ',')
        : '',
      ad_hoc_receipt_url: initialValues?.ad_hoc_pricing?.receiptUrl ?? '',
      ad_hoc_other_fees: initialValues?.ad_hoc_pricing?.otherFees?.[0]?.amount != null
        ? (initialValues.ad_hoc_pricing.otherFees[0].amount / 100).toFixed(2).replace('.', ',')
        : '',
    },
  });

  const selectedProviderId = useWatch({ control, name: 'provider_id' });
  const selectedPricingSource = useWatch({ control, name: 'pricing_source' });
  const selectedPlanId = useWatch({ control, name: 'charging_plan_id' });
  const selectedSessionDate = useWatch({ control, name: 'session_timestamp' });
  const providerPlans = React.useMemo(
    () => chargingPlans.filter(plan => plan.provider_id === selectedProviderId),
    [chargingPlans, selectedProviderId]
  );
  const sessionDateField = register('session_timestamp');

  React.useEffect(() => {
    if (selectedPricingSource === 'adHoc') {
      if (getValues('provider_id')) {
        setValue('provider_id', '');
      }
      if (getValues('charging_plan_id')) {
        setValue('charging_plan_id', '');
      }
      return;
    }

    const currentPlanId = getValues('charging_plan_id');

    if (!selectedProviderId) {
      if (currentPlanId) {
        setValue('charging_plan_id', '');
      }
      return;
    }

    const currentPlanStillValid = providerPlans.some(plan => plan.id === currentPlanId);
    if (currentPlanStillValid) {
      return;
    }

    if (providerPlans.length === 1) {
      setValue('charging_plan_id', providerPlans[0].id, { shouldDirty: true });
      return;
    }

    setValue('charging_plan_id', '');
  }, [selectedPricingSource, selectedProviderId, providerPlans, getValues, setValue]);

  const sessionDateLabel = React.useMemo(() => {
    const raw = selectedSessionDate || formatDateInputValue(new Date());
    const [year, month, day] = raw.split('-');
    if (!year || !month || !day) return raw;
    return `${day}.${month}.${year}`;
  }, [selectedSessionDate]);

  const openNativeDatePicker = React.useCallback(() => {
    const input = hiddenDateInputRef.current;
    if (!input) return;
    if (typeof input.showPicker === 'function') {
      input.showPicker();
      return;
    }
    input.focus();
    input.click();
  }, []);

  const handleFormSubmit = async (values: SessionFormValues) => {
    // A session must belong to the active user; unauthenticated renders should
    // not be able to create orphaned local records.
    if (!user) return;

    // Convert browser-friendly strings into the numeric domain fields expected
    // by prepareSession. Decimal fields accept both German and English input.
    const sessionBase = {
      user_id: user.id,
      session_timestamp: parseDateInputAsUtc(values.session_timestamp),
      charging_type: values.charging_type,
      kwh_billed: parseFloat(values.kwh_billed.replace(',', '.')),
      kwh_added: values.kwh_added ? parseFloat(values.kwh_added.replace(',', '.')) : undefined,
      start_soc_percentage: values.start_soc_percentage ? parseInt(values.start_soc_percentage) : undefined,
      end_soc_percentage: values.end_soc_percentage ? parseInt(values.end_soc_percentage) : undefined,
      odometer_km: values.odometer_km ? parseInt(values.odometer_km) : undefined,
      notes: values.notes,
    };

    if (values.pricing_source === 'chargingPlan') {
      const providerId = values.provider_id;
      if (!providerId) return;
      const provider = providers.find(p => p.id === providerId);
      if (!provider) return;
      const chargingPlan = chargingPlans.find((plan) => plan.id === values.charging_plan_id);
      if (!chargingPlan) return;
      const sessionDate = parseDateInputAsUtc(values.session_timestamp);
      const snapshot = buildTariffPriceSnapshot(chargingPlan, provider.name, values.pricing_mode, values.charging_type);
      const activeSelection = await getActivePlanSelectionAt(providerId, sessionDate);
      const planSelection = (!activeSelection || activeSelection.tariff_plan_id !== chargingPlan.id)
        ? await setActivePlanSelection({
          userId: user.id,
          providerId,
          tariffPlanId: chargingPlan.id,
          validFrom: sessionDate,
          priceSnapshot: snapshot
        })
        : activeSelection;
      const session = prepareSession(
        {
          ...sessionBase,
          provider_id: providerId,
          session_mode: 'plan',
          tariff_plan_id: chargingPlan.id,
          plan_selection_id: planSelection.id,
          price_snapshot: snapshot,
          pricing_source: 'chargingPlan',
          pricing_context: values.pricing_mode,
          charging_plan_id: chargingPlan.id,
        },
        chargingPlan,
        provider
      );
      await onSubmit(session);
      return;
    }

    const pricePerKwh = parseDecimalToCents(values.ad_hoc_price_per_kwh);
    if (pricePerKwh == null) {
      return;
    }
    const sessionFee = parseDecimalToCents(values.ad_hoc_session_fee);
    const otherFeesAmount = parseDecimalToCents(values.ad_hoc_other_fees);

    const session = prepareSession({
      ...sessionBase,
      provider_id: null,
      session_mode: 'adHoc',
      tariff_plan_id: null,
      plan_selection_id: null,
      price_snapshot: {
        label: 'Ad-Hoc',
        kWhPrice: pricePerKwh,
        sessionFee: sessionFee,
        blockingFee: otherFeesAmount
      },
      pricing_source: 'adHoc',
      pricing_context: 'ad_hoc',
      ad_hoc_pricing: {
        cpoName: values.cpo_name?.trim() || null,
        pricePerKwh,
        pricePerSession: sessionFee,
        receiptUrl: values.ad_hoc_receipt_url || null,
        notes: values.notes || null,
        otherFees: otherFeesAmount == null ? undefined : [{ label: 'Other fees', amount: otherFeesAmount }],
      },
    });
    await onSubmit(session);
  };

  return (
    <Slab>
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-primary">
          {initialValues?.id ? 'Edit Session' : 'New Session'}
        </h2>
        <button
          onClick={onCancel}
          className="p-2 text-secondary/40 hover:text-secondary rounded-full hover:bg-secondary/10 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Cancel"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-8" noValidate>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Date */}
          <div className="flex flex-col">
            <label htmlFor="session_timestamp" className="text-[13px] font-medium text-secondary uppercase tracking-wider mb-1">
              Date
            </label>
            <div className="relative border-b border-secondary/20 focus-within:border-accent transition-colors duration-300">
              <button
                type="button"
                onClick={openNativeDatePicker}
                className="w-full py-1 min-h-[44px] flex items-center text-left"
                aria-label="Open session picker"
              >
                <Calendar className="w-5 h-5 mr-2 text-secondary/40 shrink-0" />
                <span className="flex-1 text-primary text-xl font-medium tabular-nums">
                  {sessionDateLabel}
                </span>
                <Calendar className="w-5 h-5 text-primary shrink-0" />
              </button>
              <input
                id="session_timestamp"
                type="date"
                name={sessionDateField.name}
                onChange={sessionDateField.onChange}
                onBlur={sessionDateField.onBlur}
                ref={(element) => {
                  sessionDateField.ref(element);
                  hiddenDateInputRef.current = element;
                }}
                className="absolute opacity-0 pointer-events-none w-px h-px"
                tabIndex={-1}
                aria-hidden="true"
              />
            </div>
            {errors.session_timestamp && (
              <p className="text-sm text-red-500 font-medium mt-1.5">{errors.session_timestamp.message}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Pricing source */}
          <Controller
            name="pricing_source"
            control={control}
            render={({ field }) => (
              <TactileMatrix
                label="Pricing Source"
                value={field.value}
                onChange={field.onChange}
                options={[
                  { label: 'Charging Plan', value: 'chargingPlan' },
                  { label: 'Ad-Hoc', value: 'adHoc' },
                ]}
              />
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {selectedPricingSource === 'chargingPlan' ? (
            <>
              {/* Charging Plan Provider */}
              <div className="flex flex-col">
                <label htmlFor="provider_id" className="text-[13px] font-medium text-secondary uppercase tracking-wider mb-1">
                  Charging Plan Provider
                </label>
                <select
                  id="provider_id"
                  {...register('provider_id')}
                  className={`w-full px-0 py-2 border-b border-secondary/20 focus:border-accent outline-none bg-transparent text-xl font-medium min-h-[44px] transition-colors ${
                    selectedProviderId ? 'text-primary' : 'text-primary/70'
                  }`}
                >
                  <option value="">Select Charging Provider</option>
                  {providers.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {errors.provider_id && (
                  <p className="text-sm text-red-500 font-medium mt-1.5">{errors.provider_id.message}</p>
                )}
              </div>

              {/* Plan */}
              <div className="flex flex-col">
                <label htmlFor="charging_plan_id" className="text-[13px] font-medium text-secondary uppercase tracking-wider mb-1">
                  Plan
                </label>
                <select
                  id="charging_plan_id"
                  {...register('charging_plan_id')}
                  disabled={!selectedProviderId || providerPlans.length === 0}
                  className={`w-full px-0 py-2 border-b border-secondary/20 focus:border-accent outline-none bg-transparent text-xl font-medium min-h-[44px] transition-colors disabled:text-secondary/55 disabled:cursor-not-allowed ${
                    selectedPlanId ? 'text-primary' : 'text-primary/70'
                  }`}
                >
                  <option
                    value=""
                    disabled={Boolean(selectedProviderId && providerPlans.length > 0)}
                  >
                    Select Plan
                  </option>
                  {providerPlans.map(plan => (
                      <option key={plan.id} value={plan.id}>{plan.plan_name}</option>
                    ))}
                </select>
                {errors.charging_plan_id && (
                  <p className="text-sm text-red-500 font-medium mt-1.5">{errors.charging_plan_id.message}</p>
                )}
              </div>

              <Controller
                name="pricing_mode"
                control={control}
                render={({ field }) => (
                  <TactileMatrix
                    label="Pricing Mode"
                    value={field.value}
                    onChange={field.onChange}
                    options={[
                      { label: 'Domestic', value: 'standard' },
                      { label: 'Roaming', value: 'roaming' },
                    ]}
                  />
                )}
              />
            </>
          ) : (
            <>
              <ThinInput
                label="CPO/Operator"
                type="text"
                placeholder="Operator name"
                {...register('cpo_name')}
                error={errors.cpo_name?.message}
              />
            </>
          )}
        </div>

        {selectedPricingSource === 'adHoc' && (
          <div className="flex flex-col gap-8">
            <ThinInput
              label="Price per kWh"
              unit="EUR"
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              {...register('ad_hoc_price_per_kwh')}
              error={errors.ad_hoc_price_per_kwh?.message}
            />
            <ThinInput
              label="Session fee"
              unit="EUR"
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              {...register('ad_hoc_session_fee')}
            />
            <ThinInput
              label="Receipt URL"
              type="url"
              placeholder="https://..."
              {...register('ad_hoc_receipt_url')}
              error={errors.ad_hoc_receipt_url?.message}
            />
            <ThinInput
              label="Other fees"
              unit="EUR"
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              {...register('ad_hoc_other_fees')}
            />
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Charging Type */}
          <Controller
            name="charging_type"
            control={control}
            render={({ field }) => (
              <TactileMatrix
                label="Charging Type"
                value={field.value}
                onChange={field.onChange}
                options={[
                  { label: 'AC', value: 'AC' },
                  { label: 'DC', value: 'DC' },
                ]}
              />
            )}
          />

          {/* Spacer for consistent grid rhythm */}
          <div className="flex flex-col">
            <div className="hidden md:block h-full" />
          </div>
        </div>

        <div className="flex flex-col gap-8">
          {/* kWh Billed */}
          <ThinInput
            label="kWh Billed"
            unit="kWh"
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            {...register('kwh_billed')}
            error={errors.kwh_billed?.message}
          />

          {/* kWh Added */}
          <ThinInput
            label="kWh Added"
            unit="kWh"
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            {...register('kwh_added')}
            error={errors.kwh_added?.message}
          />

          {/* Odometer */}
          <ThinInput
            label="Odometer"
            unit="km"
            type="text"
            inputMode="numeric"
            placeholder="0"
            {...register('odometer_km')}
            error={errors.odometer_km?.message}
          />

          {/* Start SoC */}
          <ThinInput
            label="Start SoC"
            unit="%"
            type="text"
            inputMode="numeric"
            placeholder="20"
            {...register('start_soc_percentage')}
            error={errors.start_soc_percentage?.message}
          />

          {/* End SoC */}
          <ThinInput
            label="End SoC"
            unit="%"
            type="text"
            inputMode="numeric"
            placeholder="80"
            {...register('end_soc_percentage')}
            error={errors.end_soc_percentage?.message}
          />
        </div>

        {/* Notes */}
        <div className="flex flex-col">
          <label htmlFor="notes" className="text-[13px] font-medium text-secondary uppercase tracking-wider mb-1 flex items-center">
            <FileText className="w-4 h-4 mr-1 text-secondary/40" />
            Notes
          </label>
          <textarea
            id="notes"
            {...register('notes')}
            rows={2}
            className="w-full px-0 py-2 border-b border-secondary/20 focus:border-accent outline-none bg-transparent text-lg transition-colors resize-none"
            placeholder="Optional notes..."
          />
        </div>

        <div className="pt-6 flex flex-col sm:flex-row gap-4">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 flex items-center justify-center py-4 px-6 bg-accent text-white font-bold rounded-xl hover:opacity-90 transition-all disabled:opacity-50 min-h-[56px] shadow-lg shadow-accent/20"
          >
            {isSubmitting ? (
              <div className="w-5 h-5 border-2 border-surface/30 border-t-surface rounded-full animate-spin mr-2" />
            ) : (
              <Save className="w-5 h-5 mr-2" />
            )}
            Save Session
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
