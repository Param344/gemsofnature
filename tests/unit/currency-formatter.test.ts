// tests/unit/currency-formatter.test.ts
// Unit tests for CurrencyFormatter and CurrencyAdapter
// Stage 2A.1: Rigorous verification of numerical behavior, edge cases, legacy parity, and adapter reversibility

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CurrencyFormatter } from '../../src/client/currency-formatter';
import {
  initCurrencyAdapter,
  revertCurrencyAdapter,
  isCurrencyAdapterActive
} from '../../src/client/currency-adapter';
import type { PriceFormatOptions } from '../../src/types/currency';

describe('CurrencyFormatter — Core Formatting & Conversion', () => {
  describe('Rates and Symbols', () => {
    it('provides exact authoritative exchange rates', () => {
      expect(CurrencyFormatter.RATES.INR).toBe(1);
      expect(CurrencyFormatter.RATES.USD).toBeCloseTo(1 / 83, 6);
      expect(CurrencyFormatter.RATES.EUR).toBeCloseTo(1 / 95, 6);
      expect(CurrencyFormatter.RATES.GBP).toBeCloseTo(1 / 110, 6);
    });

    it('provides correct currency symbols', () => {
      expect(CurrencyFormatter.SYMBOLS.INR).toBe('₹');
      expect(CurrencyFormatter.SYMBOLS.USD).toBe('$');
      expect(CurrencyFormatter.SYMBOLS.EUR).toBe('€');
      expect(CurrencyFormatter.SYMBOLS.GBP).toBe('£');
    });

    it('identifies supported currencies', () => {
      expect(CurrencyFormatter.isSupportedCurrency('INR')).toBe(true);
      expect(CurrencyFormatter.isSupportedCurrency('USD')).toBe(true);
      expect(CurrencyFormatter.isSupportedCurrency('EUR')).toBe(true);
      expect(CurrencyFormatter.isSupportedCurrency('GBP')).toBe(true);
      expect(CurrencyFormatter.isSupportedCurrency('JPY')).toBe(false);
      expect(CurrencyFormatter.isSupportedCurrency('XYZ')).toBe(false);
      expect(CurrencyFormatter.isSupportedCurrency('')).toBe(false);
      expect(CurrencyFormatter.isSupportedCurrency(null)).toBe(false);
      expect(CurrencyFormatter.isSupportedCurrency(undefined)).toBe(false);
      expect(CurrencyFormatter.isSupportedCurrency(123)).toBe(false);
    });
  });

  describe('Currency Conversion', () => {
    it('converts INR amounts accurately to foreign currencies', () => {
      expect(CurrencyFormatter.convertPrice(8300, 'USD')).toBeCloseTo(100, 2);
      expect(CurrencyFormatter.convertPrice(9500, 'EUR')).toBeCloseTo(100, 2);
      expect(CurrencyFormatter.convertPrice(11000, 'GBP')).toBeCloseTo(100, 2);
      expect(CurrencyFormatter.convertPrice(5000, 'INR')).toBe(5000);
    });

    it('handles boundary and invalid amounts in conversion safely', () => {
      expect(CurrencyFormatter.convertPrice(0, 'USD')).toBe(0);
      expect(CurrencyFormatter.convertPrice(null, 'USD')).toBe(0);
      expect(CurrencyFormatter.convertPrice(undefined, 'USD')).toBe(0);
      expect(CurrencyFormatter.convertPrice(NaN, 'USD')).toBe(0);
      expect(CurrencyFormatter.convertPrice(Infinity, 'USD')).toBe(0);
      expect(CurrencyFormatter.convertPrice(-Infinity, 'USD')).toBe(0);
      expect(CurrencyFormatter.convertPrice(-830, 'USD')).toBeCloseTo(-10, 2);
    });

    it('handles repeated conversion without compounding or drift', () => {
      const inrAmount = 8300;
      const usd1 = CurrencyFormatter.convertPrice(inrAmount, 'USD');
      const usd2 = CurrencyFormatter.convertPrice(inrAmount, 'USD');
      expect(usd1).toBe(usd2);

      // Verify mathematical inverse
      const backToInr = usd1 * (1 / CurrencyFormatter.RATES.USD);
      expect(backToInr).toBeCloseTo(inrAmount, 4);
    });
  });

  describe('formatPrice (GNUtils.formatPrice API Parity)', () => {
    it('formats normal INR prices with en-IN numbering and custom precision', () => {
      const formattedDefault = CurrencyFormatter.formatPrice(120000);
      // en-IN format for 120000 is 1,20,000.00
      expect(formattedDefault).toContain('1,20,000');

      const formattedZeroDecimals = CurrencyFormatter.formatPrice(120000, { precision: 0 });
      expect(formattedZeroDecimals).toContain('1,20,000');
      expect(formattedZeroDecimals).not.toContain('.00');
    });

    it('formats foreign currencies with appropriate symbols and decimal places', () => {
      const usd = CurrencyFormatter.formatPrice(100.5, { currency: 'USD', precision: 2 });
      expect(usd).toContain('100.50');

      const eur = CurrencyFormatter.formatPrice(50.25, { currency: 'EUR', precision: 2 });
      expect(eur).toContain('50.25');

      const gbp = CurrencyFormatter.formatPrice(75.1, { currency: 'GBP', precision: 2 });
      expect(gbp).toContain('75.10');
    });

    it('handles zero, positive, negative, and decimal amounts in formatPrice', () => {
      expect(CurrencyFormatter.formatPrice(0)).toContain('0');
      expect(CurrencyFormatter.formatPrice(-500)).toContain('500');
      expect(CurrencyFormatter.formatPrice(0.05, { precision: 2 })).toContain('0.05');
      expect(CurrencyFormatter.formatPrice(1234.567, { precision: 2 })).toContain('1,234.57');
    });

    it('handles large values with correct Indian number grouping', () => {
      // 10 Lakh = 10,00,000
      expect(CurrencyFormatter.formatPrice(1000000)).toContain('10,00,000');
      // 1 Crore = 1,00,00,000
      expect(CurrencyFormatter.formatPrice(10000000)).toContain('1,00,00,000');
    });

    it('handles string numbers and malformed strings gracefully', () => {
      expect(CurrencyFormatter.formatPrice('1500')).toContain('1,500');
      expect(CurrencyFormatter.formatPrice('₹2,500.50')).toContain('2,500.50');
      expect(CurrencyFormatter.formatPrice('  $5,000  ', { currency: 'USD' })).toContain('5,000');
      expect(CurrencyFormatter.formatPrice(null)).toContain('0');
      expect(CurrencyFormatter.formatPrice(undefined)).toContain('0');
      expect(CurrencyFormatter.formatPrice('')).toContain('0');
      expect(CurrencyFormatter.formatPrice('   ')).toContain('0');
      expect(CurrencyFormatter.formatPrice('invalid_text')).toContain('0');
      expect(CurrencyFormatter.formatPrice(NaN)).toContain('0');
      expect(CurrencyFormatter.formatPrice(Infinity)).toContain('0');
      expect(CurrencyFormatter.formatPrice(-Infinity)).toContain('0');
    });

    it('falls back safely when unknown currency code is provided', () => {
      // @ts-expect-error Testing invalid runtime currency
      const result = CurrencyFormatter.formatPrice(1500, { currency: 'UNKNOWN_CODE' });
      expect(result).toContain('1,500');
    });

    it('handles repeated formatting idempotently', () => {
      const once = CurrencyFormatter.formatPrice(5000);
      const twice = CurrencyFormatter.formatPrice(once);
      expect(twice).toBe(once);
    });
  });

  describe('formatCurrency (shop-ecom.html API Parity)', () => {
    it('formats INR values as integer currency with en-IN grouping', () => {
      expect(CurrencyFormatter.formatCurrency(1500, 'INR')).toBe('₹1,500');
      expect(CurrencyFormatter.formatCurrency(120000, 'INR')).toBe('₹1,20,000');
      expect(CurrencyFormatter.formatCurrency(0, 'INR')).toBe('₹0');
    });

    it('formats converted foreign currencies with exact 2 decimal places and symbols', () => {
      expect(CurrencyFormatter.formatCurrency(8300, 'USD')).toBe('$100.00');
      expect(CurrencyFormatter.formatCurrency(9500, 'EUR')).toBe('€100.00');
      expect(CurrencyFormatter.formatCurrency(11000, 'GBP')).toBe('£100.00');
    });

    it('formats negative amounts cleanly', () => {
      expect(CurrencyFormatter.formatCurrency(-1500, 'INR')).toBe('₹-1,500');
      expect(CurrencyFormatter.formatCurrency(-8300, 'USD')).toBe('$-100.00');
    });

    it('returns empty string for null, undefined, empty, or whitespace-only inputs', () => {
      expect(CurrencyFormatter.formatCurrency(null)).toBe('');
      expect(CurrencyFormatter.formatCurrency(undefined)).toBe('');
      expect(CurrencyFormatter.formatCurrency('')).toBe('');
      expect(CurrencyFormatter.formatCurrency('   ')).toBe('');
      expect(CurrencyFormatter.formatCurrency('abc')).toBe('');
      expect(CurrencyFormatter.formatCurrency(NaN)).toBe('');
      expect(CurrencyFormatter.formatCurrency(Infinity)).toBe('');
      expect(CurrencyFormatter.formatCurrency(-Infinity)).toBe('');
    });

    it('safely handles strings with embedded currency symbols and commas', () => {
      expect(CurrencyFormatter.formatCurrency('1500', 'INR')).toBe('₹1,500');
      expect(CurrencyFormatter.formatCurrency('₹1,500', 'INR')).toBe('₹1,500');
      expect(CurrencyFormatter.formatCurrency('$8300', 'USD')).toBe('$100.00');
      expect(CurrencyFormatter.formatCurrency('  120000  ', 'INR')).toBe('₹1,20,000');
    });

    it('falls back to INR when an unknown currency code is passed', () => {
      // @ts-expect-error Testing invalid runtime currency code
      expect(CurrencyFormatter.formatCurrency(1500, 'XYZ')).toBe('₹1,500');
    });
  });

  describe('Legacy Behavior Parity Verification', () => {
    // Simulated legacy function from shop-ecom.html (line 312)
    const legacyRates = { INR: 1, USD: 1 / 83, EUR: 1 / 95, GBP: 1 / 110 };
    function legacyFormatCurrency(value: unknown, currency = 'INR') {
      if (value == null) return '';
      if (currency === 'INR') return '₹' + Number(value).toLocaleString('en-IN');
      const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '£';
      // @ts-expect-error legacy simulation
      return symbol + (Number(value) * legacyRates[currency]).toFixed(2);
    }

    const testValues = [0, 50, 100, 499, 999, 1500, 2500, 8300, 10000, 50000, 100000, 500000];
    const currencies = ['INR', 'USD', 'EUR', 'GBP'] as const;

    for (const cur of currencies) {
      for (const val of testValues) {
        it(`produces exact parity with legacy formatCurrency for ${val} in ${cur}`, () => {
          const legacyResult = legacyFormatCurrency(val, cur);
          const v2Result = CurrencyFormatter.formatCurrency(val, cur);
          expect(v2Result).toBe(legacyResult);
        });
      }
    }
  });
});

