// js/layout.js
document.addEventListener("DOMContentLoaded", function () {
  // Ensure containers exist, even if you forgot to add them in HTML
  function ensureContainer(id, position) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("div");
      el.id = id;

      if (position === "top") {
        document.body.insertBefore(el, document.body.firstChild);
      } else {
        document.body.appendChild(el);
      }
    }
    return el;
  }

  const headerContainer = ensureContainer("header", "top");
  const footerContainer = ensureContainer("footer", "bottom");

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

  // 🔥 This is perfect: always from site root
  loadComponent(headerContainer, "/header.html");
  loadComponent(footerContainer, "/footer.html");
});
