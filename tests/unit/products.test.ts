import { describe, it, expect } from 'vitest';
import { products, getProductById, getAllProducts } from '../../src/core/products';
import fs from 'fs';
import path from 'path';

describe('Authoritative Product Catalogue Integrity', () => {
  it('contains exactly 104 verified products', () => {
    expect(products.length).toBe(104);
    expect(getAllProducts().length).toBe(104);
  });

  it('guarantees unique product IDs without collision', () => {
    const ids = products.map(p => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('enforces non-negative price bounds for every item', () => {
    products.forEach(p => {
      expect(typeof p.price_min).toBe('number');
      expect(typeof p.price_max).toBe('number');
      expect(p.price_min).toBeGreaterThan(0);
      expect(p.price_max).toBeGreaterThanOrEqual(p.price_min);
    });
  });

  it('verifies all mandatory fields are populated and non-empty', () => {
    products.forEach(p => {
      expect(p.id.trim()).not.toBe('');
      expect(p.name.trim()).not.toBe('');
      expect(p.category.trim()).not.toBe('');
      expect(p.image.trim()).not.toBe('');
      expect(p.description.trim()).not.toBe('');
    });
  });

  it('verifies every referenced product image file exists on disk', () => {
    products.forEach(p => {
      const fullPath = path.resolve(process.cwd(), p.image);
      expect(fs.existsSync(fullPath), `Missing image on disk: ${p.image}`).toBe(true);
    });
  });

  it('retrieves products correctly by ID', () => {
    const p1 = getProductById('p1');
    expect(p1).toBeDefined();
    expect(p1?.name).toBe('Yellow Sapphire (Pukhraj)');

    const nonExistent = getProductById('non_existent_999');
    expect(nonExistent).toBeUndefined();
  });
});
