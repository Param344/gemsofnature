// js/gn-utils.js
// Shared utility functions for Gems of Nature

(function (window, document) {
  "use strict";

  const cfg = window.GN_CONFIG || {};

  const GNUtils = {
    // -------- DOM HELPERS --------
    $(selector, root) {
      return (root || document).querySelector(selector);
    },

    $all(selector, root) {
      return Array.from((root || document).querySelectorAll(selector));
    },

    on(target, event, selectorOrHandler, handler) {
      // Simple: on(element, "click", handler)
      if (typeof selectorOrHandler === "function") {
        target.addEventListener(event, selectorOrHandler);
        return;
      }

      // Delegated: on(document, "click", ".btn", handler)
      const selector = selectorOrHandler;
      target.addEventListener(event, function (e) {
        const possibleTargets = target.querySelectorAll(selector);
        const targetElement = e.target.closest(selector);
        if (targetElement && Array.prototype.includes.call(possibleTargets, targetElement)) {
          handler.call(targetElement, e);
        }
      });
    },

    createElement(tag, options = {}) {
      const el = document.createElement(tag);
      if (options.className) el.className = options.className;
      if (options.text) el.textContent = options.text;
      if (options.html) el.innerHTML = options.html;
      if (options.attrs) {
        Object.entries(options.attrs).forEach(([key, value]) => {
          el.setAttribute(key, value);
        });
      }
      return el;
    },

    // -------- PRICE / FORMATTERS --------
    formatPrice(amount, opts = {}) {
      const precision = opts.precision != null ? opts.precision : (cfg.pricePrecision || 2);
      const symbol = opts.symbol != null ? opts.symbol : (cfg.currencySymbol || "₹");
      const currency = opts.currency || cfg.currency || "INR";

      try {
        // Intl API for nice formatting
        const formatter = new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency,
          minimumFractionDigits: precision,
          maximumFractionDigits: precision
        });
        return formatter.format(amount);
      } catch (e) {
        // Fallback
        return symbol + Number(amount).toFixed(precision);
      }
    },

    // -------- LOCAL STORAGE HELPERS --------
    safeJSONParse(str, fallback) {
      try {
        return str ? JSON.parse(str) : fallback;
      } catch (e) {
        console.warn("JSON parse failed:", e);
        return fallback;
      }
    },

    loadFromStorage(key, defaultValue) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return defaultValue;
        // Auto-detect JSON vs plain
        if (raw[0] === "{" || raw[0] === "[") {
          return GNUtils.safeJSONParse(raw, defaultValue);
        }
        return raw;
      } catch (e) {
        console.warn("loadFromStorage error:", e);
        return defaultValue;
      }
    },

    saveToStorage(key, value) {
      try {
        const isObject = typeof value === "object";
        localStorage.setItem(key, isObject ? JSON.stringify(value) : String(value));
      } catch (e) {
        console.warn("saveToStorage error:", e);
      }
    },

    removeFromStorage(key) {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        console.warn("removeFromStorage error:", e);
      }
    },

    // -------- URL / NAVIGATION --------
    getQueryParam(name) {
      const params = new URLSearchParams(window.location.search);
      return params.get(name);
    },

    goTo(routeKey) {
      if (!cfg.routes || !cfg.routes[routeKey]) return;
      window.location.href = cfg.routes[routeKey];
    },

    // -------- MISC HELPERS --------
    debounce(fn, delay) {
      let timer;
      return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
      };
    },

    throttle(fn, limit) {
      let inThrottle = false;
      return function (...args) {
        if (!inThrottle) {
          fn.apply(this, args);
          inThrottle = true;
          setTimeout(() => {
            inThrottle = false;
          }, limit);
        }
      };
    },

    scrollToTop(smooth = true) {
      window.scrollTo({
        top: 0,
        behavior: smooth ? "smooth" : "auto"
      });
    },

    generateId(prefix = "gon") {
      const random = Math.random().toString(36).slice(2, 8);
      const time = Date.now().toString(36);
      return `${prefix}_${time}_${random}`;
    }
  };

  // Expose globally
  window.GNUtils = GNUtils;
})(window, document);
