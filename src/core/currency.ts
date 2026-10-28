// src/core/currency.ts
// Currency conversion rates and formatting utilities

import type { CurrencyCode, CurrencyRates, PriceFormatOptions } from '../types/currency';
import { GN_CONFIG } from './config';

export const CURRENCY_RATES: Readonly<CurrencyRates> = {
  INR: 1,
  USD: 1 / 83,
  EUR: 1 / 95,
  GBP: 1 / 110
} as const;

export const CURRENCY_SYMBOLS: Readonly<Record<CurrencyCode, string>> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£'
} as const;

export function convertPrice(amountInINR: number, targetCurrency: CurrencyCode): number {
  const rate = CURRENCY_RATES[targetCurrency] ?? 1;
  return amountInINR * rate;
}

export function formatPrice(amount: number, opts: PriceFormatOptions = {}): string {
  const currency: CurrencyCode = opts.currency ?? (GN_CONFIG.currency as CurrencyCode) ?? 'INR';
  const precision = opts.precision ?? (currency === 'INR' ? 0 : 2);
  const symbol = opts.symbol ?? CURRENCY_SYMBOLS[currency] ?? '₹';

  try {
    const formatter = new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: precision,
      maximumFractionDigits: precision
    });
    return formatter.format(amount);
  } catch {
    // Fallback if Intl formatter fails
    return `${symbol}${amount.toFixed(precision)}`;
  }
}
