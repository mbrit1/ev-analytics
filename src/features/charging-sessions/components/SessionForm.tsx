import React from 'react';
import { useForm, Controller, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Save, X, FileText } from 'lucide-react';
import {
  buildLogicalTariffs,
  getActivePlanSelectionAt,
  getLogicalTariffKey,
  parseUtcDateInput,
  type SetActivePlanSelectionInput,
  useChargingPlans,
  useProviders,
} from '../../charging-plans';
import { useAuth } from '../../auth';
import { type ChargingPlan, type ChargingSession, type TariffPriceSnapshot } from '../../../infra/db';
import {
  prepareSession,
  prepareSessionEdit,
  type SessionPersistenceRequest,
} from '../services/sessionService';
import { DatePicker, Slab } from '../../../shared/ui';
import { ThinInput } from '../../../shared/ui';
import { TactileMatrix } from '../../../shared/ui';
import { formatCurrency } from '../../../shared/lib/utils';

/**
 * Browser form values are kept as strings so react-hook-form can preserve
 * partially typed decimal input before validation converts it to domain data.
 */
const sessionSchema = z.object({
  /** Date-only input; converted to a Date when the session is prepared. */
  session_timestamp: z.string().min(1, 'Date is required'),
  /** Selected provider determines the available tariff options in plan mode. */
  provider_id: z.string(),
  session_mode: z.enum(['plan', 'ad_hoc']),
  /** Selected logical tariff resolves to a raw version on the chosen date. */
  logical_tariff_key: z.string().optional(),
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
  const billedKwh = Number.parseFloat(values.kwh_billed.replace(',', '.'));
  if (!Number.isFinite(billedKwh) || billedKwh <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['kwh_billed'],
      message: 'Must be greater than 0',
    });
  }

  if (values.kwh_added) {
    const addedKwh = Number.parseFloat(values.kwh_added.replace(',', '.'));
    if (!Number.isFinite(addedKwh) || addedKwh < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['kwh_added'],
        message: 'Must be 0 or greater',
      });
    }
  }

  if (values.start_soc_percentage && values.end_soc_percentage) {
    const startSoc = Number.parseInt(values.start_soc_percentage, 10);
    const endSoc = Number.parseInt(values.end_soc_percentage, 10);
    if (Number.isFinite(startSoc) && Number.isFinite(endSoc) && endSoc < startSoc) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end_soc_percentage'],
        message: 'End SoC must be greater than or equal to Start SoC',
      });
    }
  }

  if (values.session_mode === 'plan') {
    if (!values.provider_id.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['provider_id'],
        message: 'Provider is required',
      });
    }

    if (!values.logical_tariff_key) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['logical_tariff_key'],
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

type ChargingRateValue = 'AC_standard' | 'DC_standard' | 'AC_roaming' | 'DC_roaming';

const chargingRateOptions: Array<{
  label: string;
  value: ChargingRateValue;
  chargingType: SessionFormValues['charging_type'];
  pricingMode: SessionFormValues['pricing_mode'];
  getPrice: (plan: ChargingPlan) => number | null | undefined;
}> = [
  { label: 'Domestic AC', value: 'AC_standard', chargingType: 'AC', pricingMode: 'standard', getPrice: (plan) => plan.ac_price_per_kwh },
  { label: 'Roaming AC', value: 'AC_roaming', chargingType: 'AC', pricingMode: 'roaming', getPrice: (plan) => plan.roaming_ac_price_per_kwh },
  { label: 'Domestic DC', value: 'DC_standard', chargingType: 'DC', pricingMode: 'standard', getPrice: (plan) => plan.dc_price_per_kwh },
  { label: 'Roaming DC', value: 'DC_roaming', chargingType: 'DC', pricingMode: 'roaming', getPrice: (plan) => plan.roaming_dc_price_per_kwh },
];

function toChargingRateValue(
  chargingType: SessionFormValues['charging_type'],
  pricingMode: SessionFormValues['pricing_mode']
): ChargingRateValue {
  return `${chargingType}_${pricingMode}` as ChargingRateValue;
}

