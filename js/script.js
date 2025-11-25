// js/script.js
// Handles mobile menu toggle for the shared header

document.addEventListener("DOMContentLoaded", function () {
  const menuToggle = document.getElementById("mobile-menu-button");
  const mobileMenu = document.getElementById("mobile-menu");

  if (menuToggle && mobileMenu) {
    menuToggle.addEventListener("click", function () {
      mobileMenu.classList.toggle("hidden");
    });
  }
});
