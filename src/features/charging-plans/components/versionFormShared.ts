import { useEffect, useMemo, useRef } from 'react';
import type {
  FieldPath,
  PathValue,
  FieldValues,
  UseFormClearErrors,
  UseFormSetError,
  UseFormSetValue,
} from 'react-hook-form';
import * as z from 'zod';
import type { ChargingPlan } from '../../../infra/db';
import { formatCentsToDecimal } from '../../../shared/lib';
import { formatUtcDate, parseUtcDateInput, resolveEffectivePlanForDate } from '../model/logicalTariffs';
import type { TariffPriceInput } from '../services/planService';

/**
 * Shared money-field shape for version-management price forms.
 */
export interface VersionPriceFormFields {
  ac_price?: string;
  dc_price?: string;
  roaming_ac_price?: string;
  roaming_dc_price?: string;
  monthly_base_fee: string;
  session_fee: string;
}

export const moneyField = z.string().refine(isValidMoneyInput, 'Enter a valid non-negative amount');

export const priceFields = {
  ac_price: moneyField.optional(),
  dc_price: moneyField.optional(),
  roaming_ac_price: moneyField.optional(),
  roaming_dc_price: moneyField.optional(),
  monthly_base_fee: moneyField,
  session_fee: moneyField,
} as const;

const groupedMoneyPattern = /^\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$/;
const simpleMoneyPattern = /^\d+(?:[.,]\d{1,2})?$/;

export function isValidMoneyInput(value?: string): boolean {
  if (value == null || value.trim() === '') return true;

  const trimmed = value.trim();

  if (trimmed.includes('.') && trimmed.includes(',')) {
    return groupedMoneyPattern.test(trimmed);
  }

  return simpleMoneyPattern.test(trimmed);
}

export function parseMoneyInputToCents(value?: string): number | undefined {
  if (value == null) return undefined;

  const trimmed = value.trim();

  if (trimmed === '' || !isValidMoneyInput(trimmed)) {
    return undefined;
  }

  const normalized = trimmed.includes('.') && trimmed.includes(',')
    ? trimmed.replace(/\./g, '').replace(',', '.')
    : trimmed.replace(',', '.');

  const parsed = Number(normalized);

  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return Math.round(parsed * 100);
}

export function toMoneyInput(value?: number): string {
  return value == null ? '' : formatCentsToDecimal(value);
}

export function toTariffPriceInput(values: VersionPriceFormFields): TariffPriceInput {
  return {
    ac_price_per_kwh: parseMoneyInputToCents(values.ac_price ?? ''),
    dc_price_per_kwh: parseMoneyInputToCents(values.dc_price ?? ''),
    roaming_ac_price_per_kwh: parseMoneyInputToCents(values.roaming_ac_price ?? ''),
    roaming_dc_price_per_kwh: parseMoneyInputToCents(values.roaming_dc_price ?? ''),
    monthly_base_fee: parseMoneyInputToCents(values.monthly_base_fee ?? '') ?? 0,
    session_fee: parseMoneyInputToCents(values.session_fee ?? '') ?? 0,
  };
}

export function prefillPriceFields<TFieldValues extends FieldValues & VersionPriceFormFields>(
  baseline: ChargingPlan,
  setValue: UseFormSetValue<TFieldValues>,
): void {
  const setMoneyValue = (fieldName: FieldPath<TFieldValues>, value?: number): void => {
    setValue(
      fieldName,
      toMoneyInput(value) as PathValue<TFieldValues, FieldPath<TFieldValues>>,
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
  TFieldValues extends FieldValues & VersionPriceFormFields,
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
