// src/cart/price-calculator.ts
// Mathematical calculation engine and purchase-readiness gate for shopping cart

import type { CartCalculation, LegacyCartRecord, PurchaseReadinessResult } from '../types/cart';
import type { Product } from '../types/product';
import { getProductById } from '../core/products';

export class PriceCalculator {
  // Approved Stage 2F domestic standard delivery fee
  public static readonly SHIPPING_DOMESTIC_FLAT_INR = 200;
  // Preserved alias for backward compatibility
  public static readonly SHIPPING_FLAT_INR = 200;

  /**
   * Evaluates whether an individual product entity satisfies all requirements
   * for commercial checkout with an owner-approved selling price.
   * Fails closed on any missing, malformed, non-positive, or non-finite price.
   */
  public static isProductPaymentReady(product: unknown): boolean {
    if (!product || typeof product !== 'object') return false;
    const p = product as Record<string, unknown>;
    return (
      p.pricingStatus === 'INVENTORY_CONFIRMED' &&
      typeof p.finalPrice === 'number' &&
      Number.isFinite(p.finalPrice) &&
      p.finalPrice > 0 &&
      typeof p.inventorySku === 'string' &&
      p.inventorySku.trim().length > 0 &&
      p.inStock !== false
    );
  }

  /**
   * Evaluates whether a cart is ready for instant automated payment capture
   * or must proceed as a stone-selection & price-confirmation inquiry.
   */
  public static evaluatePurchaseReadiness(cart: LegacyCartRecord): PurchaseReadinessResult {
    const provisionalItemIds: string[] = [];
    const confirmedItemIds: string[] = [];

    for (const [productId, quantity] of Object.entries(cart)) {
      if (quantity <= 0) continue;
      const product = getProductById(productId);
      if (!product) {
        // Unknown or unpurchasable product ID: fail closed into provisional/inquiry
        provisionalItemIds.push(productId);
        continue;
      }

      if (this.isProductPaymentReady(product)) {
        confirmedItemIds.push(productId);
      } else {
        provisionalItemIds.push(productId);
      }
    }

    if (provisionalItemIds.length > 0) {
      return {
        canCapturePayment: false,
        status: 'PROVISIONAL_INQUIRY',
        provisionalItemIds,
        confirmedItemIds,
        reason: 'Cart contains items with provisional catalogue price ranges. Owner price confirmation and stone selection is required before payment.'
      };
    }

    return {
      canCapturePayment: confirmedItemIds.length > 0,
      status: 'READY_FOR_PAYMENT',
      provisionalItemIds: [],
      confirmedItemIds,
      reason: confirmedItemIds.length > 0
        ? 'All items have confirmed inventory selling prices.'
        : 'Cart is empty.'
    };
  }

  /**
   * Calculates illustrative minimum and maximum subtotal and total bounds
   * for carts containing provisional preliminary catalogue items.
   */
  public static calculateProvisionalRange(cart: LegacyCartRecord): {
    itemCount: number;
    minSubtotal: number;
    maxSubtotal: number;
    shipping: number;
    minTotal: number;
    maxTotal: number;
    isProvisional: boolean;
  } {
    let minSubtotal = 0;
    let maxSubtotal = 0;
    let itemCount = 0;

    for (const [productId, quantity] of Object.entries(cart)) {
      if (quantity <= 0) continue;
      const product = getProductById(productId);
      if (!product) continue;

      const unitMin = typeof product.price_min === 'number' ? product.price_min : 0;
      const unitMax = typeof product.price_max === 'number' ? product.price_max : unitMin;

      minSubtotal += unitMin * quantity;
      maxSubtotal += unitMax * quantity;
      itemCount += quantity;
    }

    const shipping = itemCount > 0 ? this.SHIPPING_DOMESTIC_FLAT_INR : 0;
    const minTotal = minSubtotal + shipping;
    const maxTotal = maxSubtotal + shipping;

    return {
      itemCount,
      minSubtotal,
      maxSubtotal,
      shipping,
      minTotal,
      maxTotal,
      isProvisional: true
    };
  }

  /**
   * Calculates subtotal, shipping, and total for a validated cart with confirmed unit prices.
   * Enforces zero-price protection: products cannot be checked out with unitPrice <= 0.
   */
  public static calculate(
    cart: LegacyCartRecord,
    resolveUnitPrice: (product: Product) => number
  ): CartCalculation {
    let subtotal = 0;
    let itemCount = 0;

    for (const [productId, quantity] of Object.entries(cart)) {
      if (quantity <= 0) continue;

      const product = getProductById(productId);
      if (!product) {
        throw new Error(`[PriceCalculator] Invalid product ID: "${productId}"`);
      }

      const unitPrice = resolveUnitPrice(product);
      if (typeof unitPrice !== 'number' || unitPrice <= 0 || isNaN(unitPrice)) {
        throw new Error(
          `[PriceCalculator] Zero or unapproved price detected for "${product.name}" (${productId}). ` +
          `Commercial checkout without an approved fixed price is strictly forbidden.`
        );
      }

      subtotal += unitPrice * quantity;
      itemCount += quantity;
    }

    const shipping = itemCount > 0 ? this.SHIPPING_DOMESTIC_FLAT_INR : 0;
    const total = subtotal + shipping;

    return {
      subtotal,
      shipping,
      total,
      itemCount
    };
  }
}
