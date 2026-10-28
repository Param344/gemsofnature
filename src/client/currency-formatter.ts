// src/client/currency-formatter.ts
// Strict TypeScript implementation of currency conversion and price formatting for Gems of Nature V2

import type { CurrencyCode, CurrencyRates, PriceFormatOptions } from '../types/currency';

export interface ExtendedFormatOptions extends PriceFormatOptions {
  useGrouping?: boolean;
}

export class CurrencyFormatter {
  /**
   * Authoritative exchange rates relative to 1 INR.
   * Matches shop-ecom.html and gn-config.js exact definitions.
   */
  public static readonly RATES: Readonly<CurrencyRates> = {
    INR: 1,
    USD: 1 / 83,
    EUR: 1 / 95,
    GBP: 1 / 110
  } as const;

  /**
   * Currency symbols.
   */
  public static readonly SYMBOLS: Readonly<Record<CurrencyCode, string>> = {
    INR: '₹',
    USD: '$',
    EUR: '€',
    GBP: '£'
  } as const;

  public static readonly DEFAULT_CURRENCY: CurrencyCode = 'INR';

  /**
   * Validates if a string is a supported currency code.
   */
  public static isSupportedCurrency(code: unknown): code is CurrencyCode {
    return typeof code === 'string' && code in this.RATES;
  }

  /**
   * Converts an amount in INR to target currency.
   * Returns 0 for invalid, null, undefined, or NaN inputs.
   */
  public static convertPrice(amountInINR: number | null | undefined, targetCurrency: CurrencyCode = 'INR'): number {
    if (amountInINR == null || isNaN(amountInINR) || !isFinite(amountInINR)) {
      return 0;
    }
    const rate = this.RATES[targetCurrency] ?? 1;
    return amountInINR * rate;
  }

  /**
   * Legacy-compatible formatPrice implementation (matching GNUtils.formatPrice in gn-utils.js).
   * Uses Indian numbering locale 'en-IN' for currency grouping.
   *
   * @param amount The numeric amount to format
   * @param opts Configuration options (currency, precision, symbol)
   */
  public static formatPrice(
    amount: number | string | null | undefined,
    opts: ExtendedFormatOptions = {}
  ): string {
    const num = this.parseAmount(amount);
    const currency: CurrencyCode = (opts.currency && this.isSupportedCurrency(opts.currency))
      ? opts.currency
      : this.DEFAULT_CURRENCY;

    const precision = opts.precision != null
      ? Math.max(0, Math.floor(opts.precision))
      : (currency === 'INR' ? 2 : 2);

    const symbol = opts.symbol != null
      ? opts.symbol
      : (this.SYMBOLS[currency] ?? '₹');

    try {
      const formatter = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency,
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
        useGrouping: opts.useGrouping !== false
      });
      return formatter.format(num);
    } catch {
      // Robust fallback if Intl is unavailable or fails
      return `${symbol}${num.toFixed(precision)}`;
    }
  }

  /**
   * E-commerce catalogue compatible formatter (matching formatCurrency in shop-ecom.html).
   *
   * Rules:
   * - If value == null or NaN, returns empty string ''.
   * - If currency is INR: formats as '₹' + Number(value).toLocaleString('en-IN') (no decimals for integer values).
   * - If foreign currency (USD, EUR, GBP): converts from INR and formats as symbol + value.toFixed(2).
   */
  public static formatCurrency(
    value: number | string | null | undefined,
    currency: CurrencyCode = 'INR'
  ): string {
    if (value == null || value === '') return '';

    const num = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.-]/g, ''));
    if (isNaN(num) || !isFinite(num)) return '';

    const validCurrency: CurrencyCode = this.isSupportedCurrency(currency) ? currency : 'INR';

    if (validCurrency === 'INR') {
      return '₹' + Number(num).toLocaleString('en-IN');
    }

    const symbol = this.SYMBOLS[validCurrency] ?? '$';
    const converted = num * (this.RATES[validCurrency] ?? 1);
    return symbol + converted.toFixed(2);
  }

  /**
   * Safely parses any input into a valid finite number.
   * Returns 0 for null, undefined, NaN, or non-numeric values.
   */
  public static parseAmount(val: unknown): number {
    if (typeof val === 'number') {
      return isFinite(val) ? val : 0;
    }
    if (typeof val === 'string') {
      const cleaned = val.replace(/[^0-9.-]/g, '');
      const parsed = parseFloat(cleaned);
      return (!isNaN(parsed) && isFinite(parsed)) ? parsed : 0;
    }
    return 0;
  }
}
