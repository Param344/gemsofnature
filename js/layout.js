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

  // Handle header-specific interactions (mobile menu, etc.)
  function initHeaderInteractions() {
    const mobileMenuButton = document.getElementById("mobile-menu-button");
    const mobileMenu = document.getElementById("mobile-menu");

    if (!mobileMenuButton || !mobileMenu) return;

    // Toggle mobile menu open/close
    mobileMenuButton.addEventListener("click", function () {
      const isOpen = !mobileMenu.classList.contains("hidden");

      if (isOpen) {
        mobileMenu.classList.add("hidden");
        mobileMenuButton.setAttribute("aria-expanded", "false");
      } else {
        mobileMenu.classList.remove("hidden");
        mobileMenuButton.setAttribute("aria-expanded", "true");
      }
    });

    // Close menu when a link is clicked (common mobile UX)
    const mobileLinks = mobileMenu.querySelectorAll("a");
    mobileLinks.forEach(function (link) {
      link.addEventListener("click", function () {
        mobileMenu.classList.add("hidden");
        mobileMenuButton.setAttribute("aria-expanded", "false");
      });
    });

    // Ensure menu is hidden again if user resizes to desktop width
    window.addEventListener("resize", function () {
      if (window.innerWidth >= 768) {
        mobileMenu.classList.add("hidden");
        mobileMenuButton.setAttribute("aria-expanded", "false");
      }
    });
  }

  async function loadComponent(container, filePath) {
    try {
      const res = await fetch(filePath);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      container.innerHTML = html;

      // After header is loaded, wire up interactions
      if (filePath === "/header.html") {
        initHeaderInteractions();
      }
    } catch (err) {
      console.error(`Error loading ${filePath}:`, err);
    }
  }

  // Load reusable components
  loadComponent(headerContainer, "/header.html");
  loadComponent(footerContainer, "/footer.html");

  // ------------------------------------------
  // INIT Chat widget (structure only for now)
  // ------------------------------------------
  // This waits until layout is placed in DOM
  setTimeout(() => {
    if (window.gonAIChat && typeof window.gonAIChat.init === "function") {
      window.gonAIChat.init();
    }
  }, 300);
});
