/* DUM Club embed installer — drop-in script that mounts a live
 * commerce experience inside any merchant's website.
 *
 * Usage on the merchant's page (snippet shape unchanged):
 *
 *   <script
 *     src="https://dum.club/embed.js"
 *     data-business-id="topgun-maintenance"
 *     async
 *   ></script>
 *
 * What this script does, in order:
 *
 *   1. Renders a styled wrapper + branded skeleton in-place where
 *      the merchant pasted the snippet, so there is never a blank
 *      640px hole during page load.
 *   2. Defers iframe creation until the wrapper is near the
 *      viewport (IntersectionObserver, with a synchronous fallback
 *      for browsers that lack it).
 *   3. Mounts a sandboxed iframe pointing at /embed/{businessId}
 *      and fades it in over the skeleton on load.
 *   4. Listens for an `embed-resize` postMessage from the embed
 *      page so the iframe wrapper auto-grows to the embed's actual
 *      content height. No internal scrollbar on phones.
 *   5. If the iframe never loads (network error or 10s timeout),
 *      swaps the skeleton for a graceful DUM-branded fallback.
 *
 * Stays plain ES5 so it loads on any reasonably modern browser
 * without a bundler. No build step. No runtime deps.
 *
 * Merchant CSS hooks (override anything via these selectors):
 *
 *   [data-dum-embed-wrapper]   — the outer container
 *   [data-dum-embed]           — the iframe itself
 *   [data-dum-embed-skeleton]  — the loading / fallback overlay
 */
