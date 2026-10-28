// src/catalogue/product-catalogue.ts
// Typed, read-only product catalogue read layer for Gems of Nature V2

import type { Product, ProductCategory, ProductMetadata } from '../types/product';
import type {
  ProductIdStatus,
  ProductLookupResult,
  ProductPriceRange,
  ProductSearchOptions,
  ProductWithMetadata,
} from '../types/catalogue';
import { products as defaultProducts } from '../core/products';
import { productMeta as defaultProductMeta } from '../core/product-meta';

/**
 * Typed Read-Only Product Catalogue.
 *
 * Encapsulates read-only access to the authoritative product and metadata datasets.
 * Guarantees that:
 * 1. All 104 verified products and 108 metadata records are preserved exactly.
 * 2. Unactivated metadata records (p127, p128, p129, p135) remain strictly excluded from purchasable results.
 * 3. Product IDs, bounds, categories, and descriptions are never mutated or reconciled.
 * 4. Selling price policy is not decided (price_min and price_max are strictly preserved).
 */
export class ProductCatalogue {
  private readonly products: readonly Product[];
  private readonly metadata: Readonly<Record<string, ProductMetadata>>;
  private readonly productMap: ReadonlyMap<string, Product>;
  private readonly metadataOnlyIds: readonly string[];
  private readonly categories: readonly ProductCategory[];

  constructor(
    products: readonly Product[] = defaultProducts,
    metadata: Readonly<Record<string, ProductMetadata>> = defaultProductMeta,
  ) {
    this.products = Object.freeze(products.map(p => Object.freeze({ ...p })));

    const frozenMeta: Record<string, ProductMetadata> = {};
    for (const [id, m] of Object.entries(metadata)) {
      frozenMeta[id] = Object.freeze({ ...m });
    }
    this.metadata = Object.freeze(frozenMeta);

    const pMap = new Map<string, Product>();
    const categoriesSet = new Set<ProductCategory>();

    for (const p of this.products) {
      pMap.set(p.id, p);
      categoriesSet.add(p.category);
    }

    this.productMap = pMap;
    this.categories = Object.freeze(Array.from(categoriesSet));

    // Derive metadata-only IDs dynamically from datasets (p127, p128, p129, p135)
    const metaOnly: string[] = [];
    for (const id of Object.keys(this.metadata)) {
      if (!this.productMap.has(id)) {
        metaOnly.push(id);
      }
    }
    this.metadataOnlyIds = Object.freeze(metaOnly);
  }

  /**
   * Total number of active, purchasable products in the catalogue.
   */
  get productCount(): number {
    return this.products.length;
  }

  /**
   * Total number of product metadata records available.
   */
  get metadataCount(): number {
    return Object.keys(this.metadata).length;
  }

  /**
   * Returns all active, purchasable products in the catalogue.
   * Metadata-only IDs are strictly excluded.
   */
  getAllProducts(): readonly Product[] {
    return this.products;
  }

  /**
   * Returns all categories present in the active catalogue.
   */
  getCategories(): readonly ProductCategory[] {
    return this.categories;
  }

  /**
   * Retrieves an active purchasable product by its ID.
   * Returns undefined for unknown IDs and for metadata-only IDs (p127, p128, p129, p135).
   */
  getProductById(id: string): Product | undefined {
    return this.productMap.get(id);
  }

  /**
   * Returns all products that match a given name.
   * Preserves multiple products that share the same name with distinct IDs.
   * Does NOT collapse or reconcile duplicate names.
   */
  getProductsByName(name: string, exactCase = false): readonly Product[] {
    if (!name || typeof name !== 'string') return Object.freeze([]);
    if (exactCase) {
      return Object.freeze(this.products.filter(p => p.name === name));
    }
    const target = name.trim().toLowerCase();
    return Object.freeze(this.products.filter(p => p.name.trim().toLowerCase() === target));
  }

  /**
   * Returns all purchasable products in a given category.
   * Matching is case-insensitive; passing 'all' or empty string returns all products.
   */
  getProductsByCategory(category: ProductCategory | string): readonly Product[] {
    if (!category || typeof category !== 'string') return this.products;
    const catLower = category.trim().toLowerCase();
    if (catLower === 'all' || catLower === '') {
      return this.products;
    }
    return Object.freeze(this.products.filter(p => p.category.toLowerCase().trim() === catLower));
  }

