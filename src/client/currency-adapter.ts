// src/client/currency-adapter.ts
// Reversible client adapter connecting CurrencyFormatter to legacy window globals

import { CurrencyFormatter } from './currency-formatter';
import type { CurrencyCode, PriceFormatOptions } from '../types/currency';

declare global {
  interface Window {
    GNCurrency?: typeof CurrencyFormatter;
    GNUtils?: {
      formatPrice?: (amount: number, opts?: PriceFormatOptions) => string;
      [key: string]: unknown;
    };
    formatCurrency?: (value: number | string | null | undefined, currency?: CurrencyCode) => string;
  }
}

// Store original implementations and state for complete, zero-risk reversibility
let isAdapterActive = false;
let didDefineFormatCurrency = false;
let originalGNUtilsFormatPrice: ((amount: number, opts?: PriceFormatOptions) => string) | undefined;
let originalFormatCurrency: ((value: number | string | null | undefined, currency?: CurrencyCode) => string) | undefined;

/**
 * Initializes the client currency adapter.
 * - Idempotent: repeated activation is a safe no-op.
 * - Safe when one or both legacy functions are missing.
 * - Preserves original function references for clean rollback.
 */
export function initCurrencyAdapter(): void {
  if (typeof window === 'undefined') return;
  if (isAdapterActive) return; // Prevent repeated wrapping

  // 1. Expose GNCurrency namespace on window
  window.GNCurrency = CurrencyFormatter;

  // 2. Wrap GNUtils.formatPrice if GNUtils exists
  if (window.GNUtils && typeof window.GNUtils.formatPrice === 'function') {
    originalGNUtilsFormatPrice = window.GNUtils.formatPrice;
    window.GNUtils.formatPrice = (amount: number, opts?: PriceFormatOptions): string => {
      return CurrencyFormatter.formatPrice(amount, opts);
    };
  }

  // 3. Expose or wrap window.formatCurrency
  if (typeof window.formatCurrency === 'function') {
    originalFormatCurrency = window.formatCurrency;
    window.formatCurrency = (value, currency) => {
      return CurrencyFormatter.formatCurrency(value, currency);
    };
  } else {
    didDefineFormatCurrency = true;
    window.formatCurrency = (value, currency) => {
      return CurrencyFormatter.formatCurrency(value, currency);
    };
  }

  isAdapterActive = true;
}

/**
 * Reverts all modifications made by the adapter, completely restoring legacy behavior.
 * - Safe if never activated.
 * - Restores exact original function references.
 * - Removes newly defined global variables.
 */
export function revertCurrencyAdapter(): void {
  if (typeof window === 'undefined') return;
  if (!isAdapterActive) return; // Safe no-op if not active

  delete window.GNCurrency;

  if (window.GNUtils && originalGNUtilsFormatPrice) {
    window.GNUtils.formatPrice = originalGNUtilsFormatPrice;
    originalGNUtilsFormatPrice = undefined;
  }

  if (didDefineFormatCurrency) {
    delete window.formatCurrency;
    didDefineFormatCurrency = false;
  } else if (originalFormatCurrency) {
    window.formatCurrency = originalFormatCurrency;
    originalFormatCurrency = undefined;
  }

  isAdapterActive = false;
}

/**
 * Returns whether the adapter is currently active.
 */
export function isCurrencyAdapterActive(): boolean {
  return isAdapterActive;
}

// Auto-initialize when loaded as a script in the browser
if (typeof window !== 'undefined') {
  initCurrencyAdapter();
}
