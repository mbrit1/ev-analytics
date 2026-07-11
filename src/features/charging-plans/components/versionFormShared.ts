import { useEffect, useMemo, useRef } from 'react';
import type {
  FieldPath,
  PathValue,
  FieldValues,
  UseFormClearErrors,
  UseFormSetError,
  UseFormSetValue,
} from 'react-hook-form';
import type { ChargingPlan } from '../../../infra/db';
import { formatUtcDate, parseUtcDateInput, resolveEffectivePlanForDate } from '../model/logicalTariffs';
import {
  formatTariffMoneyInput,
  type TariffMoneyFormFields,
} from './tariffMoney';

/**
 * Shared money-field shape for version-management price forms.
 */
export function prefillPriceFields<TFieldValues extends FieldValues & TariffMoneyFormFields>(
  baseline: ChargingPlan,
  setValue: UseFormSetValue<TFieldValues>,
): void {
  const setMoneyValue = (fieldName: FieldPath<TFieldValues>, value?: number): void => {
    setValue(
      fieldName,
      formatTariffMoneyInput(value) as PathValue<TFieldValues, FieldPath<TFieldValues>>,
      { shouldValidate: true, shouldDirty: false }
    );
  };

  setMoneyValue('ac_price' as FieldPath<TFieldValues>, baseline.ac_price_per_kwh);
  setMoneyValue('dc_price' as FieldPath<TFieldValues>, baseline.dc_price_per_kwh);
  setMoneyValue('roaming_ac_price' as FieldPath<TFieldValues>, baseline.roaming_ac_price_per_kwh);
  setMoneyValue('roaming_dc_price' as FieldPath<TFieldValues>, baseline.roaming_dc_price_per_kwh);
  setMoneyValue('monthly_base_fee' as FieldPath<TFieldValues>, baseline.monthly_base_fee);
  setMoneyValue('session_fee' as FieldPath<TFieldValues>, baseline.session_fee);
}

export function getEarliestVersionStart(versions: ChargingPlan[]): string | undefined {
  if (versions.length === 0) return undefined;

  return formatUtcDate(
    versions.reduce((earliest, version) => (
      version.valid_from.getTime() < earliest.valid_from.getTime() ? version : earliest
    )).valid_from
  );
}

export function useVersionBaselinePrefill<
  TFieldValues extends FieldValues & TariffMoneyFormFields,
  TStartFieldName extends FieldPath<TFieldValues>,
>({
  versions,
  selectedStart,
  startFieldName,
  sameStartErrorMessage,
  setValue,
  setError,
  clearErrors,
}: {
  versions: ChargingPlan[];
  selectedStart?: string;
  startFieldName: TStartFieldName;
  sameStartErrorMessage: string;
  setValue: UseFormSetValue<TFieldValues>;
  setError: UseFormSetError<TFieldValues>;
  clearErrors: UseFormClearErrors<TFieldValues>;
}): { baseline: ChargingPlan | null; isStartAfterBaseline: boolean } {
  const baseline = useMemo(
    () => (
      selectedStart
        ? resolveEffectivePlanForDate(versions, parseUtcDateInput(selectedStart))
        : null
    ),
    [selectedStart, versions],
  );
  const lastPrefilledBaselineIdRef = useRef<string | null>(null);
  const isStartAfterBaseline = Boolean(
    selectedStart
    && baseline
    && parseUtcDateInput(selectedStart).getTime() > baseline.valid_from.getTime()
  );

  useEffect(() => {
    if (!selectedStart) {
      lastPrefilledBaselineIdRef.current = null;
      clearErrors(startFieldName);
      return;
    }

    if (!baseline) {
      lastPrefilledBaselineIdRef.current = null;
      setError(startFieldName, {
        type: 'manual',
        message: `No baseline tariff exists for ${selectedStart}`,
      });
      return;
    }

    if (!isStartAfterBaseline) {
      setError(startFieldName, {
        type: 'manual',
        message: sameStartErrorMessage,
      });
    } else {
      clearErrors(startFieldName);
    }

    if (lastPrefilledBaselineIdRef.current === baseline.id) {
      return;
    }

    prefillPriceFields(baseline, setValue);
    lastPrefilledBaselineIdRef.current = baseline.id;
  }, [
    baseline,
    clearErrors,
    isStartAfterBaseline,
    sameStartErrorMessage,
    selectedStart,
    setError,
    setValue,
    startFieldName,
  ]);

  return { baseline, isStartAfterBaseline };
}
