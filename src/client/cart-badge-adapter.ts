// src/client/cart-badge-adapter.ts
// Reversible client adapter connecting the header cart-count badge to CartManager

import { CartManager } from '../cart/cart-manager';
import { GN_CONFIG } from '../core/config';
import {
  initMiniCartAdapter,
  revertMiniCartAdapter,
  renderMiniCart,
  isMiniCartAdapterActive,
  resolveProductPrice
} from './mini-cart';

export {
  initMiniCartAdapter,
  revertMiniCartAdapter,
  renderMiniCart,
  isMiniCartAdapterActive,
  resolveProductPrice
};

declare global {
  interface Window {
    GNCartBadge?: {
      init: () => void;
      revert: () => void;
      update: () => number;
      isActive: () => boolean;
      getCount: () => number;
    };
    updateHeaderCartCount?: (count?: number) => void;
  }
}

let isAdapterActive = false;
let isSyncingFromStorage = false;
let didDefineUpdateHeaderCartCount = false;
let originalUpdateHeaderCartCount: ((count?: number) => void) | undefined;
let wrappedUpdateHeaderCartCount: ((count?: number) => void) | undefined;
let unsubscribeCartManager: (() => void) | undefined;
let storageListener: ((event: StorageEvent) => void) | undefined;
let domObserver: MutationObserver | null = null;
let originalStorageSetItem: ((key: string, value: string) => void) | undefined;
let originalStorageRemoveItem: ((key: string) => void) | undefined;
let originalStorageClear: (() => void) | undefined;
let wrappedStorageSetItem: ((key: string, value: string) => void) | undefined;
let wrappedStorageRemoveItem: ((key: string) => void) | undefined;
let wrappedStorageClear: (() => void) | undefined;

/**
 * Updates the DOM header badge elements (#cartCount and #cartCountLabel)
 * according to current CartManager item count (total quantity) and V1 semantics.
 * Safe to call even when badge or header is missing from the DOM.
 */
let isUpdatingBadge = false;

export function updateCartBadge(): number {
  if (typeof document === 'undefined') return 0;
  if (isUpdatingBadge) return getCartBadgeCount();

  isUpdatingBadge = true;
  try {
    const cartManager = CartManager.getInstance();
    const count = cartManager.getItemCount();

    const badge = document.getElementById('cartCount');
    const label = document.getElementById('cartCountLabel');

    if (badge) {
      const countStr = String(count);
      if (badge.textContent !== countStr) {
        badge.textContent = countStr;
      }
      if (count === 0) {
        if (!badge.classList.contains('hidden')) {
          badge.classList.add('hidden');
        }
      } else {
        if (badge.classList.contains('hidden')) {
          badge.classList.remove('hidden');
        }
      }
    }

    if (label) {
      const labelStr = count === 1 ? '1 item in cart' : `${count} items in cart`;
      if (label.textContent !== labelStr) {
        label.textContent = labelStr;
      }
    }

    if (isMiniCartAdapterActive()) {
      renderMiniCart();
    }

    return count;
  } finally {
    isUpdatingBadge = false;
  }
}

/**
 * Returns the current total cart quantity tracked by CartManager.
 */
export function getCartBadgeCount(): number {
  return CartManager.getInstance().getItemCount();
}

/**
 * Initializes the reversible header cart badge adapter.
 * - Idempotent: repeated activation is a safe no-op.
 * - Subscribes to CartManager for reactive intra-page updates.
 * - Synchronizes same-tab direct localStorage updates to 'gon_cart'.
 * - Listens for storage events on 'gon_cart' for multi-tab synchronization.
 * - Hooks/exposes window.updateHeaderCartCount without breaking legacy callers.
 * - Safely handles dynamically injected headers via MutationObserver.
 */
