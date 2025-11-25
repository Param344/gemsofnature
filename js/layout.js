// js/layout.js
document.addEventListener("DOMContentLoaded", function () {
  const headerContainer = document.getElementById("header");
  const footerContainer = document.getElementById("footer");

  // Dynamic load function
  async function loadComponent(container, filePath) {
    try {
      const res = await fetch(filePath);
      const html = await res.text();
      container.innerHTML = html;
    } catch (err) {
      console.error(`Error loading ${filePath}:`, err);
    }
  }

  // Load shared header + footer
  if (headerContainer) loadComponent(headerContainer, "components/header.html");
  if (footerContainer) loadComponent(footerContainer, "components/footer.html");
});
