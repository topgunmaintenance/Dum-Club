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
    // Loom-style identity card. Replaces the old "Shop Live" pill
    // with a single cohesive bubble that carries merchant identity,
    // a LIVE/Deal badge, the greeting copy, and a tap-to-open CTA.
    // The whole card is the click target; clicking opens the
    // existing centered storefront overlay (unchanged below).
    //
    // Card never autoplays media, never covers the page above the
    // fold. Pulse animation is on the avatar ring only — subtle
    // enough not to read as spam, prominent enough to draw the eye.
    if (!document.getElementById("dum-embed-bubble-styles")) {
      var bs = document.createElement("style");
      bs.id = "dum-embed-bubble-styles";
      bs.textContent = [
        // Card container. Fixed bottom-right on desktop; the right
        // anchor + max-width keeps it inside the viewport on every
        // mobile width. Translates in from below on mount.
        "[data-dum-embed-card] {",
        "  position: fixed;",
        "  bottom: 20px;",
        "  right: 20px;",
        "  z-index: 2147483646;",
        "  display: flex;",
        "  align-items: stretch;",
        "  gap: 12px;",
        "  width: min(340px, calc(100vw - 32px));",
        "  padding: 14px 14px 14px 14px;",
        "  border: 0;",
        "  border-radius: 18px;",
        "  background: #ffffff;",
        "  color: #0b2545;",
        "  font: 500 14px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;",
        "  text-align: left;",
        "  cursor: pointer;",
        "  box-shadow: 0 18px 44px rgba(11,18,32,0.22), 0 0 0 1px rgba(11,18,32,0.06);",
        "  opacity: 0;",
        "  transform: translateY(12px);",
        "  transition: opacity 240ms ease, transform 240ms ease, box-shadow 200ms ease;",
        "}",
        "[data-dum-embed-card].is-visible {",
        "  opacity: 1;",
        "  transform: translateY(0);",
        "}",
        "[data-dum-embed-card]:hover {",
        "  box-shadow: 0 22px 52px rgba(11,18,32,0.28), 0 0 0 1px rgba(0,209,164,0.4);",
        "}",
        "[data-dum-embed-card]:focus-visible {",
        "  outline: 2px solid #00d1a4;",
        "  outline-offset: 3px;",
        "}",
        // Avatar — circular monogram with a slow brand-teal pulse
        // ring. The ring is the attention animation; the avatar
        // itself stays still so it doesn't read as anxious.
        "[data-dum-embed-card] .dum-avatar {",
        "  position: relative;",
        "  flex: 0 0 auto;",
        "  width: 44px; height: 44px;",
        "  border-radius: 50%;",
        "  background: linear-gradient(135deg, #00d1a4 0%, #00ffa3 100%);",
        "  color: #0b2545;",
        "  display: inline-flex;",
        "  align-items: center; justify-content: center;",
        "  font: 700 15px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;",
        "  letter-spacing: 0.02em;",
        "}",
        "[data-dum-embed-card] .dum-avatar::after {",
        "  content: '';",
        "  position: absolute; inset: -6px;",
        "  border-radius: 50%;",
        "  border: 2px solid rgba(0,209,164,0.5);",
        "  animation: dum-embed-ring 2.2s ease-out infinite;",
        "  pointer-events: none;",
        "}",
        // Body — name + greeting + CTA stacked.
        "[data-dum-embed-card] .dum-body {",
        "  flex: 1 1 auto;",
        "  min-width: 0;",
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: 4px;",
        "  padding-right: 20px;", // leave room for the close x
        "}",
        "[data-dum-embed-card] .dum-meta {",
        "  display: inline-flex;",
        "  align-items: center;",
        "  gap: 8px;",
        "  font-weight: 700;",
        "  font-size: 13px;",
        "  color: #0b2545;",
        "}",
        "[data-dum-embed-card] .dum-name {",
        "  max-width: 100%;",
        "  overflow: hidden;",
        "  text-overflow: ellipsis;",
        "  white-space: nowrap;",
        "}",
        // Live / Deal badge — semantic colour: red dot for IVS-
        // live merchants, teal dot for deal-only. Tiny, all-caps,
        // not distracting.
        "[data-dum-embed-card] .dum-badge {",
        "  display: inline-flex;",
        "  align-items: center;",
        "  gap: 5px;",
        "  padding: 2px 7px;",
        "  border-radius: 9999px;",
        "  font-size: 9px;",
        "  font-weight: 800;",
        "  letter-spacing: 0.08em;",
        "  text-transform: uppercase;",
        "  white-space: nowrap;",
        "}",
        "[data-dum-embed-card] .dum-badge.is-live {",
        "  background: rgba(239,68,68,0.12);",
        "  color: #b91c1c;",
        "}",
        "[data-dum-embed-card] .dum-badge.is-deal {",
        "  background: rgba(0,209,164,0.14);",
        "  color: #036f56;",
        "}",
        "[data-dum-embed-card] .dum-badge-dot {",
        "  width: 6px; height: 6px; border-radius: 50%;",
        "}",
        "[data-dum-embed-card] .dum-badge.is-live .dum-badge-dot {",
        "  background: #ef4444;",
        "  animation: dum-embed-blink 1.4s ease-in-out infinite;",
        "}",
        "[data-dum-embed-card] .dum-badge.is-deal .dum-badge-dot {",
        "  background: #00d1a4;",
        "}",
        "[data-dum-embed-card] .dum-greeting {",
        "  margin: 2px 0 4px 0;",
        "  font-size: 13px;",
        "  line-height: 1.4;",
        "  color: #213047;",
        "  display: -webkit-box;",
        "  -webkit-line-clamp: 3;",
        "  -webkit-box-orient: vertical;",
        "  overflow: hidden;",
        "}",
        "[data-dum-embed-card] .dum-cta {",
        "  display: inline-flex;",
        "  align-items: center;",
        "  gap: 4px;",
        "  font-size: 12px;",
        "  font-weight: 700;",
        "  color: #036f56;",
        "  letter-spacing: 0.02em;",
        "}",
        "[data-dum-embed-card] .dum-cta::after {",
        "  content: '→';",
        "  font-size: 14px;",
        "  line-height: 1;",
        "  transition: transform 160ms ease;",
        "}",
        "[data-dum-embed-card]:hover .dum-cta::after {",
        "  transform: translateX(3px);",
        "}",
        // Close × in the top-right of the card. Stops propagation
        // so it doesn't double-fire the open-overlay click.
        "[data-dum-embed-card-close] {",
        "  position: absolute; top: 8px; right: 8px;",
        "  width: 26px; height: 26px;",
        "  padding: 0;",
        "  margin: 0;",
        "  display: inline-flex; align-items: center; justify-content: center;",
        "  border: 0; border-radius: 9999px;",
        "  background: transparent; color: #5b6478;",
        "  font: 700 16px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;",
        "  cursor: pointer;",
        "  -webkit-appearance: none;",
        "  appearance: none;",
        "}",
        "[data-dum-embed-card-close]:hover { color: #0b2545; background: rgba(11,18,32,0.06); }",
        "[data-dum-embed-card-close]:focus-visible {",
        "  outline: 2px solid #00d1a4;",
        "  outline-offset: 2px;",
        "}",
        // After the card is dismissed, fall back to a tiny round
        // launcher so the merchant CTA is still reachable. Stays
        // out of the way until the visitor wants it back.
        "[data-dum-embed-launcher] {",
        "  position: fixed;",
        "  bottom: 20px;",
        "  right: 20px;",
        "  z-index: 2147483646;",
        "  display: none;", // hidden by default; revealed on dismiss
        "  align-items: center;",
        "  justify-content: center;",
        "  width: 56px; height: 56px;",
        "  border: 0;",
        "  border-radius: 50%;",
        "  background: linear-gradient(135deg, #00d1a4 0%, #00ffa3 100%);",
        "  color: #0b2545;",
        "  font: 700 22px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;",
        "  cursor: pointer;",
        "  box-shadow: 0 12px 28px rgba(11,18,32,0.2), 0 0 0 4px rgba(0,209,164,0.18);",
        "  transition: transform 160ms ease, box-shadow 160ms ease;",
        "}",
        "[data-dum-embed-launcher].is-visible { display: inline-flex; }",
        "[data-dum-embed-launcher]:hover { transform: translateY(-2px); }",
        "[data-dum-embed-launcher]:focus-visible {",
        "  outline: 2px solid #0b2545;",
        "  outline-offset: 3px;",
        "}",
        // Overlay + iframe — unchanged contract; clicking the card
        // (or the small launcher) opens the centered storefront.
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
        // Mobile tuning. Cap the card at 280px on small phones
        // (vs the calc(100vw - 24px) we used initially — that was
        // basically full width and crowded the bottom of merchant
        // pages). 280px leaves ~95px on the left visible for page
        // content on a 375px iPhone, still gives the body enough
        // room for a 2-line greeting + CTA.
        // Greeting clamps to 2 lines on mobile (vs 3 on desktop)
        // so the card stays compact in the vertical direction too.
        // Close x grows to 32px so the tap target is forgiving.
        "@media (max-width: 480px) {",
        "  [data-dum-embed-card] {",
        "    bottom: 12px;",
        "    right: 12px;",
        "    width: min(280px, calc(100vw - 24px));",
        "    padding: 12px;",
        "  }",
        "  [data-dum-embed-card] .dum-greeting {",
        "    -webkit-line-clamp: 2;",
        "    font-size: 12.5px;",
        "  }",
        "  [data-dum-embed-card-close] {",
        "    top: 6px; right: 6px;",
        "    width: 32px; height: 32px;",
        "  }",
        "  [data-dum-embed-launcher] {",
        "    bottom: 12px;",
        "    right: 12px;",
        "  }",
        "}",
        "@keyframes dum-embed-fade {",
        "  from { opacity: 0; } to { opacity: 1; }",
        "}",
        "@keyframes dum-embed-pulse {",
        "  0%, 100% { transform: scale(1);   opacity: 0.85; }",
        "  50%      { transform: scale(1.4); opacity: 1;    }",
        "}",
        "@keyframes dum-embed-ring {",
        "  0%   { transform: scale(1);    opacity: 0.55; }",
        "  80%  { transform: scale(1.25); opacity: 0;    }",
        "  100% { transform: scale(1.25); opacity: 0;    }",
        "}",
        "@keyframes dum-embed-blink {",
        "  0%, 100% { opacity: 1; }",
        "  50%      { opacity: 0.35; }",
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
    var initials = merchantTitle
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(function (w) { return w.charAt(0).toUpperCase(); })
      .join("") || "•";

    // First-visit vs returning-visitor greeting selection. Mirror
    // PR #161's contract: the localStorage `visited` flag is only
    // written after the card actually renders so a tab-closed-
    // during-delay user doesn't get bumped to "returning" state.
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

    // ── Build the storefront overlay (unchanged contract) ──
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
      overlayCard.appendChild(overlayIframe);
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

    // ── Build the fallback round launcher (hidden until card is
    //    dismissed; gives the visitor a way back in) ──
    var launcher = document.createElement("button");
    launcher.type = "button";
    launcher.setAttribute("data-dum-embed-launcher", businessId);
    launcher.setAttribute("aria-label", "Open DUM Club live storefront");
    launcher.textContent = "▸";
    launcher.addEventListener("click", openOverlay);
    document.body.appendChild(launcher);

    // ── Build the Loom-style identity card ──
    // Rendered as a div with role="button" rather than a literal
    // <button>: the close × must be a real interactive element
    // for keyboard / screen-reader users, and <button> inside
    // <button> is invalid HTML that confuses assistive tech. The
    // role + tabindex + keydown handler below give the outer card
    // identical keyboard behaviour without the nesting bug.
    //
    // Greeting text uses textContent (never innerHTML) — merchants
    // can put arbitrary strings in the dashboard and we treat them
    // as untrusted.
    var cardEl = null;
    function buildCard() {
      cardEl = document.createElement("div");
      cardEl.setAttribute("data-dum-embed-card", businessId);
      cardEl.setAttribute("role", "button");
      cardEl.setAttribute("tabindex", "0");
      cardEl.setAttribute(
        "aria-label",
        "Open " + merchantTitle + " live storefront"
      );

      var avatar = document.createElement("span");
      avatar.className = "dum-avatar";
      avatar.setAttribute("aria-hidden", "true");
      avatar.textContent = initials;

      var body = document.createElement("span");
      body.className = "dum-body";

      var meta = document.createElement("span");
      meta.className = "dum-meta";

      var name = document.createElement("span");
      name.className = "dum-name";
      name.textContent = merchantTitle;

      var badge = document.createElement("span");
      var isLive = cfg.is_live === true || popinConfig && popinConfig.is_live === true;
      badge.className = "dum-badge " + (isLive ? "is-live" : "is-deal");
      var badgeDot = document.createElement("span");
      badgeDot.className = "dum-badge-dot";
      var badgeLabel = document.createElement("span");
      badgeLabel.textContent = isLive ? "Live now" : "Deal";
      badge.appendChild(badgeDot);
      badge.appendChild(badgeLabel);

      meta.appendChild(name);
      meta.appendChild(badge);

      var greetingEl = document.createElement("span");
      greetingEl.className = "dum-greeting";
      greetingEl.textContent =
        greetingText ||
        (isLive
          ? "Live now. Tap to join."
          : "Check today's live deal.");

      var cta = document.createElement("span");
      cta.className = "dum-cta";
      cta.textContent = isLive ? "Tap to shop live" : "View today's deal";

      body.appendChild(meta);
      body.appendChild(greetingEl);
      body.appendChild(cta);

      var close = document.createElement("button");
      close.type = "button";
      close.setAttribute("data-dum-embed-card-close", "");
      close.setAttribute("aria-label", "Dismiss");
      close.textContent = "×";

      // Card click / Enter / Space → open overlay. Close × stops
      // propagation so dismiss doesn't double as open.
      cardEl.addEventListener("click", function () {
        openOverlay();
      });
      cardEl.addEventListener("keydown", function (e) {
        // Don't hijack arrow keys, Tab, Esc — only the
        // button-activation keys.
        if (e.key === "Enter" || e.key === " ") {
          if (e.preventDefault) e.preventDefault();
          openOverlay();
        }
      });
      function dismissCard(e) {
        if (e) {
          e.stopPropagation();
          if (e.preventDefault) e.preventDefault();
        }
        if (!cardEl) return;
        cardEl.classList.remove("is-visible");
        // Reveal the small round launcher so the visitor still has
        // a path back into the storefront after dismissal.
        launcher.classList.add("is-visible");
        // Remove the card from the layout tree after the fade out
        // finishes so it doesn't keep grabbing focus.
        window.setTimeout(function () {
          if (cardEl && cardEl.parentNode) {
            cardEl.parentNode.removeChild(cardEl);
            cardEl = null;
          }
        }, 280);
      }
      close.addEventListener("click", dismissCard);

      cardEl.appendChild(avatar);
      cardEl.appendChild(body);
      cardEl.appendChild(close);
      document.body.appendChild(cardEl);
    }

    // ── Mount logic ──
    // Always build the card so the merchant identity is visible.
    // The greeting copy is selected above; if neither greeting is
    // configured we still surface the merchant name + a sensible
    // default greeting + CTA so the card never reads blank.
    //
    // showOncePerSession means "once we've shown this card with a
    // configured greeting this session, don't show it again" — in
    // that case we skip straight to the dismissed-state launcher.
    if (!popinEnabled) {
      // Merchant explicitly disabled pop-in. Show only the launcher
      // so the storefront remains reachable.
      launcher.classList.add("is-visible");
      return;
    }
    if (alreadyShownThisSession) {
      launcher.classList.add("is-visible");
      return;
    }

    buildCard();

    var delayMs = Math.max(0, Number(cfg.delay_seconds) || 0) * 1000;
    var delayCap = 60000; // mirror server clamp
    if (delayMs > delayCap) delayMs = delayCap;

    function showCard() {
      if (!cardEl) return;
      cardEl.classList.add("is-visible");
      if (greetingText) {
        if (isReturning) {
          dumLog("Returning-visitor greeting shown");
        } else {
          dumLog("First-visit greeting shown");
        }
      } else {
        dumLog("Identity card shown (no greeting configured)");
      }
      // Once-per-session bookkeeping: tag the session so a SPA
      // reload within the tab doesn't re-show the card.
      if (oncePerSession) safeSessionWrite(keys.sessionShown, "1");
      // Mark the visitor as known ONLY after the card actually
      // renders. Preserves the PR #161 contract — tab-closed-
      // during-delay users don't get bumped to returning state.
      if (!hasVisited && greetingText) safeLocalWrite(keys.visited, "1");
    }

    if (delayMs > 0) {
      window.setTimeout(showCard, delayMs);
    } else {
      showCard();
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
