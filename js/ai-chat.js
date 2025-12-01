// js/ai-chat.js
// Lightweight chat widget scaffold for future AI bot.
// Now: pretty lead-capture card styled with Tailwind classes.

(function () {
  "use strict";

  // Toggle this if you want the widget visible now
  const ENABLE_WIDGET = true; // set false to hide bubble completely

  function createChatWidget() {
    if (!ENABLE_WIDGET) return;

    // Avoid double init
    if (document.getElementById("gon-chat-toggle")) return;

    // --- Floating button ---
    const toggleBtn = document.createElement("button");
    toggleBtn.id = "gon-chat-toggle";
    toggleBtn.type = "button";
    toggleBtn.setAttribute("aria-label", "Open chat helper");

    toggleBtn.className =
      "fixed bottom-24 right-6 z-40 w-12 h-12 rounded-full bg-emerald-600 " +
      "text-white shadow-lg border-2 border-emerald-300 flex items-center justify-center " +
      "text-2xl hover:bg-emerald-700 hover:-translate-y-0.5 transition transform";

    toggleBtn.innerHTML = `
  <img src="/images/chat-gem.png"
       alt="Chat"
       style="width:26px; height:26px; object-fit:contain;">
`;

    // --- Panel ---
    const panel = document.createElement("div");
    panel.id = "gon-chat-panel";
    panel.className =
      "fixed bottom-24 right-6 z-50 w-80 max-w-xs sm:max-w-sm rounded-2xl bg-white " +
      "shadow-2xl border border-emerald-100 overflow-hidden hidden";

    panel.innerHTML = `
      <!-- Header -->
      <div class="bg-emerald-700 text-emerald-50 px-4 py-3 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="h-9 w-9 rounded-full bg-emerald-500 flex items-center justify-center text-lg shadow-inner">
            💎
          </div>
          <div>
            <div class="text-sm font-semibold leading-tight">Gems of Nature Assistant</div>
            <div class="text-[11px] text-emerald-100/80 leading-tight">
              Quick help &amp; call-back requests
            </div>
          </div>
        </div>
        <button type="button" id="gon-chat-close"
                class="text-emerald-100 hover:text-white text-lg leading-none px-1">
          &times;
        </button>
      </div>

      <!-- Body -->
      <div class="px-4 py-3 bg-emerald-50/60 text-[13px] text-slate-900 space-y-3 max-h-80 overflow-y-auto">
        <div>
          <p class="mb-1">
            👋 <strong>Hi!</strong> I can help with quick questions about
            <em>shipping, returns, gemstones &amp; certificates</em>.
          </p>
          <p class="text-xs text-slate-600">
            For detailed recommendations, please leave your details and our expert will contact you personally.
          </p>
        </div>

        <!-- Topic chips -->
        <div class="flex flex-wrap gap-2 text-[11px] text-slate-700">
          <span class="px-2 py-1 rounded-full bg-white border border-emerald-100">
            Shipping &amp; delivery
          </span>
          <span class="px-2 py-1 rounded-full bg-white border border-emerald-100">
            Returns &amp; lab certificates
          </span>
          <span class="px-2 py-1 rounded-full bg-white border border-emerald-100">
            Gemstone selection
          </span>
        </div>

        <!-- Form -->
        <form id="gon-chat-form" class="mt-1 space-y-2 text-xs">
          <input type="text" name="name" placeholder="Your name" required
                 class="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none
                        focus:ring-2 focus:ring-emerald-200 focus:border-emerald-500">

          <input type="tel" name="phone" placeholder="WhatsApp / phone" required
                 class="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none
                        focus:ring-2 focus:ring-emerald-200 focus:border-emerald-500">

          <input type="email" name="email" placeholder="Email (optional)"
                 class="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none
                        focus:ring-2 focus:ring-emerald-200 focus:border-emerald-500">

          <textarea name="question" rows="3" placeholder="Your question" required
                    class="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none resize-y
                           focus:ring-2 focus:ring-emerald-200 focus:border-emerald-500"></textarea>

          <button type="submit"
                  class="w-full rounded-full bg-emerald-600 hover:bg-emerald-700 text-white
                         text-xs font-semibold py-2.5 shadow-md mt-1">
            Send &amp; we’ll contact you
          </button>

          <p class="mt-1 text-[11px] text-slate-600 leading-snug">
            We usually reply within 24 hours via WhatsApp or email.
          </p>
        </form>
      </div>
    `;

    document.body.appendChild(toggleBtn);
    document.body.appendChild(panel);

    const closeBtn = panel.querySelector("#gon-chat-close");
    const form = panel.querySelector("#gon-chat-form");

    function togglePanel() {
      panel.classList.toggle("hidden");
    }

    toggleBtn.addEventListener("click", togglePanel);
    closeBtn.addEventListener("click", togglePanel);

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      const formData = new FormData(form);
      const data = Object.fromEntries(formData.entries());

      // For now: open mail client. Later: send to Formspree or backend/CRM.
      const subject = encodeURIComponent("New chat enquiry - Gems of Nature");
      const body = encodeURIComponent(
        `Name: ${data.name}\n` +
        `Phone: ${data.phone}\n` +
        `Email: ${data.email || "-"}\n\n` +
        `Message:\n${data.question}\n\n` +
        `Source: On-site chat helper`
      );

      window.open(
        `mailto:gemsofnatureofficial@gmail.com?subject=${subject}&body=${body}`
      );

      alert(
        "Thank you! We’ve opened your email app. You can also expect a reply on WhatsApp / email soon."
      );
      form.reset();
      panel.classList.add("hidden");
    });
  }

  // Expose init function globally so layout.js can call it
  window.gonAIChat = {
    init: createChatWidget
  };
})();
