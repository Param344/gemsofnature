// src/core/validator.ts
// Runtime validation and sanitization for untrusted cart data and input

import { getProductById } from './products';
import type { LegacyCartRecord } from '../types/cart';

export class CartValidator {
  public static readonly MAX_ITEM_QUANTITY = 20;

  /**
   * Sanitizes untrusted localStorage cart data.
   * - Filters out non-existent product IDs (prevents 'r1' missing-item price bugs).
   * - Eliminates XSS injection attempts stored in keys or values.
   * - Never reads or trusts stored price values (only IDs and quantities).
   * - Restricts quantities to safe positive integers (1 to MAX_ITEM_QUANTITY).
   */
  public static sanitizeCart(raw: unknown): LegacyCartRecord {
    const sanitized: LegacyCartRecord = {};

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return sanitized;
    }

    for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
      // 1. Verify product exists in authoritative catalogue
      const product = getProductById(key);
      if (!product) {
        continue; // Discard invalid or unknown IDs safely
      }

      // 2. Validate quantity
      const num = typeof val === 'number' ? val : parseInt(String(val), 10);
      if (Number.isInteger(num) && num > 0) {
        sanitized[key] = Math.min(num, this.MAX_ITEM_QUANTITY);
      }
    }

    return sanitized;
  }
}
