import { describe, it, expect } from 'vitest';
import { PriceCalculator } from '../../src/cart/price-calculator';

describe('Price Calculator Business Engine', () => {
  it('correctly calculates subtotal, flat ₹200 domestic shipping, and total for valid items', () => {
    const cart = {
      p1: 2, // Yellow Sapphire
      p5: 1  // Emerald
    };

    // Test with explicit price resolution
    const result = PriceCalculator.calculate(cart, (p) => p.price_min);
    expect(result.subtotal).toBe(40000 * 2 + 8000 * 1); // 88000
    expect(result.shipping).toBe(200);
    expect(result.total).toBe(88200);
    expect(result.itemCount).toBe(3);
  });

  it('applies ₹0 shipping and ₹0 total when cart is empty', () => {
    const result = PriceCalculator.calculate({}, (p) => p.price_min);
    expect(result.subtotal).toBe(0);
    expect(result.shipping).toBe(0);
    expect(result.total).toBe(0);
    expect(result.itemCount).toBe(0);
  });

  it('evaluates purchase readiness correctly: blocks automated payment for provisional catalogue items', () => {
    const cart = { p1: 1, p5: 2 };
    const readiness = PriceCalculator.evaluatePurchaseReadiness(cart);
    expect(readiness.canCapturePayment).toBe(false);
    expect(readiness.status).toBe('PROVISIONAL_INQUIRY');
    expect(readiness.provisionalItemIds).toEqual(['p1', 'p5']);
    expect(readiness.reason).toContain('provisional catalogue price ranges');
  });

  it('calculates provisional range bounds correctly with flat ₹200 shipping', () => {
    // p1: 40000 - 200000
    // p5: 8000 - 150000
    const cart = { p1: 1, p5: 1 };
    const range = PriceCalculator.calculateProvisionalRange(cart);
    expect(range.minSubtotal).toBe(40000 + 8000); // 48000
    expect(range.maxSubtotal).toBe(200000 + 150000); // 350000
    expect(range.shipping).toBe(200);
    expect(range.minTotal).toBe(48200);
    expect(range.maxTotal).toBe(350200);
    expect(range.isProvisional).toBe(true);
  });

  it('strictly rejects checkout with zero or unapproved price (zero-price safeguard)', () => {
    const cart = { p1: 1 };
    expect(() => {
      PriceCalculator.calculate(cart, () => 0);
    }).toThrowError(/Commercial checkout without an approved fixed price is strictly forbidden/);

    expect(() => {
      PriceCalculator.calculate(cart, () => -500);
    }).toThrowError(/Commercial checkout without an approved fixed price is strictly forbidden/);
  });

  it('throws an error if an unknown product ID is passed to calculator', () => {
    const cart = { invalid_id_999: 1 };
    expect(() => {
      PriceCalculator.calculate(cart, (p) => p.price_min);
    }).toThrowError(/Invalid product ID/);
  });

  it('fails closed when evaluating purchase readiness for unknown or forged product IDs', () => {
    const cart = { unknown_sku_xyz: 1 };
    const readiness = PriceCalculator.evaluatePurchaseReadiness(cart);
    expect(readiness.canCapturePayment).toBe(false);
    expect(readiness.status).toBe('PROVISIONAL_INQUIRY');
    expect(readiness.provisionalItemIds).toContain('unknown_sku_xyz');
  });

  it('fails closed when evaluating purchase readiness for metadata-only IDs (p127, p128, p129, p135)', () => {
    const cart = { p127: 1, p128: 2 };
    const readiness = PriceCalculator.evaluatePurchaseReadiness(cart);
    expect(readiness.canCapturePayment).toBe(false);
    expect(readiness.status).toBe('PROVISIONAL_INQUIRY');
    expect(readiness.provisionalItemIds).toEqual(['p127', 'p128']);
  });

  it('fails closed when evaluating empty cart', () => {
    const readiness = PriceCalculator.evaluatePurchaseReadiness({});
    expect(readiness.canCapturePayment).toBe(false);
    expect(readiness.status).toBe('READY_FOR_PAYMENT');
    expect(readiness.confirmedItemIds).toHaveLength(0);
    expect(readiness.provisionalItemIds).toHaveLength(0);
    expect(readiness.reason).toContain('Cart is empty');
  });

  describe('isProductPaymentReady strict price & inventory validation', () => {
    const validConfirmedProduct = {
      id: 'inv_101',
      name: 'Certified Ruby 5ct',
      category: 'Precious',
      pricingStatus: 'INVENTORY_CONFIRMED',
      finalPrice: 85000,
      inventorySku: 'RUBY-5CT-001',
      inStock: true,
      price_min: 40000,
      price_max: 200000
    };

    it('approves a genuinely confirmed product with positive finite price, SKU, and inStock', () => {
      expect(PriceCalculator.isProductPaymentReady(validConfirmedProduct)).toBe(true);
    });

    it('rejects product with missing or provisional pricingStatus', () => {
      expect(PriceCalculator.isProductPaymentReady({ ...validConfirmedProduct, pricingStatus: undefined })).toBe(false);
      expect(PriceCalculator.isProductPaymentReady({ ...validConfirmedProduct, pricingStatus: 'PROVISIONAL_RANGE' })).toBe(false);
      expect(PriceCalculator.isProductPaymentReady({ ...validConfirmedProduct, pricingStatus: 'UNKNOWN_STATUS' })).toBe(false);
    });

    it('rejects product with negative, zero, NaN, or infinite finalPrice', () => {
      expect(PriceCalculator.isProductPaymentReady({ ...validConfirmedProduct, finalPrice: 0 })).toBe(false);
      expect(PriceCalculator.isProductPaymentReady({ ...validConfirmedProduct, finalPrice: -500 })).toBe(false);
      expect(PriceCalculator.isProductPaymentReady({ ...validConfirmedProduct, finalPrice: NaN })).toBe(false);
      expect(PriceCalculator.isProductPaymentReady({ ...validConfirmedProduct, finalPrice: Infinity })).toBe(false);
      expect(PriceCalculator.isProductPaymentReady({ ...validConfirmedProduct, finalPrice: -Infinity })).toBe(false);
    });

    it('rejects product with string or object finalPrice', () => {
      expect(PriceCalculator.isProductPaymentReady({ ...validConfirmedProduct, finalPrice: '85000' as any })).toBe(false);
      expect(PriceCalculator.isProductPaymentReady({ ...validConfirmedProduct, finalPrice: null as any })).toBe(false);
    });

    it('rejects product with missing, empty, or whitespace-only inventorySku', () => {
      expect(PriceCalculator.isProductPaymentReady({ ...validConfirmedProduct, inventorySku: undefined })).toBe(false);
      expect(PriceCalculator.isProductPaymentReady({ ...validConfirmedProduct, inventorySku: '' })).toBe(false);
      expect(PriceCalculator.isProductPaymentReady({ ...validConfirmedProduct, inventorySku: '   ' })).toBe(false);
    });

    it('rejects product when inStock is false', () => {
      expect(PriceCalculator.isProductPaymentReady({ ...validConfirmedProduct, inStock: false })).toBe(false);
    });

    it('rejects non-object or null input', () => {
      expect(PriceCalculator.isProductPaymentReady(null)).toBe(false);
      expect(PriceCalculator.isProductPaymentReady(undefined)).toBe(false);
      expect(PriceCalculator.isProductPaymentReady('product_string')).toBe(false);
      expect(PriceCalculator.isProductPaymentReady(123)).toBe(false);
    });
  });
});