(function () {
  "use strict";

  // ── 1. Locate the <script> tag this code is running inside ──
  // Prefer document.currentScript (set on script load); fall back
  // to the last <script> tag in the DOM, which is what older
  // browsers expose during synchronous evaluation.
  var script = document.currentScript;
  if (!script) {
    var scripts = document.getElementsByTagName("script");
    script = scripts[scripts.length - 1];
  }
  if (!script) return;

  // ── 2. Read the business identifier ──
  // data-business-id is canonical; data-business is an accepted
  // alias kept around for older snippets that may already exist
  // on merchant sites.
  var businessId =
    script.getAttribute("data-business-id") ||
    script.getAttribute("data-business");
  if (!businessId) {
    if (window.console && window.console.warn) {
      window.console.warn(
        "[dum-embed] Missing data-business-id on <script> tag. Skipping."
      );
    }
    return;
  }

  // ── 2b. Read the outer display mode ──
  // Three values the merchant sets in the DUM Club dashboard
  // (migration 040: projects.embed_display_mode):
  //
  //   "full"       — inline iframe of the full storefront. Current
  //                  default behaviour; what every existing snippet
  //                  shipped before this feature renders.
  //   "bubble"     — small floating launcher (brand-teal pill,
  //                  fixed bottom-right) that opens the full
  //                  storefront in a centered overlay on click.
  //   "automatic"  — DUM picks at runtime. Until we wire live-state
  //                  awareness here, automatic resolves to "full"
  //                  so existing merchants keep their current page
  //                  unchanged after the migration's default flips
  //                  them to "automatic".
  //
  // We do not fetch the project's stored mode from the API because
  // CORS on /api/* doesn't permit arbitrary merchant origins. The
  // dashboard snippet generator passes the mode in the data-attr.
  var displayMode = (script.getAttribute("data-display-mode") || "").toLowerCase();
  if (displayMode !== "bubble" && displayMode !== "full" && displayMode !== "automatic") {
    displayMode = "automatic";
  }
  if (displayMode === "automatic") {
    displayMode = "full"; // until live-state awareness ships
  }

  // ── 3. Resolve the embed origin from the script's own src ──
  // A script served from staging.dum.club embeds the staging app,
  // a script served from dum.club embeds production, etc. Falling
  // back to window.location.origin is only correct in the rare
  // case the script is served same-origin with the merchant page,
  // which doesn't happen in practice but keeps us safe.
  var origin;
  try {
    origin = new URL(script.src).origin;
  } catch (err) {
    origin = window.location.origin;
  }
  var embedUrl = origin + "/embed/" + encodeURIComponent(businessId);

  // ── Bubble launcher (display mode === "bubble") ──
  // When the merchant has chosen Bubble, we skip the inline wrapper
  // entirely and render a fixed-position launcher button. The full
  // storefront lives behind a centred overlay that opens on click.
  // Everything else in this file (iframe creation, resize protocol,
  // fallback handling) gets called once the merchant taps the
  // launcher, so the iframe still goes through the same code path.
  if (displayMode === "bubble") {
    if (!document.getElementById("dum-embed-bubble-styles")) {
      var bs = document.createElement("style");
      bs.id = "dum-embed-bubble-styles";
      bs.textContent = [
        "[data-dum-embed-launcher] {",
        "  position: fixed;",
        "  bottom: 20px;",
        "  right: 20px;",
        "  z-index: 2147483646;",
        "  display: inline-flex;",
        "  align-items: center;",
        "  gap: 8px;",
        "  padding: 12px 18px;",
        "  border: 0;",
        "  border-radius: 9999px;",
        "  background: #00d1a4;",
        "  color: #0b2545;",
        "  font: 700 13px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;",
        "  letter-spacing: 0.04em;",
        "  text-transform: uppercase;",
        "  cursor: pointer;",
        "  box-shadow: 0 10px 28px rgba(11,18,32,0.18), 0 0 0 4px rgba(0,209,164,0.18);",
        "  transition: transform 160ms ease, box-shadow 160ms ease;",
        "}",
        "[data-dum-embed-launcher]:hover { transform: translateY(-2px); }",
        "[data-dum-embed-launcher]:focus-visible {",
        "  outline: 2px solid #0b2545;",
        "  outline-offset: 3px;",
        "}",
        "[data-dum-embed-launcher] .dum-dot {",
        "  width: 8px; height: 8px; border-radius: 50%;",
        "  background: #fff; box-shadow: 0 0 0 4px rgba(255,255,255,0.45);",
        "  animation: dum-embed-pulse 1.6s ease-in-out infinite;",
        "}",
        "[data-dum-embed-overlay] {",
        "  position: fixed; inset: 0; z-index: 2147483647;",
        "  display: none; align-items: center; justify-content: center;",
        "  background: rgba(11,18,32,0.72);",
        "  backdrop-filter: blur(8px);",
        "  -webkit-backdrop-filter: blur(8px);",
        "  padding: 24px;",
        "  animation: dum-embed-fade 200ms ease;",
        "}",
        "[data-dum-embed-overlay].is-open { display: flex; }",
        "[data-dum-embed-overlay-card] {",
        "  position: relative;",
        "  width: 100%;",
        "  max-width: 720px;",
        "  height: min(86vh, 900px);",
        "  border-radius: 20px;",
        "  overflow: hidden;",
        "  background: #060606;",
        "  box-shadow: 0 24px 60px rgba(0,0,0,0.45);",
        "}",
        "[data-dum-embed-overlay-card] iframe {",
        "  position: absolute; inset: 0;",
        "  width: 100%; height: 100%;",
        "  border: 0; display: block;",
        "}",
        "[data-dum-embed-overlay-close] {",
        "  position: absolute; top: 12px; right: 12px;",
        "  width: 36px; height: 36px;",
        "  display: inline-flex; align-items: center; justify-content: center;",
        "  border: 0; border-radius: 9999px;",
        "  background: rgba(255,255,255,0.92); color: #0b2545;",
        "  font-size: 18px; font-weight: 700; cursor: pointer;",
        "  z-index: 2;",
        "}",
        "@keyframes dum-embed-fade {",
        "  from { opacity: 0; } to { opacity: 1; }",
        "}",
        "@keyframes dum-embed-pulse {",
        "  0%, 100% { transform: scale(1);   opacity: 0.85; }",
        "  50%      { transform: scale(1.4); opacity: 1;    }",
        "}",
      ].join("\n");
      document.head.appendChild(bs);
    }

    var launcher = document.createElement("button");
    launcher.type = "button";
    launcher.setAttribute("data-dum-embed-launcher", businessId);
    launcher.setAttribute("aria-label", "Open DUM Club live storefront");
    var dot = document.createElement("span");
    dot.className = "dum-dot";
    dot.setAttribute("aria-hidden", "true");
    var label = document.createElement("span");
    label.textContent = "Shop Live";
    launcher.appendChild(dot);
    launcher.appendChild(label);

    var overlay = document.createElement("div");
    overlay.setAttribute("data-dum-embed-overlay", businessId);
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "DUM Club live storefront");

    var card = document.createElement("div");
    card.setAttribute("data-dum-embed-overlay-card", "");

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("data-dum-embed-overlay-close", "");
    closeBtn.setAttribute("aria-label", "Close DUM Club");
    closeBtn.textContent = "×";

    var overlayIframe = null;
    function ensureOverlayIframe() {
      if (overlayIframe) return;
      overlayIframe = document.createElement("iframe");
      overlayIframe.src = embedUrl;
      overlayIframe.title = "DUM Club live storefront";
      overlayIframe.setAttribute("data-dum-embed", businessId);
      overlayIframe.setAttribute("frameborder", "0");
      overlayIframe.setAttribute(
        "allow",
        "payment *; fullscreen *; clipboard-write *; popups *"
      );
      overlayIframe.setAttribute("allowfullscreen", "true");
      overlayIframe.setAttribute(
        "sandbox",
        "allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"
      );
      card.appendChild(overlayIframe);
    }

    function openOverlay() {
      ensureOverlayIframe();
      overlay.classList.add("is-open");
      document.body.style.overflow = "hidden";
    }
    function closeOverlay() {
      overlay.classList.remove("is-open");
      document.body.style.overflow = "";
    }

    launcher.addEventListener("click", openOverlay);
    closeBtn.addEventListener("click", closeOverlay);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeOverlay();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay.classList.contains("is-open")) {
        closeOverlay();
      }
    });

    card.appendChild(closeBtn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    document.body.appendChild(launcher);
    return;
  }

  // ── 4. Inject scoped styles once ──
  // Keyframe + structural rules live in a single <style> block we
  // dedupe across multiple embeds on the same page. Selectors are
  // namespaced with [data-dum-embed-*] so we don't bleed into the
  // merchant's stylesheet.
  if (!document.getElementById("dum-embed-styles")) {
    var styleEl = document.createElement("style");
    styleEl.id = "dum-embed-styles";
    styleEl.textContent = [
      "@keyframes dum-embed-pulse {",
      "  0%, 100% { transform: scale(1);   opacity: 0.85; }",
      "  50%      { transform: scale(1.4); opacity: 1;    }",
      "}",
      "[data-dum-embed-wrapper] {",
      "  position: relative;",
      "  width: 100%;",
      "  max-width: 100%;",
      "  min-height: 480px;",
      "  min-height: clamp(480px, 80vh, 1100px);",
      "  border-radius: 16px;",
      "  overflow: hidden;",
      "  background: #060606;",
      "  border: 1px solid rgba(255,255,255,0.06);",
      "  box-shadow: 0 1px 3px rgba(0,0,0,0.04);",
      "  scroll-margin-top: 80px;",
      "  isolation: isolate;",
      "}",
      "[data-dum-embed] {",
      "  position: absolute;",
      "  inset: 0;",
      "  width: 100%;",
      "  height: 100%;",
      "  border: 0;",
      "  display: block;",
      "  opacity: 0;",
      "  transition: opacity 320ms ease;",
      "  z-index: 2;",
      "}",
      "[data-dum-embed-skeleton] {",
      "  position: absolute;",
      "  inset: 0;",
      "  display: flex;",
      "  flex-direction: column;",
      "  align-items: center;",
      "  justify-content: center;",
      "  gap: 14px;",
      "  background: linear-gradient(180deg, #0a0a0a 0%, #060606 100%);",
      "  color: #b4b4cc;",
      "  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;",
      "  font-size: 13px;",
      "  letter-spacing: 0.05em;",
      "  transition: opacity 320ms ease;",
      "  z-index: 1;",
      "  padding: 24px;",
      "  text-align: center;",
      "}",
      "[data-dum-embed-skeleton] .dum-embed-dot {",
      "  width: 12px;",
      "  height: 12px;",
      "  border-radius: 50%;",
      "  background: #00ffa3;",
      "  box-shadow: 0 0 18px rgba(0,255,163,0.6);",
      "  animation: dum-embed-pulse 1.4s ease-in-out infinite;",
      "}",
      "[data-dum-embed-skeleton] .dum-embed-fallback-title {",
      "  color: #ffffff;",
      "  font-weight: 700;",
      "  font-size: 15px;",
      "  margin-bottom: 6px;",
      "  letter-spacing: 0;",
      "}",
      "[data-dum-embed-skeleton] .dum-embed-fallback-sub {",
      "  color: #b4b4cc;",
      "  font-size: 13px;",
      "  letter-spacing: 0;",
      "}"
    ].join("\n");
    (document.head || document.documentElement).appendChild(styleEl);
  }

  // ── 5. Build wrapper + skeleton DOM ──
  var wrapper = document.createElement("div");
  wrapper.setAttribute("data-dum-embed-wrapper", businessId);

  var skeleton = document.createElement("div");
  skeleton.setAttribute("data-dum-embed-skeleton", "");

  var dot = document.createElement("div");
  dot.className = "dum-embed-dot";
  var label = document.createElement("div");
  label.textContent = "Loading live storefront…";
  skeleton.appendChild(dot);
  skeleton.appendChild(label);

  wrapper.appendChild(skeleton);

  // Insert wrapper into the DOM at the script position so the
  // embed appears in the natural document flow where the merchant
  // placed the snippet.
  if (script.parentNode) {
    script.parentNode.insertBefore(wrapper, script.nextSibling);
  } else {
    (document.body || document.documentElement).appendChild(wrapper);
  }

  // ── 6. Iframe creation (deferred until near viewport) ──
  var iframeMounted = false;
  var loaded = false;
  var failed = false;
  var iframe;

  function showFallback() {
    if (loaded || failed) return;
    failed = true;
    while (skeleton.firstChild) {
      skeleton.removeChild(skeleton.firstChild);
    }
    var msg = document.createElement("div");
    var title = document.createElement("div");
    title.className = "dum-embed-fallback-title";
    title.textContent = "DUM Live can’t load right now.";
    var sub = document.createElement("div");
    sub.className = "dum-embed-fallback-sub";
    sub.textContent = "Refresh to try again.";
    msg.appendChild(title);
    msg.appendChild(sub);
    skeleton.appendChild(msg);
    if (iframe && iframe.parentNode) {
      try {
        iframe.parentNode.removeChild(iframe);
      } catch (e) {
        // best-effort cleanup
      }
    }
  }

  function createIframe() {
    if (iframeMounted) return;
    iframeMounted = true;

    iframe = document.createElement("iframe");
    iframe.src = embedUrl;
    iframe.title = "DUM Club live storefront";
    iframe.loading = "lazy";
    iframe.setAttribute("data-dum-embed", businessId);
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute("scrolling", "no");

    // Capability allow-list:
    //   payment           → Stripe Payment Request, Apple/Google Pay
    //   fullscreen        → live video viewer fullscreen
    //   clipboard-write   → optional copy helpers in receipt panels
    //   popups            → Stripe Checkout opens in a new tab
    iframe.setAttribute(
      "allow",
      "payment *; fullscreen *; clipboard-write *; popups *"
    );
    iframe.setAttribute("allowfullscreen", "true");

    // Sandbox: minimum required to run the React app, accept user
    // input, and pop a Stripe Checkout window. allow-same-origin
    // is required so the embed talks to its own backend with
    // cookies and so React hydration runs against the embed origin.
    iframe.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"
    );

    iframe.addEventListener("load", function () {
      loaded = true;
      iframe.style.opacity = "1";
      skeleton.style.opacity = "0";
      setTimeout(function () {
        if (skeleton.parentNode) {
          try {
            skeleton.parentNode.removeChild(skeleton);
          } catch (e) {
            // best-effort cleanup
          }
        }
      }, 360);
    });
    iframe.addEventListener("error", showFallback);

    // 10s wall-clock timeout. iframe.onload doesn't fire on
    // unreachable hosts in many browsers, so without this the
    // skeleton would spin forever.
    setTimeout(showFallback, 10000);

    wrapper.appendChild(iframe);
  }

  if (typeof window.IntersectionObserver === "function") {
    var observer = new window.IntersectionObserver(
      function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            observer.disconnect();
            createIframe();
            return;
          }
        }
      },
      // Pre-load slightly before the wrapper enters the viewport
      // so the merchant doesn't see a flash of skeleton on scroll.
      { rootMargin: "200px 0px" }
    );
    observer.observe(wrapper);
  } else {
    // Old browsers without IntersectionObserver: create immediately.
    // No worse than the previous behaviour.
    createIframe();
  }

  // ── 7. embed-resize protocol ──
  // Embed page (when iframed) posts its actual content height up
  // to us. We grow the wrapper so the iframe can fill it and the
  // merchant page sees no inner scrollbar.
  function onMessage(event) {
    if (event.origin !== origin) return;
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type !== "embed-resize") return;
    var h = Number(data.height);
    if (!isFinite(h) || h < 100) return;
    wrapper.style.height = h + "px";
    // Once we know the real height, lift the min-height clamp so
    // the wrapper tracks content exactly instead of staying at
    // the floor when content is shorter than the clamp minimum.
    wrapper.style.minHeight = "0";
  }
  if (window.addEventListener) {
    window.addEventListener("message", onMessage, false);
  }
})();