function parseChargingRateValue(value: string): typeof chargingRateOptions[number] {
  const option = chargingRateOptions.find((candidate) => candidate.value === value);
  if (!option) {
    return chargingRateOptions[0];
  }
  return option;
}

function buildChargingRateOptions(plan?: ChargingPlan): Array<{
  label: string;
  secondaryLabel: string;
  value: ChargingRateValue;
}> {
  if (!plan) {
    return [];
  }

  return chargingRateOptions.flatMap((option) => {
    const price = option.getPrice(plan);
    if (price == null) {
      return [];
    }

    return [{
      label: option.label,
      secondaryLabel: `${formatCurrency(price)}/kWh`,
      value: option.value,
    }];
  });
}

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

function resolveSubmittedSessionTimestamp(
  dateInput: string,
  existingSession?: ChargingSession
): Date {
  if (
    existingSession
    && formatDateInputValue(existingSession.session_timestamp) === dateInput
  ) {
    return existingSession.session_timestamp;
  }

  return parseDateInputAsUtc(dateInput);
}

function resolveInitialPricingSource(initialValues?: LegacySessionInitialValues): SessionFormValues['session_mode'] {
  if (initialValues?.session_mode) {
    return initialValues.session_mode;
  }
  if (initialValues?.pricing_context === 'ad_hoc') {
    return 'ad_hoc';
  }
  return 'plan';
}

