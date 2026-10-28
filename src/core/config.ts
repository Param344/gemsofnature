// src/core/config.ts
// Global configuration for Gems of Nature

import type { SiteConfig } from '../types/config';

export const GN_CONFIG: SiteConfig = {
  siteName: "Gems of Nature",
  brandTagline: "Healing Gemstones & Spiritual Tools",

  currency: "INR",
  currencySymbol: "₹",
  pricePrecision: 2,

  // LocalStorage keys (preserved for legacy compatibility)
  storageKeys: {
    cart: "gon_cart",
    wishlist: "gon_wishlist",
    compare: "gon_compare",
    checkoutDraft: "gon_checkout_draft",
    userPreferences: "gon_user_prefs"
  },

  // Common routes
  routes: {
    home: "index.html",
    shop: "shop.html",
    product: "shop-ecom.html",
    about: "about.html",
    contact: "contact.html",
    cart: "checkout.html",
    checkout: "checkout.html",
    privacy: "guides/privacy-policy.html",
    terms: "guides/terms-conditions.html"
  },

  // Responsive breakpoints
  breakpoints: {
    mobileMax: 767,
    tabletMax: 1023
  },

  // Feature flags
  features: {
    enableWishlist: true,
    enableCompare: false,
    enableRecommendations: true,
    enableOfflineCartSync: false
  }
} as const;
