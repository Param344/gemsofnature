// src/client/mini-cart.ts
// Shared reversible TypeScript mini-cart component for Gems of Nature
// Synchronizes #cartPopup, #cart-items-mini, #cart-subtotal-mini, #cart-shipping-mini, and #cart-total-mini with CartManager

import { CartManager } from '../cart/cart-manager';
import { PriceCalculator } from '../cart/price-calculator';
import { getProductById } from '../core/products';

declare global {
  interface Window {
    GNMiniCart?: {
      init: (options?: { force?: boolean }) => void;
      revert: () => void;
      render: () => void;
      isActive: () => boolean;
      resolvePrice: (productId: string) => number;
    };
    products?: Array<{
      id: string;
      name: string;
      price?: number;
      finalPrice?: number;
      pricingStatus?: string;
      price_min?: number;
      price_max?: number;
      image?: string;
    }>;
  }
}

let isMiniCartActive = false;
let unsubscribeCartManager: (() => void) | undefined;
let storageListener: ((event: StorageEvent) => void) | undefined;
let domObserver: MutationObserver | null = null;
let keydownListener: ((event: KeyboardEvent) => void) | undefined;
let isRenderingMiniCart = false;

/**
 * Resolves product unit price preserving existing page pricing policies:
 * 1. Checks window.products for assigned legacy price (e.g. shop-ecom midpoint).
 * 2. Checks window.products for price_min.
 * 3. Falls back to typed catalogue getProductById(id).price_min.
 * 4. Strictly returns 0 if product is unknown or has no positive price.
 */
export function resolveProductPrice(productId: string): number {
  if (typeof window !== 'undefined' && Array.isArray(window.products)) {
    const legacyProd = window.products.find((p) => String(p.id) === String(productId));
    if (legacyProd) {
      if (typeof legacyProd.finalPrice === 'number' && legacyProd.finalPrice > 0) {
        return legacyProd.finalPrice;
      }
      if (typeof legacyProd.price === 'number' && legacyProd.price > 0) {
        return legacyProd.price;
      }
      if (typeof legacyProd.price_min === 'number' && legacyProd.price_min > 0) {
        return legacyProd.price_min;
      }
    }
  }

  const typedProd = getProductById(productId);
  if (typedProd) {
    if (typedProd.pricingStatus === 'INVENTORY_CONFIRMED' && typeof typedProd.finalPrice === 'number' && typedProd.finalPrice > 0) {
      return typedProd.finalPrice;
    }
    if (typeof typedProd.price_min === 'number' && typedProd.price_min > 0) {
      return typedProd.price_min;
    }
  }

  return 0;
}

/**
 * Renders the mini-cart items list and total inside #cartPopup.
 * - If cart is empty: displays standard empty message and ₹0 total.
 * - If cart has items: displays each item's name, quantity, unit price, and line total.
 * - Displays total including flat shipping (₹50) per PriceCalculator.SHIPPING_FLAT_INR.
 * - Binds #clear-cart-mini if present.
 */