function resolveInitialPricingMode(initialValues?: LegacySessionInitialValues): SessionFormValues['pricing_mode'] {
  if (resolveInitialPricingSource(initialValues) === 'ad_hoc') {
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

function formatDecimalInputValue(value?: number): string {
  return value == null ? '' : value.toString().replace('.', ',');
}

function resolveInitialLogicalKey(
  initialValues: LegacySessionInitialValues | undefined,
  plans: ChargingPlan[]
): string {
  if (resolveInitialPricingSource(initialValues) === 'ad_hoc') {
    return '';
  }

  const rawPlanId = initialValues?.tariff_plan_id ?? initialValues?.tariff_id;
  if (!rawPlanId) {
    return '';
  }

  const plan = plans.find((candidate) => candidate.id === rawPlanId);
  return plan ? getLogicalTariffKey(plan) : `historical::${rawPlanId}`;
}

function resolvePlanSnapshotKwhPrice(
  plan: ChargingPlan,
  pricingMode: SessionFormValues['pricing_mode'],
  chargingType: SessionFormValues['charging_type']
): number {
  if (pricingMode === 'roaming') {
    const roamingPrice = chargingType === 'AC'
      ? plan.roaming_ac_price_per_kwh
      : plan.roaming_dc_price_per_kwh;
    if (roamingPrice == null) {
      throw new Error(`No matching roaming ${chargingType} price for selected charging plan`);
    }
    return roamingPrice;
  }

  const domesticPrice = chargingType === 'AC'
    ? plan.ac_price_per_kwh
    : plan.dc_price_per_kwh;
  if (domesticPrice == null) {
    throw new Error(`No matching domestic ${chargingType} price for selected charging plan`);
  }
  return domesticPrice;
}

function buildTariffPriceSnapshot(
  plan: ChargingPlan,
  providerName: string,
  pricingMode: SessionFormValues['pricing_mode'],
  chargingType: SessionFormValues['charging_type']
): TariffPriceSnapshot {
  return {
    label: `${providerName} ${plan.name}`,
    kWhPrice: resolvePlanSnapshotKwhPrice(plan, pricingMode, chargingType),
    sessionFee: plan.session_fee
  };
}

function hasPlanPriceForMode(
  plan: ChargingPlan,
  pricingMode: SessionFormValues['pricing_mode'],
  chargingType: SessionFormValues['charging_type']
): boolean {
  if (pricingMode === 'roaming') {
    return chargingType === 'AC'
      ? plan.roaming_ac_price_per_kwh != null
      : plan.roaming_dc_price_per_kwh != null;
  }

  return chargingType === 'AC'
    ? plan.ac_price_per_kwh != null
    : plan.dc_price_per_kwh != null;
}

interface SessionFormProps {
  /** Persists the prepared session plus any atomic plan-selection change. */
  onSubmit: (request: SessionPersistenceRequest) => Promise<void>;
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
  const { planVersions } = useChargingPlans();
  const { providers } = useProviders();
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  const hasUserChangedProviderRef = React.useRef(false);
  const hasUserChangedLogicalSelectionRef = React.useRef(false);

  const initialAdHocOtherFeesTotal = React.useMemo(() => {
    return initialValues?.ad_hoc_pricing?.otherFees?.reduce((sum, fee) => sum + fee.amount, 0) ?? 0;
  }, [initialValues]);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    getValues,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<SessionFormValues>({
    resolver: zodResolver(sessionSchema),
    defaultValues: {
      session_timestamp: initialValues?.session_timestamp 
        ? formatDateInputValue(initialValues.session_timestamp)
        : formatDateInputValue(new Date()),
      charging_type: (initialValues?.charging_type as SessionFormValues['charging_type']) || 'AC',
      session_mode: resolveInitialPricingSource(legacyInitialValues),
      pricing_mode: resolveInitialPricingMode(legacyInitialValues),
      start_soc_percentage: initialValues?.start_soc_percentage?.toString() || '',
      end_soc_percentage: initialValues?.end_soc_percentage?.toString() || '',
      provider_id: initialValues?.provider_id || '',
      logical_tariff_key: '',
      kwh_billed: formatDecimalInputValue(initialValues?.kwh_billed),
      kwh_added: formatDecimalInputValue(initialValues?.kwh_added),
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
      ad_hoc_other_fees: initialAdHocOtherFeesTotal > 0
        ? (initialAdHocOtherFeesTotal / 100).toFixed(2).replace('.', ',')
        : '',
    },
  });

  const selectedProviderId = useWatch({ control, name: 'provider_id' });
  const selectedPricingSource = useWatch({ control, name: 'session_mode' });
  const selectedLogicalTariffKey = useWatch({ control, name: 'logical_tariff_key' });
  const selectedChargingType = useWatch({ control, name: 'charging_type' });
  const selectedPricingMode = useWatch({ control, name: 'pricing_mode' });
  const selectedSessionDate = useWatch({ control, name: 'session_timestamp' });
  const isEditMode = Boolean(initialValues?.id);
  const existingSession = isEditMode ? initialValues as ChargingSession : undefined;
  const closeActionLabel = isEditMode ? 'Close session editor' : 'Close new session form';
  const cancelActionLabel = isEditMode ? 'Discard changes' : 'Back to history';
  const pricingSourceLabel = selectedPricingSource === 'ad_hoc' ? 'Ad-Hoc' : 'Charging Plan';
  const isChargingPlanPricing = selectedPricingSource === 'plan';
  const providerPlans = React.useMemo(
    () => planVersions.filter(plan => plan.provider_id === selectedProviderId),
    [planVersions, selectedProviderId]
  );
  const resolvedSelectedSessionDate = selectedSessionDate || formatDateInputValue(new Date());
  const logicalTariffsForProvider = React.useMemo(
    () => buildLogicalTariffs(providerPlans, parseUtcDateInput(resolvedSelectedSessionDate)),
    [providerPlans, resolvedSelectedSessionDate]
  );
  const initialLogicalKey = React.useMemo(
    () => resolveInitialLogicalKey(legacyInitialValues, planVersions),
    [legacyInitialValues, planVersions]
  );
  const isUsingExistingProviderSelection = Boolean(
    existingSession && selectedProviderId === existingSession.provider_id
  );
  const hasHistoricalProviderFallback = Boolean(
    existingSession
    && !providers.some((provider) => provider.id === existingSession.provider_id)
  );
  const historicalLogicalTariffKey = existingSession?.tariff_plan_id
    ? `historical::${existingSession.tariff_plan_id}`
    : '';
  const hasHistoricalPlanFallback = Boolean(
    existingSession?.tariff_plan_id
    && isUsingExistingProviderSelection
    && !providerPlans.some((plan) => plan.id === existingSession.tariff_plan_id)
  );
  const selectedLogicalTariff = React.useMemo(
    () => logicalTariffsForProvider.find((logical) => logical.key === selectedLogicalTariffKey),
    [logicalTariffsForProvider, selectedLogicalTariffKey]
  );
  const effectivePlan = selectedLogicalTariff?.currentVersion ?? null;
  const isHistoricalLogicalSelection = Boolean(
    historicalLogicalTariffKey && selectedLogicalTariffKey === historicalLogicalTariffKey
  );
  const selectablePlanCount = logicalTariffsForProvider.length + (hasHistoricalPlanFallback ? 1 : 0);
  const shouldDisablePlanSelect = selectedPricingSource === 'plan'
    && selectablePlanCount <= 1;
  const selectedChargingRate = toChargingRateValue(selectedChargingType, selectedPricingMode);
  const planRateOptions = React.useMemo(
    () => buildChargingRateOptions(effectivePlan ?? undefined),
    [effectivePlan]
  );
  const logicalTariffGapMessage = (
    isChargingPlanPricing
    && Boolean(selectedLogicalTariffKey)
    && Boolean(selectedLogicalTariff)
    && !isHistoricalLogicalSelection
    && !effectivePlan
  )
    ? 'No tariff version applies on the selected date'
    : undefined;
  const hasGapSelectionError = errors.logical_tariff_key?.message === 'No tariff version applies on the selected date';
  const providerErrorId = errors.provider_id ? 'session-provider-error' : undefined;
  const planErrorId = errors.logical_tariff_key ? 'session-plan-error' : undefined;
  const planGapMessageId = !errors.logical_tariff_key && logicalTariffGapMessage
    ? 'session-plan-gap-message'
    : undefined;
  const planDescribedBy = [planErrorId, planGapMessageId].filter(Boolean).join(' ') || undefined;

  React.useEffect(() => {
    if (
      hasGapSelectionError
      && (
        selectedPricingSource !== 'plan'
        || !selectedLogicalTariffKey
        || isHistoricalLogicalSelection
        || effectivePlan
      )
    ) {
      clearErrors('logical_tariff_key');
    }
  }, [
    clearErrors,
    effectivePlan,
    hasGapSelectionError,
    isHistoricalLogicalSelection,
    selectedLogicalTariffKey,
    selectedPricingSource,
  ]);

  React.useEffect(() => {
    if (selectedPricingSource === 'ad_hoc') {
      if (getValues('logical_tariff_key')) {
        setValue('logical_tariff_key', '');
      }
      return;
    }

    const currentLogicalKey = getValues('logical_tariff_key');

    if (!selectedProviderId) {
      if (currentLogicalKey) {
        setValue('logical_tariff_key', '');
      }
      return;
    }

    const currentLogicalTariffStillValid = logicalTariffsForProvider.some(
      (logicalTariff) => logicalTariff.key === currentLogicalKey
    );
    const isPersistedHistoricalSelection = hasHistoricalPlanFallback
      && historicalLogicalTariffKey === currentLogicalKey;
    if (currentLogicalTariffStillValid || isPersistedHistoricalSelection) {
      return;
    }

    if (logicalTariffsForProvider.length === 1) {
      setValue('logical_tariff_key', logicalTariffsForProvider[0].key, { shouldDirty: true });
      return;
    }

    setValue('logical_tariff_key', '');
  }, [
    existingSession,
    selectedPricingSource,
    selectedProviderId,
    getValues,
    hasHistoricalPlanFallback,
    historicalLogicalTariffKey,
    logicalTariffsForProvider,
    setValue,
  ]);

  React.useEffect(() => {
    if (selectedPricingSource !== 'plan') {
      return;
    }

    const initialProviderId = legacyInitialValues?.provider_id;
    const initialRawPlanId = legacyInitialValues?.tariff_plan_id ?? legacyInitialValues?.tariff_id;
    if (!initialProviderId || !initialRawPlanId) {
      return;
    }

    if (getValues('provider_id') !== initialProviderId) {
      return;
    }

    if (hasUserChangedProviderRef.current || hasUserChangedLogicalSelectionRef.current) {
      return;
    }

    const currentLogicalKey = getValues('logical_tariff_key');
    if (
      currentLogicalKey
      && !['', `historical::${initialRawPlanId}`, initialLogicalKey].includes(currentLogicalKey)
    ) {
      return;
    }

    if (currentLogicalKey !== initialLogicalKey) {
      setValue('logical_tariff_key', initialLogicalKey, { shouldDirty: false });
    }
  }, [
    getValues,
    initialLogicalKey,
    legacyInitialValues,
    selectedPricingSource,
    setValue,
  ]);

  React.useEffect(() => {
    if (selectedPricingSource !== 'plan') {
      return;
    }

    if (!effectivePlan) {
      return;
    }

    const currentChargingType = getValues('charging_type');
    const currentPricingMode = getValues('pricing_mode');
    const currentOption = parseChargingRateValue(toChargingRateValue(currentChargingType, currentPricingMode));
    if (hasPlanPriceForMode(effectivePlan, currentOption.pricingMode, currentOption.chargingType)) {
      return;
    }

    const nextOption = chargingRateOptions.find((option) => (
      hasPlanPriceForMode(effectivePlan, option.pricingMode, option.chargingType)
    ));

    if (!nextOption) {
      return;
    }

    if (nextOption.chargingType !== currentChargingType) {
      setValue('charging_type', nextOption.chargingType, { shouldDirty: true });
    }
    if (nextOption.pricingMode !== currentPricingMode) {
      setValue('pricing_mode', nextOption.pricingMode, { shouldDirty: true });
    }
  }, [effectivePlan, getValues, selectedPricingSource, setValue]);

  React.useLayoutEffect(() => {
    const heading = headingRef.current;
    if (!heading) {
      return;
    }

    heading.scrollIntoView({ block: 'start', behavior: 'auto' });
    heading.focus({ preventScroll: true });
  }, []);

  const handleFormSubmit = async (values: SessionFormValues) => {
    clearErrors('root.submit');

    try {
      // A session must belong to the active user; unauthenticated renders should
      // not be able to create orphaned local records.
      if (!user) return;

      const sessionTimestamp = resolveSubmittedSessionTimestamp(
        values.session_timestamp,
        existingSession
      );

      // Convert browser-friendly strings into the numeric domain fields expected
      // by prepareSession. Decimal fields accept both German and English input.
      const sessionBase = {
        user_id: user.id,
        session_timestamp: sessionTimestamp,
        charging_type: values.charging_type,
        kwh_billed: parseFloat(values.kwh_billed.replace(',', '.')),
        kwh_added: values.kwh_added ? parseFloat(values.kwh_added.replace(',', '.')) : undefined,
        start_soc_percentage: values.start_soc_percentage ? parseInt(values.start_soc_percentage) : undefined,
        end_soc_percentage: values.end_soc_percentage ? parseInt(values.end_soc_percentage) : undefined,
        odometer_km: values.odometer_km ? parseInt(values.odometer_km) : undefined,
        notes: values.notes,
      };

      const providerId = values.provider_id;

      if (values.session_mode === 'plan') {
        if (!providerId) return;
        if (!values.logical_tariff_key) {
          setError('logical_tariff_key', {
            type: 'manual',
            message: 'Plan is required',
          });
          return;
        }

        const planSelectionDate = parseDateInputAsUtc(values.session_timestamp);
        const visibleDateMatchesExisting = Boolean(
          existingSession
          && formatDateInputValue(existingSession.session_timestamp) === values.session_timestamp
        );
        const planIdentityIsUnchanged = Boolean(
          existingSession
          && providerId === existingSession.provider_id
          && values.logical_tariff_key === initialLogicalKey
          && visibleDateMatchesExisting
          && values.charging_type === existingSession.charging_type
          && values.pricing_mode === (existingSession.pricing_context ?? 'standard')
        );
        const planInput = {
          ...sessionBase,
          provider_id: providerId,
          session_mode: 'plan' as const,
          pricing_context: values.pricing_mode,
        };

        if (existingSession && planIdentityIsUnchanged) {
          await onSubmit({
            session: prepareSessionEdit(existingSession, {
              ...planInput,
              tariff_plan_id: existingSession.tariff_plan_id!,
              plan_selection_id: existingSession.plan_selection_id,
              price_snapshot: existingSession.price_snapshot,
            }),
          });
          return;
        }

        const provider = providers.find((candidate) => candidate.id === providerId);
        if (!effectivePlan) {
          setError('logical_tariff_key', {
            type: 'manual',
            message: 'No tariff version applies on the selected date',
          });
          return;
        }

        if (!provider) {
          throw new Error('Select an active provider and charging plan to change historical pricing');
        }

        const snapshot = buildTariffPriceSnapshot(
          effectivePlan,
          provider.name,
          values.pricing_mode,
          values.charging_type
        );
        const activeSelection = await getActivePlanSelectionAt(providerId, user.id, planSelectionDate);
        // Logical tariff selection is date-derived in the browser, but
        // provider-plan selection history still persists the raw effective plan id.
        const planSelectionChange = (!activeSelection || activeSelection.tariff_plan_id !== effectivePlan.id)
          ? {
            userId: user.id,
            providerId,
            tariffPlanId: effectivePlan.id,
            validFrom: planSelectionDate,
            priceSnapshot: snapshot,
          } satisfies SetActivePlanSelectionInput
          : undefined;
        const input = {
          ...planInput,
          tariff_plan_id: effectivePlan.id,
          plan_selection_id: activeSelection?.tariff_plan_id === effectivePlan.id ? activeSelection.id : undefined,
          price_snapshot: snapshot,
        };
        const session = existingSession
          ? prepareSessionEdit(existingSession, input, effectivePlan, provider)
          : prepareSession(input, effectivePlan, provider);
        await onSubmit({
          session,
          planSelectionChange,
        });
        return;
      }

      const pricePerKwh = parseDecimalToCents(values.ad_hoc_price_per_kwh);
      if (pricePerKwh == null) {
        return;
      }
      const sessionFee = parseDecimalToCents(values.ad_hoc_session_fee);
      const otherFeesAmount = parseDecimalToCents(values.ad_hoc_other_fees);
      const shouldPreserveExistingOtherFees = existingSession?.session_mode === 'ad_hoc'
        && (otherFeesAmount ?? 0) === initialAdHocOtherFeesTotal;
      const otherFees = shouldPreserveExistingOtherFees
        ? existingSession.ad_hoc_pricing?.otherFees
        : otherFeesAmount == null
          ? undefined
          : [{ label: 'Other fees', amount: otherFeesAmount }];
      const selectedBillingProvider = providers.find((candidate) => candidate.id === providerId);
      const billingProviderName = selectedBillingProvider?.name
        ?? (existingSession?.session_mode === 'ad_hoc'
          ? existingSession.provider_name_snapshot
          : undefined);
      if (!billingProviderName) {
        throw new Error('Select a billing provider');
      }

      const input = {
        ...sessionBase,
        session_mode: 'ad_hoc' as const,
        tariff_plan_id: null,
        plan_selection_id: null,
        billing_provider_name: billingProviderName,
        cpo_name: values.cpo_name,
        price_snapshot: {
          label: 'Ad-Hoc',
          kWhPrice: pricePerKwh,
          sessionFee: sessionFee,
          blockingFee: otherFeesAmount,
        },
        pricing_context: 'ad_hoc' as const,
        ad_hoc_pricing: {
          pricePerKwh,
          pricePerSession: sessionFee,
          receiptUrl: values.ad_hoc_receipt_url || null,
          notes: values.notes || null,
          otherFees,
        },
      };
      const session = existingSession
        ? prepareSessionEdit(existingSession, input)
        : prepareSession(input);
      await onSubmit({ session });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save session. Please try again.';
      setError('root.submit', {
        type: 'server',
        message,
      });
    }
  };

  return (
    <Slab>
      <div className="flex items-center justify-between mb-8">
        <div className="flex flex-col">
          <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-primary">
            {initialValues?.id ? 'Edit Session' : 'New Session'}
          </h2>
          <p className="text-sm text-secondary mt-1">
            <span className="text-primary font-medium" aria-hidden="true">*</span> Required fields
          </p>
        </div>
        <button
          onClick={onCancel}
          className="p-2 text-secondary/40 hover:text-secondary rounded-full hover:bg-secondary/10 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label={closeActionLabel}
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-8" noValidate>
        {errors.root?.submit?.message && (
          <p role="alert" className="text-sm text-red-500 font-medium">
            {errors.root.submit.message}
          </p>
        )}
        <input type="hidden" {...register('charging_type')} />
        <input type="hidden" {...register('pricing_mode')} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Controller
            name="session_timestamp"
            control={control}
            render={({ field }) => (
              <DatePicker
                label="Date"
                value={field.value}
                onChange={field.onChange}
                required
                requiredIndicator
                error={errors.session_timestamp?.message}
              />
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Pricing source */}
          {isEditMode ? (
            <div className="flex flex-col">
              <span className="text-[13px] font-medium text-secondary uppercase tracking-wider mb-1">
                Pricing Source
              </span>
              <div className="min-h-[44px] border-b border-secondary/20 py-2 text-xl font-medium text-primary">
                {pricingSourceLabel}
              </div>
            </div>
          ) : (
            <Controller
              name="session_mode"
              control={control}
              render={({ field }) => (
                <TactileMatrix
                  label="Pricing Source"
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    { label: 'Charging Plan', value: 'plan' },
                    { label: 'Ad-Hoc', value: 'ad_hoc' },
                  ]}
                />
              )}
            />
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {selectedPricingSource === 'plan' ? (
            <>
              {/* Provider */}
              <div className="flex flex-col">
                <label htmlFor="provider_id" className="text-[13px] font-medium text-secondary uppercase tracking-wider mb-1">
                  Provider <span className="text-primary" aria-hidden="true">*</span>
                </label>
                <Controller
                  name="provider_id"
                  control={control}
                  render={({ field }) => (
                    <select
                      id="provider_id"
                      {...field}
                      onChange={(event) => {
                        hasUserChangedProviderRef.current = true;
                        field.onChange(event);
                      }}
                      required
                      aria-required="true"
                      aria-invalid={errors.provider_id ? 'true' : 'false'}
                      aria-describedby={providerErrorId}
                      className={`w-full px-0 py-2 border-b border-secondary/20 focus:border-accent outline-none bg-transparent text-xl font-medium min-h-[44px] transition-colors ${
                        selectedProviderId ? 'text-primary' : 'text-primary/70'
                      }`}
                    >
                      <option value="">Select Provider</option>
                      {hasHistoricalProviderFallback && existingSession && (
                          <option value={existingSession.provider_id ?? undefined}>
                          {existingSession.provider_name_snapshot}
                        </option>
                      )}
                      {providers.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  )}
                />
                {errors.provider_id && (
                  <p id={providerErrorId} className="text-sm text-red-500 font-medium mt-1.5">{errors.provider_id.message}</p>
                )}
              </div>

              {/* Plan */}
              <div className="flex flex-col">
                <label htmlFor="logical_tariff_key" className="text-[13px] font-medium text-secondary uppercase tracking-wider mb-1">
                  Plan <span className="text-primary" aria-hidden="true">*</span>
                </label>
                <Controller
                  name="logical_tariff_key"
                  control={control}
                  render={({ field }) => (
                    <select
                      id="logical_tariff_key"
                      {...field}
                      onChange={(event) => {
                        hasUserChangedLogicalSelectionRef.current = true;
                        field.onChange(event);
                      }}
                      required={isChargingPlanPricing}
                      aria-required={isChargingPlanPricing ? 'true' : 'false'}
                      aria-invalid={errors.logical_tariff_key ? 'true' : 'false'}
                      aria-describedby={planDescribedBy}
                      disabled={shouldDisablePlanSelect}
                      className={`w-full px-0 py-2 border-b border-secondary/20 focus:border-accent outline-none bg-transparent text-xl font-medium min-h-[44px] transition-colors disabled:text-secondary/55 disabled:cursor-not-allowed ${
                        selectedLogicalTariffKey ? 'text-primary' : 'text-primary/70'
                      }`}
                    >
                      <option
                        value=""
                        disabled={Boolean(selectedProviderId && selectablePlanCount > 0)}
                      >
                        Select Plan
                      </option>
                      {hasHistoricalPlanFallback && historicalLogicalTariffKey && (
                        <option value={historicalLogicalTariffKey}>
                          {existingSession?.charging_plan_name_snapshot
                            ?? existingSession?.price_snapshot?.label
                            ?? 'Historical Plan'}
                        </option>
                      )}
                      {logicalTariffsForProvider.map((logicalTariff) => (
                        <option key={logicalTariff.key} value={logicalTariff.key}>
                          {logicalTariff.name || 'Unnamed tariff'}
                        </option>
                      ))}
                    </select>
                  )}
                />
                {errors.logical_tariff_key && (
                  <p id={planErrorId} className="text-sm text-red-500 font-medium mt-1.5">{errors.logical_tariff_key.message}</p>
                )}
                {!errors.logical_tariff_key && logicalTariffGapMessage && (
                  <p id={planGapMessageId} className="text-sm text-red-500 font-medium mt-1.5">{logicalTariffGapMessage}</p>
                )}
              </div>

              {planRateOptions.length > 0 && (
                <TactileMatrix
                  label="Charging Rate"
                  className="lg:col-span-2"
                  value={selectedChargingRate}
                  onChange={(value) => {
                    const nextRate = parseChargingRateValue(value);
                    setValue('charging_type', nextRate.chargingType, { shouldDirty: true });
                    setValue('pricing_mode', nextRate.pricingMode, { shouldDirty: true });
                  }}
                  options={planRateOptions}
                />
              )}
            </>
          ) : (
            <>
              <div className="flex flex-col">
                <label htmlFor="provider_id" className="text-[13px] font-medium text-secondary uppercase tracking-wider mb-1">
                  Provider <span className="text-primary" aria-hidden="true">*</span>
                </label>
                <Controller
                  name="provider_id"
                  control={control}
                  render={({ field }) => (
                    <select
                      id="provider_id"
                      {...field}
                      onChange={(event) => {
                        hasUserChangedProviderRef.current = true;
                        field.onChange(event);
                      }}
                      required
                      aria-required="true"
                      aria-invalid={errors.provider_id ? 'true' : 'false'}
                      aria-describedby={providerErrorId}
                      className={`w-full px-0 py-2 border-b border-secondary/20 focus:border-accent outline-none bg-transparent text-xl font-medium min-h-[44px] transition-colors ${
                        selectedProviderId ? 'text-primary' : 'text-primary/70'
                      }`}
                    >
                      <option value="">Select Provider</option>
                      {hasHistoricalProviderFallback && existingSession && (
                          <option value={existingSession.provider_id ?? undefined}>
                          {existingSession.provider_name_snapshot}
                        </option>
                      )}
                      {providers.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  )}
                />
                {errors.provider_id && (
                  <p id={providerErrorId} className="text-sm text-red-500 font-medium mt-1.5">{errors.provider_id.message}</p>
                )}
              </div>
              <ThinInput
                label="CPO/Operator"
                requiredIndicator
                required
                aria-required="true"
                type="text"
                placeholder="Operator name"
                {...register('cpo_name')}
                error={errors.cpo_name?.message}
              />
            </>
          )}
        </div>

        {selectedPricingSource === 'ad_hoc' && (
          <div className="flex flex-col gap-8">
            <ThinInput
              label="Price per kWh"
              requiredIndicator
              required
              aria-required="true"
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

        <div className="flex flex-col gap-8">
          {/* kWh Billed */}
          <ThinInput
            label="kWh Billed"
            requiredIndicator
            required
            aria-required="true"
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
            {cancelActionLabel}
          </button>
        </div>
      </form>
    </Slab>
  );
};
