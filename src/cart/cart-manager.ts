// src/cart/cart-manager.ts
// Central state manager for the shopping cart

import type { LegacyCartRecord } from '../types/cart';
import { GN_CONFIG } from '../core/config';
import { getProductById } from '../core/products';
import { loadFromStorage, saveToStorage } from '../core/storage';
import { CartValidator } from '../core/validator';

export class CartManager {
  private static instance: CartManager | null = null;
  private cart: LegacyCartRecord = {};
  private listeners: Set<(cart: LegacyCartRecord) => void> = new Set();

  private constructor() {
    this.reload();
  }

  public static getInstance(): CartManager {
    if (!CartManager.instance) {
      CartManager.instance = new CartManager();
    }
    return CartManager.instance;
  }

  /**
   * Reloads and validates cart state from localStorage.
   */
  public reload(): void {
    const raw = loadFromStorage<unknown>(GN_CONFIG.storageKeys.cart, {});
    this.cart = CartValidator.sanitizeCart(raw);
    this.notify();
  }

  public getItems(): LegacyCartRecord {
    return { ...this.cart };
  }

  public getItemCount(): number {
    return Object.values(this.cart).reduce((sum, qty) => sum + qty, 0);
  }

  public addItem(productId: string, quantity = 1): boolean {
    const product = getProductById(productId);
    if (!product || quantity <= 0) {
      return false;
    }

    const currentQty = this.cart[productId] ?? 0;
    const newQty = Math.min(currentQty + quantity, CartValidator.MAX_ITEM_QUANTITY);
    this.cart[productId] = newQty;

    this.persist();
    return true;
  }

  public updateQuantity(productId: string, quantity: number): boolean {
    const product = getProductById(productId);
    if (!product) return false;

    if (quantity <= 0) {
      return this.removeItem(productId);
    }

    this.cart[productId] = Math.min(quantity, CartValidator.MAX_ITEM_QUANTITY);
    this.persist();
    return true;
  }

  public removeItem(productId: string): boolean {
    if (productId in this.cart) {
      delete this.cart[productId];
      this.persist();
      return true;
    }
    return false;
  }

  public clearCart(): void {
    this.cart = {};
    this.persist();
  }

  public subscribe(listener: (cart: LegacyCartRecord) => void): () => void {
    this.listeners.add(listener);
    listener(this.getItems());
    return () => this.listeners.delete(listener);
  }

  private persist(): void {
    saveToStorage(GN_CONFIG.storageKeys.cart, this.cart);
    this.notify();
  }

  private notify(): void {
    const items = this.getItems();
    this.listeners.forEach(fn => fn(items));
  }
}
