// js/script.js
// Handles mobile menu + header/cart behavior for dynamic header loading

/*************************************************
 * Initialize mobile menu toggle
 *************************************************/
function initMobileMenu() {
  const menuToggle = document.getElementById("mobile-menu-button");
  const mobileMenu = document.getElementById("mobile-menu");

  if (!menuToggle || !mobileMenu) return;

  // Add ARIA for accessibility
  menuToggle.setAttribute("aria-controls", "mobile-menu");
  menuToggle.setAttribute("aria-expanded", "false");

  // Avoid double-binding the click event
  menuToggle.onclick = function () {
    const isHidden = mobileMenu.classList.contains("hidden");
    mobileMenu.classList.toggle("hidden");
    menuToggle.setAttribute("aria-expanded", String(isHidden));
  };
}

/*************************************************
 * Global Cart Badge Updater
 *************************************************/
function updateHeaderCartCount() {
  const cartCountEl = document.getElementById("cartCount");
  if (!cartCountEl) return;

  let cart = {};
  try {
    cart = JSON.parse(localStorage.getItem("gon_cart") || "{}");
  } catch (e) {
    console.error("Error parsing cart:", e);
    return;
  }

  let totalQty = 0;
  Object.values(cart).forEach(q => totalQty += Number(q || 0));
  cartCountEl.textContent = totalQty;
}

/*************************************************
 * Initialize all header-related behavior
 *************************************************/
function initHeaderInteractiveFeatures() {
  initMobileMenu();
  updateHeaderCartCount();
}

/*************************************************
 * DOM Ready + Dynamic Header Injection Support
 *************************************************/
document.addEventListener("DOMContentLoaded", () => {
  // If header is already in DOM (static pages)
  initHeaderInteractiveFeatures();

  // If header loads dynamically from layout.js (fetch → innerHTML)
  const waitForHeader = setInterval(() => {
    const headerLoaded = document.getElementById("mobile-menu-button");
    if (headerLoaded) {
      initHeaderInteractiveFeatures();
      clearInterval(waitForHeader);
    }
  }, 100);
});
