/**
 * Converts a decimal string (potentially with comma) to integer cents.
 * Handles both "1.50" and "1,50".
 * 
 * @param val - The decimal string value
 * @returns Integer cents
 */
export function parseDecimalToCents(val: string): number {
  if (!val) return 0;
  
  // Replace comma with dot for standard parsing
  const normalized = val.replace(',', '.');
  const parsed = parseFloat(normalized);
  
  if (isNaN(parsed)) return 0;
  
  // Multiply by 100 and round to handle floating point precision
  return Math.round(parsed * 100);
}

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