export function initCartBadgeAdapter(): void {
  if (typeof window === 'undefined') return;
  if (isAdapterActive) return; // Idempotent guard

  const cartManager = CartManager.getInstance();
  cartManager.reload();

  // 1. Hook or define window.updateHeaderCartCount safely
  if (typeof window.updateHeaderCartCount === 'function') {
    originalUpdateHeaderCartCount = window.updateHeaderCartCount;
  } else {
    didDefineUpdateHeaderCartCount = true;
  }
  wrappedUpdateHeaderCartCount = (legacyCount?: number) => {
    if (!isAdapterActive) {
      if (originalUpdateHeaderCartCount) {
        originalUpdateHeaderCartCount(legacyCount);
      }
      return;
    }
    if (!isSyncingFromStorage) {
      isSyncingFromStorage = true;
      try {
        cartManager.reload();
        updateCartBadge();
      } finally {
        isSyncingFromStorage = false;
      }
    }
  };
  window.updateHeaderCartCount = wrappedUpdateHeaderCartCount;

  // 2. Subscribe to CartManager changes
  unsubscribeCartManager = cartManager.subscribe(() => {
    updateCartBadge();
  });

  // 3. Same-tab localStorage synchronization with re-entrancy & wrapper safety
  // Note: The browser 'storage' event ONLY fires across different tabs/windows.
  // Intercepting localStorage methods provides seamless same-tab reactive synchronization
  // when legacy code mutates 'gon_cart' directly without calling updateHeaderCartCount.
  try {
    if (typeof window.localStorage !== 'undefined') {
      const storage = window.localStorage;
      originalStorageSetItem = storage.setItem.bind(storage);
      originalStorageRemoveItem = storage.removeItem.bind(storage);
      originalStorageClear = storage.clear.bind(storage);

      wrappedStorageSetItem = function (this: Storage, key: string, _value: string): void {
        const result = originalStorageSetItem!.apply(this, arguments as unknown as [string, string]);
        if (isAdapterActive && !isSyncingFromStorage && String(key) === GN_CONFIG.storageKeys.cart) {
          isSyncingFromStorage = true;
          try {
            cartManager.reload();
            updateCartBadge();
          } finally {
            isSyncingFromStorage = false;
          }
        }
        return result;
      };

      wrappedStorageRemoveItem = function (this: Storage, key: string): void {
        const result = originalStorageRemoveItem!.apply(this, arguments as unknown as [string]);
        if (isAdapterActive && !isSyncingFromStorage && String(key) === GN_CONFIG.storageKeys.cart) {
          isSyncingFromStorage = true;
          try {
            cartManager.reload();
            updateCartBadge();
          } finally {
            isSyncingFromStorage = false;
          }
        }
        return result;
      };

      wrappedStorageClear = function (this: Storage): void {
        const result = originalStorageClear!.apply(this, arguments as unknown as []);
        if (isAdapterActive && !isSyncingFromStorage) {
          isSyncingFromStorage = true;
          try {
            cartManager.reload();
            updateCartBadge();
          } finally {
            isSyncingFromStorage = false;
          }
        }
        return result;
      };

      storage.setItem = wrappedStorageSetItem;
      storage.removeItem = wrappedStorageRemoveItem;
      storage.clear = wrappedStorageClear;
    }
  } catch {
    // Graceful fallback if storage access is restricted (e.g. sandbox/private browsing)
  }

  // 4. Multi-tab synchronization via localStorage 'storage' event
  storageListener = (event: StorageEvent) => {
    if (event.key === GN_CONFIG.storageKeys.cart || event.key === null) {
      if (!isSyncingFromStorage) {
        isSyncingFromStorage = true;
        try {
          cartManager.reload();
          updateCartBadge();
        } finally {
          isSyncingFromStorage = false;
        }
      }
    }
  };
  window.addEventListener('storage', storageListener);

  // 5. Handle dynamic header injection via MutationObserver if available
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    domObserver = new MutationObserver((mutations) => {
      if (isUpdatingBadge) return;
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          const badge = document.getElementById('cartCount');
          // Ignore mutations from badge, label, or mini-cart elements to prevent infinite feedback loops
          const targetNode = mutation.target as HTMLElement | null;
          if (
            targetNode &&
            (targetNode === badge ||
              targetNode.id === 'cartCount' ||
              targetNode.id === 'cartCountLabel' ||
              targetNode.id === 'cart-items-mini' ||
              targetNode.id === 'cart-subtotal-mini' ||
              targetNode.id === 'cart-shipping-mini' ||
              targetNode.id === 'cart-total-mini' ||
              targetNode.id === 'cartPopup' ||
              (typeof targetNode.closest === 'function' && targetNode.closest('#cartPopup')))
          ) {
            continue;
          }
          if (badge) {
            updateCartBadge();
            break;
          }
        }
      }
    });

    const target =
      document.getElementById('header') ||
      (document.body ? document.body : null) ||
      (typeof document.documentElement !== 'undefined' ? document.documentElement : null);
    if (target) {
      domObserver.observe(target, { childList: true, subtree: true });
    }
  }

  // 6. Expose GNCartBadge helper namespace
  window.GNCartBadge = {
    init: initCartBadgeAdapter,
    revert: revertCartBadgeAdapter,
    update: updateCartBadge,
    isActive: isCartBadgeAdapterActive,
    getCount: getCartBadgeCount,
  };

  isAdapterActive = true;

  // Initial update
  updateCartBadge();
  initMiniCartAdapter();
}

