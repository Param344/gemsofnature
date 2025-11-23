// js/layout.js

document.addEventListener("DOMContentLoaded", () => {
  const headerHTML = `
  <!-- Navbar -->
  <header class="bg-emerald-900 text-white shadow-md">
    <nav class="container mx-auto flex justify-between items-center py-4 px-6">
      <!-- Logo -->
      <a href="index.html" class="flex items-center">
        <img src="images/logo.png" alt="Gems of Nature Logo" class="h-12 w-auto" loading="lazy">
        <span class="ml-3 text-2xl font-bold">Gems of Nature</span>
      </a>

      <!-- Desktop Links -->
      <ul class="hidden md:flex gap-6 text-lg">
        <li><a href="index.html" class="hover:text-emerald-300 transition">Home</a></li>
        <li><a href="about.html" class="hover:text-emerald-300 transition">About Us</a></li>
        <li><a href="shop.html" class="hover:text-emerald-300 transition">Collections</a></li>
        <li><a href="contact.html" class="hover:text-emerald-300 transition">Contact</a></li>
        <li><a href="astrology.consultation.html" class="hover:text-emerald-300 transition">Astrology & Consultation</a></li>
      </ul>

      <!-- Right: Buy Online + Cart + Mobile -->
      <div class="flex items-center gap-4">
        <a href="shop-ecom.html" class="hidden md:inline-block bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-semibold">Buy Online</a>
        <a href="shop-ecom.html" aria-label="Cart" class="text-2xl">🛒</a>
        <button id="mobile-menu-button" class="text-2xl md:hidden focus:outline-none">☰</button>
      </div>
    </nav>

    <!-- Mobile Menu -->
    <div id="mobile-menu" class="hidden bg-emerald-800 md:hidden">
      <ul class="flex flex-col gap-4 px-6 py-4">
        <li><a href="index.html" class="block hover:text-emerald-300 transition">Home</a></li>
        <li><a href="about.html" class="block hover:text-emerald-300 transition">About Us</a></li>
        <li><a href="shop.html" class="block hover:text-emerald-300 transition">Collections</a></li>
        <li><a href="shop-ecom.html" class="block hover:text-emerald-300 transition">Buy Online</a></li>
        <li><a href="contact.html" class="block hover:text-emerald-300 transition">Contact</a></li>
        <li><a href="astrology.consultation.html" class="block hover:text-emerald-300 transition">Astrology & Consultation</a></li>
      </ul>
    </div>
  </header>
  `;

  const footerHTML = `
  <!-- FOOTER -->
  <footer class="bg-emerald-900 text-white py-6">
    <div class="max-w-7xl mx-auto footer-inner flex flex-col md:flex-row items-center justify-between gap-4 px-6">

      <!-- Copyright -->
      <div class="text-sm footer-nowrap">
        &copy; 2025 <strong>Gems of Nature</strong>. All rights reserved.
      </div>

      <!-- Tagline -->
      <div class="text-sm text-emerald-100 font-medium text-center">
        100% natural stones • Secure payments • Fast shipping • 7-day returns
      </div>

      <!-- Social Links (PNG icons + labels) -->
      <div class="flex items-center justify-center gap-8 ml-2">
        <!-- Facebook -->
        <a
          href="https://www.facebook.com/profile.php?id=61581929357076"
          target="_blank" rel="noopener noreferrer"
          class="flex items-center gap-2 hover:opacity-90 transition"
        >
          <img src="images/social/facebook.png" alt="Facebook" class="w-6 h-6 rounded-full shadow-md">
          <span class="text-sm font-medium">Facebook</span>
        </a>

        <!-- Instagram -->
        <a
          href="https://www.instagram.com/gemsofnatureshop"
          target="_blank" rel="noopener noreferrer"
          class="flex items-center gap-2 hover:opacity-90 transition"
        >
          <img src="images/social/instagram.png" alt="Instagram" class="w-6 h-6 rounded-md shadow-md">
          <span class="text-sm font-medium">Instagram</span>
        </a>

        <!-- LinkedIn -->
        <a
          href="https://www.linkedin.com/company/gems-of-nature"
          target="_blank" rel="noopener noreferrer"
          class="flex items-center gap-2 hover:opacity-90 transition"
        >
          <img src="images/social/linkedin.png" alt="LinkedIn" class="w-6 h-6 rounded-md shadow-md">
          <span class="text-sm font-medium">LinkedIn</span>
        </a>
      </div>
    </div>
  </footer>
  `;

  // Inject header
  const headerContainer = document.getElementById("header");
  if (headerContainer) {
    headerContainer.innerHTML = headerHTML;
  }

  // Inject footer
  const footerContainer = document.getElementById("footer");
  if (footerContainer) {
    footerContainer.innerHTML = footerHTML;
  }

  // Apply base body classes
  if (document.body) {
    document.body.classList.add("bg-white", "text-gray-800", "font-montserrat");
  }

  // Mobile menu toggle
  const mobileMenuButton = document.getElementById("mobile-menu-button");
  const mobileMenu = document.getElementById("mobile-menu");
  if (mobileMenuButton && mobileMenu) {
    mobileMenuButton.addEventListener("click", () => {
      mobileMenu.classList.toggle("hidden");
    });
  }

  // Highlight current page in nav
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  const allNavLinks = document.querySelectorAll("header a, #mobile-menu a");

  allNavLinks.forEach((link) => {
    const href = link.getAttribute("href");
    if (!href) return;

    if (href === currentPage) {
      link.classList.add("font-semibold", "text-emerald-300");
    } else {
      link.classList.remove("font-semibold", "text-emerald-300");
    }
  });
});
