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
  // Full /embed-config response. is_live, ivs_stage_arn, and
  // pinned_offer all live at the TOP LEVEL of that payload — they
  // are NOT inside popin_config. Storing only popinConfig (the
  // sub-object) was the root cause of the live-bubble outage:
  // the bubble's `isLive` check evaluated `popinConfig.is_live`
  // which is always undefined, so the live-iframe branch never
  // fired. Capture the whole response so the bubble branch can
  // read top-level fields directly.
  var embedConfig = null;

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
            if (cfg && typeof cfg === "object") {
              // Capture the FULL response. is_live, pinned_offer,
              // ivs_stage_arn live here at the top level; the
              // bubble branch reads them directly via embedConfig.
              embedConfig = cfg;
              if (cfg.popin_config) popinConfig = cfg.popin_config;
            }
            var m =
              cfg && typeof cfg.embed_display_mode === "string"
                ? cfg.embed_display_mode.toLowerCase()
                : "";
            render(m);

            // Live-state polling. The initial fetch above is one-shot;
            // without this loop a bubble loaded BEFORE the merchant
            // went live would never switch to LIVE state until the
            // buyer manually refreshed. Adaptive cadence:
            //   - offline: 3s  (catches go-live within ~3-5s on an
            //              already-open tab; the embed-config Cache-
            //              Control is max-age=2 so most polls hit the
            //              Vercel edge cache, not the origin)
            //   - live:    5s  (live state can change fast; matches
            //              the host page's tick rate)
            // Pauses on hidden tabs via the visibility API. Bubble's
            // `.is-live` class + aria-label are toggled in place; no
            // re-mount. Errors are silent — next tick retries.
            function pollLiveState() {
              if (typeof document !== "undefined" && document.visibilityState === "hidden") {
                scheduleNext();
                return;
              }
              try {
                window.fetch(configUrl, { method: "GET", credentials: "omit" })
                  .then(function (r) { return r.ok ? r.json() : null; })
                  .then(function (next) {
                    if (next && typeof next === "object") {
                      var prevIsLive =
                        (embedConfig && embedConfig.is_live === true) ||
                        (popinConfig && popinConfig.is_live === true);
                      embedConfig = next;
                      if (next.popin_config) popinConfig = next.popin_config;
                      var nextIsLive =
                        (next.is_live === true) ||
                        (next.popin_config && next.popin_config.is_live === true);
                      if (nextIsLive !== prevIsLive) {
                        var bubbleEl = document.querySelector(
                          "[data-dum-embed-bubble='" + businessId + "']"
                        );
                        if (bubbleEl) {
                          if (nextIsLive) bubbleEl.classList.add("is-live");
                          else bubbleEl.classList.remove("is-live");
                          var newLabel = nextIsLive
                            ? "Watch live now"
                            : "Open live storefront";
                          bubbleEl.setAttribute("aria-label", newLabel);
                        }
                      }
                    }
                  })
                  .catch(function () { /* silent — next tick retries */ })
                  .then(scheduleNext);
              } catch (_e) {
                scheduleNext();
              }
            }
            function scheduleNext() {
              var isLiveNow =
                (embedConfig && embedConfig.is_live === true) ||
                (popinConfig && popinConfig.is_live === true);
              var ms = isLiveNow ? 5000 : 3000;
              window.setTimeout(pollLiveState, ms);
            }
            scheduleNext();
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
  // ── Circular bubble launcher (display mode === "bubble") ──
  // True Loom-style floating launcher: a single circular tile in
  // the bottom-right of the merchant's site. Avatar (or initials
  // fallback) inside, gold ring + pulsing LIVE pill when the
  // merchant is broadcasting, dismiss × in the top-right corner.
  // Clicking the bubble opens the same centred storefront overlay
  // the previous identity card opened — the overlay + iframe
  // contract is preserved end-to-end so chat, inventory, Stripe,
  // and WebSocket wiring continue to work exactly as before.
  //
  // Greeting copy is intentionally dropped from this surface (a
  // 140px circle has no room for it). The dashboard pop-in
  // greeting still drives the in-iframe PopInSeller component on
  // the embed page itself; only the host-page launcher shape
  // changes here.
  if (displayMode === "bubble") {
    // Scoped styles for the circular bubble + storefront overlay.
    // Selectors are namespaced under [data-dum-embed-*] so they
    // don't bleed into the merchant's own stylesheet. Dedupe by
    // element id so multiple embeds on the same page only inject
    // the block once.
    if (!document.getElementById("dum-embed-bubble-styles")) {
      var bs = document.createElement("style");
      bs.id = "dum-embed-bubble-styles";
      bs.textContent = [
        // ── Bubble shell ───────────────────────────────────────
        // Fixed bottom-right launcher. Transparent outer shell so
        // the dismiss × can sit in the corner of the bounding box
        // (outside the visual circle) and the LIVE pill can hang
        // off the bottom edge without a square clip artifact. The
        // circular mask lives on the inner .dum-clip element.
        "[data-dum-embed-bubble] {",
        "  position: fixed;",
        "  bottom: 20px;",
        "  right: 20px;",
        "  z-index: 2147483646;",
        "  width: 140px; height: 140px;",
        "  padding: 0; margin: 0; border: 0;",
        "  background: transparent;",
        "  cursor: pointer;",
        "  opacity: 0;",
        "  transform: translateY(12px) scale(0.94);",
        "  transition: opacity 240ms ease, transform 240ms ease;",
        "  -webkit-tap-highlight-color: transparent;",
        "  touch-action: none;",  // Prevents iOS scroll-cancel during drag
        "}",
        "[data-dum-embed-bubble].is-dragging {",
        "  cursor: grabbing;",
        "  transition: none;",   // Snap to pointer, no animation lag
        "}",
        "[data-dum-embed-bubble].is-dragging .dum-tap-hint,",
        "[data-dum-embed-bubble].is-dragging .dum-live-pill,",
        "[data-dum-embed-bubble].is-dragging .dum-bubble-viewers {",
        "  opacity: 0.4;",       // Dim chrome while dragging
        "}",
        "[data-dum-embed-bubble].is-visible {",
        "  opacity: 1; transform: translateY(0) scale(1);",
        "}",
        "[data-dum-embed-bubble]:focus-visible { outline: none; }",
        // ── Circular clip — the visual circle ─────────────────
        // border-radius: 50% + overflow: hidden gives a true
        // circle. The clip carries a brand-teal gradient as a
        // backdrop so initials render against the brand colour
        // when no avatar image is supplied. Hover lift + shadow
        // upgrade are bound to the outer bubble so the dismiss ×
        // moves with the same animation.
        "[data-dum-embed-bubble] .dum-clip {",
        "  position: absolute; inset: 0;",
        "  border-radius: 50%;",
        "  overflow: hidden;",
        "  background: linear-gradient(135deg, #00d1a4 0%, #00ffa3 100%);",
        "  box-shadow: 0 16px 36px rgba(11,18,32,0.28), 0 0 0 1px rgba(11,18,32,0.06);",
        "  transition: transform 200ms ease, box-shadow 200ms ease;",
        "}",
        "[data-dum-embed-bubble]:hover .dum-clip {",
        "  transform: scale(1.04);",
        "  box-shadow: 0 22px 44px rgba(11,18,32,0.34), 0 0 0 1px rgba(0,209,164,0.4);",
        "}",
        "[data-dum-embed-bubble]:focus-visible .dum-clip {",
        "  box-shadow: 0 16px 36px rgba(11,18,32,0.32), 0 0 0 4px rgba(0,209,164,0.55);",
        "}",
        "[data-dum-embed-bubble] .dum-clip img {",
        "  position: absolute; inset: 0;",
        "  width: 100%; height: 100%;",
        "  object-fit: cover;",
        "  display: block;",
        "}",
        // Live IVS preview iframe — clipped by .dum-clip's circle.
        // pointer-events: none so a click anywhere on the bubble
        // bubbles up to the host-page wrapper's click handler and
        // opens the overlay (vs. eating clicks inside the iframe).
        "[data-dum-embed-bubble] .dum-clip iframe {",
        "  position: absolute; inset: 0;",
        "  width: 100%; height: 100%;",
        "  border: 0;",
        "  display: block;",
        "  background: #060606;",
        "  pointer-events: none;",
        "}",
        // When live, the .dum-clip backdrop becomes black so a
        // brief stream-loading flash doesn't show the brand-teal
        // gradient peeking through behind the video.
        "[data-dum-embed-bubble].is-live .dum-clip {",
        "  background: #060606;",
        "}",
        "[data-dum-embed-bubble] .dum-initials {",
        "  position: absolute; inset: 0;",
        "  display: flex; align-items: center; justify-content: center;",
        "  color: #0b2545;",
        "  font: 700 38px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;",
        "  letter-spacing: 0.02em;",
        "  text-shadow: 0 1px 2px rgba(255,255,255,0.35);",
        "  user-select: none;",
        "}",
        // ── Gold live ring + breathing glow ───────────────────
        // Painted only when .is-live is on. Solid inner ring is
        // gold; the breathing halo softens the surrounding glow
        // without distorting the avatar.
        "[data-dum-embed-bubble].is-live .dum-clip {",
        "  animation: dum-embed-live-ring 2.4s ease-in-out infinite;",
        "}",
        // ── LIVE pill — anchored to the bottom edge ───────────
        // Sits just past the circle's bottom edge so it reads as
        // a label hung off the avatar. Hidden until .is-live.
        "[data-dum-embed-bubble] .dum-live-pill {",
        "  position: absolute;",
        "  left: 50%; bottom: -6px;",
        "  transform: translateX(-50%);",
        "  display: none;",
        "  align-items: center; gap: 5px;",
        "  padding: 4px 10px;",
        "  border-radius: 9999px;",
        "  background: #ef4444;",
        "  color: #ffffff;",
        "  font: 800 10px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;",
        "  letter-spacing: 0.14em;",
        "  text-transform: uppercase;",
        "  box-shadow: 0 6px 14px rgba(239,68,68,0.45), 0 0 0 2px #ffffff;",
        "  white-space: nowrap;",
        "  pointer-events: none;",
        "}",
        "[data-dum-embed-bubble].is-live .dum-live-pill { display: inline-flex; }",
        // Viewer count pill on the bubble itself. Tucked next to
        // the LIVE pill at the bottom of the circle so visitors
        // see live momentum even when no product stack renders
        // (offline merchant turned the panel off, or no offers
        // configured). Hidden when viewer_count is 0 / unknown.
        "[data-dum-embed-bubble] .dum-bubble-viewers {",
        "  position: absolute;",
        "  left: 50%; bottom: -6px;",
        "  transform: translate(calc(-50% + 64px), 0);",
        "  display: none;",
        "  align-items: center; gap: 4px;",
        "  padding: 3px 8px;",
        "  border-radius: 9999px;",
        "  background: rgba(11,18,32,0.92);",
        "  color: #ffffff;",
        "  font: 700 9px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;",
        "  letter-spacing: 0.12em;",
        "  text-transform: uppercase;",
        "  box-shadow: 0 4px 10px rgba(11,18,32,0.35), 0 0 0 2px #ffffff;",
        "  white-space: nowrap;",
        "  pointer-events: none;",
        "}",
        "[data-dum-embed-bubble].is-live .dum-bubble-viewers.is-visible { display: inline-flex; }",
        "[data-dum-embed-bubble] .dum-bubble-viewers-dot {",
        "  width: 4px; height: 4px; border-radius: 50%;",
        "  background: #00d1a4;",
        "}",
        // "Tap to watch" caption — small white pill that sits
        // just below the bubble when live. Visible only with
        // .is-live so the offline bubble stays clean.
        "[data-dum-embed-bubble] .dum-tap-hint {",
        "  position: absolute;",
        "  left: 50%; top: 100%;",
        "  transform: translate(-50%, 12px);",
        "  display: none;",
        "  padding: 5px 11px;",
        "  border-radius: 9999px;",
        "  background: rgba(11,18,32,0.92);",
        "  color: #ffffff;",
        "  font: 700 11px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;",
        "  white-space: nowrap;",
        "  box-shadow: 0 4px 12px rgba(11,18,32,0.3);",
        "  pointer-events: none;",
        "}",
        "[data-dum-embed-bubble].is-live .dum-tap-hint { display: inline-flex; }",
        // Viewer-count pill — inline element used inside the
        // countdown banner row to surface "12 watching". Calm
        // colour so it reads as data, not urgency.
        "[data-dum-embed-product-viewers] {",
        "  display: inline-flex;",
        "  align-items: center;",
        "  gap: 5px;",
        "  padding: 4px 8px;",
        "  border-radius: 9999px;",
        "  background: rgba(11,18,32,0.06);",
        "  color: #213047;",
        "  font: 700 10px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;",
        "  letter-spacing: 0.08em;",
        "  text-transform: uppercase;",
        "  margin-left: 6px;",
        "}",
        "[data-dum-embed-product-viewers] .dum-viewers-dot {",
        "  width: 5px; height: 5px; border-radius: 50%;",
        "  background: #00d1a4;",
        "}",
        "[data-dum-embed-bubble] .dum-live-dot {",
        "  width: 6px; height: 6px; border-radius: 50%;",
        "  background: #ffffff;",
        "  animation: dum-embed-blink 1.4s ease-in-out infinite;",
        "}",
        // ── Dismiss × — top-right, fades in on hover/focus ────
        "[data-dum-embed-bubble-close] {",
        "  position: absolute;",
        "  top: 0; right: 0;",
        "  width: 26px; height: 26px;",
        "  display: inline-flex; align-items: center; justify-content: center;",
        "  border: 0; border-radius: 9999px;",
        "  background: #ffffff;",
        "  color: #0b2545;",
        "  font: 700 14px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;",
        "  cursor: pointer;",
        "  box-shadow: 0 4px 10px rgba(11,18,32,0.22);",
        "  opacity: 0;",
        "  transition: opacity 160ms ease;",
        "  -webkit-appearance: none; appearance: none;",
        "  padding: 0; margin: 0;",
        "  z-index: 2;",
        "}",
        "[data-dum-embed-bubble]:hover [data-dum-embed-bubble-close],",
        "[data-dum-embed-bubble]:focus-within [data-dum-embed-bubble-close] {",
        "  opacity: 1;",
        "}",
        "[data-dum-embed-bubble-close]:hover { background: #f3f4f6; }",
        "[data-dum-embed-bubble-close]:focus-visible {",
        "  outline: 2px solid #00d1a4; outline-offset: 2px; opacity: 1;",
        "}",
        // ── Product panel — countdown + up to 3 offer rows ──
        // When the merchant is live AND embed-config exposes
        // active_offers, the panel replaces the PR #168 single
        // chip with a compact storefront stack: an honest
        // countdown banner on top (from live_session.remaining_
        // seconds) plus offer rows the visitor can tap into the
        // full overlay from. When offline, falls back to the
        // single chip layout (still rendered via the same
        // [data-dum-embed-product-chip] selector below).
        "[data-dum-embed-product-panel] {",
        "  position: fixed;",
        "  bottom: 20px;",
        "  right: 178px;",          // 20 (bubble right) + 140 (bubble) + 18 gap
        "  z-index: 2147483646;",
        "  display: flex;",
        "  flex-direction: column;",
        "  align-items: stretch;",
        "  gap: 6px;",
        "  width: 280px;",
        "  max-width: calc(100vw - 200px);",
        "  opacity: 0;",
        "  transform: translateX(8px);",
        "  transition: opacity 240ms ease, transform 240ms ease;",
        "  pointer-events: none;",
        "}",
        "[data-dum-embed-product-panel].is-visible {",
        "  opacity: 1; transform: translateX(0);",
        "  pointer-events: auto;",
        "}",
        // Countdown banner — anchored to the top of the panel.
        // Single line, small + bold, monospace for the digit
        // section so it doesn't reflow each second. Background
        // is a soft red wash when an urgent "Only N left" stock
        // state is on; brand teal otherwise.
        "[data-dum-embed-product-countdown] {",
        "  display: inline-flex;",
        "  align-items: center;",
        "  gap: 6px;",
        "  padding: 6px 10px;",
        "  border-radius: 9999px;",
        "  background: rgba(0,209,164,0.14);",
        "  color: #036f56;",
        "  font: 800 10px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;",
        "  letter-spacing: 0.14em;",
        "  text-transform: uppercase;",
        "  align-self: flex-start;",
        "  box-shadow: 0 6px 14px rgba(11,18,32,0.08);",
        "}",
        "[data-dum-embed-product-countdown].is-stock {",
        "  background: rgba(239,68,68,0.14);",
        "  color: #b91c1c;",
        "}",
        "[data-dum-embed-product-countdown] .dum-cd-dot {",
        "  width: 6px; height: 6px; border-radius: 50%;",
        "  background: #00d1a4;",
        "  animation: dum-embed-blink 1.4s ease-in-out infinite;",
        "}",
        "[data-dum-embed-product-countdown].is-stock .dum-cd-dot {",
        "  background: #ef4444;",
        "}",
        "[data-dum-embed-product-countdown] .dum-cd-digits {",
        "  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;",
        "  font-weight: 700;",
        "  letter-spacing: 0.04em;",
        "}",
        // Product row — full-width button styled like a list item.
        "[data-dum-embed-product-row] {",
        "  display: inline-flex;",
        "  align-items: center;",
        "  gap: 10px;",
        "  padding: 9px 12px;",
        "  border: 0;",
        "  border-radius: 14px;",
        "  background: #ffffff;",
        "  color: #0b2545;",
        "  font: 600 13px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;",
        "  text-align: left;",
        "  cursor: pointer;",
        "  box-shadow: 0 10px 24px rgba(11,18,32,0.18), 0 0 0 1px rgba(11,18,32,0.06);",
        "  transition: box-shadow 200ms ease, transform 160ms ease;",
        "  -webkit-tap-highlight-color: transparent;",
        "  -webkit-appearance: none; appearance: none;",
        "  width: 100%;",
        "}",
        "[data-dum-embed-product-row]:hover {",
        "  transform: translateY(-1px);",
        "  box-shadow: 0 14px 28px rgba(11,18,32,0.24), 0 0 0 1px rgba(0,209,164,0.5);",
        "}",
        "[data-dum-embed-product-row]:focus-visible {",
        "  outline: 2px solid #00d1a4; outline-offset: 3px;",
        "}",
        "[data-dum-embed-product-row] .dum-row-body {",
        "  display: inline-flex;",
        "  flex-direction: column;",
        "  gap: 2px;",
        "  flex: 1 1 auto;",
        "  min-width: 0;",
        "}",
        "[data-dum-embed-product-row] .dum-row-title {",
        "  font-size: 13px;",
        "  font-weight: 600;",
        "  color: #0b2545;",
        "  overflow: hidden;",
        "  text-overflow: ellipsis;",
        "  white-space: nowrap;",
        "}",
        "[data-dum-embed-product-row] .dum-row-meta {",
        "  font-size: 11px;",
        "  color: #5b6478;",
        "  font-weight: 600;",
        "}",
        "[data-dum-embed-product-row] .dum-row-meta.is-low {",
        "  color: #b91c1c;",
        "}",
        "[data-dum-embed-product-row] .dum-row-price {",
        "  font: 700 13px/1 ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;",
        "  color: #036f56;",
        "  flex: 0 0 auto;",
        "  white-space: nowrap;",
        "}",
        "[data-dum-embed-product-row] .dum-row-arrow {",
        "  font-size: 14px; line-height: 1;",
        "  color: #036f56;",
        "  flex: 0 0 auto;",
        "  transition: transform 160ms ease;",
        "}",
        "[data-dum-embed-product-row]:hover .dum-row-arrow {",
        "  transform: translateX(3px);",
        "}",
        // ── Product chip — pinned offer CTA next to the bubble ──
        // Independent fixed element. Sits to the LEFT of the bubble
        // on desktop (so it doesn't extend past the right edge of
        // the viewport) and ABOVE the bubble on mobile. Click opens
        // the same storefront overlay focused on the pinned offer.
        // Title is truncated at the natural ellipsis; price renders
        // monospaced for legibility next to it.
        "[data-dum-embed-product-chip] {",
        "  position: fixed;",
        "  bottom: 32px;",         // align with the centre of a 140px bubble
        "  right: 178px;",          // 20 (bubble right) + 140 (bubble) + 18 gap
        "  z-index: 2147483646;",
        "  display: inline-flex;",
        "  align-items: center;",
        "  gap: 10px;",
        "  max-width: min(280px, calc(100vw - 200px));",
        "  padding: 10px 14px;",
        "  border: 0;",
        "  border-radius: 9999px;",
        "  background: #ffffff;",
        "  color: #0b2545;",
        "  font: 600 13px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;",
        "  text-align: left;",
        "  cursor: pointer;",
        "  box-shadow: 0 14px 32px rgba(11,18,32,0.22), 0 0 0 1px rgba(11,18,32,0.06);",
        "  opacity: 0;",
        "  transform: translateX(8px);",
        "  transition: opacity 240ms ease, transform 240ms ease, box-shadow 200ms ease;",
        "  -webkit-tap-highlight-color: transparent;",
        "}",
        "[data-dum-embed-product-chip].is-visible {",
        "  opacity: 1; transform: translateX(0);",
        "}",
        "[data-dum-embed-product-chip]:hover {",
        "  box-shadow: 0 18px 40px rgba(11,18,32,0.28), 0 0 0 1px rgba(0,209,164,0.5);",
        "}",
        "[data-dum-embed-product-chip]:focus-visible {",
        "  outline: 2px solid #00d1a4; outline-offset: 3px;",
        "}",
        "[data-dum-embed-product-chip] .dum-chip-body {",
        "  display: inline-flex; flex-direction: column; gap: 1px;",
        "  min-width: 0;",
        "}",
        "[data-dum-embed-product-chip] .dum-chip-label {",
        "  font-size: 9px;",
        "  font-weight: 800;",
        "  letter-spacing: 0.16em;",
        "  text-transform: uppercase;",
        "  color: #036f56;",
        "}",
        "[data-dum-embed-product-chip] .dum-chip-title {",
        "  font-size: 13px;",
        "  font-weight: 600;",
        "  color: #0b2545;",
        "  max-width: 200px;",
        "  overflow: hidden;",
        "  text-overflow: ellipsis;",
        "  white-space: nowrap;",
        "}",
        "[data-dum-embed-product-chip] .dum-chip-price {",
        "  font: 700 14px/1 ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;",
        "  color: #036f56;",
        "  white-space: nowrap;",
        "}",
        "[data-dum-embed-product-chip] .dum-chip-arrow {",
        "  font-size: 14px; line-height: 1;",
        "  color: #036f56;",
        "  transition: transform 160ms ease;",
        "}",
        "[data-dum-embed-product-chip]:hover .dum-chip-arrow {",
        "  transform: translateX(3px);",
        "}",
        // ── Mobile sizing ─────────────────────────────────────
        // Diameter drops to 96px; dismiss × becomes a 30px tap
        // target and is always visible (no hover state on touch).
        // Product chip stacks ABOVE the bubble on small phones so
        // it doesn't fight for horizontal space; max-width caps it
        // at the viewport minus the safe-area gutters.
        "@media (max-width: 480px) {",
        "  [data-dum-embed-bubble] {",
        "    width: 96px; height: 96px;",
        "    bottom: 16px; right: 16px;",
        "  }",
        "  [data-dum-embed-bubble] .dum-initials { font-size: 26px; }",
        "  [data-dum-embed-bubble] .dum-live-pill {",
        "    font-size: 9px; padding: 3px 8px; bottom: -5px;",
        "  }",
        "  [data-dum-embed-bubble-close] {",
        "    width: 30px; height: 30px; opacity: 1;",
        "  }",
        "  [data-dum-embed-product-chip] {",
        "    bottom: 124px;",        // bubble bottom 16 + bubble 96 + gap 12
        "    right: 16px;",
        "    max-width: calc(100vw - 32px);",
        "    padding: 9px 12px;",
        "  }",
        "  [data-dum-embed-product-chip] .dum-chip-title {",
        "    max-width: calc(100vw - 160px);",
        "  }",
        "  [data-dum-embed-product-panel] {",
        "    bottom: 124px;",        // same anchor as the chip
        "    right: 16px;",
        "    width: calc(100vw - 32px);",
        "    max-width: 360px;",
        "  }",
        "}",
        // ── Reduced-motion override ───────────────────────────
        // Quiet the entrance + live-ring animation for visitors
        // who have asked for less motion. Bubble still shows and
        // the LIVE pill still reads — nothing throbs.
        "@media (prefers-reduced-motion: reduce) {",
        "  [data-dum-embed-bubble] {",
        "    transition: opacity 120ms ease;",
        "    transform: none;",
        "  }",
        "  [data-dum-embed-bubble].is-live .dum-clip {",
        "    animation: none;",
        "    box-shadow: 0 0 0 3px #FFD24A, 0 0 0 8px rgba(255,210,74,0.25), 0 16px 36px rgba(11,18,32,0.32);",
        "  }",
        "  [data-dum-embed-bubble] .dum-live-dot { animation: none; }",
        "}",
        // ── Overlay (storefront iframe modal) ─────────────────
        // Identical contract to the prior bubble branch — chat,
        // checkout, inventory, and WebSocket wiring all flow
        // through this iframe once the visitor taps the bubble.
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
        // ── Mobile overlay tuning (<= 480px) ─────────────────
        // On phones the visitor wants the livestream to feel native —
        // edge-to-edge, with the close button respecting the notch /
        // dynamic-island safe area. Defaults above are sized for
        // desktop / tablet where 24px gutters and a 720px-max card
        // read as a polite modal; on a 390px phone those gutters cost
        // 12% of the available width and the 86vh card leaves an
        // empty bottom band on Safari with the URL bar hidden.
        "@media (max-width: 480px) {",
        "  [data-dum-embed-overlay] {",
        "    padding: 8px;",
        "  }",
        "  [data-dum-embed-overlay-card] {",
        // vh first (legacy), dvh second (modern). Browsers that
        // don't recognise dvh ignore the second rule.
        "    height: 96vh;",
        "    height: 96dvh;",
        "    border-radius: 14px;",
        "  }",
        "  [data-dum-embed-overlay-close] {",
        // Push below iPhone notch / Android cutouts. env() returns 0
        // when no safe area is reported (older Android), so the
        // fallback math keeps the button at 8px minimum.
        "    top: calc(env(safe-area-inset-top, 0px) + 8px);",
        "    right: calc(env(safe-area-inset-right, 0px) + 8px);",
        "  }",
        "}",
        // ── Animations ────────────────────────────────────────
        // dum-embed-live-ring is the breathing gold halo painted
        // around the avatar when .is-live is on; the inner solid
        // 3px ring stays fixed while the outer halo pulses.
        "@keyframes dum-embed-fade {",
        "  from { opacity: 0; } to { opacity: 1; }",
        "}",
        "@keyframes dum-embed-blink {",
        "  0%, 100% { opacity: 1; }",
        "  50%      { opacity: 0.35; }",
        "}",
        "@keyframes dum-embed-live-ring {",
        "  0%, 100% {",
        "    box-shadow:",
        "      0 0 0 3px #FFD24A,",
        "      0 0 0 8px rgba(255,210,74,0.30),",
        "      0 16px 36px rgba(11,18,32,0.32);",
        "  }",
        "  50% {",
        "    box-shadow:",
        "      0 0 0 3px #FFD24A,",
        "      0 0 0 12px rgba(255,210,74,0.16),",
        "      0 16px 36px rgba(11,18,32,0.32);",
        "  }",
        "}",
      ].join("\n");
      document.head.appendChild(bs);
    }

    // ── Compute identity copy ──
    var cfg = popinConfig || {};
    var popinEnabled = cfg.enabled !== false;
    var merchantTitle =
      (cfg.title || cfg.merchant_title || "").trim() ||
      // Last-resort: convert the businessId/slug into a Title-Case
      // approximation so we never render a slug verbatim ("topgun-
      // maintenance" -> "Topgun Maintenance").
      businessId
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, function (c) { return c.toUpperCase(); });

    // Initials for the circular avatar — up to two letters,
    // uppercased, from the first two words of the merchant title.
    // Falls back to "•" when no word characters are present so the
    // circle never reads empty.
    var initials = merchantTitle
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(function (w) { return w.charAt(0).toUpperCase(); })
      .join("") || "•";

    // Optional avatar / poster image. Read off the same popin_config
    // payload the server already returns; no new endpoint. If the URL
    // 404s or fails to decode the <img>'s error handler swaps in the
    // initials fallback at render time.
    var avatarUrl = "";
    if (typeof cfg.avatar_url === "string" && cfg.avatar_url) {
      avatarUrl = cfg.avatar_url;
    } else if (typeof cfg.poster_url === "string" && cfg.poster_url) {
      avatarUrl = cfg.poster_url;
    }

    // is_live + pinned_offer are TOP-LEVEL fields on the embed-
    // config response, not inside popin_config. Read from
    // embedConfig directly. The legacy popinConfig fallback is
    // kept defensively in case a future server change ever
    // mirrors the flag down into popin_config.
    var isLive =
      (embedConfig && embedConfig.is_live === true) ||
      cfg.is_live === true ||
      (popinConfig && popinConfig.is_live === true);

    // Once-per-session bookkeeping survives intact so merchants who
    // opted into that pattern keep the same behaviour. Greeting copy
    // is no longer rendered on this surface (no room in a 140px
    // circle) but the inner-iframe PopInSeller still renders it.
    var keys = popinStorageKeys();
    var oncePerSession = cfg.once_per_session === true;
    var alreadyShownThisSession =
      oncePerSession && safeSessionRead(keys.sessionShown) === "1";

    // ── Build the storefront overlay (unchanged contract) ──
    // Chat, inventory, Stripe checkout, and WebSocket wiring all
    // flow through this iframe once the visitor taps the bubble.
    var overlay = document.createElement("div");
    overlay.setAttribute("data-dum-embed-overlay", businessId);
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "DUM Club live storefront");

    var overlayCard = document.createElement("div");
    overlayCard.setAttribute("data-dum-embed-overlay-card", "");

    var overlayClose = document.createElement("button");
    overlayClose.type = "button";
    overlayClose.setAttribute("data-dum-embed-overlay-close", "");
    overlayClose.setAttribute("aria-label", "Close DUM Club");
    overlayClose.textContent = "×";

    var overlayIframe = null;
    function ensureOverlayIframe() {
      if (overlayIframe) return;
      overlayIframe = document.createElement("iframe");
      // ?display=modal tells the embed page it's in the fixed-height
      // overlay (capped at 86vh) rather than the inline "full" wrapper
      // that auto-grows to content. The page uses it to switch to a
      // viewport-fit column so the video can't push the offer + CTA
      // off the bottom. The inline full-mode iframe (createIframe
      // below) deliberately omits the flag and keeps its natural,
      // auto-growing layout.
      overlayIframe.src = embedUrl + "?display=modal";
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
      overlayCard.appendChild(overlayIframe);
    }
    // Reference to the bubble's live IVS iframe (populated only
    // when the merchant is live and we mount the preview route).
    // Lets openOverlay / closeOverlay postMessage pause + resume so
    // we don't double-count viewer slots against the backend's
    // MAX_VIEWERS_PER_STREAM cap (services/live_limits.py:15).
    var bubbleLiveIframe = null;
    function pauseBubbleStream() {
      if (!bubbleLiveIframe || !bubbleLiveIframe.contentWindow) return;
      try {
        bubbleLiveIframe.contentWindow.postMessage(
          { type: "bubble-pause" },
          "*"
        );
      } catch (e) {
        // Cross-origin postMessage failures are silently swallowed
        // — the bubble keeps running, the visitor double-counts,
        // but the page never breaks over a messaging hiccup.
      }
    }
    function resumeBubbleStream() {
      if (!bubbleLiveIframe || !bubbleLiveIframe.contentWindow) return;
      try {
        bubbleLiveIframe.contentWindow.postMessage(
          { type: "bubble-resume" },
          "*"
        );
      } catch (e) {
        // see pauseBubbleStream
      }
    }
    function openOverlay() {
      ensureOverlayIframe();
      overlay.classList.add("is-open");
      document.body.style.overflow = "hidden";
      pauseBubbleStream();
    }
    function closeOverlay() {
      overlay.classList.remove("is-open");
      document.body.style.overflow = "";
      resumeBubbleStream();
    }
    overlayClose.addEventListener("click", closeOverlay);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeOverlay();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay.classList.contains("is-open")) {
        closeOverlay();
      }
    });
    overlayCard.appendChild(overlayClose);
    overlay.appendChild(overlayCard);
    document.body.appendChild(overlay);

    // ── Mount gates ──
    // Merchant explicitly disabled pop-in, or once-per-session
    // already fired in this tab → no bubble. The visitor reaches
    // the storefront via the merchant's own page links instead.
    // Preserves the prior merchant contract: an opt-out still
    // opts out, even though the bubble's visual shape changed.
    if (!popinEnabled || alreadyShownThisSession) {
      return;
    }

    // ── Build the circular bubble ──
    // Rendered as <div role="button"> so the dismiss × can be a
    // real nested <button> without invalid HTML. Keyboard
    // activation (Enter / Space) is wired to openOverlay.
    var bubble = document.createElement("div");
    bubble.setAttribute("data-dum-embed-bubble", businessId);
    bubble.setAttribute("role", "button");
    bubble.setAttribute("tabindex", "0");
    bubble.setAttribute(
      "aria-label",
      isLive
        ? "Watch " + merchantTitle + " live now"
        : "Open " + merchantTitle + " live storefront"
    );
    if (isLive) bubble.classList.add("is-live");

    var clip = document.createElement("span");
    clip.className = "dum-clip";
    clip.setAttribute("aria-hidden", "true");

    // Bubble interior. Three branches, in priority order:
    //   1. Live merchant → mount the lightweight preview iframe at
    //      /embed/bubble/[id]. The iframe's React app subscribes to
    //      the IVS Stage and paints the video full-bleed; our
    //      circular .dum-clip masks it into a circle on the host
    //      page. Iframe is pointer-events: none so the host-page
    //      bubble click handler still fires.
    //   2. Avatar / poster URL configured → <img> with a hard
    //      error fallback to initials.
    //   3. Otherwise → initials monogram on the brand gradient.
    if (isLive) {
      bubbleLiveIframe = document.createElement("iframe");
      bubbleLiveIframe.src =
        origin + "/embed/bubble/" + encodeURIComponent(businessId);
      bubbleLiveIframe.title = merchantTitle + " live preview";
      bubbleLiveIframe.setAttribute("frameborder", "0");
      bubbleLiveIframe.setAttribute("scrolling", "no");
      // autoplay is required for the muted preview video element
      // inside the iframe to start without a tap. fullscreen is
      // not needed here (full overlay handles that path) but we
      // leave it permissive in case a future iframe surface uses
      // it.
      bubbleLiveIframe.setAttribute("allow", "autoplay; fullscreen *");
      // Minimum sandbox to run the React app + WebRTC subscribe.
      // allow-same-origin is required so sessionStorage (anon
      // viewer id) and the IVS SDK's internal storage work. We
      // intentionally do NOT include allow-popups / allow-forms
      // — checkout happens in the full overlay, not here.
      bubbleLiveIframe.setAttribute(
        "sandbox",
        "allow-scripts allow-same-origin"
      );
      clip.appendChild(bubbleLiveIframe);
    } else if (avatarUrl) {
      var img = document.createElement("img");
      img.src = avatarUrl;
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      img.addEventListener("error", function () {
        if (img.parentNode) img.parentNode.removeChild(img);
        var ini = document.createElement("span");
        ini.className = "dum-initials";
        ini.textContent = initials;
        clip.appendChild(ini);
      });
      clip.appendChild(img);
    } else {
      var initialsEl = document.createElement("span");
      initialsEl.className = "dum-initials";
      initialsEl.textContent = initials;
      clip.appendChild(initialsEl);
    }

    var livePill = document.createElement("span");
    livePill.className = "dum-live-pill";
    livePill.setAttribute("aria-hidden", "true");
    var liveDot = document.createElement("span");
    liveDot.className = "dum-live-dot";
    var liveLabel = document.createElement("span");
    liveLabel.textContent = "Live";
    livePill.appendChild(liveDot);
    livePill.appendChild(liveLabel);

    // Viewer count pill directly on the bubble. Sits next to the
    // LIVE pill at the bottom of the circle. Built empty/hidden;
    // updateBubbleViewers() below populates + reveals when we
    // know a live count > 0. Refreshes when bubble-offers
    // postMessage arrives with fresh live_session data.
    var bubbleViewersPill = document.createElement("span");
    bubbleViewersPill.className = "dum-bubble-viewers";
    bubbleViewersPill.setAttribute("aria-hidden", "true");
    var bubbleViewersDot = document.createElement("span");
    bubbleViewersDot.className = "dum-bubble-viewers-dot";
    var bubbleViewersLabel = document.createElement("span");
    bubbleViewersPill.appendChild(bubbleViewersDot);
    bubbleViewersPill.appendChild(bubbleViewersLabel);
    function updateBubbleViewers(session) {
      var count =
        session &&
        typeof session.viewer_count === "number" &&
        session.viewer_count > 0
          ? session.viewer_count
          : 0;
      if (count > 0) {
        bubbleViewersLabel.textContent =
          count === 1 ? "1 watching" : count + " watching";
        bubbleViewersPill.classList.add("is-visible");
      } else {
        bubbleViewersPill.classList.remove("is-visible");
      }
    }
    updateBubbleViewers(liveSession);

    // "Tap to watch" caption — sits just under the bubble when
    // the merchant is live so visitors know the circle is
    // interactive (some users miss that the bubble is clickable
    // when the live face is the dominant signal). Hidden when
    // offline so the offline initials stay clean.
    var tapHint = document.createElement("span");
    tapHint.className = "dum-tap-hint";
    tapHint.setAttribute("aria-hidden", "true");
    tapHint.textContent = "Watch live →";

    var close = document.createElement("button");
    close.type = "button";
    close.setAttribute("data-dum-embed-bubble-close", "");
    close.setAttribute("aria-label", "Dismiss");
    close.textContent = "×";

    bubble.appendChild(clip);
    bubble.appendChild(livePill);
    bubble.appendChild(bubbleViewersPill);
    bubble.appendChild(tapHint);
    bubble.appendChild(close);

    // ── Commerce surface ──────────────────────────────────────
    // Three states, in priority order:
    //   1. Live + active_offers.length > 0 → product STACK
    //      (countdown banner on top + up to 3 offer rows). The
    //      stack creates instant buying intent next to the live
    //      video without trying to cram checkout into the bubble
    //      itself — each row opens the existing full overlay.
    //   2. Not live + pinned_offer present → single chip
    //      (PR #168 contract). Less prominent surface for offline
    //      merchants.
    //   3. Otherwise → no commerce surface. Bubble alone.
    //
    // Both surfaces dismiss with the bubble × so we never leave
    // an orphaned CTA floating after the visitor opts out.
    var productChip = null;
    var productPanel = null;
    var countdownTimer = null;

    var pinnedOffer =
      (embedConfig && embedConfig.pinned_offer) ||
      (cfg && cfg.pinned_offer);
    var activeOffers =
      (embedConfig && Array.isArray(embedConfig.active_offers))
        ? embedConfig.active_offers
        : [];
    var liveSession =
      (embedConfig && embedConfig.live_session) || null;

    // Defensive fallback: when we're live but the embed-config
    // response has no active_offers (either because the backend
    // hasn't redeployed PR #170, or because the merchant has
    // zero is_active=true offer rows), synthesise a 1-element
    // stack from the pinned_offer field. PR #168's pinned_offer
    // is the same shape the rows expect (id, title, price_usd),
    // so the panel still renders the same way; we just lose the
    // row-level "Only N left" tag because pinned_offer doesn't
    // carry quantity_remaining. The countdown banner still works
    // when live_session is populated, and gracefully drops out
    // when it isn't. Without this fallback, a stale Railway
    // backend leaves live merchants with an empty commerce
    // surface even though they have a featured offer wired up.
    if (
      isLive &&
      activeOffers.length === 0 &&
      pinnedOffer &&
      typeof pinnedOffer === "object" &&
      typeof pinnedOffer.title === "string" &&
      pinnedOffer.title.trim()
    ) {
      activeOffers = [{
        id: pinnedOffer.id || null,
        title: pinnedOffer.title,
        price_usd: typeof pinnedOffer.price_usd === "number"
          ? pinnedOffer.price_usd
          : null,
        quantity_remaining: null,
      }];
    }

    function formatCountdown(totalSeconds) {
      var s = Math.max(0, Math.floor(totalSeconds));
      var m = Math.floor(s / 60);
      var sec = s % 60;
      var mm = m < 10 ? "0" + m : "" + m;
      var ss = sec < 10 ? "0" + sec : "" + sec;
      return mm + ":" + ss;
    }

    // Extracted so the bubble-iframe → /api/offers postMessage
    // recovery path can build the same panel after initial render.
    // Idempotent: bails if productPanel or productChip is already
    // mounted, so a slow second source doesn't double-render.
    function buildProductPanel(offers, sessionData) {
      if (productPanel || productChip) return;
      if (!Array.isArray(offers) || offers.length === 0) return;

      productPanel = document.createElement("div");
      productPanel.setAttribute("data-dum-embed-product-panel", businessId);
      productPanel.setAttribute("role", "region");
      productPanel.setAttribute(
        "aria-label",
        merchantTitle + " live deals"
      );

      // Urgency banner. Two honest sources:
      //   (a) live_session.remaining_seconds — the per-stream
      //       duration cap really exists, so "Live deal ends in
      //       MM:SS" reflects a real product constraint.
      //   (b) Stock urgency on the TOP offer — only painted when
      //       quantity_remaining is a non-null small number.
      // Prefer (a) when both apply (stream-end is the harder
      // ceiling); fall back to (b); otherwise no banner.
      var topOffer = offers[0];
      var topQty =
        topOffer && typeof topOffer.quantity_remaining === "number"
          ? topOffer.quantity_remaining
          : null;
      var hasTimer =
        sessionData &&
        typeof sessionData.remaining_seconds === "number" &&
        sessionData.remaining_seconds > 0;
      var hasStockUrgency = topQty !== null && topQty > 0 && topQty <= 5;
      if (hasTimer || hasStockUrgency) {
        var cd = document.createElement("div");
        cd.setAttribute("data-dum-embed-product-countdown", "");
        if (!hasTimer && hasStockUrgency) {
          cd.className = "is-stock";
        }
        var cdDot = document.createElement("span");
        cdDot.className = "dum-cd-dot";
        cd.appendChild(cdDot);

        if (hasTimer) {
          var cdLabel = document.createElement("span");
          cdLabel.textContent = "Live deal ends in";
          var cdDigits = document.createElement("span");
          cdDigits.className = "dum-cd-digits";
          var initialRemaining = sessionData.remaining_seconds;
          cdDigits.textContent = formatCountdown(initialRemaining);
          cd.appendChild(cdLabel);
          cd.appendChild(cdDigits);

          // Client-side ticker. Anchored to wall-clock so we don't
          // drift on tab throttle: every tick recomputes from the
          // start timestamp instead of decrementing by 1.
          var startedAt = Date.now();
          countdownTimer = window.setInterval(function () {
            var elapsed = Math.floor((Date.now() - startedAt) / 1000);
            var remaining = initialRemaining - elapsed;
            if (remaining <= 0) {
              cdDigits.textContent = "00:00";
              if (countdownTimer) {
                window.clearInterval(countdownTimer);
                countdownTimer = null;
              }
              return;
            }
            cdDigits.textContent = formatCountdown(remaining);
          }, 1000);
        } else {
          var stockLabel = document.createElement("span");
          stockLabel.textContent =
            topQty === 1 ? "Only 1 left" : "Only " + topQty + " left";
          cd.appendChild(stockLabel);
        }
        // Viewer count chip — appended to the right of the
        // urgency banner when the backend reports any viewers.
        // get_viewer_count returns the live WebSocket join total,
        // so this only shows when the chat socket has at least
        // one connected listener on the stream.
        var viewersCount = sessionData &&
          typeof sessionData.viewer_count === "number"
          ? sessionData.viewer_count
          : 0;
        if (viewersCount > 0) {
          var vChip = document.createElement("span");
          vChip.setAttribute("data-dum-embed-product-viewers", "");
          var vDot = document.createElement("span");
          vDot.className = "dum-viewers-dot";
          var vLabel = document.createElement("span");
          vLabel.textContent =
            viewersCount === 1 ? "1 watching" : viewersCount + " watching";
          vChip.appendChild(vDot);
          vChip.appendChild(vLabel);
          cd.appendChild(vChip);
        }
        productPanel.appendChild(cd);
      } else if (
        sessionData &&
        typeof sessionData.viewer_count === "number" &&
        sessionData.viewer_count > 0
      ) {
        // No urgency banner but we still want to surface
        // "12 watching" so visitors see live momentum. Mount a
        // calm viewer-only pill at the top of the panel.
        var vOnly = document.createElement("div");
        vOnly.setAttribute("data-dum-embed-product-countdown", "");
        var vOnlyDot = document.createElement("span");
        vOnlyDot.className = "dum-cd-dot";
        var vOnlyLabel = document.createElement("span");
        var vc = sessionData.viewer_count;
        vOnlyLabel.textContent = vc === 1 ? "1 watching" : vc + " watching";
        vOnly.appendChild(vOnlyDot);
        vOnly.appendChild(vOnlyLabel);
        productPanel.appendChild(vOnly);
      }

      // Up to 3 offer rows. Each is a real <button> so keyboard +
      // screen-reader users get the affordance for free. Click
      // opens the same storefront overlay the bubble click does.
      var rowsToRender = offers.slice(0, 3);
      for (var ri = 0; ri < rowsToRender.length; ri++) {
        var off = rowsToRender[ri];
        if (!off || typeof off.title !== "string" || !off.title.trim()) {
          continue;
        }
        var row = document.createElement("button");
        row.type = "button";
        row.setAttribute("data-dum-embed-product-row", off.id || "");
        row.setAttribute(
          "aria-label",
          "View " + off.title + " from " + merchantTitle
        );

        var rowBody = document.createElement("span");
        rowBody.className = "dum-row-body";
        var rowTitle = document.createElement("span");
        rowTitle.className = "dum-row-title";
        rowTitle.textContent = off.title;
        rowBody.appendChild(rowTitle);
        var qr =
          typeof off.quantity_remaining === "number"
            ? off.quantity_remaining
            : null;
        if (qr !== null && qr > 0 && qr <= 5) {
          var rowMeta = document.createElement("span");
          rowMeta.className = "dum-row-meta is-low";
          rowMeta.textContent =
            qr === 1 ? "Only 1 left" : qr + " left";
          rowBody.appendChild(rowMeta);
        }
        row.appendChild(rowBody);

        if (
          typeof off.price_usd === "number" &&
          isFinite(off.price_usd)
        ) {
          var rowPrice = document.createElement("span");
          rowPrice.className = "dum-row-price";
          rowPrice.textContent = "$" + off.price_usd.toFixed(2);
          row.appendChild(rowPrice);
        }

        var rowArrow = document.createElement("span");
        rowArrow.className = "dum-row-arrow";
        rowArrow.setAttribute("aria-hidden", "true");
        rowArrow.textContent = "→";
        row.appendChild(rowArrow);

        row.addEventListener("click", function () {
          openOverlay();
        });
        productPanel.appendChild(row);
      }

      document.body.appendChild(productPanel);
      // If the bubble is already on screen, fade the panel in
      // immediately. Otherwise the initial showBubble() will pick
      // it up when it runs.
      if (bubble.classList.contains("is-visible")) {
        productPanel.classList.add("is-visible");
      }
    }

    if (isLive && activeOffers.length > 0) {
      // ── Path 1: Live product stack ───────────────────────────
      buildProductPanel(activeOffers, liveSession);
    } else if (
      pinnedOffer &&
      typeof pinnedOffer === "object" &&
      typeof pinnedOffer.title === "string" &&
      pinnedOffer.title.trim()
    ) {
      // ── Path 2: Offline pinned-offer chip (PR #168 contract) ──
      productChip = document.createElement("button");
      productChip.type = "button";
      productChip.setAttribute("data-dum-embed-product-chip", businessId);
      productChip.setAttribute(
        "aria-label",
        "Buy " + pinnedOffer.title + " from " + merchantTitle
      );

      var chipBody = document.createElement("span");
      chipBody.className = "dum-chip-body";
      var chipLabel = document.createElement("span");
      chipLabel.className = "dum-chip-label";
      chipLabel.textContent = isLive ? "Buy live" : "Featured";
      var chipTitle = document.createElement("span");
      chipTitle.className = "dum-chip-title";
      chipTitle.textContent = pinnedOffer.title;
      chipBody.appendChild(chipLabel);
      chipBody.appendChild(chipTitle);

      productChip.appendChild(chipBody);

      if (
        typeof pinnedOffer.price_usd === "number" &&
        isFinite(pinnedOffer.price_usd)
      ) {
        var chipPrice = document.createElement("span");
        chipPrice.className = "dum-chip-price";
        chipPrice.textContent = "$" + pinnedOffer.price_usd.toFixed(2);
        productChip.appendChild(chipPrice);
      }

      var chipArrow = document.createElement("span");
      chipArrow.className = "dum-chip-arrow";
      chipArrow.setAttribute("aria-hidden", "true");
      chipArrow.textContent = "→";
      productChip.appendChild(chipArrow);

      productChip.addEventListener("click", function () {
        openOverlay();
      });
      document.body.appendChild(productChip);
    }

    // Click / Enter / Space on the bubble opens the overlay.
    bubble.addEventListener("click", function () {
      openOverlay();
    });
    bubble.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        if (e.preventDefault) e.preventDefault();
        openOverlay();
      }
    });

    // Dismiss × → fade out the bubble + commerce surface, mark
    // the session so they stay hidden until a new tab / session
    // opens. Stops propagation so the close click doesn't
    // double-fire the open-overlay handler above. Clears the
    // countdown ticker so we don't keep firing setInterval after
    // the panel is removed.
    function dismissBubble(e) {
      if (e) {
        e.stopPropagation();
        if (e.preventDefault) e.preventDefault();
      }
      bubble.classList.remove("is-visible");
      if (productChip) productChip.classList.remove("is-visible");
      if (productPanel) productPanel.classList.remove("is-visible");
      if (countdownTimer) {
        window.clearInterval(countdownTimer);
        countdownTimer = null;
      }
      safeSessionWrite(keys.sessionShown, "1");
      window.setTimeout(function () {
        if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
        if (productChip && productChip.parentNode) {
          productChip.parentNode.removeChild(productChip);
        }
        if (productPanel && productPanel.parentNode) {
          productPanel.parentNode.removeChild(productPanel);
        }
      }, 280);
    }
    close.addEventListener("click", dismissBubble);

    document.body.appendChild(bubble);

    // ── Drag-and-drop (Phase 2 from PR #167 audit) ──
    // Lets visitors move the bubble away from the bottom-right
    // corner if it covers something they want to see. Position
    // persists per-merchant in localStorage so a returning
    // visitor sees the bubble where they left it.
    //
    // Drag gate: 6px movement threshold before .is-dragging fires.
    // Below that, the pointerup fires the bubble's click handler
    // normally (opens the overlay) — without this, every click
    // would be treated as a drag and the overlay would never open.
    //
    // Touch-only viewports: touch-action: none on the bubble (CSS)
    // prevents iOS Safari from interpreting the drag as a page
    // scroll. The dismiss × and bubble preview iframe carry their
    // own pointer-events / stop-propagation so they don't get
    // hijacked into a drag.
    var posKey = "dum-embed-position:" + businessId;
    var dragState = {
      active: false,
      moved: false,
      startX: 0,
      startY: 0,
      origLeft: 0,
      origTop: 0,
    };

    function applyPosition(leftPx, topPx) {
      var w = bubble.offsetWidth || 140;
      var h = bubble.offsetHeight || 140;
      // Viewport clamp — ~4px gutter so the bubble never sits
      // fully against an edge.
      var maxLeft = Math.max(4, window.innerWidth - w - 4);
      var maxTop = Math.max(4, window.innerHeight - h - 4);
      var clampedLeft = Math.min(Math.max(4, leftPx), maxLeft);
      var clampedTop = Math.min(Math.max(4, topPx), maxTop);
      bubble.style.left = clampedLeft + "px";
      bubble.style.top = clampedTop + "px";
      bubble.style.right = "auto";
      bubble.style.bottom = "auto";
    }

    // Restore saved position. Bail (keep CSS default bottom-right)
    // when the saved position would land off-screen after a
    // resize — applyPosition's clamp handles that case too.
    try {
      var savedRaw = window.localStorage &&
        window.localStorage.getItem(posKey);
      if (savedRaw) {
        var saved = JSON.parse(savedRaw);
        if (saved && isFinite(saved.left) && isFinite(saved.top)) {
          applyPosition(saved.left, saved.top);
        }
      }
    } catch (e) {
      // ignore JSON / storage errors
    }

    function onPointerDown(e) {
      // Don't start a drag from the dismiss × or the live-video
      // iframe — those have their own click handlers.
      var target = e.target;
      if (
        target &&
        (target.closest("[data-dum-embed-bubble-close]") ||
          target.tagName === "IFRAME")
      ) {
        return;
      }
      var rect = bubble.getBoundingClientRect();
      dragState.active = true;
      dragState.moved = false;
      dragState.startX = e.clientX;
      dragState.startY = e.clientY;
      dragState.origLeft = rect.left;
      dragState.origTop = rect.top;
      // Capture so we keep receiving moves even if the pointer
      // leaves the bubble's bounding box.
      if (bubble.setPointerCapture && e.pointerId !== undefined) {
        try { bubble.setPointerCapture(e.pointerId); } catch (err) {}
      }
    }

    function onPointerMove(e) {
      if (!dragState.active) return;
      var dx = e.clientX - dragState.startX;
      var dy = e.clientY - dragState.startY;
      if (!dragState.moved) {
        // 6px threshold — small enough to feel responsive, big
        // enough that a normal tap doesn't trigger a drag.
        if (Math.sqrt(dx * dx + dy * dy) < 6) return;
        dragState.moved = true;
        bubble.classList.add("is-dragging");
      }
      if (e.preventDefault) e.preventDefault();
      applyPosition(dragState.origLeft + dx, dragState.origTop + dy);
    }

    function onPointerUp(e) {
      if (!dragState.active) return;
      var wasMoved = dragState.moved;
      dragState.active = false;
      dragState.moved = false;
      bubble.classList.remove("is-dragging");
      if (bubble.releasePointerCapture && e.pointerId !== undefined) {
        try { bubble.releasePointerCapture(e.pointerId); } catch (err) {}
      }
      if (wasMoved) {
        // Persist the resting position and suppress the click
        // that would otherwise fire from the same pointerup.
        var rect = bubble.getBoundingClientRect();
        try {
          if (window.localStorage) {
            window.localStorage.setItem(
              posKey,
              JSON.stringify({ left: rect.left, top: rect.top })
            );
          }
        } catch (err) {
          // quota / disabled storage — degrade silently
        }
        // Block the upcoming click event from opening the overlay.
        var blocker = function (ev) {
          ev.stopPropagation();
          ev.preventDefault();
          bubble.removeEventListener("click", blocker, true);
        };
        bubble.addEventListener("click", blocker, true);
      }
    }

    if (bubble.addEventListener) {
      bubble.addEventListener("pointerdown", onPointerDown);
      // pointermove/up listen on document so dragging out of the
      // bubble doesn't lose the cursor mid-drag.
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
      document.addEventListener("pointercancel", onPointerUp);
    }

    // Re-clamp on viewport resize / orientation change so a
    // saved position that's now off-screen comes back into view.
    function onResize() {
      var rect = bubble.getBoundingClientRect();
      // Only re-clamp if the bubble is in custom position (left/top
      // are set). The default bottom-right anchor handles itself.
      if (bubble.style.left && bubble.style.top) {
        applyPosition(rect.left, rect.top);
      }
    }
    if (window.addEventListener) {
      window.addEventListener("resize", onResize);
    }

    // ── Messages from the preview iframe ──
    // The /embed/bubble route postMessages two payloads:
    //
    //   1. bubble-live-state — authoritative is_live reading from
    //      the iframe's own embed-config fetch. Keeps the gold
    //      ring in sync if the merchant ends a stream mid-session.
    //   2. bubble-offers — active offer list fetched directly from
    //      /api/offers/{project_id} (same-origin from inside the
    //      iframe, no CORS gate). Recovery path for when the
    //      host-page embed-config response is missing active_offers
    //      (stale Railway deploy) or the merchant has no pinned
    //      offer to fall back on. Builds the product panel via
    //      buildProductPanel — idempotent, so it bails if a panel
    //      or chip was already mounted from the initial render.
    //
    // Origin guard mirrors the canonical embed origin so a hostile
    // parent frame can't fake either message.
    function onBubbleMessage(event) {
      if (event.origin !== origin) return;
      var data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "bubble-live-state") {
        if (data.live === true) bubble.classList.add("is-live");
        else bubble.classList.remove("is-live");
        return;
      }
      if (data.type === "bubble-offers") {
        // Only render the stack when we're live — the iframe is
        // already only mounted under is-live, but the host page
        // may have flipped to offline in between. Skip silently
        // if the bubble was already dismissed.
        if (!isLive) return;
        if (!bubble.parentNode) return;
        // Prefer the host-page's own liveSession (from its
        // embed-config fetch). Fall back to the iframe's reading
        // when the host page missed the field — this lets the
        // countdown banner fire as soon as backend support is
        // deployed, even if the host's first fetch was stale.
        var effectiveSession = liveSession;
        if (data.live_session) {
          // Always prefer the iframe's fresher viewer_count even
          // when the host-page side already had one — the iframe
          // reads /live-status directly which is the source of
          // truth for in-process presence.
          effectiveSession = data.live_session;
          liveSession = effectiveSession;
        }
        // Refresh the on-bubble viewer pill whenever a new
        // bubble-offers message arrives, regardless of whether
        // the panel actually renders.
        updateBubbleViewers(effectiveSession);
        buildProductPanel(data.active_offers, effectiveSession);
        return;
      }
    }
    if (window.addEventListener) {
      window.addEventListener("message", onBubbleMessage, false);
    }

    // Delay before reveal, clamped to mirror the server-side cap.
    var delayMs = Math.max(0, Number(cfg.delay_seconds) || 0) * 1000;
    var delayCap = 60000;
    if (delayMs > delayCap) delayMs = delayCap;

    function showBubble() {
      if (!bubble.parentNode) return;
      bubble.classList.add("is-visible");
      if (productChip) productChip.classList.add("is-visible");
      if (productPanel) productPanel.classList.add("is-visible");
      dumLog(isLive
        ? "Circular bubble shown (merchant is live)"
        : "Circular bubble shown");
      if (oncePerSession) safeSessionWrite(keys.sessionShown, "1");
      // Visited flag preserved so the inner-iframe PopInSeller can
      // still distinguish first-visit vs returning visitors once
      // the overlay opens.
      if (!safeLocalRead(keys.visited)) safeLocalWrite(keys.visited, "1");
    }

    if (delayMs > 0) {
      window.setTimeout(showBubble, delayMs);
    } else {
      showBubble();
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
