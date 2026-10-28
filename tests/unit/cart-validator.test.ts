import { describe, it, expect } from 'vitest';
import { CartValidator } from '../../src/core/validator';

describe('Cart Validator & Runtime Sanitizer', () => {
  it('parses and validates legitimate legacy cart records', () => {
    const raw = { p1: 2, p2: 1 };
    const sanitized = CartValidator.sanitizeCart(raw);
    expect(sanitized).toEqual({ p1: 2, p2: 1 });
  });

  it('safely discards non-existent product IDs (including r1-r7 homepage recommender IDs)', () => {
    const raw = {
      p1: 1,
      r1: 2, // Non-existent in products.ts (V1 recommender bug)
      unknown_bead: 5
    };
    const sanitized = CartValidator.sanitizeCart(raw);
    expect(sanitized).toEqual({ p1: 1 });
    expect(sanitized['r1']).toBeUndefined();
    expect(sanitized['unknown_bead']).toBeUndefined();
  });

  it('rejects stored DOM XSS payloads in keys or values', () => {
    const maliciousRaw = {
      p1: 1,
      '<img src=x onerror=alert(1)>': 1,
      '<script>alert(document.cookie)</script>': 5,
      p2: '<script>alert(1)</script>'
    };
    const sanitized = CartValidator.sanitizeCart(maliciousRaw);
    expect(sanitized).toEqual({ p1: 1 });
    expect(Object.keys(sanitized)).toEqual(['p1']);
  });

  it('enforces quantity bounds (caps at MAX_ITEM_QUANTITY and rejects <= 0)', () => {
    const raw = {
      p1: 50, // exceeds max (20)
      p2: 0,  // zero
      p3: -5, // negative
      p4: '3' // numeric string
    };
    const sanitized = CartValidator.sanitizeCart(raw);
    expect(sanitized.p1).toBe(20);
    expect(sanitized.p2).toBeUndefined();
    expect(sanitized.p3).toBeUndefined();
    expect(sanitized.p4).toBe(3);
  });

  it('handles corrupt, null, or malformed localStorage data gracefully', () => {
    expect(CartValidator.sanitizeCart(null)).toEqual({});
    expect(CartValidator.sanitizeCart(undefined)).toEqual({});
    expect(CartValidator.sanitizeCart('corrupted_string')).toEqual({});
    expect(CartValidator.sanitizeCart([1, 2, 3])).toEqual({});
  });

  it('never trusts or retains stored prices or payment evidence', () => {
    const spoofedCart = {
      p1: 1,
      unitPrice: 1,
      total: 1,
      isPaid: true
    };
    const sanitized = CartValidator.sanitizeCart(spoofedCart);
    // Only valid product IDs remain as keys, spoofed price fields are discarded
    expect(sanitized).toEqual({ p1: 1 });
    expect((sanitized as Record<string, unknown>).unitPrice).toBeUndefined();
    expect((sanitized as Record<string, unknown>).isPaid).toBeUndefined();
  });

  it('strictly excludes unactivated metadata-only IDs (p127, p128, p129, p135) from cart storage', () => {
    const raw = {
      p1: 1,
      p127: 1, // Amethyst Pendant (metadata only)
      p128: 2, // Rose Quartz Pendant (metadata only)
      p129: 1, // Clear Quartz Pendant (metadata only)
      p135: 3  // Charging Plate (metadata only)
    };
    const sanitized = CartValidator.sanitizeCart(raw);
    expect(sanitized).toEqual({ p1: 1 });
    expect(sanitized['p127']).toBeUndefined();
    expect(sanitized['p128']).toBeUndefined();
    expect(sanitized['p129']).toBeUndefined();
    expect(sanitized['p135']).toBeUndefined();
  });
});
