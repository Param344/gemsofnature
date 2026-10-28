// src/types/catalogue.ts
// Strict type definitions for the typed product catalogue read layer

import type { Product, ProductCategory, ProductMetadata } from './product';

/**
 * Classification of a product identifier:
 * - 'purchasable': active product in the 104-item catalogue
 * - 'metadata_only': preserved metadata record without an active purchasable product (e.g. p127, p128, p129, p135)
 * - 'unknown': ID does not exist in either products or metadata
 */
export type ProductIdStatus = 'purchasable' | 'metadata_only' | 'unknown';

/**
 * Enriched representation combining a product with its metadata
 */
export interface ProductWithMetadata {
  readonly product: Product;
  readonly metadata?: ProductMetadata;
}

/**
 * Tagged union distinguishing purchasable products, metadata-only records, and unknown IDs.
 * Purchase eligibility is explicitly encoded in the type system.
 */
export type ProductLookupResult =
  | {
      readonly status: 'purchasable';
      readonly isPurchasable: true;
      readonly product: Product;
      readonly metadata?: ProductMetadata;
    }
  | {
      readonly status: 'metadata_only';
      readonly isPurchasable: false;
      readonly id: string;
      readonly metadata: ProductMetadata;
    }
  | {
      readonly status: 'unknown';
      readonly isPurchasable: false;
      readonly id: string;
    };

/**
 * Price bounds representation preserving price_min and price_max without deciding selling price
 */
export interface ProductPriceRange {
  readonly min: number;
  readonly max: number;
}

/**
 * Configuration options for searching the product catalogue
 */
export interface ProductSearchOptions {
  /** Optional category filter */
  readonly category?: ProductCategory | string;
  /** Whether to search within metadata fields (planet, zodiac, chakra, benefits, long_description) */
  readonly includeMetadata?: boolean;
  /**
   * Behavior when query string is empty or whitespace-only:
   * - 'all': returns all products (matching store search box behavior)
   * - 'none': returns an empty array
   * Default is 'all'.
   */
  readonly emptyQueryPolicy?: 'all' | 'none';
  /** Optional limit on number of returned results */
  readonly limit?: number;
}