describe('CurrencyAdapter — Lifecycle, Reversibility & Isolation', () => {
  let fakeWindow: Record<string, unknown>;

  beforeEach(() => {
    fakeWindow = {};
    // @ts-expect-error Mocking global window
    global.window = fakeWindow;
  });

  afterEach(() => {
    revertCurrencyAdapter();
    // @ts-expect-error Cleanup mock global
    delete global.window;
  });

  it('preserves original global functions before activation', () => {
    const originalFormatPrice = (amount: number, _opts?: PriceFormatOptions) => `custom:${amount}`;
    const originalFormatCurrency = (val: unknown) => `custom_currency:${val}`;

    fakeWindow.GNUtils = { formatPrice: originalFormatPrice };
    fakeWindow.formatCurrency = originalFormatCurrency;

    expect(isCurrencyAdapterActive()).toBe(false);
    expect(fakeWindow.GNCurrency).toBeUndefined();
    // Functions remain completely untouched
    expect((fakeWindow.GNUtils as { formatPrice: unknown }).formatPrice).toBe(originalFormatPrice);
    expect(fakeWindow.formatCurrency).toBe(originalFormatCurrency);
  });

  it('is safe when both legacy globals (GNUtils and formatCurrency) are missing', () => {
    expect(fakeWindow.GNUtils).toBeUndefined();
    expect(fakeWindow.formatCurrency).toBeUndefined();

    expect(() => initCurrencyAdapter()).not.toThrow();
    expect(isCurrencyAdapterActive()).toBe(true);
    expect(fakeWindow.GNCurrency).toBe(CurrencyFormatter);
    expect(typeof fakeWindow.formatCurrency).toBe('function');

    expect(() => revertCurrencyAdapter()).not.toThrow();
    expect(isCurrencyAdapterActive()).toBe(false);
    expect(fakeWindow.GNCurrency).toBeUndefined();
    expect(fakeWindow.formatCurrency).toBeUndefined();
  });

  it('is safe when only GNUtils is present', () => {
    const originalFormatPrice = (amount: number) => `legacy:${amount}`;
    fakeWindow.GNUtils = { formatPrice: originalFormatPrice };

    initCurrencyAdapter();
    expect(isCurrencyAdapterActive()).toBe(true);

    // GNUtils.formatPrice was wrapped
    const wrappedResult = (fakeWindow.GNUtils as { formatPrice: (a: number) => string }).formatPrice(120000);
    expect(wrappedResult).toContain('1,20,000');

    // Revert restores original function reference exactly
    revertCurrencyAdapter();
    expect((fakeWindow.GNUtils as { formatPrice: unknown }).formatPrice).toBe(originalFormatPrice);
  });

  it('is safe when only formatCurrency is present', () => {
    const originalFormatCurrency = (val: unknown) => `custom_format:${val}`;
    fakeWindow.formatCurrency = originalFormatCurrency;

    initCurrencyAdapter();
    expect(isCurrencyAdapterActive()).toBe(true);

    // formatCurrency was wrapped
    const wrappedResult = (fakeWindow.formatCurrency as (v: number) => string)(8300);
    expect(wrappedResult).toBe('₹8,300');

    // Revert restores original reference exactly
    revertCurrencyAdapter();
    expect(fakeWindow.formatCurrency).toBe(originalFormatCurrency);
  });

  it('repeated activation does not wrap functions repeatedly or lose original references', () => {
    const originalFormatPrice = (amount: number) => `original_price:${amount}`;
    const originalFormatCurrency = (val: unknown) => `original_currency:${val}`;

    fakeWindow.GNUtils = { formatPrice: originalFormatPrice };
    fakeWindow.formatCurrency = originalFormatCurrency;

    // Call init 5 times
    initCurrencyAdapter();
    initCurrencyAdapter();
    initCurrencyAdapter();
    initCurrencyAdapter();
    initCurrencyAdapter();

    expect(isCurrencyAdapterActive()).toBe(true);

    // Verify it is active
    expect((fakeWindow.formatCurrency as (v: number) => string)(1500)).toBe('₹1,500');

    // Revert
    revertCurrencyAdapter();
    expect(isCurrencyAdapterActive()).toBe(false);

    // Verify exact original function references are fully restored
    expect((fakeWindow.GNUtils as { formatPrice: unknown }).formatPrice).toBe(originalFormatPrice);
    expect(fakeWindow.formatCurrency).toBe(originalFormatCurrency);
  });

  it('rollback is safe if the adapter was never activated', () => {
    const originalFormatCurrency = (val: unknown) => `untouched:${val}`;
    fakeWindow.formatCurrency = originalFormatCurrency;

    // Call revert without calling init
    expect(() => revertCurrencyAdapter()).not.toThrow();

    // Verify nothing was touched or deleted
    expect(fakeWindow.formatCurrency).toBe(originalFormatCurrency);
    expect(isCurrencyAdapterActive()).toBe(false);
  });

  it('leaves zero global state behind after revert when starting with empty window', () => {
    initCurrencyAdapter();
    expect(fakeWindow.GNCurrency).toBeDefined();
    expect(fakeWindow.formatCurrency).toBeDefined();

    revertCurrencyAdapter();

    expect(fakeWindow.GNCurrency).toBeUndefined();
    expect(fakeWindow.formatCurrency).toBeUndefined();
    expect(fakeWindow.GNUtils).toBeUndefined();
  });
});
