// js/layout.js
// Dynamically load shared header & footer and then initialise interactive features

document.addEventListener("DOMContentLoaded", () => {
  const headerContainer = document.getElementById("header");
  const footerContainer = document.getElementById("footer");

  async function loadFragment(container, path, callback) {
    if (!container) return;
    try {
      const res = await fetch(path);
      const html = await res.text();
      container.innerHTML = html;

      // run callback AFTER fragment is in the DOM
      if (typeof callback === "function") {
        callback();
      }
    } catch (err) {
      console.error(`Error loading ${path}:`, err);
    }
  }

  // Load header and then wire up mobile menu + cart badge
  loadFragment(headerContainer, "header.html", () => {
    if (typeof initHeaderInteractiveFeatures === "function") {
      initHeaderInteractiveFeatures();
    } else if (typeof initMobileMenu === "function") {
      // fallback if only that exists
      initMobileMenu();
    }
  });

  // Load footer (no special JS needed for now)
  loadFragment(footerContainer, "footer.html");
});