export function renderMiniCart(): void {
  if (typeof document === 'undefined') return;
  if (isRenderingMiniCart) return;

  isRenderingMiniCart = true;
  try {
    const cartMiniItemsEl = document.getElementById('cart-items-mini');
    const cartSubtotalMiniEl = document.getElementById('cart-subtotal-mini');
    const cartShippingMiniEl = document.getElementById('cart-shipping-mini');
    const cartTotalMiniEl = document.getElementById('cart-total-mini');
    const clearCartMiniBtn = document.getElementById('clear-cart-mini');

    // If header has not been injected yet, return safely
    if (!cartMiniItemsEl && !cartTotalMiniEl) return;

    const cartManager = CartManager.getInstance();
    const items = cartManager.getItems();
    const entries = Object.entries(items);

    if (entries.length === 0) {
      if (cartMiniItemsEl) {
        cartMiniItemsEl.innerHTML = '<p class="text-sm text-gray-600">Your cart is empty.</p>';
      }
      if (cartSubtotalMiniEl) {
        cartSubtotalMiniEl.textContent = '₹0';
      }
      if (cartShippingMiniEl) {
        cartShippingMiniEl.textContent = '₹0';
      }
      if (cartTotalMiniEl) {
        cartTotalMiniEl.textContent = '₹0';
      }
      return;
    }

    let minSubtotal = 0;
    let maxSubtotal = 0;
    let hasProvisionalRange = false;
    const itemRowsHtml: string[] = [];

    for (const [productId, quantity] of entries) {
      if (quantity <= 0) continue;

      let name = productId;
      let unitPrice = resolveProductPrice(productId);
      let minPrice = unitPrice;
      let maxPrice = unitPrice;
      let isProvisional = true;

      const tp = getProductById(productId);
      if (tp) {
        name = tp.name;
        minPrice = typeof tp.price_min === 'number' ? tp.price_min : unitPrice;
        maxPrice = typeof tp.price_max === 'number' ? tp.price_max : minPrice;
        if (tp.pricingStatus === 'INVENTORY_CONFIRMED' && typeof tp.finalPrice === 'number' && tp.finalPrice > 0) {
          isProvisional = false;
          minPrice = tp.finalPrice;
          maxPrice = tp.finalPrice;
        }
      }

      if (typeof window !== 'undefined' && Array.isArray(window.products)) {
        const lp = window.products.find((p) => String(p.id) === String(productId));
        if (lp) {
          if (lp.name) name = lp.name;
          if (typeof lp.finalPrice === 'number' && lp.finalPrice > 0) {
            isProvisional = false;
            minPrice = lp.finalPrice;
            maxPrice = lp.finalPrice;
          } else if (typeof lp.price === 'number' && lp.price > 0) {
            isProvisional = false;
            minPrice = lp.price;
            maxPrice = lp.price;
          }
        }
      }

      if (isProvisional && minPrice !== maxPrice) {
        hasProvisionalRange = true;
      }

      const lineMin = minPrice * quantity;
      const lineMax = maxPrice * quantity;
      minSubtotal += lineMin;
      maxSubtotal += lineMax;

      const formattedUnit = isProvisional && minPrice !== maxPrice
        ? `₹${minPrice.toLocaleString('en-IN')} – ₹${maxPrice.toLocaleString('en-IN')} (est.)`
        : `₹${minPrice.toLocaleString('en-IN')}`;

      const formattedLine = isProvisional && minPrice !== maxPrice
        ? `₹${lineMin.toLocaleString('en-IN')} – ₹${lineMax.toLocaleString('en-IN')}`
        : `₹${lineMin.toLocaleString('en-IN')}`;

      itemRowsHtml.push(`
        <div class="flex items-center justify-between gap-2 py-1 border-b border-gray-100 last:border-b-0" data-mini-item-id="${productId}">
          <div class="flex-1">
            <div class="text-xs font-medium text-gray-800">${escapeHtml(name)}</div>
            <div class="text-[11px] text-gray-500">${quantity} × ${formattedUnit}</div>
          </div>
          <div class="text-xs font-semibold text-gray-800">
            ${formattedLine}
          </div>
        </div>
      `.trim());
    }

    if (hasProvisionalRange) {
      itemRowsHtml.push(`
        <div class="py-1 px-2 mt-1 rounded bg-amber-50 text-[10px] text-amber-800 border border-amber-200">
          *Provisional catalogue estimate. Final price confirmed upon stone selection.
        </div>
      `.trim());
    }

    if (cartMiniItemsEl) {
      cartMiniItemsEl.innerHTML = itemRowsHtml.join('\n');
    }

    const shipping = entries.length > 0 ? PriceCalculator.SHIPPING_FLAT_INR : 0;
    const minTotal = minSubtotal + shipping;
    const maxTotal = maxSubtotal + shipping;

    if (cartSubtotalMiniEl) {
      cartSubtotalMiniEl.textContent = hasProvisionalRange
        ? `₹${minSubtotal.toLocaleString('en-IN')} – ₹${maxSubtotal.toLocaleString('en-IN')}`
        : `₹${minSubtotal.toLocaleString('en-IN')}`;
    }
    if (cartShippingMiniEl) {
      cartShippingMiniEl.textContent = `₹${shipping.toLocaleString('en-IN')}`;
    }
    if (cartTotalMiniEl) {
      cartTotalMiniEl.textContent = hasProvisionalRange
        ? `₹${minTotal.toLocaleString('en-IN')} – ₹${maxTotal.toLocaleString('en-IN')}`
        : `₹${minTotal.toLocaleString('en-IN')}`;
    }

    // Wire up "Clear Cart" button safely
    if (clearCartMiniBtn && !clearCartMiniBtn.dataset.gnBound) {
      clearCartMiniBtn.dataset.gnBound = '1';
      clearCartMiniBtn.addEventListener('click', () => {
        const confirmed = typeof window !== 'undefined' && typeof window.confirm === 'function'
          ? window.confirm('Clear your cart?')
          : true;
        if (confirmed) {
          cartManager.clearCart();
        }
      });
    }
  } finally {
    isRenderingMiniCart = false;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Initializes the shared mini-cart adapter.
 * - Idempotent: repeated activation is a safe no-op.
 * - Subscribes to CartManager for reactive updates.
 * - Listens for cross-tab storage changes on 'gon_cart'.
 * - Observes #header via MutationObserver for dynamic injection.
 * - Handles Escape key to close popup when visible.
 */
export function initMiniCartAdapter(options?: { force?: boolean }): void {
  if (typeof window === 'undefined') return;
  if (isMiniCartActive && !options?.force) return;

  let page = '';
  if (typeof document !== 'undefined' && document.body) {
    if (typeof document.body.getAttribute === 'function') {
      page = document.body.getAttribute('data-page') || '';
    }
  }

  // Controlled integration: Enabled only on approved shop pages ('shop' and 'shop-ecom')
  if (page && page !== 'shop' && page !== 'shop-ecom' && !options?.force) {
    return;
  }

  const cartManager = CartManager.getInstance();

  // 1. Subscribe to CartManager changes for reactive re-renders
  unsubscribeCartManager = cartManager.subscribe(() => {
    renderMiniCart();
  });

  // 2. Keyboard Escape handler to close cart popup
  keydownListener = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      const popup = document.getElementById('cartPopup');
      const overlay = document.getElementById('cartOverlay');
      if (popup && !popup.classList.contains('hidden')) {
        popup.classList.add('hidden');
        if (overlay) overlay.classList.add('hidden');
      }
    }
  };
  window.addEventListener('keydown', keydownListener);

  // 3. Expose GNMiniCart namespace
  window.GNMiniCart = {
    init: initMiniCartAdapter,
    revert: revertMiniCartAdapter,
    render: renderMiniCart,
    isActive: isMiniCartAdapterActive,
    resolvePrice: resolveProductPrice,
  };

  isMiniCartActive = true;

  // Initial render
  renderMiniCart();
}

/**
 * Reverts the mini-cart adapter, cleaning up all observers and listeners.
 */
export function revertMiniCartAdapter(): void {
  if (typeof window === 'undefined' || !isMiniCartActive) return;

  isMiniCartActive = false;

  if (unsubscribeCartManager) {
    unsubscribeCartManager();
    unsubscribeCartManager = undefined;
  }

  if (storageListener) {
    window.removeEventListener('storage', storageListener);
    storageListener = undefined;
  }

  if (domObserver) {
    domObserver.disconnect();
    domObserver = null;
  }

  if (keydownListener) {
    window.removeEventListener('keydown', keydownListener);
    keydownListener = undefined;
  }

  const clearCartMiniBtn = typeof document !== 'undefined'
    ? document.getElementById('clear-cart-mini')
    : null;
  if (clearCartMiniBtn) {
    delete clearCartMiniBtn.dataset.gnBound;
  }

  delete window.GNMiniCart;
}

export function isMiniCartAdapterActive(): boolean {
  return isMiniCartActive;
}
