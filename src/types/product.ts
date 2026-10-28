// src/types/product.ts
// Strict product and metadata type definitions

export type ProductCategory =
  | 'Precious'
  | 'Opal'
  | 'Astrology'
  | 'Healing'
  | 'Accessory'
  | 'Rudraksha'
  | 'Raw';

export type ProductPricingStatus =
  | 'PROVISIONAL_RANGE'     // Preliminary illustrative catalogue range (price_min to price_max)
  | 'INVENTORY_CONFIRMED';  // Future physical inventory lot with owner-approved selling price

export interface Product {
  readonly id: string;
  readonly name: string;
  readonly category: ProductCategory;
  readonly image: string;
  readonly price_min: number;
  readonly price_max: number;
  readonly description: string;
  // Preliminary vs inventory pricing distinction
  readonly pricingStatus?: ProductPricingStatus;
  readonly finalPrice?: number;
  readonly inventorySku?: string;
  readonly caratWeight?: number;
  readonly rattiWeight?: number;
  readonly certNumber?: string;
  readonly certLab?: string;
  readonly origin?: string;
  readonly inStock?: boolean;
  // Legacy optional field preserved for backward compatibility
  readonly price?: number;
  readonly mukhi?: number;
}

export interface ProductMetadata {
  readonly long_description?: string;
  readonly benefits?: readonly string[];
  readonly planet?: string;
  readonly zodiac?: readonly string[];
  readonly chakra?: readonly string[];
  readonly mantra_sanskrit?: string;
  readonly mantra_english?: string;
  readonly usage?: string;
  readonly deity?: string;
  readonly placement?: readonly string[];
  readonly element?: string;
}