  /**
   * Returns metadata for any known product ID (both active products and metadata-only IDs).
   */
  getMetadataById(id: string): ProductMetadata | undefined {
    return this.metadata[id];
  }

  /**
   * Returns an active purchasable product together with its metadata (if available).
   * Returns undefined if the product is not in the purchasable catalogue.
   */
  getProductWithMetadata(id: string): ProductWithMetadata | undefined {
    const product = this.productMap.get(id);
    if (!product) return undefined;
    return Object.freeze({
      product,
      metadata: this.metadata[id],
    });
  }

  /**
   * Classifies an ID into one of three distinct statuses:
   * - 'purchasable': active product in the catalogue
   * - 'metadata_only': has metadata but excluded from purchasable catalogue (e.g. p127, p128, p129, p135)
   * - 'unknown': ID does not exist in products or metadata
   */
  getIdStatus(id: string): ProductIdStatus {
    if (this.productMap.has(id)) {
      return 'purchasable';
    }
    if (id in this.metadata) {
      return 'metadata_only';
    }
    return 'unknown';
  }

  /**
   * Returns true if the product ID is eligible for purchase in the active catalogue.
   */
  isPurchasable(id: string): boolean {
    return this.productMap.has(id);
  }

  /**
   * Returns true if the ID exists in metadata but is excluded from the active catalogue.
   */
  isMetadataOnly(id: string): boolean {
    return !this.productMap.has(id) && id in this.metadata;
  }

  /**
   * Returns true if the ID is known in either the product catalogue or metadata.
   */
  isKnownId(id: string): boolean {
    return this.productMap.has(id) || id in this.metadata;
  }

  /**
   * Returns the list of IDs that exist in metadata but are excluded from the active catalogue.
   */
  getMetadataOnlyIds(): readonly string[] {
    return this.metadataOnlyIds;
  }

  /**
   * Unified lookup that returns a tagged union distinguishing purchasable,
   * metadata-only, and unknown IDs. Purchase eligibility is explicit in the result.
   */
  lookupProduct(id: string): ProductLookupResult {
    const product = this.productMap.get(id);
    const metadata = this.metadata[id];

    if (product) {
      return Object.freeze({
        status: 'purchasable',
        isPurchasable: true,
        product,
        metadata,
      });
    }

    if (metadata) {
      return Object.freeze({
        status: 'metadata_only',
        isPurchasable: false,
        id,
        metadata,
      });
    }

    return Object.freeze({
      status: 'unknown',
      isPurchasable: false,
      id,
    });
  }

  /**
   * Returns the price bounds for a product without deciding an authoritative selling price.
   */
  getPriceRange(productOrId: Product | string): ProductPriceRange | undefined {
    const product = typeof productOrId === 'string'
      ? this.productMap.get(productOrId)
      : productOrId;

    if (!product) return undefined;
    return Object.freeze({
      min: product.price_min,
      max: product.price_max,
    });
  }

