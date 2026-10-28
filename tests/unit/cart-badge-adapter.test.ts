// tests/unit/cart-badge-adapter.test.ts
// Unit tests for the reversible header cart-badge adapter

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initCartBadgeAdapter,
  revertCartBadgeAdapter,
  isCartBadgeAdapterActive,
  updateCartBadge,
  getCartBadgeCount,
} from '../../src/client/cart-badge-adapter';
import { CartManager } from '../../src/cart/cart-manager';

interface MockElement {
  id: string;
  textContent: string;
  classList: {
    add: (cls: string) => void;
    remove: (cls: string) => void;
    contains: (cls: string) => boolean;
  };
}

describe('Stage 2C.1: Reversible Header Cart-Badge Adapter', () => {
  let mockStorage: Record<string, string>;
  let mockElements: Map<string, MockElement>;
  let eventListeners: Map<string, Set<(event: unknown) => void>>;
  let originalWindow: unknown;
  let originalDocument: unknown;

  let originalMutationObserver: unknown;

  class MockMutationObserver {
    public static instances: MockMutationObserver[] = [];
    public callback: (mutations: Array<{ type: string; target?: unknown }>, observer: MockMutationObserver) => void;
    public target: unknown = null;
    public options: unknown = null;
    public isConnected = false;

    constructor(callback: (mutations: Array<{ type: string; target?: unknown }>, observer: MockMutationObserver) => void) {
      this.callback = callback;
      MockMutationObserver.instances.push(this);
    }

    observe(target: unknown, options: unknown): void {
      this.target = target;
      this.options = options;
      this.isConnected = true;
    }

    disconnect(): void {
      this.isConnected = false;
    }

    trigger(mutations: Array<{ type: string; target?: unknown }>): void {
      if (this.isConnected) {
        this.callback(mutations, this);
      }
    }
  }

  function createMockElement(id: string, initialText = '0', isHidden = true): MockElement {
    const classes = new Set<string>();
    if (isHidden) classes.add('hidden');

    return {
      id,
      textContent: initialText,
      classList: {
        add: (cls: string) => { classes.add(cls); },
        remove: (cls: string) => { classes.delete(cls); },
        contains: (cls: string) => classes.has(cls),
      },
    };
  }

  beforeEach(() => {
    mockStorage = {};
    mockElements = new Map();
    eventListeners = new Map();

    originalWindow = (global as unknown as { window?: unknown }).window;
    originalDocument = (global as unknown as { document?: unknown }).document;
    originalMutationObserver = (global as unknown as { MutationObserver?: unknown }).MutationObserver;

    MockMutationObserver.instances = [];
    // @ts-expect-error Mocking global MutationObserver
    global.MutationObserver = MockMutationObserver;

    // Create standard header badge and container elements
    mockElements.set('header', createMockElement('header', '', false));
    mockElements.set('cartCount', createMockElement('cartCount', '0', true));
    mockElements.set('cartCountLabel', createMockElement('cartCountLabel', '0 items in cart', false));

    const mockBody = createMockElement('body', '', false);
    const mockDocEl = createMockElement('html', '', false);

    const fakeWindow: Record<string, unknown> = {
      localStorage: {
        getItem: (k: string) => mockStorage[k] ?? null,
        setItem: (k: string, v: string) => { mockStorage[k] = String(v); },
        removeItem: (k: string) => { delete mockStorage[k]; },
        clear: () => { mockStorage = {}; },
      },
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        if (!eventListeners.has(type)) eventListeners.set(type, new Set());
        eventListeners.get(type)!.add(listener);
      },
      removeEventListener: (type: string, listener: (event: unknown) => void) => {
        if (eventListeners.has(type)) {
          eventListeners.get(type)!.delete(listener);
        }
      },
    };

    const fakeDocument: Record<string, unknown> = {
      body: mockBody,
      documentElement: mockDocEl,
      getElementById: (id: string) => mockElements.get(id) || null,
      querySelector: (sel: string) => {
        if (sel.includes('#cartCount')) return mockElements.get('cartCount') || null;
        return null;
      },
    };

    // @ts-expect-error Mocking global window & document for test environment
    global.window = fakeWindow;
    // @ts-expect-error Mocking global document
    global.document = fakeDocument;

    // Reset CartManager singleton state
    const manager = CartManager.getInstance();
    manager.clearCart();
  });

  afterEach(() => {
    revertCartBadgeAdapter();

    // Reset global references
    if (originalMutationObserver !== undefined) {
      // @ts-expect-error Restoring global MutationObserver
      global.MutationObserver = originalMutationObserver;
    } else {
      // @ts-expect-error Cleaning global MutationObserver
      delete global.MutationObserver;
    }

    if (originalWindow !== undefined) {
      // @ts-expect-error Restoring global window
      global.window = originalWindow;
    } else {
      // @ts-expect-error Cleaning global window
      delete global.window;
    }

    if (originalDocument !== undefined) {
      // @ts-expect-error Restoring global document
      global.document = originalDocument;
    } else {
      // @ts-expect-error Cleaning global document
      delete global.document;
    }
  });

  describe('1. V1 Badge-Count Semantics & Formatting', () => {
    it('formats empty cart as 0 with hidden class and zero-item label', () => {
      initCartBadgeAdapter();

      const badge = mockElements.get('cartCount');
      const label = mockElements.get('cartCountLabel');

      expect(badge?.textContent).toBe('0');
      expect(badge?.classList.contains('hidden')).toBe(true);
      expect(label?.textContent).toBe('0 items in cart');
      expect(getCartBadgeCount()).toBe(0);
    });

    it('updates badge for one product with quantity one (removes hidden class)', () => {
      initCartBadgeAdapter();
      const manager = CartManager.getInstance();

      manager.addItem('p1', 1);

      const badge = mockElements.get('cartCount');
      const label = mockElements.get('cartCountLabel');

      expect(badge?.textContent).toBe('1');
      expect(badge?.classList.contains('hidden')).toBe(false);
      expect(label?.textContent).toBe('1 item in cart');
      expect(getCartBadgeCount()).toBe(1);
    });

    it('displays total quantity when one product has quantity greater than one', () => {
      initCartBadgeAdapter();
      const manager = CartManager.getInstance();

      manager.addItem('p1', 4);

      const badge = mockElements.get('cartCount');
      const label = mockElements.get('cartCountLabel');

      expect(badge?.textContent).toBe('4');
      expect(badge?.classList.contains('hidden')).toBe(false);
      expect(label?.textContent).toBe('4 items in cart');
    });

    it('sums total quantity across multiple distinct product IDs', () => {
      initCartBadgeAdapter();
      const manager = CartManager.getInstance();

      manager.addItem('p1', 2);
      manager.addItem('p2', 3);
      manager.addItem('p5', 5);

      const badge = mockElements.get('cartCount');
      const label = mockElements.get('cartCountLabel');

      // 2 + 3 + 5 = 10 total quantity
      expect(badge?.textContent).toBe('10');
      expect(label?.textContent).toBe('10 items in cart');
      expect(getCartBadgeCount()).toBe(10);
    });
  });

  describe('2. Unknown, Corrupt, and Metadata-Only Product IDs', () => {
    it('refuses to increment badge for unknown or recommender bug IDs (r1)', () => {
      initCartBadgeAdapter();
      const manager = CartManager.getInstance();

      const addedFake = manager.addItem('r1', 2);
      const addedUnknown = manager.addItem('unknown_gem_999', 1);

      expect(addedFake).toBe(false);
      expect(addedUnknown).toBe(false);

      const badge = mockElements.get('cartCount');
      expect(badge?.textContent).toBe('0');
      expect(badge?.classList.contains('hidden')).toBe(true);
    });

    it('refuses to increment badge for unactivated metadata-only IDs (p127, p128, p129, p135)', () => {
      initCartBadgeAdapter();
      const manager = CartManager.getInstance();

      expect(manager.addItem('p127', 1)).toBe(false);
      expect(manager.addItem('p128', 1)).toBe(false);
      expect(manager.addItem('p129', 1)).toBe(false);
      expect(manager.addItem('p135', 1)).toBe(false);

      const badge = mockElements.get('cartCount');
      expect(badge?.textContent).toBe('0');
      expect(getCartBadgeCount()).toBe(0);
    });

    it('sanitizes corrupt localStorage data and displays only valid quantity', () => {
      // Preload localStorage with a mix of valid, orphan, and invalid keys
      mockStorage['gon_cart'] = JSON.stringify({
        p1: 2,
        p127: 5, // orphan metadata
        r1: 3,   // old recommender bug
        invalid: 10,
        p2: 3,
      });

      initCartBadgeAdapter();

      const badge = mockElements.get('cartCount');
      // Only p1 (2) + p2 (3) = 5 should be accepted
      expect(badge?.textContent).toBe('5');
      expect(getCartBadgeCount()).toBe(5);
    });
  });

  describe('3. Missing DOM Elements & Robustness', () => {
    it('safely handles missing cartCount badge element without throwing', () => {
      mockElements.delete('cartCount');

      expect(() => {
        initCartBadgeAdapter();
      }).not.toThrow();

      expect(() => {
        updateCartBadge();
      }).not.toThrow();

      expect(getCartBadgeCount()).toBe(0);
    });

    it('safely handles missing cartCountLabel without throwing', () => {
      mockElements.delete('cartCountLabel');
      initCartBadgeAdapter();

      const manager = CartManager.getInstance();
      manager.addItem('p1', 2);

      const badge = mockElements.get('cartCount');
      expect(badge?.textContent).toBe('2');
    });

    it('safely handles complete absence of document', () => {
      // @ts-expect-error Clearing document
      delete global.document;

      expect(() => {
        updateCartBadge();
      }).not.toThrow();
      expect(updateCartBadge()).toBe(0);
    });
  });

  describe('4. Lifecycle, Idempotency & Reversibility', () => {
    it('is strictly idempotent on repeated initialization', () => {
      initCartBadgeAdapter();
      expect(isCartBadgeAdapterActive()).toBe(true);

      // Repeated calls must be safe no-ops
      initCartBadgeAdapter();
      initCartBadgeAdapter();
      expect(isCartBadgeAdapterActive()).toBe(true);

      // Verify listeners don't accumulate
      const manager = CartManager.getInstance();
      manager.addItem('p1', 1);

      const badge = mockElements.get('cartCount');
      expect(badge?.textContent).toBe('1');
    });

    it('reverts cleanly, disconnects listeners, and restores original pointers', () => {
      let legacyCallCount = 0;
      const originalLegacyFunc = () => { legacyCallCount++; };

      // Set pre-existing global function
      (global.window as unknown as Record<string, unknown>).updateHeaderCartCount = originalLegacyFunc;

      initCartBadgeAdapter();
      expect(isCartBadgeAdapterActive()).toBe(true);
      expect((global.window as unknown as Record<string, unknown>).GNCartBadge).toBeDefined();

      // Calling updateHeaderCartCount through adapter wraps CartManager
      (global.window as unknown as { updateHeaderCartCount: () => void }).updateHeaderCartCount();
      expect(isCartBadgeAdapterActive()).toBe(true);

      // Revert adapter
      revertCartBadgeAdapter();
      expect(isCartBadgeAdapterActive()).toBe(false);
      expect((global.window as unknown as Record<string, unknown>).GNCartBadge).toBeUndefined();

      // Original function pointer must be restored exactly
      expect((global.window as unknown as Record<string, unknown>).updateHeaderCartCount).toBe(originalLegacyFunc);

      // CartManager updates after revert must not touch badge
      const manager = CartManager.getInstance();
      manager.addItem('p5', 5);

      const badge = mockElements.get('cartCount');
      // Remains unchanged because adapter is disconnected
      expect(badge?.textContent).toBe('0');
    });

    it('supports clean reinitialization after teardown', () => {
      initCartBadgeAdapter();
      revertCartBadgeAdapter();
      expect(isCartBadgeAdapterActive()).toBe(false);

      // Reinitialize
      initCartBadgeAdapter();
      expect(isCartBadgeAdapterActive()).toBe(true);

      const manager = CartManager.getInstance();
      manager.addItem('p1', 3);

      const badge = mockElements.get('cartCount');
      expect(badge?.textContent).toBe('3');
    });

    it('reverting when never initialized is a safe no-op', () => {
      expect(() => {
        revertCartBadgeAdapter();
      }).not.toThrow();
      expect(isCartBadgeAdapterActive()).toBe(false);
    });
  });

  describe('5. Reactive Cart Updates & Multi-Tab Synchronization', () => {
    it('reacts immediately to quantity changes and removals', () => {
      initCartBadgeAdapter();
      const manager = CartManager.getInstance();
      const badge = mockElements.get('cartCount');

      manager.addItem('p1', 5);
      expect(badge?.textContent).toBe('5');

      manager.updateQuantity('p1', 2);
      expect(badge?.textContent).toBe('2');

      manager.removeItem('p1');
      expect(badge?.textContent).toBe('0');
      expect(badge?.classList.contains('hidden')).toBe(true);

      manager.addItem('p2', 1);
      expect(badge?.textContent).toBe('1');
      manager.clearCart();
      expect(badge?.textContent).toBe('0');
      expect(badge?.classList.contains('hidden')).toBe(true);
    });

    it('synchronizes badge on localStorage storage event from another tab', () => {
      initCartBadgeAdapter();
      const badge = mockElements.get('cartCount');
      expect(badge?.textContent).toBe('0');

      // Simulate another tab writing to localStorage and dispatching storage event
      mockStorage['gon_cart'] = JSON.stringify({ p1: 3, p5: 2 });

      const storageListeners = eventListeners.get('storage');
      expect(storageListeners).toBeDefined();
      expect(storageListeners?.size).toBe(1);

      // Dispatch event
      const storageEvent = { key: 'gon_cart' } as StorageEvent;
      storageListeners?.forEach(fn => fn(storageEvent));

      // Badge must update to 3 + 2 = 5
      expect(badge?.textContent).toBe('5');
      expect(getCartBadgeCount()).toBe(5);
    });

    it('ignores storage events for unrelated keys', () => {
      initCartBadgeAdapter();
      const badge = mockElements.get('cartCount');

      const storageListeners = eventListeners.get('storage');
      const unrelatedEvent = { key: 'user_theme' } as StorageEvent;
      storageListeners?.forEach(fn => fn(unrelatedEvent));

      expect(badge?.textContent).toBe('0');
    });
  });

  describe('6. Stage 2C.1.1: Cart-Badge Synchronization Audit — 10 Required Scenarios', () => {
    it('Scenario 1: Initial badge state when gon_cart already contains items before adapter initializes', () => {
      mockStorage['gon_cart'] = JSON.stringify({ p1: 2, p2: 3 });

      initCartBadgeAdapter();

      const badge = mockElements.get('cartCount');
      const label = mockElements.get('cartCountLabel');
      expect(badge?.textContent).toBe('5');
      expect(badge?.classList.contains('hidden')).toBe(false);
      expect(label?.textContent).toBe('5 items in cart');
      expect(getCartBadgeCount()).toBe(5);
    });

    it('Scenario 2: Quantity changes made through CartManager', () => {
      initCartBadgeAdapter();
      const manager = CartManager.getInstance();
      const badge = mockElements.get('cartCount');
      const label = mockElements.get('cartCountLabel');

      manager.addItem('p1', 2);
      expect(badge?.textContent).toBe('2');
      expect(badge?.classList.contains('hidden')).toBe(false);
      expect(label?.textContent).toBe('2 items in cart');

      manager.updateQuantity('p1', 7);
      expect(badge?.textContent).toBe('7');
      expect(label?.textContent).toBe('7 items in cart');

      manager.addItem('p5', 3);
      expect(badge?.textContent).toBe('10');
      expect(label?.textContent).toBe('10 items in cart');
      expect(getCartBadgeCount()).toBe(10);
    });

    it('Scenario 3: Item removal and cart clearing', () => {
      initCartBadgeAdapter();
      const manager = CartManager.getInstance();
      const badge = mockElements.get('cartCount');
      const label = mockElements.get('cartCountLabel');

      manager.addItem('p1', 3);
      manager.addItem('p2', 2);
      expect(badge?.textContent).toBe('5');

      manager.removeItem('p1');
      expect(badge?.textContent).toBe('2');
      expect(badge?.classList.contains('hidden')).toBe(false);
      expect(label?.textContent).toBe('2 items in cart');

      manager.clearCart();
      expect(badge?.textContent).toBe('0');
      expect(badge?.classList.contains('hidden')).toBe(true);
      expect(label?.textContent).toBe('0 items in cart');
      expect(getCartBadgeCount()).toBe(0);
    });

    it('Scenario 4: Direct gon_cart updates from legacy code in the same tab', () => {
      initCartBadgeAdapter();
      const badge = mockElements.get('cartCount');
      const label = mockElements.get('cartCountLabel');

      // Legacy script directly writes to localStorage without calling updateHeaderCartCount
      // (e.g. index.html recommender quiz line 1127)
      window.localStorage.setItem('gon_cart', JSON.stringify({ p1: 4, p5: 2 }));

      expect(badge?.textContent).toBe('6');
      expect(badge?.classList.contains('hidden')).toBe(false);
      expect(label?.textContent).toBe('6 items in cart');
      expect(getCartBadgeCount()).toBe(6);

      // Legacy script overwrites with single item
      window.localStorage.setItem('gon_cart', JSON.stringify({ p1: 1 }));
      expect(badge?.textContent).toBe('1');
      expect(label?.textContent).toBe('1 item in cart');

      // Legacy script removes gon_cart
      window.localStorage.removeItem('gon_cart');
      expect(badge?.textContent).toBe('0');
      expect(badge?.classList.contains('hidden')).toBe(true);
      expect(label?.textContent).toBe('0 items in cart');
      expect(getCartBadgeCount()).toBe(0);

      // Legacy script clears localStorage
      window.localStorage.setItem('gon_cart', JSON.stringify({ p2: 3 }));
      expect(badge?.textContent).toBe('3');
      window.localStorage.clear();
      expect(badge?.textContent).toBe('0');
      expect(badge?.classList.contains('hidden')).toBe(true);
      expect(label?.textContent).toBe('0 items in cart');
    });

    it('Scenario 5: gon_cart changes from another tab via the storage event', () => {
      initCartBadgeAdapter();
      const badge = mockElements.get('cartCount');
      const label = mockElements.get('cartCountLabel');

      mockStorage['gon_cart'] = JSON.stringify({ p2: 4, p6: 1 });
      const storageListeners = eventListeners.get('storage');
      expect(storageListeners).toBeDefined();

      storageListeners?.forEach(fn => fn({ key: 'gon_cart' } as StorageEvent));

      expect(badge?.textContent).toBe('5');
      expect(badge?.classList.contains('hidden')).toBe(false);
      expect(label?.textContent).toBe('5 items in cart');
      expect(getCartBadgeCount()).toBe(5);

      // Cross-tab clear event
      mockStorage['gon_cart'] = JSON.stringify({});
      storageListeners?.forEach(fn => fn({ key: 'gon_cart' } as StorageEvent));

      expect(badge?.textContent).toBe('0');
      expect(badge?.classList.contains('hidden')).toBe(true);
      expect(label?.textContent).toBe('0 items in cart');
    });

    it('Scenario 6: Header injection after adapter initialization', () => {
      // Start with header elements absent from DOM
      mockElements.delete('cartCount');
      mockElements.delete('cartCountLabel');

      // Prepopulate cart in localStorage
      mockStorage['gon_cart'] = JSON.stringify({ p1: 3 });

      // Initialize adapter (target is documentElement/body fallback)
      initCartBadgeAdapter();
      expect(MockMutationObserver.instances.length).toBe(1);

      // Header is dynamically injected by layout.js
      const injectedBadge = createMockElement('cartCount', '0', true);
      const injectedLabel = createMockElement('cartCountLabel', '0 items in cart', false);
      mockElements.set('cartCount', injectedBadge);
      mockElements.set('cartCountLabel', injectedLabel);

      // MutationObserver triggers on childList insertion
      MockMutationObserver.instances[0]!.trigger([{ type: 'childList' }]);

      // Injected badge must be synchronized immediately to current cart state
      expect(injectedBadge.textContent).toBe('3');
      expect(injectedBadge.classList.contains('hidden')).toBe(false);
      expect(injectedLabel.textContent).toBe('3 items in cart');
    });

    it('Scenario 7: Header replacement or reinjection without duplicate observers or listeners', () => {
      initCartBadgeAdapter();
      const manager = CartManager.getInstance();
      manager.addItem('p1', 4);

      expect(MockMutationObserver.instances.length).toBe(1);

      // Header is reloaded or replaced with a new element
      const replacedBadge = createMockElement('cartCount', '0', true);
      const replacedLabel = createMockElement('cartCountLabel', '0 items in cart', false);
      mockElements.set('cartCount', replacedBadge);
      mockElements.set('cartCountLabel', replacedLabel);

      // MutationObserver detects replacement
      MockMutationObserver.instances[0]!.trigger([{ type: 'childList' }]);
      expect(replacedBadge.textContent).toBe('4');
      expect(replacedBadge.classList.contains('hidden')).toBe(false);

      // Repeated initCartBadgeAdapter() must not add duplicate observers or listeners
      const storageListenersBefore = eventListeners.get('storage')?.size ?? 0;
      initCartBadgeAdapter();
      initCartBadgeAdapter();

      expect(MockMutationObserver.instances.length).toBe(1);
      expect(eventListeners.get('storage')?.size).toBe(storageListenersBefore);
    });

    it('Scenario 8: Repeated initialization and teardown followed by reinitialization', () => {
      initCartBadgeAdapter();
      expect(isCartBadgeAdapterActive()).toBe(true);

      revertCartBadgeAdapter();
      expect(isCartBadgeAdapterActive()).toBe(false);
      expect(MockMutationObserver.instances[0]!.isConnected).toBe(false);

      // Reinitialize
      initCartBadgeAdapter();
      expect(isCartBadgeAdapterActive()).toBe(true);
      expect(MockMutationObserver.instances[1]!.isConnected).toBe(true);

      const manager = CartManager.getInstance();
      manager.addItem('p2', 3);

      const badge = mockElements.get('cartCount');
      expect(badge?.textContent).toBe('3');

      // Final revert
      revertCartBadgeAdapter();
      expect(isCartBadgeAdapterActive()).toBe(false);
      expect(MockMutationObserver.instances[1]!.isConnected).toBe(false);
    });

    it('Scenario 9: Unknown and metadata-only product IDs', () => {
      initCartBadgeAdapter();
      const manager = CartManager.getInstance();

      // Unknown IDs
      expect(manager.addItem('r1', 1)).toBe(false);
      expect(manager.addItem('nonexistent_gem', 2)).toBe(false);

      // Metadata-only unactivated IDs
      expect(manager.addItem('p127', 1)).toBe(false);
      expect(manager.addItem('p128', 1)).toBe(false);
      expect(manager.addItem('p129', 1)).toBe(false);
      expect(manager.addItem('p135', 1)).toBe(false);

      const badge = mockElements.get('cartCount');
      expect(badge?.textContent).toBe('0');
      expect(badge?.classList.contains('hidden')).toBe(true);
      expect(getCartBadgeCount()).toBe(0);

      // Same-tab direct injection of corrupt and valid items
      window.localStorage.setItem('gon_cart', JSON.stringify({
        p1: 2,
        r1: 5,
        p127: 10,
        unknown_id: 3,
        p5: 3,
      }));

      // Only valid products p1 (2) + p5 (3) = 5 must be reflected
      expect(badge?.textContent).toBe('5');
      expect(getCartBadgeCount()).toBe(5);
    });

    it('Scenario 10: Empty cart hiding the badge and resetting the accessibility label', () => {
      initCartBadgeAdapter();
      const manager = CartManager.getInstance();
      const badge = mockElements.get('cartCount');
      const label = mockElements.get('cartCountLabel');

      // Transition empty -> populated
      manager.addItem('p1', 5);
      expect(badge?.textContent).toBe('5');
      expect(badge?.classList.contains('hidden')).toBe(false);
      expect(label?.textContent).toBe('5 items in cart');

      // Transition populated -> empty via clearCart()
      manager.clearCart();
      expect(badge?.textContent).toBe('0');
      expect(badge?.classList.contains('hidden')).toBe(true);
      expect(label?.textContent).toBe('0 items in cart');

      // Transition empty -> 1 item -> remove to empty
      manager.addItem('p2', 1);
      expect(badge?.textContent).toBe('1');
      expect(badge?.classList.contains('hidden')).toBe(false);
      expect(label?.textContent).toBe('1 item in cart');

      manager.removeItem('p2');
      expect(badge?.textContent).toBe('0');
      expect(badge?.classList.contains('hidden')).toBe(true);
      expect(label?.textContent).toBe('0 items in cart');

      // Transition empty -> 3 items -> updateQuantity to 0
      manager.addItem('p5', 3);
      expect(badge?.textContent).toBe('3');
      expect(badge?.classList.contains('hidden')).toBe(false);

      manager.updateQuantity('p5', 0);
      expect(badge?.textContent).toBe('0');
      expect(badge?.classList.contains('hidden')).toBe(true);
      expect(label?.textContent).toBe('0 items in cart');
    });
  });

  describe('7. Stage 2C.1.2: Storage Interception Safety & Overlapping Wrapper Review', () => {
    it('preserves native QuotaExceededError and does not falsely update cart on failed setItem', () => {
      initCartBadgeAdapter();
      const badge = mockElements.get('cartCount');
      expect(badge?.textContent).toBe('0');

      // Make native setItem throw QuotaExceededError
      const quotaError = new Error('QuotaExceededError: DOM Exception 22');
      const originalSet = window.localStorage.setItem;
      window.localStorage.setItem = () => {
        throw quotaError;
      };

      // Calling setItem should throw native error
      expect(() => {
        window.localStorage.setItem('gon_cart', JSON.stringify({ p1: 5 }));
      }).toThrow('QuotaExceededError');

      // Badge must NOT have been updated (failed operation does not create a false cart update)
      expect(badge?.textContent).toBe('0');
      expect(badge?.classList.contains('hidden')).toBe(true);
      expect(getCartBadgeCount()).toBe(0);

      // Restore
      window.localStorage.setItem = originalSet;
    });

    it('preserves native exceptions on removeItem and clear without updating badge', () => {
      initCartBadgeAdapter();
      const manager = CartManager.getInstance();
      manager.addItem('p1', 2);
      const badge = mockElements.get('cartCount');
      expect(badge?.textContent).toBe('2');

      // Make native removeItem throw
      const removeError = new Error('SecurityError');
      const originalRemove = window.localStorage.removeItem;
      window.localStorage.removeItem = () => {
        throw removeError;
      };

      expect(() => {
        window.localStorage.removeItem('gon_cart');
      }).toThrow('SecurityError');

      // Badge must remain at 2 because the storage removal failed
      expect(badge?.textContent).toBe('2');

      // Make native clear throw
      const clearError = new Error('SecurityError');
      const originalClear = window.localStorage.clear;
      window.localStorage.clear = () => {
        throw clearError;
      };

      expect(() => {
        window.localStorage.clear();
      }).toThrow('SecurityError');

      expect(badge?.textContent).toBe('2');

      window.localStorage.removeItem = originalRemove;
      window.localStorage.clear = originalClear;
    });

    it('does not trigger cart reload or badge update for unrelated storage keys', () => {
      initCartBadgeAdapter();
      const badge = mockElements.get('cartCount');
      const label = mockElements.get('cartCountLabel');

      // Add valid product to start
      const manager = CartManager.getInstance();
      manager.addItem('p1', 1);
      expect(badge?.textContent).toBe('1');

      // Mutate unrelated keys
      window.localStorage.setItem('user_theme', 'dark');
      window.localStorage.setItem('session_token', 'xyz-123');
      window.localStorage.removeItem('user_theme');

      // Cart badge must remain exactly 1, unaffected
      expect(badge?.textContent).toBe('1');
      expect(label?.textContent).toBe('1 item in cart');
      expect(getCartBadgeCount()).toBe(1);
    });

    it('preserves downstream wrappers on localStorage.setItem installed after adapter and becomes inert pass-through on teardown', () => {
      initCartBadgeAdapter();
      expect(isCartBadgeAdapterActive()).toBe(true);

      // Simulate a third-party analytics or logging wrapper installed AFTER this adapter
      const interceptedKeys: string[] = [];
      const underlyingAdapterWrapper = window.localStorage.setItem;
      const downstreamWrapper = function (this: Storage, key: string, value: string) {
        interceptedKeys.push(key);
        return underlyingAdapterWrapper.call(this, key, value);
      };
      window.localStorage.setItem = downstreamWrapper;

      // Revert our adapter
      revertCartBadgeAdapter();
      expect(isCartBadgeAdapterActive()).toBe(false);

      // The downstream wrapper MUST NOT have been overwritten by teardown!
      expect(window.localStorage.setItem).toBe(downstreamWrapper);

      // Calling setItem through the downstream wrapper succeeds
      window.localStorage.setItem('test_key', 'test_val');
      expect(interceptedKeys).toContain('test_key');
      expect(mockStorage['test_key']).toBe('test_val');

      // Mutating gon_cart through the downstream wrapper must NOT update badge because adapter is inactive
      const badge = mockElements.get('cartCount');
      expect(badge?.textContent).toBe('0');
      window.localStorage.setItem('gon_cart', JSON.stringify({ p1: 4 }));
      expect(interceptedKeys).toContain('gon_cart');
      expect(mockStorage['gon_cart']).toBe(JSON.stringify({ p1: 4 }));

      // Badge must remain at 0 because the reverted adapter acted as an inert pass-through
      expect(badge?.textContent).toBe('0');
    });

    it('preserves downstream wrappers on window.updateHeaderCartCount installed after adapter and becomes inert pass-through on teardown', () => {
      initCartBadgeAdapter();
      expect(isCartBadgeAdapterActive()).toBe(true);

      // Simulate downstream wrapper on window.updateHeaderCartCount
      let downstreamWrapperCalled = false;
      const underlyingAdapterUpdate = window.updateHeaderCartCount!;
      const downstreamUpdateWrapper = function (legacyCount?: number) {
        downstreamWrapperCalled = true;
        underlyingAdapterUpdate(legacyCount);
      };
      window.updateHeaderCartCount = downstreamUpdateWrapper;

      // Teardown
      revertCartBadgeAdapter();
      expect(isCartBadgeAdapterActive()).toBe(false);

      // Downstream wrapper must remain intact
      expect(window.updateHeaderCartCount).toBe(downstreamUpdateWrapper);

      // Calling downstream wrapper executes without error and does not touch badge
      window.updateHeaderCartCount();
      expect(downstreamWrapperCalled).toBe(true);
    });

    it('prevents re-entrant sync loops between storage and CartManager', () => {
      initCartBadgeAdapter();
      const manager = CartManager.getInstance();
      const badge = mockElements.get('cartCount');

      // CartManager.addItem internally calls persist() -> saveToStorage() -> localStorage.setItem()
      // Which triggers storage.setItem wrapper -> cartManager.reload() -> notify()
      // This must complete cleanly without recursion error or call-stack overflow
      expect(() => {
        manager.addItem('p1', 2);
        manager.addItem('p2', 3);
        manager.updateQuantity('p1', 5);
        manager.removeItem('p2');
        manager.clearCart();
      }).not.toThrow();

      expect(badge?.textContent).toBe('0');
      expect(badge?.classList.contains('hidden')).toBe(true);
    });

    it('handles non-string keys and native argument passing gracefully', () => {
      initCartBadgeAdapter();
      const badge = mockElements.get('cartCount');

      // Non-string key object or number
      const numKey = 12345;
      window.localStorage.setItem(numKey as unknown as string, 'numeric_value');
      expect(mockStorage['12345']).toBe('numeric_value');
      expect(badge?.textContent).toBe('0');
    });
  });
});
