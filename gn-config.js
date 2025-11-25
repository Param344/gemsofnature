// js/gn-config.js
// Global configuration for Gems of Nature

(function (window) {
  "use strict";

  const GN_CONFIG = {
    siteName: "Gems of Nature",
    brandTagline: "Healing Gemstones & Spiritual Tools",

    currency: "INR",
    currencySymbol: "₹",
    pricePrecision: 2,

    // LocalStorage keys (use these everywhere)
    storageKeys: {
      cart: "gon_cart",
      wishlist: "gon_wishlist",
      compare: "gon_compare",
      checkoutDraft: "gon_checkout_draft",
      userPreferences: "gon_user_prefs"
    },

    // Common routes (keep all file names here)
    routes: {
      home: "index.html",
      shop: "shop.html",
      product: "product.html",
      about: "about.html",
      contact: "contact.html",
      cart: "cart.html",
      checkout: "checkout-online-preview.html",
      privacy: "privacy-policy.html",
      terms: "terms-and-conditions.html"
    },

    // Responsive breakpoints (should match your CSS)
    breakpoints: {
      mobileMax: 767,
      tabletMax: 1023
      // desktop: anything above tabletMax
    },

    // Feature flags (easy to turn things on/off later)
    features: {
      enableWishlist: true,
      enableCompare: false,
      enableRecommendations: true,
      enableOfflineCartSync: false // for future when you add backend
    }
  };

  // Expose config globally
  window.GN_CONFIG = GN_CONFIG;
})(window);
