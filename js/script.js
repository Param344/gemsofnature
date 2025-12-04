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

// Cart popup init that can be called after header is loaded
function initGONCartPopup() {
  const cartBtn     = document.getElementById("headerCartBtn");
  const cartPopup   = document.getElementById("cartPopup");
  const cartOverlay = document.getElementById("cartOverlay");
  const cartClose   = document.getElementById("cartCloseBtn");

  // If header not injected yet, return false so we can try again
  if (!cartBtn || !cartPopup) {
    return false;
  }

  function openCartPopup() {
    cartPopup.classList.remove("hidden");
    if (cartOverlay) cartOverlay.classList.remove("hidden");
  }

  function closeCartPopup() {
    cartPopup.classList.add("hidden");
    if (cartOverlay) cartOverlay.classList.add("hidden");
  }

  // Toggle on header cart click
  cartBtn.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();

    if (cartPopup.classList.contains("hidden")) {
      openCartPopup();
    } else {
      closeCartPopup();
    }
  });

  // Clicking inside the popup should NOT close it
  cartPopup.addEventListener("click", function (e) {
    e.stopPropagation();
  });

  // X button
  if (cartClose) {
    cartClose.addEventListener("click", function (e) {
      e.preventDefault();
      closeCartPopup();
    });
  }

  // Overlay click closes
  if (cartOverlay) {
    cartOverlay.addEventListener("click", function () {
      closeCartPopup();
    });
  }

  // Click outside closes (optional, good UX on desktop)
  document.addEventListener("click", function (e) {
    if (!cartPopup.classList.contains("hidden")) {
      if (!e.target.closest("#headerCartBtn") && !e.target.closest("#cartPopup")) {
        closeCartPopup();
      }
    }
  });

  console.log("GON cart popup initialized");
  return true;
}

// Try to initialize after DOM + header injection
document.addEventListener("DOMContentLoaded", function () {
  // Keep trying until header is actually in the DOM
  const maxTries = 20;
  let tries = 0;

  const intervalId = setInterval(function () {
    tries++;
    const ok = initGONCartPopup();
    if (ok || tries >= maxTries) {
      clearInterval(intervalId);
    }
  }, 200);
});
