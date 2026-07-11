import { describe, expect, it } from 'vitest';
import {
  formatTariffMoneyInput,
  hasMeaningfulTariffPricing,
  isValidTariffMoneyInput,
  parseTariffMoneyToCents,
  toTariffPriceInput,
} from './tariffMoney';

/**
 * Test suite for the canonical tariff money-input contract.
 *
 * Verifies supported European input, strict validation, integer-cent conversion,
 * and preservation of unavailable optional prices.
 */
describe('tariffMoney', () => {
  it.each(['', '0,49', '0.49', '1.234,56'])('accepts supported input %s', (input) => {
    // Arrange / Act / Assert
    expect(isValidTariffMoneyInput(input)).toBe(true);
  });

  it.each(['-1', '1,234', '1.2.3', 'value'])('rejects unsupported input %s', (input) => {
    // Arrange / Act / Assert
    expect(isValidTariffMoneyInput(input)).toBe(false);
  });

  it('parses decimal and grouped values into integer cents', () => {
    // Arrange / Act / Assert
    expect(parseTariffMoneyToCents('0,49')).toBe(49);
    expect(parseTariffMoneyToCents('1.234,56')).toBe(123456);
    expect(parseTariffMoneyToCents('')).toBeUndefined();
  });

  it('preserves blank optional prices and defaults blank fees to zero', () => {
    // Arrange
    const values = {
      ac_price: '',
      dc_price: '',
      roaming_ac_price: '',
      roaming_dc_price: '',
      monthly_base_fee: '',
      session_fee: '',
    };

    // Act
    const prices = toTariffPriceInput(values);

    // Assert
    expect(prices).toEqual({
      ac_price_per_kwh: undefined,
      dc_price_per_kwh: undefined,
      roaming_ac_price_per_kwh: undefined,
      roaming_dc_price_per_kwh: undefined,
      monthly_base_fee: 0,
      session_fee: 0,
    });
    expect(hasMeaningfulTariffPricing(values)).toBe(false);
  });

  it('formats stored cents for form input', () => {
    // Arrange / Act / Assert
    expect(formatTariffMoneyInput(49)).toBe('0,49');
    expect(formatTariffMoneyInput(undefined)).toBe('');
  });
});
