import { describe, expect, it } from 'vitest';
import {
  formatCtPerKwh,
  formatCurrency,
  formatKwh,
  formatMonthLabel,
} from './utils';

/**
 * Test suite for the Overall Price rate formatter.
 *
 * Verifies locale-aware decimal separators and presentation-only rounding to
 * exactly one fractional cent per kWh.
 */
describe('formatCtPerKwh', () => {
  it('formats a full-precision rate with a German decimal comma', () => {
    // Arrange: Keep the weighted calculation result at full precision.
    const rate = 6615 / 129.2;

    // Act: Format the rate for a German locale.
    const formatted = formatCtPerKwh(rate, 'de-DE');

    // Assert: Only the display value is rounded to one fractional digit.
    expect(formatted).toBe('51,2 ct/kWh');
  });

  it('formats and rounds a rate for a decimal-point locale', () => {
    // Arrange: Use a value whose second fractional digit rounds upward.
    const rate = 51.26;

    // Act: Format the rate for a US English locale.
    const formatted = formatCtPerKwh(rate, 'en-US');

    // Assert: The locale separator and normal numeric rounding are applied.
    expect(formatted).toBe('51.3 ct/kWh');
  });
});

/** Test suite protecting the established supporting currency formatter. */
describe('formatCurrency', () => {
  it('keeps integer cents formatted as German-localized euros', () => {
    // Arrange: Use an integer-cent supporting spend value.
    const cents = 1234;

    // Act: Format the supporting currency value.
    const formatted = formatCurrency(cents);

    // Assert: Existing currency behavior remains unchanged.
    expect(formatted).toBe('12,34 €');
  });
});

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
