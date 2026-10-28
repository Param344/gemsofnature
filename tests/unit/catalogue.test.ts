import { describe, it, expect } from 'vitest';
import {
  catalogue,
  ProductCatalogue,
  getCatalogueProductById,
  getPurchasableProducts,
  getProductsByCategory,
  getProductsByName,
  getProductMetadata,
  getProductWithMetadata,
  getIdStatus,
  isPurchasable,
  isMetadataOnly,
  isKnownId,
  getMetadataOnlyIds,
  lookupProduct,
  getPriceRange,
  searchProducts,
  searchProductsWithMetadata,
  getCatalogueCategories,
} from '../../src/catalogue';
import { productMeta } from '../../src/core/product-meta';
import type { Product, ProductCategory } from '../../src/types/product';

describe('Stage 2B: Typed Product Catalogue Read Layer', () => {
  describe('1. Exact Dataset Counts & Field Preservation', () => {
    it('preserves exactly 104 verified products in the catalogue', () => {
      expect(catalogue.productCount).toBe(104);
      expect(catalogue.getAllProducts().length).toBe(104);
      expect(getPurchasableProducts().length).toBe(104);
    });

    it('preserves exactly 108 metadata records', () => {
      expect(catalogue.metadataCount).toBe(108);
      expect(Object.keys(productMeta).length).toBe(108);
    });

    it('preserves all required fields across every product record', () => {
      catalogue.getAllProducts().forEach(p => {
        expect(p.id).toBeDefined();
        expect(typeof p.id).toBe('string');
        expect(p.id.trim()).not.toBe('');

        expect(p.name).toBeDefined();
        expect(typeof p.name).toBe('string');
        expect(p.name.trim()).not.toBe('');

        expect(p.category).toBeDefined();
        expect(typeof p.category).toBe('string');
        expect(p.category.trim()).not.toBe('');

        expect(p.image).toBeDefined();
        expect(typeof p.image).toBe('string');
        expect(p.image.trim()).not.toBe('');

        expect(p.description).toBeDefined();
        expect(typeof p.description).toBe('string');
        expect(p.description.trim()).not.toBe('');

        expect(typeof p.price_min).toBe('number');
        expect(p.price_min).toBeGreaterThan(0);

        expect(typeof p.price_max).toBe('number');
        expect(p.price_max).toBeGreaterThanOrEqual(p.price_min);
      });
    });

    it('guarantees unique product IDs without collisions across all 104 products', () => {
      const ids = catalogue.getAllProducts().map(p => p.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(104);
    });
  });

  describe('2. Pricing Boundary & Range Preservation', () => {
    it('does not choose or inject an authoritative selling price', () => {
      catalogue.getAllProducts().forEach(p => {
        expect(p.price).toBeUndefined();
      });
    });

    it('preserves price bounds accurately via getPriceRange', () => {
      const p1 = catalogue.getProductById('p1');
      expect(p1).toBeDefined();
      if (!p1) return;

      const bounds = getPriceRange(p1);
      expect(bounds).toEqual({ min: 40000, max: 200000 });
      expect(bounds?.min).toBe(p1.price_min);
      expect(bounds?.max).toBe(p1.price_max);

      // Verify lookup by ID string as well
      const boundsById = getPriceRange('p1');
      expect(boundsById).toEqual({ min: 40000, max: 200000 });

      // Non-existent product returns undefined
      expect(getPriceRange('invalid_id')).toBeUndefined();
    });

    it('does not infer price_min or the midpoint as the selling price', () => {
      const p2 = catalogue.getProductById('p2');
      expect(p2).toBeDefined();
      if (!p2) return;

      // Ensure price bounds are preserved without assigning midpoint (320000) or min (40000)
      expect(p2.price_min).toBe(40000);
      expect(p2.price_max).toBe(600000);
      expect(p2.price).toBeUndefined();
    });
  });

  describe('3. Known, Unknown, and Metadata-Only IDs', () => {
    it('retrieves known purchasable products accurately by ID', () => {
      const p1 = getCatalogueProductById('p1');
      expect(p1).toBeDefined();
      expect(p1?.name).toBe('Yellow Sapphire (Pukhraj)');
      expect(p1?.category).toBe('Precious');

      const p104 = catalogue.getProductById('p104');
      expect(p104).toBeDefined();
      expect(p104?.name).toBe('Raw Clear Quartz');
      expect(p104?.category).toBe('Raw');
    });

    it('classifies known purchasable IDs correctly', () => {
      expect(getIdStatus('p1')).toBe('purchasable');
      expect(isPurchasable('p1')).toBe(true);
      expect(isMetadataOnly('p1')).toBe(false);
      expect(isKnownId('p1')).toBe(true);

      const lookup = lookupProduct('p1');
      expect(lookup.status).toBe('purchasable');
      expect(lookup.isPurchasable).toBe(true);
      if (lookup.status === 'purchasable') {
        expect(lookup.product.id).toBe('p1');
        expect(lookup.metadata).toBeDefined();
        expect(lookup.metadata?.planet).toBe('Jupiter');
      }
    });

    it('classifies unknown IDs correctly and returns undefined for product lookups', () => {
      const unknownIds = ['unknown_999', 'p999', 'xyz', ''];

      for (const id of unknownIds) {
        expect(getCatalogueProductById(id)).toBeUndefined();
        expect(catalogue.getProductById(id)).toBeUndefined();
        expect(getIdStatus(id)).toBe('unknown');
        expect(isPurchasable(id)).toBe(false);
        expect(isMetadataOnly(id)).toBe(false);
        expect(isKnownId(id)).toBe(false);
        expect(getProductMetadata(id)).toBeUndefined();
        expect(getProductWithMetadata(id)).toBeUndefined();

        const lookup = lookupProduct(id);
        expect(lookup.status).toBe('unknown');
        expect(lookup.isPurchasable).toBe(false);
        if (lookup.status === 'unknown') {
          expect(lookup.id).toBe(id);
        }
      }
    });

    it('strictly isolates metadata-only records p127, p128, p129, p135 from purchasable catalogue', () => {
      const orphanIds = ['p127', 'p128', 'p129', 'p135'] as const;

      expect(getMetadataOnlyIds()).toEqual(orphanIds);

      for (const id of orphanIds) {
        // Must NOT be retrievable as a purchasable product
        expect(getCatalogueProductById(id)).toBeUndefined();
        expect(catalogue.getProductById(id)).toBeUndefined();
        expect(isPurchasable(id)).toBe(false);
        expect(isMetadataOnly(id)).toBe(true);
        expect(isKnownId(id)).toBe(true);
        expect(getIdStatus(id)).toBe('metadata_only');

        // Must not be in purchasable products list
        expect(catalogue.getAllProducts().some(p => p.id === id)).toBe(false);
        expect(getPurchasableProducts().some(p => p.id === id)).toBe(false);

        // Metadata must be preserved and accessible
        const meta = getProductMetadata(id);
        expect(meta).toBeDefined();
        expect(typeof meta?.long_description).toBe('string');

        // Unified lookup must explicitly report status 'metadata_only' and isPurchasable false
        const lookup = lookupProduct(id);
        expect(lookup.status).toBe('metadata_only');
        expect(lookup.isPurchasable).toBe(false);
        if (lookup.status === 'metadata_only') {
          expect(lookup.id).toBe(id);
          expect(lookup.metadata).toBeDefined();
        }
      }
    });
  });

  describe('4. Category Filtering', () => {
    it('returns all 7 distinct categories in the catalogue', () => {
      const categories = getCatalogueCategories();
      expect(categories).toEqual([
        'Precious',
        'Opal',
        'Astrology',
        'Healing',
        'Accessory',
        'Rudraksha',
        'Raw',
      ]);
    });

    it('filters products correctly by each known category', () => {
      const expectedCounts: Record<ProductCategory, number> = {
        Precious: 14,
        Opal: 5,
        Astrology: 13,
        Healing: 33,
        Accessory: 13,
        Rudraksha: 19,
        Raw: 7,
      };

      let total = 0;
      for (const [cat, count] of Object.entries(expectedCounts)) {
        const items = getProductsByCategory(cat);
        expect(items.length).toBe(count);
        items.forEach(item => expect(item.category).toBe(cat));
        total += items.length;
      }

      expect(total).toBe(104);
    });

    it('supports case-insensitive category filtering', () => {
      const preciousLower = getProductsByCategory('precious');
      const preciousUpper = getProductsByCategory('PRECIOUS');
      const preciousMixed = getProductsByCategory('Precious');

      expect(preciousLower.length).toBe(14);
      expect(preciousUpper.length).toBe(14);
      expect(preciousMixed.length).toBe(14);
      expect(preciousLower.map(p => p.id)).toEqual(preciousMixed.map(p => p.id));
    });

    it('returns all products when category is "all" or empty string', () => {
      expect(getProductsByCategory('all').length).toBe(104);
      expect(getProductsByCategory('ALL').length).toBe(104);
      expect(getProductsByCategory('').length).toBe(104);
    });

    it('returns empty array for non-existent category', () => {
      expect(getProductsByCategory('NonExistentCategory')).toEqual([]);
    });
  });

  describe('5. Search Functionality & Boundary Handling', () => {
    it('performs case-insensitive substring search by product name', () => {
      const lower = searchProducts('sapphire');
      const upper = searchProducts('SAPPHIRE');
      const mixed = searchProducts('SaPphIrE');

      expect(lower.length).toBeGreaterThan(0);
      expect(lower.map(p => p.id)).toEqual(upper.map(p => p.id));
      expect(lower.map(p => p.id)).toEqual(mixed.map(p => p.id));
    });

    it('safely handles special characters and parentheses without regex errors', () => {
      // Product name contains parentheses: 'Yellow Sapphire (Pukhraj)'
      const resultsWithParens = searchProducts('(Pukhraj)');
      expect(resultsWithParens.length).toBeGreaterThanOrEqual(1);
      expect(resultsWithParens[0]?.id).toBe('p1');

      // Exact substring with parentheses
      const exactName = searchProducts('Yellow Sapphire (Pukhraj)');
      expect(exactName.length).toBeGreaterThanOrEqual(1);
      expect(exactName[0]?.id).toBe('p1');
    });

    it('matches terms in product description and category', () => {
      // 'wealth' is in description of p1
      const wealthResults = searchProducts('wealth');
      expect(wealthResults.some(p => p.id === 'p1')).toBe(true);

      // 'Rudraksha' is in category
      const rudrakshaResults = searchProducts('Rudraksha');
      expect(rudrakshaResults.length).toBe(19);
    });

    it('supports optional metadata field search when includeMetadata is true', () => {
      // 'Jupiter' is the planet in metadata for p1, not in its product name/desc
      const withoutMeta = searchProducts('Jupiter', { includeMetadata: false });
      const withMeta = searchProducts('Jupiter', { includeMetadata: true });

      expect(withMeta.some(p => p.id === 'p1')).toBe(true);
      expect(withMeta.length).toBeGreaterThanOrEqual(withoutMeta.length);
    });

    it('combines category filtering with search query', () => {
      const results = searchProducts('quartz', { category: 'Raw' });
      expect(results.length).toBeGreaterThan(0);
      results.forEach(p => expect(p.category).toBe('Raw'));
    });

    it('honors the result limit option', () => {
      const unlimited = searchProducts('quartz');
      const limited = searchProducts('quartz', { limit: 2 });

      expect(unlimited.length).toBeGreaterThan(2);
      expect(limited.length).toBe(2);
    });

    it('enriches search results with metadata via searchProductsWithMetadata', () => {
      const enriched = searchProductsWithMetadata('Yellow Sapphire');
      expect(enriched.length).toBeGreaterThanOrEqual(1);
      const match = enriched.find(item => item.product.id === 'p1');
      expect(match).toBeDefined();
      expect(match?.product.id).toBe('p1');
      expect(match?.metadata?.planet).toBe('Jupiter');
    });

    it('safe handling of empty, whitespace, null, or undefined search input', () => {
      // Default policy 'all' returns full catalogue (store search box clearing behavior)
      expect(searchProducts('').length).toBe(104);
      expect(searchProducts('   ').length).toBe(104);
      expect(searchProducts('\t\n  ').length).toBe(104);
      expect(searchProducts(null as unknown as string).length).toBe(104);
      expect(searchProducts(undefined as unknown as string).length).toBe(104);

      // 'none' policy returns empty array
      expect(searchProducts('', { emptyQueryPolicy: 'none' })).toEqual([]);
      expect(searchProducts('   ', { emptyQueryPolicy: 'none' })).toEqual([]);

      // Category filter applied to empty search
      const preciousEmpty = searchProducts('', { category: 'Precious' });
      expect(preciousEmpty.length).toBe(14);
    });

    it('never returns metadata-only products in search results', () => {
      // 'Amethyst Pendant' exists in p127 metadata
      const results = searchProducts('Amethyst Pendant', { includeMetadata: true });
      expect(results.some(p => p.id === 'p127')).toBe(false);
      expect(results.some(p => isMetadataOnly(p.id))).toBe(false);
    });

    it('produces strictly deterministic search results across repeated calls', () => {
      const run1 = searchProducts('Sapphire');
      const run2 = searchProducts('Sapphire');
      const run3 = searchProducts('Sapphire');

      expect(run1.map(p => p.id)).toEqual(run2.map(p => p.id));
      expect(run2.map(p => p.id)).toEqual(run3.map(p => p.id));
    });
  });

  describe('6. Duplicate Names & Distinct ID Preservation', () => {
    it('verifies getProductsByName on real dataset returns matching products', () => {
      const rubyProducts = getProductsByName('Ruby');
      expect(rubyProducts.length).toBe(1);
      expect(rubyProducts[0]?.id).toBe('p2');
    });

    it('never collapses or silently reconciles multiple products sharing identical names', () => {
      // Construct an isolated catalogue instance containing two items with identical names but distinct IDs
      const dupeItem1: Product = {
        id: 'mock_1',
        name: 'Natural Ruby Specimen',
        category: 'Precious',
        image: 'images/products/ruby.jpg',
        price_min: 10000,
        price_max: 20000,
        description: 'First specimen',
      };
      const dupeItem2: Product = {
        id: 'mock_2',
        name: 'Natural Ruby Specimen',
        category: 'Precious',
        image: 'images/products/ruby.jpg',
        price_min: 25000,
        price_max: 50000,
        description: 'Second specimen with higher carat',
      };

      const testCatalogue = new ProductCatalogue([dupeItem1, dupeItem2], {});

      expect(testCatalogue.productCount).toBe(2);
      expect(testCatalogue.getProductById('mock_1')).toEqual(dupeItem1);
      expect(testCatalogue.getProductById('mock_2')).toEqual(dupeItem2);

      // Querying by name returns BOTH distinct items
      const matches = testCatalogue.getProductsByName('Natural Ruby Specimen');
      expect(matches.length).toBe(2);
      expect(matches[0]?.id).toBe('mock_1');
      expect(matches[1]?.id).toBe('mock_2');

      // Search also returns both items
      const searchMatches = testCatalogue.searchProducts('Natural Ruby Specimen');
      expect(searchMatches.length).toBe(2);
      expect(searchMatches[0]?.id).toBe('mock_1');
      expect(searchMatches[1]?.id).toBe('mock_2');
    });
  });

  describe('7. Missing Metadata & Graceful Degradation', () => {
    it('confirms all 104 real catalogue products have metadata', () => {
      catalogue.getAllProducts().forEach(p => {
        const enriched = getProductWithMetadata(p.id);
        expect(enriched).toBeDefined();
        expect(enriched?.product.id).toBe(p.id);
        expect(enriched?.metadata).toBeDefined();
      });
    });

    it('gracefully handles products with missing metadata in an isolated catalogue', () => {
      const productWithoutMeta: Product = {
        id: 'no_meta_product',
        name: 'Uncatalogued Gem',
        category: 'Raw',
        image: 'images/products/raw-clearquartz.jpg',
        price_min: 500,
        price_max: 1000,
        description: 'No astrological metadata available',
      };

      const testCatalogue = new ProductCatalogue([productWithoutMeta], {});

      expect(testCatalogue.getMetadataById('no_meta_product')).toBeUndefined();

      const enriched = testCatalogue.getProductWithMetadata('no_meta_product');
      expect(enriched).toBeDefined();
      expect(enriched?.product.id).toBe('no_meta_product');
      expect(enriched?.metadata).toBeUndefined();

      const lookup = testCatalogue.lookupProduct('no_meta_product');
      expect(lookup.status).toBe('purchasable');
      expect(lookup.isPurchasable).toBe(true);
      if (lookup.status === 'purchasable') {
        expect(lookup.metadata).toBeUndefined();
      }

      // Searching with metadata enabled does not throw
      const searchRes = testCatalogue.searchProducts('Uncatalogued', { includeMetadata: true });
      expect(searchRes.length).toBe(1);
      expect(searchRes[0]?.id).toBe('no_meta_product');
    });
  });

  describe('8. Mutation Resistance & Deep Immutability Guarantees', () => {
    it('freezes returned product arrays and prevents caller mutation', () => {
      const all = catalogue.getAllProducts();
      expect(Object.isFrozen(all)).toBe(true);
      expect(() => {
        (all as unknown as Product[]).push({
          id: 'hacked_product',
          name: 'Injected',
          category: 'Precious',
          image: 'none.jpg',
          price_min: 1,
          price_max: 2,
          description: 'Hacked',
        });
      }).toThrow(TypeError);

      const precious = getProductsByCategory('Precious');
      expect(Object.isFrozen(precious)).toBe(true);

      const searched = searchProducts('Ruby');
      expect(Object.isFrozen(searched)).toBe(true);
    });

    it('freezes individual product objects and prevents property injection', () => {
      const p1 = catalogue.getProductById('p1');
      expect(p1).toBeDefined();
      if (!p1) return;

      expect(Object.isFrozen(p1)).toBe(true);

      // Attempting to inject a selling price must throw
      expect(() => {
        (p1 as unknown as Record<string, unknown>).price = 99999;
      }).toThrow(TypeError);

      // Attempting to overwrite price bounds must throw
      expect(() => {
        (p1 as unknown as Record<string, unknown>).price_min = 0;
      }).toThrow(TypeError);

      // Attempting to modify product name must throw
      expect(() => {
        (p1 as unknown as Record<string, unknown>).name = 'Altered';
      }).toThrow(TypeError);

      // Verify the product remains intact
      expect(p1.name).toBe('Yellow Sapphire (Pukhraj)');
      expect(p1.price_min).toBe(40000);
      expect(p1.price).toBeUndefined();
    });

    it('freezes lookup objects and price range objects', () => {
      const lookup = lookupProduct('p1');
      expect(Object.isFrozen(lookup)).toBe(true);

      const range = getPriceRange('p1');
      expect(Object.isFrozen(range)).toBe(true);
      expect(() => {
        (range as unknown as Record<string, unknown>).min = 100;
      }).toThrow(TypeError);
    });

    it('defends against mutations of arrays passed into the constructor', () => {
      const initialItems: Product[] = [
        {
          id: 'iso_1',
          name: 'Original Gem',
          category: 'Precious',
          image: 'img.jpg',
          price_min: 100,
          price_max: 200,
          description: 'Original',
        },
      ];

      const testCat = new ProductCatalogue(initialItems, {});
      expect(testCat.productCount).toBe(1);

      // Mutating the initial array after construction
      initialItems.push({
        id: 'iso_2',
        name: 'Injected Gem',
        category: 'Precious',
        image: 'img2.jpg',
        price_min: 300,
        price_max: 400,
        description: 'Injected after construction',
      });

      // Internal catalogue remains unaffected
      expect(testCat.productCount).toBe(1);
      expect(testCat.getProductById('iso_2')).toBeUndefined();
    });
  });

  describe('9. Unusual Query Input & Character Safety', () => {
    it('safely handles regex metacharacters (*, +, ?, [, ], ^, $, \\, |) without exceptions', () => {
      const unusualStrings = [
        '*',
        '+',
        '?',
        '[',
        ']',
        '[[',
        '\\',
        '^',
        '$',
        '.*',
        'p.*',
        '?',
        '(',
        ')',
        '()',
        'a|b',
        '{1,3}',
      ];

      for (const str of unusualStrings) {
        expect(() => searchProducts(str)).not.toThrow();
        const results = searchProducts(str);
        expect(Array.isArray(results)).toBe(true);
      }
    });

    it('safely handles Unicode and Sanskrit characters', () => {
      // Test search with Sanskrit characters present in metadata
      expect(() => searchProducts('ॐ', { includeMetadata: true })).not.toThrow();
      const omResults = searchProducts('ॐ', { includeMetadata: true });
      expect(Array.isArray(omResults)).toBe(true);
      // Products with Sanskrit mantras in metadata should match
      expect(omResults.length).toBeGreaterThan(0);
    });
  });
});
