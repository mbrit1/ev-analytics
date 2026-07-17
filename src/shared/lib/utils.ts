/**
 * Formats integer cents to a localized decimal string (with comma).
 * 
 * @param cents - The integer cents
 * @returns Localized decimal string (e.g. "1,50")
 */
export function formatCentsToDecimal(cents: number): string {
  const decimal = cents / 100;
  return decimal.toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Formats cents for currency display (e.g. "1,50 €").
 */
export function formatCurrency(cents: number): string {
  return `${formatCentsToDecimal(cents)} €`;
}

/**
 * Formats a full-precision cents-per-kWh rate for primary KPI display.
 *
 * @param ctPerKwh - The unrounded rate in cents per kWh
 * @param locale - The active locale supplied by the presentation layer
 * @returns Localized rate with exactly one fractional digit and its unit
 */
export function formatCtPerKwh(ctPerKwh: number, locale: string): string {
  const formattedRate = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(ctPerKwh);

  return `${formattedRate} ct/kWh`;
}

/** Formats a local calendar month for the English-language application UI. */
export function formatMonthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month, 1));
}

/**
 * Formats kWh values with German locale decimals and no forced trailing zeroes.
 *
 * @param kwh - The energy amount in kWh
 * @returns Localized kWh string
 */
export function formatKwh(kwh: number): string {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(kwh);
}
