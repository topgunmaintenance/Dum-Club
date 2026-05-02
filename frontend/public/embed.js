/* DUM Club embed installer — drop-in script that mounts a live
 * commerce experience inside any merchant's website.
 *
 * Usage on the merchant's page:
 *
 *   <script
 *     src="https://dum.club/embed.js"
 *     data-business-id="topgun-maintenance"
 *     async
 *   ></script>
 *
 * The script reads `data-business-id` (or, as a fallback,
 * `data-business`) from its own <script> tag, then injects a
 * sandboxed iframe pointing at /embed/{businessId}. The iframe
 * source origin is taken from the script's own src so a script
 * served from staging.dum.club embeds the staging app, etc.
 *
 * Optional postMessage resize protocol: if the embed page ever
 * starts posting `{ type: "embed-resize", height: <number> }`
 * (same-origin to the script src), the listener below picks it up
 * and updates the iframe height. The embed page does NOT send
 * those messages today; the listener is forward-looking so the
 * installer doesn't need a follow-up release when it does.
 *
 * No backend dependencies. No build step. Plain ES5 so it loads
 * on any reasonably modern browser without a bundler.
 */
(function () {
  "use strict";

  // 1. Locate the <script> tag this code is running inside. We
  //    prefer document.currentScript (set on script load); fall
  //    back to the last <script> tag in the DOM, which is what
  //    older browsers expose during synchronous evaluation.
  var script = document.currentScript;
  if (!script) {
    var scripts = document.getElementsByTagName("script");
    script = scripts[scripts.length - 1];
  }
  if (!script) return;

  // 2. Read the business identifier. data-business-id is the
  //    canonical name; data-business is an accepted alias.
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

  // 3. Resolve the embed origin from the script's own src so this
  //    file works on any deployment without a hardcoded host.
  var origin;
  try {
    origin = new URL(script.src).origin;
  } catch (err) {
    origin = window.location.origin;
  }
  var embedUrl = origin + "/embed/" + encodeURIComponent(businessId);

  // 4. Build the iframe.
  var iframe = document.createElement("iframe");
  iframe.src = embedUrl;
  iframe.title = "DUM Club live storefront";
  iframe.loading = "lazy";

  // Visual / layout defaults. The merchant can override any of
  // these via CSS targeting [data-dum-embed].
  iframe.setAttribute("data-dum-embed", businessId);
  iframe.style.width = "100%";
  iframe.style.minHeight = "640px";
  iframe.style.border = "none";
  iframe.style.display = "block";
  iframe.setAttribute("frameborder", "0");
  iframe.setAttribute("scrolling", "no");

  // Capability allow-list. We need:
  //   - popups        → Stripe Checkout opens in a new tab when
  //                     the embed is iframed (Step 5).
  //   - payment       → Required by Stripe Payment Request API
  //                     and Apple/Google Pay buttons.
  //   - fullscreen    → Live video viewer can request fullscreen.
  //   - clipboard-write → Optional copy-to-clipboard helpers in
  //                       future receipt panels.
  iframe.setAttribute(
    "allow",
    "payment *; fullscreen *; clipboard-write *; popups *"
  );
  iframe.setAttribute("allowfullscreen", "true");

  // Sandbox: minimum required to run the React app, accept user
  // input, and pop a Stripe Checkout window. allow-same-origin is
  // required so the embed can talk to its own backend with cookies
  // and so the React hydration runs against the embed origin.
  iframe.setAttribute(
    "sandbox",
    "allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"
  );

  // 5. Insert immediately after the script tag so the embed
  //    appears in the natural document flow where the merchant
  //    placed the snippet.
  if (script.parentNode) {
    script.parentNode.insertBefore(iframe, script.nextSibling);
  } else {
    document.body.appendChild(iframe);
  }

  // 6. Optional resize protocol. Forward-looking — the embed page
  //    does not post these messages today. When/if it starts, the
  //    iframe will auto-grow to its content height, eliminating
  //    the inner scrollbar without the merchant having to re-paste
  //    the snippet.
  function onMessage(event) {
    if (event.source !== iframe.contentWindow) return;
    if (event.origin !== origin) return;
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type !== "embed-resize") return;
    var h = Number(data.height);
    if (!isFinite(h) || h < 100) return;
    iframe.style.height = h + "px";
  }
  if (window.addEventListener) {
    window.addEventListener("message", onMessage, false);
  }
})();