/**
 * Reverts the adapter, completely restoring legacy functions and unbinding all listeners.
 * - Safe no-op if never activated.
 * - Sets active state to false so any retained wrappers act as transparent pass-throughs.
 * - Unsubscribes from CartManager.
 * - Safely restores original localStorage methods without overwriting downstream wrappers.
 * - Removes window storage listener.
 * - Disconnects DOM MutationObserver.
 * - Safely restores or deletes window.updateHeaderCartCount.
 * - Deletes window.GNCartBadge.
 */
export function revertCartBadgeAdapter(): void {
  if (typeof window === 'undefined') return;
  if (!isAdapterActive) return;

  // Inactive state set first: any subsequent call through wrappers becomes transparent pass-through
  isAdapterActive = false;
  revertMiniCartAdapter();

  // 1. Unsubscribe from CartManager
  if (unsubscribeCartManager) {
    unsubscribeCartManager();
    unsubscribeCartManager = undefined;
  }

  // 2. Safely restore original localStorage methods without destroying downstream wrappers
  try {
    if (typeof window.localStorage !== 'undefined') {
      const storage = window.localStorage;

      // Only restore storage.setItem if our wrapper is still the active pointer
      if (wrappedStorageSetItem && storage.setItem === wrappedStorageSetItem) {
        if (originalStorageSetItem) {
          storage.setItem = originalStorageSetItem;
          originalStorageSetItem = undefined;
        }
      }
      wrappedStorageSetItem = undefined;

      // Only restore storage.removeItem if our wrapper is still the active pointer
      if (wrappedStorageRemoveItem && storage.removeItem === wrappedStorageRemoveItem) {
        if (originalStorageRemoveItem) {
          storage.removeItem = originalStorageRemoveItem;
          originalStorageRemoveItem = undefined;
        }
      }
      wrappedStorageRemoveItem = undefined;

      // Only restore storage.clear if our wrapper is still the active pointer
      if (wrappedStorageClear && storage.clear === wrappedStorageClear) {
        if (originalStorageClear) {
          storage.clear = originalStorageClear;
          originalStorageClear = undefined;
        }
      }
      wrappedStorageClear = undefined;
    }
  } catch {
    // Ignore revert errors
  }

  // 3. Remove storage listener
  if (storageListener) {
    window.removeEventListener('storage', storageListener);
    storageListener = undefined;
  }

  // 4. Disconnect DOM observer
  if (domObserver) {
    domObserver.disconnect();
    domObserver = null;
  }

  // 5. Restore original window.updateHeaderCartCount without destroying downstream wrappers
  if (wrappedUpdateHeaderCartCount && window.updateHeaderCartCount === wrappedUpdateHeaderCartCount) {
    if (didDefineUpdateHeaderCartCount) {
      delete (window as unknown as Record<string, unknown>).updateHeaderCartCount;
      didDefineUpdateHeaderCartCount = false;
    } else if (originalUpdateHeaderCartCount) {
      window.updateHeaderCartCount = originalUpdateHeaderCartCount;
      originalUpdateHeaderCartCount = undefined;
    }
    wrappedUpdateHeaderCartCount = undefined;
  }

  // 6. Delete global namespace
  delete window.GNCartBadge;
}

/**
 * Returns whether the cart badge adapter is currently active.
 */
export function isCartBadgeAdapterActive(): boolean {
  return isAdapterActive;
}

// Auto-initialize when loaded as a client script in the browser
if (typeof window !== 'undefined') {
  initCartBadgeAdapter();
}
