// tests/unit/mini-cart.test.ts
// Unit tests for the shared TypeScript mini-cart component

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initMiniCartAdapter,
  revertMiniCartAdapter,
  isMiniCartAdapterActive,
  resolveProductPrice,
} from '../../src/client/mini-cart';
import { CartManager } from '../../src/cart/cart-manager';

interface MockElement {
  id: string;
  tagName?: string;
  innerHTML: string;
  textContent: string;
  dataset: Record<string, string>;
  classList: {
    add: (cls: string) => void;
    remove: (cls: string) => void;
    contains: (cls: string) => boolean;
  };
  eventListeners: Map<string, Set<(e: any) => void>>;
  addEventListener: (event: string, fn: (e: any) => void) => void;
  removeEventListener: (event: string, fn: (e: any) => void) => void;
  click: () => void;
}

function createMockElement(id: string): MockElement {
  const classes = new Set<string>();
  const listeners = new Map<string, Set<(e: any) => void>>();
  const el: MockElement = {
    id,
    innerHTML: '',
    textContent: '',
    dataset: {},
    classList: {
      add: (cls) => classes.add(cls),
      remove: (cls) => classes.delete(cls),
      contains: (cls) => classes.has(cls),
    },
    eventListeners: listeners,
    addEventListener: (event, fn) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    },
    removeEventListener: (event, fn) => {
      listeners.get(event)?.delete(fn);
    },
    click: () => {
      listeners.get('click')?.forEach((fn) => fn({ preventDefault: () => {} }));
    },
  };
  return el;
}

