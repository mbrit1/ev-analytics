import { describe, expect, it } from 'vitest';
import { formatKwh, formatMonthLabel, parseDecimalToCents } from './utils';

/**
 * Test suite for shared numeric formatting helpers.
 *
 * Verifies that kWh values use German locale formatting with up to two decimal
 * places and without forced trailing zeroes.
 */
describe('formatKwh', () => {
  it('formats whole numbers without decimal places', () => {
    // Arrange: Use a whole-number kWh value.
    const input = 103;

    // Act: Format the kWh value for UI display.
    const formatted = formatKwh(input);

    // Assert: Whole numbers remain compact.
    expect(formatted).toBe('103');
  });

  it('formats one decimal place when needed', () => {
    // Arrange: Use a single-decimal kWh value.
    const input = 103.4;

    // Act: Format the kWh value for UI display.
    const formatted = formatKwh(input);

    // Assert: German decimal formatting is preserved.
    expect(formatted).toBe('103,4');
  });

  it('caps output at two decimal places', () => {
    // Arrange: Use a value that needs rounding.
    const input = 103.456;

    // Act: Format the kWh value for UI display.
    const formatted = formatKwh(input);

    // Assert: Output is rounded to two decimal places.
    expect(formatted).toBe('103,46');
  });
});

/**
 * Test suite for parsing decimal strings into integer cents.
 *
 * Verifies that malformed inputs are rejected instead of being partially parsed.
 */
describe('parseDecimalToCents', () => {
  it('returns undefined for alphabetic suffixes', () => {
    // Arrange: Use a value with trailing non-numeric characters.
    const input = '1abc';

    // Act: Parse the value as cents.
    const parsed = parseDecimalToCents(input);

    // Assert: Malformed input is rejected.
    expect(parsed).toBeUndefined();
  });

  it('returns undefined for multiple decimal separators', () => {
    // Arrange: Use a value with repeated separators.
    const input = '1,2,3';

    // Act: Parse the value as cents.
    const parsed = parseDecimalToCents(input);

    // Assert: Ambiguous input is rejected.
    expect(parsed).toBeUndefined();
  });

  it('returns undefined for mixed thousand and decimal separators', () => {
    // Arrange: Use a value with both thousand and decimal separators.
    const input = '1.234,56';

    // Act: Parse the value as cents.
    const parsed = parseDecimalToCents(input);

    // Assert: Locale-mixed formatting is rejected.
    expect(parsed).toBeUndefined();
  });

  it('returns undefined for blank input', () => {
    // Arrange: Use a blank money input.
    const input = '   ';

    // Act: Parse the value as cents.
    const parsed = parseDecimalToCents(input);

    // Assert: Blank input stays absent for callers to handle explicitly.
    expect(parsed).toBeUndefined();
  });

  it('parses valid decimal strings into cents', () => {
    // Arrange: Use a standard German decimal string.
    const input = '0,49';

    // Act: Parse the value as cents.
    const parsed = parseDecimalToCents(input);

    // Assert: Valid decimals still map to integer cents.
    expect(parsed).toBe(49);
  });
});

/**
 * Test suite for analytics month labels.
 *
 * Verifies zero-based calendar months are presented in the English UI locale.
 */
describe('formatMonthLabel', () => {
  it('formats a calendar month with its year', () => {
    // Arrange: Use zero-based July 2026.
    const year = 2026;
    const month = 6;

    // Act: Format the analytics period label.
    const formatted = formatMonthLabel(year, month);

    // Assert: The English month and full year are shown.
    expect(formatted).toBe('July 2026');
  });
});
