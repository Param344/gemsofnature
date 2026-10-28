import { describe, it, expect, beforeEach } from 'vitest';
import { CartManager } from '../../src/cart/cart-manager';

describe('Cart Manager In-Memory Operations', () => {
  let cartManager: CartManager;

  beforeEach(() => {
    cartManager = CartManager.getInstance();
    cartManager.clearCart();
  });

  it('adds valid products and updates item count', () => {
    const success = cartManager.addItem('p1', 2);
    expect(success).toBe(true);
    expect(cartManager.getItemCount()).toBe(2);
    expect(cartManager.getItems()).toEqual({ p1: 2 });
  });

  it('rejects adding invalid product IDs', () => {
    const success = cartManager.addItem('fake_id_123', 1);
    expect(success).toBe(false);
    expect(cartManager.getItemCount()).toBe(0);
  });

  it('updates item quantities and removes when quantity is zero', () => {
    cartManager.addItem('p1', 3);
    cartManager.updateQuantity('p1', 5);
    expect(cartManager.getItems().p1).toBe(5);

    cartManager.updateQuantity('p1', 0);
    expect(cartManager.getItems().p1).toBeUndefined();
    expect(cartManager.getItemCount()).toBe(0);
  });

  it('removes items cleanly', () => {
    cartManager.addItem('p1', 2);
    cartManager.addItem('p2', 1);
    expect(cartManager.getItemCount()).toBe(3);

    const removed = cartManager.removeItem('p1');
    expect(removed).toBe(true);
    expect(cartManager.getItems()).toEqual({ p2: 1 });
  });

  it('notifies subscribers upon cart state changes', () => {
    let callCount = 0;
    let lastCart = {};

    const unsubscribe = cartManager.subscribe((cart) => {
      callCount++;
      lastCart = cart;
    });

    // Immediate callback on subscribe
    expect(callCount).toBe(1);

    cartManager.addItem('p5', 1);
    expect(callCount).toBe(2);
    expect(lastCart).toEqual({ p5: 1 });

    unsubscribe();
    cartManager.addItem('p6', 1);
    // Unsubscribed, count should remain 2
    expect(callCount).toBe(2);
  });
});
