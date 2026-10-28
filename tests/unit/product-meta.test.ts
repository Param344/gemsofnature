import { describe, it, expect } from 'vitest';
import { productMeta, getProductMetaById } from '../../src/core/product-meta';
import { products } from '../../src/core/products';

describe('Product Metadata Integrity & Orphan Preservation', () => {
  it('contains exactly 108 metadata records', () => {
    expect(Object.keys(productMeta).length).toBe(108);
  });

  it('preserves unactivated records p127, p128, p129, and p135 without data loss', () => {
    const p127 = getProductMetaById('p127');
    expect(p127).toBeDefined();
    expect(p127?.long_description).toContain('Amethyst Pendant');

    const p128 = getProductMetaById('p128');
    expect(p128).toBeDefined();
    expect(p128?.long_description).toContain('Rose Quartz Pendant');

    const p129 = getProductMetaById('p129');
    expect(p129).toBeDefined();
    expect(p129?.long_description).toContain('Clear Quartz Pendant');

    const p135 = getProductMetaById('p135');
    expect(p135).toBeDefined();
    expect(p135?.long_description).toContain('Charging Plate');
  });

  it('guarantees that all 104 active catalogue products have metadata', () => {
    products.forEach(p => {
      const meta = getProductMetaById(p.id);
      expect(meta, `Product ${p.id} (${p.name}) is missing metadata`).toBeDefined();
    });
  });
});
