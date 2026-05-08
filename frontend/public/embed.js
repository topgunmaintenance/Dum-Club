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
