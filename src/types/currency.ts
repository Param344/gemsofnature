// src/types/currency.ts
// Currency codes and formatting contracts

export type CurrencyCode = 'INR' | 'USD' | 'EUR' | 'GBP';

export type CurrencyRates = Record<CurrencyCode, number>;

export interface PriceFormatOptions {
  readonly precision?: number;
  readonly symbol?: string;
  readonly currency?: CurrencyCode;
}