describe('Stage 2D.0: Shared Mini-Cart Component', () => {
  let mockStorage: Record<string, string>;
  let mockElements: Map<string, MockElement>;
  let windowListeners: Map<string, Set<(e: any) => void>>;
  let originalWindow: unknown;
  let originalDocument: unknown;

  beforeEach(() => {
    mockStorage = {};
    mockElements = new Map();
    windowListeners = new Map();

    originalWindow = globalThis.window;
    originalDocument = globalThis.document;

    // Reset CartManager singleton
    (CartManager as any).instance = null;

    // Setup mock elements for mini-cart
    const itemsEl = createMockElement('cart-items-mini');
    const subtotalEl = createMockElement('cart-subtotal-mini');
    const shippingEl = createMockElement('cart-shipping-mini');
    const totalEl = createMockElement('cart-total-mini');
    const clearBtn = createMockElement('clear-cart-mini');
    const popupEl = createMockElement('cartPopup');
    popupEl.classList.add('hidden');
    const overlayEl = createMockElement('cartOverlay');
    overlayEl.classList.add('hidden');
    const headerEl = createMockElement('header');

    mockElements.set('cart-items-mini', itemsEl);
    mockElements.set('cart-subtotal-mini', subtotalEl);
    mockElements.set('cart-shipping-mini', shippingEl);
    mockElements.set('cart-total-mini', totalEl);
    mockElements.set('clear-cart-mini', clearBtn);
    mockElements.set('cartPopup', popupEl);
    mockElements.set('cartOverlay', overlayEl);
    mockElements.set('header', headerEl);

    // Mock localStorage
    const mockLocalStorage = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => {
        mockStorage[key] = String(value);
      },
      removeItem: (key: string) => {
        delete mockStorage[key];
      },
      clear: () => {
        mockStorage = {};
      },
    };

    // Mock document
    const mockDocument = {
      getElementById: (id: string) => mockElements.get(id) || null,
      body: {
        getAttribute: () => 'shop',
      },
      documentElement: {},
    };

    // Mock window
    const mockWin: any = {
      localStorage: mockLocalStorage,
      document: mockDocument,
      confirm: () => true,
      addEventListener: (event: string, fn: (e: any) => void) => {
        if (!windowListeners.has(event)) windowListeners.set(event, new Set());
        windowListeners.get(event)!.add(fn);
      },
      removeEventListener: (event: string, fn: (e: any) => void) => {
        windowListeners.get(event)?.delete(fn);
      },
      products: [
        { id: 'p1', name: 'Yellow Sapphire', price_min: 40000, price_max: 250000, price: 145000 },
        { id: 'p5', name: 'Emerald', price_min: 8000, price_max: 60000 },
      ],
    };

    (globalThis as any).window = mockWin;
    (globalThis as any).document = mockDocument;
  });

  afterEach(() => {
    revertMiniCartAdapter();
    (CartManager as any).instance = null;
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
  });

  it('resolves product price using legacy assigned price when present', () => {
    // p1 has legacy assigned price: 145000
    const priceP1 = resolveProductPrice('p1');
    expect(priceP1).toBe(145000);

    // p5 only has price_min: 8000
    const priceP5 = resolveProductPrice('p5');
    expect(priceP5).toBe(8000);

    // unknown product returns 0
    const priceUnknown = resolveProductPrice('unknown_xyz');
    expect(priceUnknown).toBe(0);
  });

  it('renders empty cart state when cart is empty', () => {
    initMiniCartAdapter({ force: true });
    expect(isMiniCartAdapterActive()).toBe(true);

    const itemsEl = mockElements.get('cart-items-mini')!;
    const subtotalEl = mockElements.get('cart-subtotal-mini')!;
    const shippingEl = mockElements.get('cart-shipping-mini')!;
    const totalEl = mockElements.get('cart-total-mini')!;

    expect(itemsEl.innerHTML).toContain('Your cart is empty.');
    expect(subtotalEl.textContent).toBe('₹0');
    expect(shippingEl.textContent).toBe('₹0');
    expect(totalEl.textContent).toBe('₹0');
  });

  it('renders line items, subtotal, shipping, and total when cart contains items', () => {
    mockStorage['gon_cart'] = JSON.stringify({ p1: 2 });
    (CartManager as any).instance = null;

    initMiniCartAdapter({ force: true });

    const itemsEl = mockElements.get('cart-items-mini')!;
    const subtotalEl = mockElements.get('cart-subtotal-mini')!;
    const shippingEl = mockElements.get('cart-shipping-mini')!;
    const totalEl = mockElements.get('cart-total-mini')!;

    expect(itemsEl.innerHTML).toContain('Yellow Sapphire');
    expect(itemsEl.innerHTML).toContain('2 × ₹1,45,000');
    expect(itemsEl.innerHTML).toContain('₹2,90,000');

    // Subtotal: 2 * 145000 = 290000
    expect(subtotalEl.textContent).toBe('₹2,90,000');
    // Shipping: 200 (Stage 2F domestic standard delivery)
    expect(shippingEl.textContent).toBe('₹200');
    // Total: 2 * 145000 + 200 shipping = 290200
    expect(totalEl.textContent).toBe('₹2,90,200');
  });

  it('updates reactively when CartManager items change', () => {
    initMiniCartAdapter({ force: true });
    const cartManager = CartManager.getInstance();

    cartManager.addItem('p5', 3); // 3 * 8000 = 24000, 3 * 150000 = 450000

    const itemsEl = mockElements.get('cart-items-mini')!;
    const subtotalEl = mockElements.get('cart-subtotal-mini')!;
    const shippingEl = mockElements.get('cart-shipping-mini')!;
    const totalEl = mockElements.get('cart-total-mini')!;

    expect(itemsEl.innerHTML).toContain('Emerald');
    expect(itemsEl.innerHTML).toContain('3 × ₹8,000');
    expect(subtotalEl.textContent).toBe('₹24,000 – ₹4,50,000');
    expect(shippingEl.textContent).toBe('₹200');
    expect(totalEl.textContent).toBe('₹24,200 – ₹4,50,200');
  });

  it('clears cart when #clear-cart-mini is clicked and confirmed', () => {
    mockStorage['gon_cart'] = JSON.stringify({ p1: 1 });
    (CartManager as any).instance = null;

    initMiniCartAdapter({ force: true });

    const clearBtn = mockElements.get('clear-cart-mini')!;
    clearBtn.click();

    const itemsEl = mockElements.get('cart-items-mini')!;
    const subtotalEl = mockElements.get('cart-subtotal-mini')!;
    const shippingEl = mockElements.get('cart-shipping-mini')!;
    const totalEl = mockElements.get('cart-total-mini')!;

    expect(itemsEl.innerHTML).toContain('Your cart is empty.');
    expect(subtotalEl.textContent).toBe('₹0');
    expect(shippingEl.textContent).toBe('₹0');
    expect(totalEl.textContent).toBe('₹0');
    expect(CartManager.getInstance().getItemCount()).toBe(0);
  });

  it('handles missing subtotal or shipping DOM elements gracefully without throwing', () => {
    mockElements.delete('cart-subtotal-mini');
    mockElements.delete('cart-shipping-mini');
    mockStorage['gon_cart'] = JSON.stringify({ p1: 1 });
    (CartManager as any).instance = null;

    expect(() => {
      initMiniCartAdapter({ force: true });
    }).not.toThrow();

    const totalEl = mockElements.get('cart-total-mini')!;
    expect(totalEl.textContent).toBe('₹1,45,200');
  });

  it('closes popup and overlay when Escape key is pressed', () => {
    initMiniCartAdapter({ force: true });

    const popupEl = mockElements.get('cartPopup')!;
    const overlayEl = mockElements.get('cartOverlay')!;

    // Open popup
    popupEl.classList.remove('hidden');
    overlayEl.classList.remove('hidden');
    expect(popupEl.classList.contains('hidden')).toBe(false);

    // Trigger Escape key
    const keyListeners = windowListeners.get('keydown') || new Set();
    keyListeners.forEach((fn) => fn({ key: 'Escape' }));

    expect(popupEl.classList.contains('hidden')).toBe(true);
    expect(overlayEl.classList.contains('hidden')).toBe(true);
  });

  it('cleans up all listeners and namespaces on revert', () => {
    initMiniCartAdapter({ force: true });
    expect(isMiniCartAdapterActive()).toBe(true);
    expect((window as any).GNMiniCart).toBeDefined();

    revertMiniCartAdapter();
    expect(isMiniCartAdapterActive()).toBe(false);
    expect((window as any).GNMiniCart).toBeUndefined();
  });
});
