// src/types/config.ts
// Site configuration type contracts

export interface StorageKeys {
  readonly cart: string;
  readonly wishlist: string;
  readonly compare: string;
  readonly checkoutDraft: string;
  readonly userPreferences: string;
}

export interface RouteMap {
  readonly home: string;
  readonly shop: string;
  readonly product: string;
  readonly about: string;
  readonly contact: string;
  readonly cart: string;
  readonly checkout: string;
  readonly privacy: string;
  readonly terms: string;
}

export interface Breakpoints {
  readonly mobileMax: number;
  readonly tabletMax: number;
}

export interface FeatureFlags {
  readonly enableWishlist: boolean;
  readonly enableCompare: boolean;
  readonly enableRecommendations: boolean;
  readonly enableOfflineCartSync: boolean;
}

export interface SiteConfig {
  readonly siteName: string;
  readonly brandTagline: string;
  readonly currency: string;
  readonly currencySymbol: string;
  readonly pricePrecision: number;
  readonly storageKeys: StorageKeys;
  readonly routes: RouteMap;
  readonly breakpoints: Breakpoints;
  readonly features: FeatureFlags;
}
