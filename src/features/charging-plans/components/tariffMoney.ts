import * as z from 'zod';
import { formatCentsToDecimal } from '../../../shared/lib';
import type { TariffPriceInput } from '../services/planService';

/** Form fields shared by tariff price-entry workflows. */
export interface TariffMoneyFormFields {
  ac_price?: string;
  dc_price?: string;
  roaming_ac_price?: string;
  roaming_dc_price?: string;
  monthly_base_fee: string;
  session_fee: string;
}

const groupedMoneyPattern = /^\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$/;
const simpleMoneyPattern = /^\d+(?:[.,]\d{1,2})?$/;

/** Returns whether a string is a supported non-negative EUR amount. */
export function isValidTariffMoneyInput(value?: string): boolean {
  if (value == null || value.trim() === '') return true;

  const trimmed = value.trim();
  return trimmed.includes('.') && trimmed.includes(',')
    ? groupedMoneyPattern.test(trimmed)
    : simpleMoneyPattern.test(trimmed);
}

export const tariffMoneyField = z.string().refine(
  isValidTariffMoneyInput,
  'Enter a valid non-negative amount',
);

export const tariffPriceFields = {
  ac_price: tariffMoneyField.optional(),
  dc_price: tariffMoneyField.optional(),
  roaming_ac_price: tariffMoneyField.optional(),
  roaming_dc_price: tariffMoneyField.optional(),
  monthly_base_fee: tariffMoneyField,
  session_fee: tariffMoneyField,
} as const;

/** Parses a supported EUR input into integer cents, preserving blanks as unavailable. */
export function parseTariffMoneyToCents(value?: string): number | undefined {
  if (value == null) return undefined;

  const trimmed = value.trim();
  if (trimmed === '' || !isValidTariffMoneyInput(trimmed)) return undefined;

  const normalized = trimmed.includes('.') && trimmed.includes(',')
    ? trimmed.replace(/\./g, '').replace(',', '.')
    : trimmed.replace(',', '.');

  return Math.round(Number(normalized) * 100);
}

export function formatTariffMoneyInput(value?: number): string {
  return value == null ? '' : formatCentsToDecimal(value);
}

/** Converts form fields into the domain price shape without zero-filling optional prices. */
export function toTariffPriceInput(values: TariffMoneyFormFields): TariffPriceInput {
  return {
    ac_price_per_kwh: parseTariffMoneyToCents(values.ac_price),
    dc_price_per_kwh: parseTariffMoneyToCents(values.dc_price),
    roaming_ac_price_per_kwh: parseTariffMoneyToCents(values.roaming_ac_price),
    roaming_dc_price_per_kwh: parseTariffMoneyToCents(values.roaming_dc_price),
    monthly_base_fee: parseTariffMoneyToCents(values.monthly_base_fee) ?? 0,
    session_fee: parseTariffMoneyToCents(values.session_fee) ?? 0,
  };
}

export function hasMeaningfulTariffPricing(values: TariffMoneyFormFields): boolean {
  const prices = toTariffPriceInput(values);
  return [
    prices.ac_price_per_kwh,
    prices.dc_price_per_kwh,
    prices.roaming_ac_price_per_kwh,
    prices.roaming_dc_price_per_kwh,
  ].some((value) => value != null)
    || prices.monthly_base_fee > 0
    || prices.session_fee > 0;
}
