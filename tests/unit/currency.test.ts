import { describe, it, expect } from 'vitest';
import { convertPrice, formatPrice, CURRENCY_RATES } from '../../src/core/currency';

describe('Currency Conversions & Formatters', () => {
  it('converts INR amounts accurately to foreign currencies', () => {
    const inr = 83000;
    const usd = convertPrice(inr, 'USD');
    expect(usd).toBe(83000 * CURRENCY_RATES.USD); // 1000 USD

    const eur = convertPrice(95000, 'EUR');
    expect(eur).toBe(95000 * CURRENCY_RATES.EUR); // 1000 EUR
  });

  it('formats INR prices using Indian locale (en-IN)', () => {
    const formatted = formatPrice(120000);
    // Indian grouping: 1,20,000
    expect(formatted).toContain('1,20,000');
    expect(formatted).toContain('₹');
  });

  it('formats USD and EUR with appropriate precision and symbols', () => {
    const usdFormatted = formatPrice(100.5, { currency: 'USD' });
    expect(usdFormatted).toContain('$100.50');

    const eurFormatted = formatPrice(50.25, { currency: 'EUR' });
    expect(eurFormatted).toContain('50.25');
  });
});
