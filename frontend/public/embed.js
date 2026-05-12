/* DUM Club embed installer — drop-in script that mounts a live
 * commerce experience inside any merchant's website.
 *
 * Usage on the merchant's page (canonical host is www.dum.club —
 * apex dum.club is currently misconfigured at the Vercel routing
 * layer and is canonicalised at runtime regardless of which host
 * the merchant pastes):
 *
 *   <script
 *     src="https://www.dum.club/embed.js"
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

  // ── 0. Self-deduplication ──
  // The merchant's CMS or theme may inject the same snippet twice
  // (e.g. both dum.club/embed.js and www.dum.club/embed.js end up
  // in the rendered head). Without a guard each instance would
  // mount its own wrapper or floating launcher. The flag is set on
  // window — not module-scoped — so a second copy of this same
  // file, loaded under a different origin, still sees the marker.
  if (window.__DUM_EMBED_LOADED__) {
    if (window.console && window.console.info) {
      window.console.info(
        "[DUM embed] Skipping duplicate embed.js load — already initialised."
      );
    }
    return;
  }
  window.__DUM_EMBED_LOADED__ = true;

  // Single logger so production users see one well-namespaced
  // breadcrumb per state transition. Silent if the host page has
  // muted the console, which some merchant CMS plugins do.
  function dumLog(message) {
    if (window.console && window.console.log) {
      try {
        window.console.log("[DUM embed] " + message);
      } catch (e) {
        // no-op — never break the merchant page over a log line
      }
    }
  }
  function dumWarn(message) {
    if (window.console && window.console.warn) {
      try {
        window.console.warn("[DUM embed] " + message);
      } catch (e) {
        // no-op
      }
    }
  }

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
  // Two paths to resolve the merchant's chosen mode:
  //
  //   1. data-display-mode attribute on the script tag — for
  //      merchants who want to pin a specific mode in their HTML
  //      snippet (no dashboard round-trip).
  //   2. Dashboard-saved value at GET /api/projects/{id}/embed-config
  //      — for merchants who paste the script once and switch
  //      modes in the DUM dashboard whenever. CORS on that
  //      endpoint is explicitly opened to "*" because the
  //      embed script runs on the merchant's origin (e.g.
  //      topgunmaintenance.com) which is intentionally NOT on
  //      the regular API CORS allow-list.
  //
  // The attribute wins when present. Otherwise we fetch the
  // dashboard value with a hard timeout fallback to "full" so a
  // stuck network never leaves the merchant with a blank box.
  var attrMode = (script.getAttribute("data-display-mode") || "").toLowerCase();
  var hasExplicitAttr =
    attrMode === "bubble" || attrMode === "full" || attrMode === "automatic";

  // ── 3. Resolve the embed origin ──
  // Production pins to https://www.dum.club because the apex host
  // (dum.club) is currently misconfigured at Vercel's routing
  // layer — /api/* paths there don't reach the Next.js function
  // tree, so the embed-config endpoint returns 503 when fetched
  // via apex. The www subdomain routes correctly. Hard-pinning
  // here means a merchant who installed the apex snippet
  // (<script src="https://dum.club/embed.js">) still gets working
  // config + iframe loads because every subsequent network hop
  // canonicalises to www.
  //
  // Localhost / 127.0.0.1 escape preserved so the dev server at
  // localhost:3000 keeps working without touching DNS. Anything
  // that doesn't look like a local-dev origin falls through to
  // the canonical www host.
  var CANONICAL_PROD_ORIGIN = "https://www.dum.club";
  var LOCAL_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  var origin = CANONICAL_PROD_ORIGIN;
  try {
    var scriptOrigin = new URL(script.src).origin;
    if (LOCAL_ORIGIN_RE.test(scriptOrigin)) {
      origin = scriptOrigin;
    }
  } catch (err) {
    // Stay on the canonical prod origin.
  }
  var embedUrl = origin + "/embed/" + encodeURIComponent(businessId);

  // Defer all rendering until we know which mode the merchant
  // chose. If the script tag pinned a mode explicitly via
  // data-display-mode, use it; otherwise fetch the dashboard
  // value with a hard 2500ms timeout. On fetch failure we fall
  // back to "bubble" — a self-contained, non-blocking launcher —
  // rather than to "full", which would steal the merchant's
  // viewport when their dashboard had specifically configured
  // the lighter-weight bubble. The previous behaviour
  // (fallback → "full") was the root cause of the topgun
  // bubble outage: a transient 503 from /embed-config caused
  // the script to hijack the page with the storefront iframe.
  //
  // The pop-in payload (greetings, delay, once-per-session) is
  // captured here too so renderForMode can drive the bubble
  // greeting without a second API round-trip.
  var rendered = false;
  var popinConfig = null; // populated from /embed-config when available

  function render(mode) {
    if (rendered) return;
    rendered = true;
    // Normalise: "automatic" resolves to "full" until live-state
    // awareness ships here. Already-resolved modes pass through.
    if (mode !== "bubble" && mode !== "full" && mode !== "automatic") {
      mode = "automatic";
    }
    if (mode === "automatic") mode = "full";
    var displayMode = mode;
    dumLog(displayMode === "bubble"
      ? "Bubble mode activated"
      : "Full storefront mode activated");
    renderForMode(displayMode);
  }

  if (hasExplicitAttr) {
    render(attrMode);
  } else {
    var configUrl =
      origin + "/api/projects/" + encodeURIComponent(businessId) + "/embed-config";
    // 2.5s is conservative for a single cached PostgREST round trip;
    // the previous 800ms was tight enough that a cold Railway start
    // could blow past it and trigger the storefront fallback.
    var timeoutFiredAsBubble = false;
    var timeoutId = window.setTimeout(function () {
      timeoutFiredAsBubble = true;
      dumWarn("embed-config timed out — defaulting to bubble launcher");
      render("bubble");
    }, 2500);
    try {
      var fetchPromise = window.fetch
        ? window.fetch(configUrl, { method: "GET", credentials: "omit" })
        : null;
      if (!fetchPromise) {
        window.clearTimeout(timeoutId);
        dumWarn("fetch unsupported in this browser — defaulting to bubble launcher");
        render("bubble");
      } else {
        fetchPromise
          .then(function (r) {
            if (!r.ok) {
              var err = new Error("status " + r.status);
              err.__status = r.status;
              throw err;
            }
            return r.json();
          })
          .then(function (cfg) {
            window.clearTimeout(timeoutId);
            if (timeoutFiredAsBubble) return; // race-loser, already rendered
            if (cfg && typeof cfg === "object" && cfg.popin_config) {
              popinConfig = cfg.popin_config;
            }
            var m =
              cfg && typeof cfg.embed_display_mode === "string"
                ? cfg.embed_display_mode.toLowerCase()
                : "";
            render(m);
          })
          .catch(function (err) {
            window.clearTimeout(timeoutId);
            if (timeoutFiredAsBubble) return;
            var status = (err && err.__status) || "network";
            dumWarn(
              "Failed to load embed-config (" + status + ") — " +
              "defaulting to bubble launcher"
            );
            render("bubble");
          });
      }
    } catch (e) {
      window.clearTimeout(timeoutId);
      if (!timeoutFiredAsBubble) {
        dumWarn("fetch threw synchronously — defaulting to bubble launcher");
        render("bubble");
      }
    }
  }

  // ── Pop-in greeting helpers ──
  // The dashboard-saved popin_config drives a small chat-style
  // bubble that opens above the launcher to nudge first-time
  // visitors and welcome back returning ones. Storage keys are
  // scoped per businessId so a merchant who installs multiple
  // embeds on different pages doesn't bleed state between them.
  function popinStorageKeys() {
    return {
      visited: "dum-embed-visited:" + businessId,
      sessionShown: "dum-embed-shown:" + businessId,
    };
  }
  function safeLocalRead(key) {
    try {
      return window.localStorage && window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function safeLocalWrite(key, value) {
    try {
      if (window.localStorage) window.localStorage.setItem(key, value);
    } catch (e) {
      // Quota / disabled storage — degrade silently
    }
  }
  function safeSessionRead(key) {
    try {
      return window.sessionStorage && window.sessionStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function safeSessionWrite(key, value) {
    try {
      if (window.sessionStorage) window.sessionStorage.setItem(key, value);
    } catch (e) {
      // no-op
    }
  }

  function renderForMode(displayMode) {
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
        "[data-dum-embed-greeting] {",
        "  position: fixed;",
        "  bottom: 76px;",
        "  right: 20px;",
        "  z-index: 2147483646;",
        "  max-width: min(320px, calc(100vw - 32px));",
        "  padding: 14px 40px 14px 16px;",
        "  border-radius: 16px;",
        "  background: #ffffff;",
        "  color: #0b2545;",
        "  font: 500 14px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;",
        "  box-shadow: 0 18px 40px rgba(11,18,32,0.18), 0 0 0 1px rgba(11,18,32,0.06);",
        "  opacity: 0;",
        "  transform: translateY(6px);",
        "  transition: opacity 220ms ease, transform 220ms ease;",
        "  pointer-events: none;",
        "}",
        "[data-dum-embed-greeting].is-visible {",
        "  opacity: 1;",
        "  transform: translateY(0);",
        "  pointer-events: auto;",
        "}",
        "[data-dum-embed-greeting-close] {",
        "  position: absolute; top: 6px; right: 6px;",
        "  width: 24px; height: 24px;",
        "  display: inline-flex; align-items: center; justify-content: center;",
        "  border: 0; border-radius: 9999px;",
        "  background: transparent; color: #5b6478;",
        "  font-size: 16px; line-height: 1; cursor: pointer;",
        "}",
        "[data-dum-embed-greeting-close]:hover { color: #0b2545; }",
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

    // ── Pop-in greeting card ──
    // Surfaced only when popin_config.enabled is true (default) AND
    // a non-empty greeting string is available for the visitor's
    // first-vs-returning state. Mirrors the merchant's dashboard
    // settings exactly: delay_seconds + once_per_session.
    var cfg = popinConfig || {};
    var popinEnabled = cfg.enabled !== false;
    if (popinEnabled) {
      var keys = popinStorageKeys();
      var hasVisited = !!safeLocalRead(keys.visited);
      var firstGreeting = (cfg.greeting || "").trim();
      var returningGreeting = (cfg.returning_greeting || "").trim();
      var greetingText = hasVisited
        ? returningGreeting || firstGreeting
        : firstGreeting || returningGreeting;
      var isReturning = hasVisited && !!returningGreeting;
      var oncePerSession = cfg.once_per_session === true;
      var alreadyShownThisSession =
        oncePerSession && safeSessionRead(keys.sessionShown) === "1";

      if (greetingText && !alreadyShownThisSession) {
        var greet = document.createElement("div");
        greet.setAttribute("data-dum-embed-greeting", businessId);
        greet.setAttribute("role", "status");
        greet.setAttribute("aria-live", "polite");

        var greetBody = document.createElement("div");
        greetBody.textContent = greetingText;
        var greetClose = document.createElement("button");
        greetClose.type = "button";
        greetClose.setAttribute("data-dum-embed-greeting-close", "");
        greetClose.setAttribute("aria-label", "Dismiss greeting");
        greetClose.textContent = "×";

        greet.appendChild(greetBody);
        greet.appendChild(greetClose);
        document.body.appendChild(greet);

        var delayMs = Math.max(0, Number(cfg.delay_seconds) || 0) * 1000;
        var delayCap = 60000; // mirror server clamp
        if (delayMs > delayCap) delayMs = delayCap;

        var showGreeting = function () {
          greet.classList.add("is-visible");
          if (isReturning) {
            dumLog("Returning-visitor greeting shown");
          } else {
            dumLog("First-visit greeting shown");
          }
          if (oncePerSession) safeSessionWrite(keys.sessionShown, "1");
          // Mark the visitor as known for future sessions ONLY after
          // the greeting actually renders. Writing the flag earlier
          // (or on the no-greeting fallthrough below) used to "burn"
          // the first-visit state for tab-closed-during-delay users,
          // meaning their next session would resolve to the
          // returning-visitor greeting even though they never saw
          // the first one.
          if (!hasVisited) safeLocalWrite(keys.visited, "1");
        };

        if (delayMs > 0) {
          window.setTimeout(showGreeting, delayMs);
        } else {
          showGreeting();
        }

        var dismissGreeting = function () {
          greet.classList.remove("is-visible");
        };
        greetClose.addEventListener("click", dismissGreeting);
        launcher.addEventListener("click", dismissGreeting);
      }
      // No fallthrough write: if there's no greeting to render, the
      // visited flag stays unset so the visitor doesn't silently get
      // bumped from first-visit to returning state. Once a merchant
      // configures a greeting and the visitor actually sees it, the
      // showGreeting() callback above writes the flag.
    }
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
  } // end renderForMode(displayMode)
})();
