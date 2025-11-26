// js/layout.js
document.addEventListener("DOMContentLoaded", function () {
  // Ensure containers exist, even if you forgot to add them in HTML
  function ensureContainer(id, position) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("div");
      el.id = id;

      if (position === "top") {
        // insert at very top of <body>
        document.body.insertBefore(el, document.body.firstChild);
      } else {
        // insert at very bottom of <body>
        document.body.appendChild(el);
      }
    }
    return el;
  }

  const headerContainer = ensureContainer("header", "top");
  const footerContainer = ensureContainer("footer", "bottom");

  // Dynamic load function
  async function loadComponent(container, filePath) {
    try {
      const res = await fetch(filePath);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      container.innerHTML = html;
    } catch (err) {
      console.error(`Error loading ${filePath}:`, err);
    }
  }

  // Always load from site root (works for /, /guides/, etc.)
  loadComponent(headerContainer, "/header.html");
  loadComponent(footerContainer, "/footer.html");
});
