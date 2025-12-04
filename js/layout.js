// js/layout.js
// Dynamically load shared header & footer and then initialise interactive features

document.addEventListener("DOMContentLoaded", () => {
  const headerContainer = document.getElementById("header");
  const footerContainer = document.getElementById("footer");

  async function loadFragment(container, path, callback) {
    if (!container) return;
    try {
      const res = await fetch(path, { cache: "no-cache" });
      if (!res.ok) {
        console.error(`Failed to load ${path}:`, res.status, res.statusText);
        return;
      }

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

  // NOTE: use absolute paths so it works from /, /guides/, etc.
  loadFragment(headerContainer, "/header.html", () => {
    if (typeof initHeaderInteractiveFeatures === "function") {
      initHeaderInteractiveFeatures();
    } else if (typeof initMobileMenu === "function") {
      // fallback if only that exists
      initMobileMenu();
    }
  });

  // Load footer (no special JS needed for now)
  loadFragment(footerContainer, "/footer.html");
});