  /**
   * Searches purchasable products by name, description, and category.
   * Safe handling of empty/whitespace input and special characters (e.g. parentheses).
   * Metadata-only IDs are never returned as purchasable products.
   */
  searchProducts(query: string, options?: ProductSearchOptions): readonly Product[] {
    const safeQuery = typeof query === 'string' ? query.trim().toLowerCase() : '';
    const categoryFilter = options?.category && options.category.toLowerCase() !== 'all'
      ? options.category.toLowerCase().trim()
      : undefined;
    const includeMeta = options?.includeMetadata ?? false;
    const emptyPolicy = options?.emptyQueryPolicy ?? 'all';

    if (!safeQuery) {
      if (emptyPolicy === 'none') {
        return Object.freeze([]);
      }
      let baseList = this.products;
      if (categoryFilter) {
        baseList = Object.freeze(baseList.filter(p => p.category.toLowerCase().trim() === categoryFilter));
      }
      return Object.freeze(options?.limit ? baseList.slice(0, options.limit) : baseList);
    }

    const results: Product[] = [];

    for (const product of this.products) {
      if (categoryFilter && product.category.toLowerCase().trim() !== categoryFilter) {
        continue;
      }

      const nameMatch = product.name.toLowerCase().includes(safeQuery);
      const descMatch = (product.description || '').toLowerCase().includes(safeQuery);
      const catMatch = product.category.toLowerCase().includes(safeQuery);

      let metaMatch = false;
      if (includeMeta && !nameMatch && !descMatch && !catMatch) {
        const meta = this.metadata[product.id];
        if (meta) {
          metaMatch = (
            (meta.long_description || '').toLowerCase().includes(safeQuery) ||
            (meta.planet || '').toLowerCase().includes(safeQuery) ||
            (meta.deity || '').toLowerCase().includes(safeQuery) ||
            (meta.element || '').toLowerCase().includes(safeQuery) ||
            (meta.usage || '').toLowerCase().includes(safeQuery) ||
            (meta.mantra_english || '').toLowerCase().includes(safeQuery) ||
            (meta.mantra_sanskrit || '').toLowerCase().includes(safeQuery) ||
            (meta.benefits || []).some(b => b.toLowerCase().includes(safeQuery)) ||
            (meta.zodiac || []).some(z => z.toLowerCase().includes(safeQuery)) ||
            (meta.chakra || []).some(c => c.toLowerCase().includes(safeQuery)) ||
            (meta.placement || []).some(pl => pl.toLowerCase().includes(safeQuery))
          );
        }
      }

      if (nameMatch || descMatch || catMatch || metaMatch) {
        results.push(product);
        if (options?.limit && results.length >= options.limit) {
          break;
        }
      }
    }

    return Object.freeze(results);
  }

  /**
   * Searches purchasable products and enriches matching results with their metadata.
   */
  searchProductsWithMetadata(query: string, options?: ProductSearchOptions): readonly ProductWithMetadata[] {
    const matched = this.searchProducts(query, options);
    return Object.freeze(matched.map(product => Object.freeze({
      product,
      metadata: this.metadata[product.id],
    })));
  }
}

// Default singleton instance using the authoritative dataset
export const defaultCatalogue = new ProductCatalogue();

// Exported standalone convenience functions operating on the default authoritative catalogue
export const catalogue = defaultCatalogue;
export const getCatalogueProductById = (id: string): Product | undefined => defaultCatalogue.getProductById(id);
export const getPurchasableProducts = (): readonly Product[] => defaultCatalogue.getAllProducts();
export const getProductsByCategory = (cat: ProductCategory | string): readonly Product[] => defaultCatalogue.getProductsByCategory(cat);
export const getProductsByName = (name: string, exactCase = false): readonly Product[] => defaultCatalogue.getProductsByName(name, exactCase);
export const getProductMetadata = (id: string): ProductMetadata | undefined => defaultCatalogue.getMetadataById(id);
export const getProductWithMetadata = (id: string): ProductWithMetadata | undefined => defaultCatalogue.getProductWithMetadata(id);
export const getIdStatus = (id: string): ProductIdStatus => defaultCatalogue.getIdStatus(id);
export const isPurchasable = (id: string): boolean => defaultCatalogue.isPurchasable(id);
export const isMetadataOnly = (id: string): boolean => defaultCatalogue.isMetadataOnly(id);
export const isKnownId = (id: string): boolean => defaultCatalogue.isKnownId(id);
export const getMetadataOnlyIds = (): readonly string[] => defaultCatalogue.getMetadataOnlyIds();
export const lookupProduct = (id: string): ProductLookupResult => defaultCatalogue.lookupProduct(id);
export const getPriceRange = (productOrId: Product | string): ProductPriceRange | undefined => defaultCatalogue.getPriceRange(productOrId);
export const searchProducts = (query: string, options?: ProductSearchOptions): readonly Product[] => defaultCatalogue.searchProducts(query, options);
export const searchProductsWithMetadata = (query: string, options?: ProductSearchOptions): readonly ProductWithMetadata[] => defaultCatalogue.searchProductsWithMetadata(query, options);
export const getCatalogueCategories = (): readonly ProductCategory[] => defaultCatalogue.getCategories();
