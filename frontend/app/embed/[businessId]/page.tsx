"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trackEvent } from "../../../lib/analytics";
import { PopInSellerHost } from "../../../components/PopInSellerHost";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { useWallet } from "@solana/wallet-adapter-react";
import { API_BASE } from "../../../lib/apiBase";
import { useAuth } from "../../../lib/auth/AuthContext";
import { isIVSSession } from "../../../lib/liveProvider";
import { LiveChatIVS } from "../../../components/LiveChatIVS";
import { JsonLd } from "../../../components/JsonLd";
import { buildProductSchema } from "../../../lib/schemaOrg";
import {
  SOL_CHECKOUT_ENABLED,
  SolCheckoutError,
  payOfferWithSol,
  pickSolPayWallet,
  type PayOfferStep,
} from "../../../lib/solanaCheckout";

// IVSStageViewer pulls in amazon-ivs-web-broadcast which is browser-only.
// Mirror the dynamic-import pattern used by /project/[id] to keep SSR clean.
const IVSStageViewer = dynamic(
  () =>
    import("../../../components/IVSStageViewer").then((m) => ({
      default: m.IVSStageViewer,
    })),
  { ssr: false }
);

type EmbedProject = {
  id?: string;
  slug?: string | null;
  name?: string | null;
  title?: string | null;
  is_live?: boolean | null;
  live_provider?: string | null;
  ivs_stage_arn?: string | null;
  pinned_offer_id?: string | null;
  // DUM Pop-In Seller merchant settings — JSONB on projects.popin_config
  // (migration 038). Empty / missing → client-side defaults.
  popin_config?: {
    enabled?: boolean;
    greeting?: string;
    returning_greeting?: string;
    delay_seconds?: number;
    once_per_session?: boolean;
    offer_id?: string | null;
    mode?: "bubble" | "recorded" | "live" | "auto";
    video_url?: string | null;
  } | null;
  // Owner identity — used by the embed to render an
  // owner-only "Manage offers" deep-link (Option A).
  // Returned by /api/projects/<id> already; just surfacing
  // it through the type so TS lets us read it.
  privy_id?: string | null;
};

type Offer = {
  id: string;
  title?: string | null;
  description?: string | null;
  price_usd?: number | null;
  quantity_available?: number | null;
  quantity_sold?: number | null;
  unlimited_inventory?: boolean | null;
};

type DebugEvent = {
  id: string;
  text: string;
};

/**
 * /embed/[businessId] — embed shell with live video, websocket wiring,
 * pinned offer card, Pay-with-Card checkout, redirect-back handling,
 * Pay-with-SOL secondary CTA, live reaction layer, and a mobile
 * sticky buy bar.
 *
 * Step 9 of the DUM Live Embed build. On phones, swaps the inline
 * pinned-offer card for a fixed bottom CTA bar so the buy action
 * stays in thumb reach while the viewer scrolls through video and
 * chat. Includes safe-area-inset-bottom padding for notched
 * devices, and adds matching bottom padding to the chat column so
 * the chat input never sits behind the bar.
 *
 * No DUM Club chrome (gated by SiteChrome from Step 1).
 */
export default function EmbedShellPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = params?.businessId;

  const { user: authUser, login, getToken } = useAuth();

  // Anonymous viewer identity. When the visitor isn't signed in to
  // Privy we still want the chat input to work so they can ask the
  // host a question before buying — the checkout flow stays
  // authenticated, but reading + reacting + asking shouldn't be
  // gated behind an email handover.
  //
  // The anon id is scoped to sessionStorage so it sticks across SPA
  // navigations and reloads within the tab, but doesn't persist to
  // future sessions (avoids a fingerprint-grade identifier). Each
  // merchant slug gets its own anon id so two embeds on the same
  // page don't share state.
  //
  // The display name is "Guest #XXXX" using the last 4 chars of the
  // random id (uppercased) so the host can distinguish multiple
  // simultaneous guests at a glance.
  const [anonId, setAnonId] = useState<string>("");
  useEffect(() => {
    if (authUser?.privyId) return;
    if (typeof window === "undefined") return;
    try {
      const key = `dum-anon:${businessId}`;
      let id = window.sessionStorage.getItem(key);
      if (!id) {
        id = `anon-${Math.random().toString(36).slice(2, 10)}`;
        window.sessionStorage.setItem(key, id);
      }
      setAnonId(id);
    } catch {
      // Private browsing or storage disabled — fall through with an
      // ephemeral, in-memory id. Lives for the page's lifetime.
      setAnonId(`anon-${Math.random().toString(36).slice(2, 10)}`);
    }
  }, [authUser?.privyId, businessId]);

  const viewerUserId = authUser?.privyId || anonId;
  const viewerName = authUser?.email
    || (anonId ? `Guest #${anonId.slice(-4).toUpperCase()}` : "Viewer");

  // SOL wallet sources — Privy embedded wallet first, then any
  // external wallet adapter (Phantom / Solflare). pickSolPayWallet
  // collapses both into the same shape, so the rest of the SOL
  // flow doesn't have to care which one signed.
  const { wallets: solanaWallets } = useSolanaWallets();
  const adapterWallet = useWallet();

  const [project, setProject] = useState<EmbedProject | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Checkout state — only one pinned offer is buyable from this card,
  // so a single in-flight flag + a single error string is enough.
  const [buying, setBuying] = useState<boolean>(false);
  const [buyError, setBuyError] = useState<string | null>(null);

  // SOL secondary-CTA state. Tracked separately from the Stripe
  // path so each rail's error stays attached to its own button.
  const [solBuying, setSolBuying] = useState<boolean>(false);
  const [solStep, setSolStep] = useState<PayOfferStep | null>(null);
  const [solError, setSolError] = useState<string | null>(null);

  // Reaction layer (Step 8) — purchase toasts, floating emojis, and
  // a one-shot sold-out flash. All driven by the existing item_sold /
  // item_updated WS callbacks below.
  const [saleToasts, setSaleToasts] = useState<
    Array<{ id: string; title: string }>
  >([]);
  const [emojiBursts, setEmojiBursts] = useState<
    Array<{ id: string; emoji: string; left: number; delay: number }>
  >([]);
  const [soldFlash, setSoldFlash] = useState<boolean>(false);

  // Mirror `offers` into a ref so WS callbacks can resolve fresh
  // titles without being trapped in a render-stale closure. The
  // callbacks live inside JSX-rendered LiveChatIVS props, which
  // capture state at render time; without this ref a toast for a
  // just-pinned offer could miss the title on the first event.
  const offersRef = useRef<Offer[]>([]);
  useEffect(() => {
    offersRef.current = offers;
  }, [offers]);

  // Stripe redirect-back result. Set once on mount when the URL
  // carries ?checkout=success or ?checkout=cancelled, then dismissable.
  const [checkoutResult, setCheckoutResult] = useState<
    "success" | "cancelled" | null
  >(null);

  // Event-wire diagnostics. Surfaced as visible debug text so we can
  // confirm the websocket pipeline is alive end-to-end before any
  // real checkout UI is wired up in later steps.
  const [inventoryEventCount, setInventoryEventCount] = useState<number>(0);
  const [soldEventCount, setSoldEventCount] = useState<number>(0);
  const [lastEvents, setLastEvents] = useState<DebugEvent[]>([]);

  function pushEvent(text: string) {
    const ev: DebugEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text,
    };
    setLastEvents((prev) => [...prev.slice(-4), ev]);
  }

  // ── Reaction-layer helpers (Step 8) ─────────────────────────────
  // Each helper schedules its own teardown via setTimeout. There is
  // no global cleanup on unmount because every overlay is purely
  // visual — if the iframe is torn down mid-burst the timers fire
  // into a dead component and React swallows the no-op.

  function spawnSaleToast(title: string) {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setSaleToasts((prev) => [...prev.slice(-2), { id, title }]);
    setTimeout(() => {
      setSaleToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }

  function spawnEmojiBurst() {
    const palette = ["🎉", "💸", "✨", "🔥", "💚", "🛒"];
    const batch = Array.from({ length: 9 }, (_, i) => ({
      id: `e-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
      emoji: palette[Math.floor(Math.random() * palette.length)],
      left: 10 + Math.random() * 80,
      delay: Math.random() * 300,
    }));
    setEmojiBursts((prev) => [...prev, ...batch]);
    setTimeout(() => {
      const ids = new Set(batch.map((b) => b.id));
      setEmojiBursts((prev) => prev.filter((b) => !ids.has(b.id)));
    }, 2400);
  }

  function flashSoldOut() {
    setSoldFlash(true);
    setTimeout(() => setSoldFlash(false), 1100);
  }

  // Mounted guard — load() is callable from both initial-mount and
  // post-checkout-success paths, so the inline `cancelled` flag from
  // the previous step's useEffect-scoped load() is replaced with a
  // ref that survives across calls.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!businessId) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/projects/${businessId}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Failed to load project (${res.status})`);

      const data = await res.json();
      const p: EmbedProject = data?.project || data;
      if (!mountedRef.current) return;
      setProject(p);

      // Drive Your Market Analytics — embed mount tracker
      if (p?.id) {
        trackEvent("embed_view", { project_id: p.id });
      }

      if (p?.id) {
        try {
          const offersRes = await fetch(`${API_BASE}/api/offers/${p.id}`, {
            cache: "no-store",
          });
          if (offersRes.ok) {
            const list: Offer[] = await offersRes.json();
            if (mountedRef.current) {
              setOffers(Array.isArray(list) ? list : []);
            }
          } else if (mountedRef.current) {
            setOffers([]);
          }
        } catch {
          if (mountedRef.current) setOffers([]);
        }
      }
    } catch (err: any) {
      if (mountedRef.current) setError(err?.message || "Failed to load");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  // Stripe redirect-back detection. Runs once on mount: reads the
  // query string, captures success/cancelled state, then strips the
  // query string so a manual refresh doesn't re-show the message
  // and so the URL is clean if/when the user copies it. On success
  // we also re-fetch project + offers — the order webhook may have
  // updated quantity_sold while the user was on Stripe, and we want
  // the pinned card to reflect that immediately.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("checkout");
    if (flag !== "success" && flag !== "cancelled") return;

    setCheckoutResult(flag);

    // Strip ?checkout=... from the URL. history.replaceState mutates
    // only this document's URL — safe inside an iframe (it does not
    // touch the parent window).
    try {
      window.history.replaceState({}, "", window.location.pathname);
    } catch {
      // History API blocked (rare; e.g. some sandboxed iframes) —
      // leave the URL as-is. The visible message still shows.
    }

    if (flag === "success") {
      load();
    }
    // load is stable per businessId; intentionally run-once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Autobuy resume after iframe-redirect sign-in ──────────────
  // When a buyer clicks Buy inside the merchant's iframe and they
  // are not signed in, openTopLevelSignIn() opens a fresh top-
  // level tab on dum.club at the same embed URL with an
  // `?autobuy=<offerId>` query param.
  //
  // Two sign-in paths can return to this tab:
  //   - Email OTP: stays on dum.club the whole time. URL is
  //     preserved, autobuy param survives.
  //   - Google OAuth: tab navigates away to Google +
  //     auth.privy.io, then Privy redirects back. Privy's
  //     redirect target is its registered `redirect_uri` followed
  //     by a client-side history push — depending on Privy's
  //     internal state encoding, query params on the original URL
  //     may or may not survive intact.
  //
  // To guarantee resume, we mirror the param into sessionStorage
  // on the first mount that sees it. The resume effect (declared
  // further down so it can reference `pinnedOffer`) reads from
  // EITHER the URL or sessionStorage; whichever still has it wins.
  // sessionStorage is keyed on the embed origin (dum.club), so it
  // survives the OAuth roundtrip cleanly and dies when the tab
  // closes — no cross-session leakage.
  const AUTOBUY_STORAGE_KEY = "dum_embed_autobuy";

  // Persist a buy intent into sessionStorage so the resume effect
  // below can pick it up after auth completes. Two call sites:
  //   1. Mount mirror of ?autobuy=<id> URL params (top-level new-
  //      tab landing back from openTopLevelSignIn — iframe path).
  //   2. Inline anon Buy / Pay-with-SOL click (Piece 2 of the chat
  //      flow design): the user is on /embed/[slug] directly, taps
  //      Buy, we stash the intent + call Privy login(). The same
  //      resume effect that handles the iframe round-trip resumes
  //      checkout here once authUser flips truthy.
  // The shape stays the same across both paths: { id, pay, t }.
  // Scoped per (project, offer) at the resume site below — if the
  // merchant pins a different offer between sign-in steps we
  // intentionally leave the buyer on the storefront instead of
  // surprise-charging for the wrong thing.
  function writeAutobuyIntent(offerId: string, pay: "card" | "sol") {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(
        AUTOBUY_STORAGE_KEY,
        JSON.stringify({
          id: offerId,
          pay: pay === "sol" ? "sol" : "",
          t: Date.now(),
        }),
      );
    } catch {
      // Storage blocked (private browsing / sandboxed iframe without
      // allow-same-origin). Auto-resume can't fire; the user will
      // need to tap Buy a second time after sign-in. Silent
      // fallthrough is correct.
    }
  }

  // Mirror the autobuy intent into sessionStorage on first mount.
  // Does not reference pinnedOffer, so it stays here at the top
  // of the component near the rest of the mount-only effects.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const params = new URLSearchParams(window.location.search);
      const id = params.get("autobuy");
      if (id) {
        const pay = params.get("pay") || "";
        window.sessionStorage.setItem(
          AUTOBUY_STORAGE_KEY,
          JSON.stringify({ id, pay, t: Date.now() }),
        );
      }
    } catch {
      /* storage blocked (sandboxed iframe / Safari private) — fall
         back to URL params, which are still present in most cases */
    }
  }, []);

  // ── Iframe auto-resize protocol ───────────────────────────────
  // When the embed page is rendered inside the merchant's iframe
  // (i.e. window !== window.parent), post our actual content height
  // up to embed.js so the iframe wrapper can grow with the content
  // instead of being clamped to a fixed minHeight. Receiver-side
  // verifies origin before applying. Targeted via "*" because we
  // don't know the merchant's hosting origin in advance — that's
  // the entire point of an embed. If we're not iframed (someone
  // navigated to /embed/<slug> directly), this is a no-op.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.parent === window) return;

    const post = () => {
      const h = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
      );
      try {
        window.parent.postMessage({ type: "embed-resize", height: h }, "*");
      } catch {
        // Cross-origin postMessage with "*" should never throw, but
        // wrap defensively — a broken parent shouldn't break the
        // embed.
      }
    };

    post();

    let raf: number | null = null;
    const schedule = () => {
      if (raf != null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        post();
      });
    };

    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    if (ro) {
      ro.observe(document.documentElement);
      ro.observe(document.body);
    }
    window.addEventListener("resize", schedule);

    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", schedule);
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, []);

  const displayName = project?.name || project?.title || "?";
  const displaySlug = project?.slug || businessId || "?";

  // Option A — owner identity check so the embed can render a
  // discreet "Manage offers" deep-link only to the merchant viewing
  // their own embed. Backend's /api/projects/<id> already returns
  // privy_id (see projects.py:241-242). The check matches the
  // canonical projects.py:322 ownership rule on the privy_id branch
  // — we don't have owner_id resolution in the iframe context, but
  // every founding-merchant project has privy_id populated, so the
  // privy-only check covers the demo and onboarding flows. Owner
  // controls inside the embed (Option B) come later.
  const isOwner =
    !!authUser?.privyId &&
    !!project?.privy_id &&
    project.privy_id === authUser.privyId;
  const manageHref = `/project/${project?.slug || businessId}/manage`;
  const liveLabel = project?.is_live ? "live" : "offline";
  const ivsActive = !!project && isIVSSession(project) && !!project.ivs_stage_arn;
  // True when the hero <IVSStageViewer> is actually mounted and
  // subscribing. The Pop-In Live mode reuses this section exactly —
  // no second viewer is created, the LIVE NOW affordance scrolls
  // the visitor here.
  const isLivePresent = !!project?.is_live && ivsActive;
  const liveSectionRef = useRef<HTMLElement | null>(null);
  const handlePopInLiveClick = useCallback(() => {
    const el = liveSectionRef.current;
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
      el.scrollIntoView();
    }
  }, []);

  // Pinned offer derivation — single source of truth for the card.
  const pinnedOffer = useMemo<Offer | null>(() => {
    if (!project?.pinned_offer_id) return null;
    return offers.find((o) => o.id === project.pinned_offer_id) || null;
  }, [offers, project?.pinned_offer_id]);

  // Autobuy resume — declared HERE so it can safely reference
  // pinnedOffer (defined above). Earlier placement near the
  // sessionStorage mirror effect ran into the TS Temporal-Dead-
  // Zone rule ("Block-scoped variable 'pinnedOffer' used before
  // its declaration") on Vercel's strict typecheck even though
  // local next-build skipped it. Keep this block AFTER pinnedOffer.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!authUser) return; // wait until Privy returns a user
    if (!pinnedOffer) return; // wait until offers load

    // Prefer URL params; fall back to sessionStorage so the resume
    // survives a Google OAuth roundtrip even if Privy strips the
    // query string on the way back.
    const params = new URLSearchParams(window.location.search);
    let autobuyId = params.get("autobuy");
    let pay = params.get("pay") || "";
    if (!autobuyId) {
      try {
        const raw = window.sessionStorage.getItem(AUTOBUY_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { id?: string; pay?: string; t?: number };
          // 15-minute TTL. If the buyer wandered off and came back
          // an hour later, don't surprise them with a checkout.
          if (parsed?.id && (!parsed.t || Date.now() - parsed.t < 15 * 60_000)) {
            autobuyId = parsed.id;
            pay = parsed.pay || pay;
          }
        }
      } catch {
        /* storage blocked — give up on autobuy resume */
      }
    }
    if (!autobuyId) return;

    // Only auto-resume when the pinned offer matches the one the
    // buyer clicked in the iframe. If the merchant pinned a
    // different offer between sign-in steps, leave the buyer on
    // the storefront — they can re-click and we won't surprise-
    // charge them for the wrong thing.
    function clearAutobuy() {
      try {
        window.sessionStorage.removeItem(AUTOBUY_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      try {
        window.history.replaceState({}, "", window.location.pathname);
      } catch {
        /* sandboxed iframe — leave URL */
      }
    }
    if (pinnedOffer.id !== autobuyId) {
      clearAutobuy();
      return;
    }
    // Strip the autobuy + pay params before firing so a refresh
    // mid-checkout doesn't re-trigger a second payment intent.
    clearAutobuy();
    // Defer one tick so any pending state writes from the load
    // path settle before we open the Stripe (or SOL) flow.
    const t = window.setTimeout(() => {
      if (pay === "sol") {
        handlePayWithSol();
      } else {
        handleBuy();
      }
    }, 50);
    return () => window.clearTimeout(t);
    // We intentionally do NOT include handleBuy/handlePayWithSol
    // in deps — they are defined further down the component and
    // get fresh closures every render. The effect re-runs on
    // authUser + pinnedOffer changes which is the right trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.privyId, pinnedOffer?.id]);

  // Drive Your Market Analytics — pinned-offer impression. Fires once
  // per (project, offer) pair as soon as the pinned offer resolves.
  // The pinned card is the one always-visible offer in the embed; if
  // it changes (merchant pins a different offer), we want a fresh row.
  useEffect(() => {
    if (project?.id && pinnedOffer?.id) {
      trackEvent("offer_view", {
        project_id: project.id,
        offer_id: pinnedOffer.id,
      });
    }
  }, [project?.id, pinnedOffer?.id]);

  // Sold-out logic mirrored from /project/[id]: only meaningful when
  // inventory is finite. Unlimited offers are never sold out.
  const soldOut = useMemo(() => {
    if (!pinnedOffer) return false;
    if (pinnedOffer.unlimited_inventory) return false;
    const total = Number(pinnedOffer.quantity_available || 0);
    const sold = Number(pinnedOffer.quantity_sold || 0);
    return total > 0 && total - sold <= 0;
  }, [pinnedOffer]);

  const remaining = useMemo(() => {
    if (!pinnedOffer || pinnedOffer.unlimited_inventory) return null;
    const total = Number(pinnedOffer.quantity_available || 0);
    const sold = Number(pinnedOffer.quantity_sold || 0);
    return Math.max(0, total - sold);
  }, [pinnedOffer]);

  // Detect iframe context. Cross-origin parent access throws a
  // SecurityError; treat that as iframed too — only a top-level
  // window with same-origin self can read window.top safely.
  function isInIframe(): boolean {
    if (typeof window === "undefined") return false;
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  }

  // When the embed renders inside a 3rd-party iframe (e.g.
  // topgunmaintenance.com), Privy can't reliably show its login UI
  // because:
  //   1. Privy needs to mount its own iframe (embedded wallets,
  //      auth modal). Browsers refuse double-nested iframes in
  //      certain partitioned-storage configurations.
  //   2. Even when the UI works, third-party-cookie partitioning
  //      (Safari ITP, Chrome storage partitioning) sandboxes the
  //      Privy session away from dum.club's regular cookie jar,
  //      so the buyer ends up signed in inside the partition but
  //      signed out everywhere else.
  //   3. Privy can fall back to a top-frame redirect to
  //      auth.privy.io which strands the buyer on a raw auth URL.
  //
  // Solution: open the same embed URL in a new TOP-LEVEL tab on
  // dum.club. The new tab is not iframed, Privy works as designed,
  // cookies are first-party. We carry an `autobuy` query param so
  // the new tab can resume the buy click after sign-in completes.
  function openTopLevelSignIn(opts: {
    autobuyOfferId?: string;
    payment?: "sol";
  } = {}): boolean {
    if (typeof window === "undefined") return false;
    try {
      const url = new URL(window.location.pathname, window.location.origin);
      if (opts.autobuyOfferId) url.searchParams.set("autobuy", opts.autobuyOfferId);
      if (opts.payment) url.searchParams.set("pay", opts.payment);
      const win = window.open(url.toString(), "_blank", "noopener,noreferrer");
      return Boolean(win);
    } catch {
      return false;
    }
  }

  async function handleBuy() {
    if (!pinnedOffer) return;
    if (soldOut) return;

    // Drive Your Market Analytics — checkout intent. Fires before
    // any auth / Stripe call so we capture funnel drop-off even if
    // the user bails at the auth modal.
    trackEvent("checkout_start", {
      project_id: project?.id ?? null,
      offer_id: pinnedOffer.id,
    });

    setBuyError(null);

    // Auth gate.
    //
    // Top-level (no iframe): show Privy's modal in place — the
    // existing flow.
    //
    // Iframed (e.g. embedded on topgunmaintenance.com): redirect
    // sign-in to a new top-level tab on dum.club with an
    // `?autobuy=<offerId>` query so the same buy click resumes
    // after sign-in. See openTopLevelSignIn() above for why.
    // Guest checkout path. The backend now treats POST
    // /api/checkout/create-payment-intent as auth-optional and
    // mints a synthetic guest:<token> buyer id when no
    // Authorization header is sent. Stripe Checkout captures the
    // visitor's email + payment on its own page, so we don't
    // need a Privy account to complete the sale.
    //
    // For signed-in visitors we still pass the Bearer token so
    // their orders, DUM Points balance, and saved email stay
    // attached to their identity.
    setBuying(true);

    try {
      let token: string | null = null;
      if (authUser) {
        token = await getToken();
        if (!token) {
          // Signed in but token fetch failed — fall back to
          // guest checkout rather than blocking the sale.
          token = null;
        }
      }

      // Strip any existing query params, then append the explicit
      // ?checkout=success / ?checkout=cancelled flags so the embed
      // can detect the Stripe redirect-back on mount and show the
      // appropriate message. Same clean-URL base /project/[id] uses
      // to avoid malformed URLs on repeat purchases.
      const baseUrl =
        typeof window !== "undefined"
          ? window.location.origin + window.location.pathname
          : "";

      const payload = {
        offer_id: pinnedOffer.id,
        success_url: `${baseUrl}?checkout=success`,
        cancel_url: `${baseUrl}?checkout=cancelled`,
        use_dum_discount: false,
        source: project?.is_live ? "live" : "normal",
      };

      const res = await fetch(`${API_BASE}/api/checkout/create-payment-intent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const msg =
          typeof errData.detail === "string"
            ? errData.detail
            : `Checkout failed (HTTP ${res.status})`;
        setBuyError(msg);
        setBuying(false);
        return;
      }

      const data = await res.json();
      if (!data?.checkout_url) {
        setBuyError("No checkout_url in response");
        setBuying(false);
        return;
      }

      // In-iframe: open Stripe Checkout in a new tab so we don't
      // leave the merchant's host page. Top-level: redirect in place
      // (same as /project/[id]).
      if (isInIframe()) {
        const win = window.open(data.checkout_url, "_blank", "noopener,noreferrer");
        if (!win) {
          // Popup blocked — surface a message and leave the user on
          // the embed so they can retry with a click that the
          // browser will accept as an explicit gesture.
          setBuyError("Pop-up blocked. Allow pop-ups for this site and try again.");
        }
        setBuying(false);
      } else {
        window.location.href = data.checkout_url;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setBuyError(msg);
      setBuying(false);
    }
  }

  // Pay with SOL — secondary CTA. Stays off unless
  // NEXT_PUBLIC_ENABLE_SOL_CHECKOUT=true. Unlike the Stripe path
  // there is no redirect: the wallet signs in-page, the backend
  // re-verifies on-chain, and a paid order is created inline.
  // On success we surface the same checkoutResult banner Step 6
  // built for Stripe, then refresh project + offers so the pinned
  // card's inventory reflects the just-recorded sale.
  async function handlePayWithSol() {
    if (!pinnedOffer) return;
    if (soldOut) return;

    setSolError(null);

    if (!authUser) {
      if (isInIframe()) {
        const ok = openTopLevelSignIn({
          autobuyOfferId: pinnedOffer.id,
          payment: "sol",
        });
        if (!ok) {
          setSolError(
            "Sign in opens in a new tab on dum.club. Allow pop-ups for this site and try again.",
          );
        }
        return;
      }
      // Inline anon path — see writeAutobuyIntent for the
      // resume-after-login contract. "sol" tells the resume
      // effect to dispatch handlePayWithSol instead of handleBuy.
      writeAutobuyIntent(pinnedOffer.id, "sol");
      try {
        login();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Sign-in failed";
        setSolError(msg);
      }
      return;
    }

    const wallet = pickSolPayWallet(solanaWallets, adapterWallet);
    if (!wallet) {
      setSolError(
        "No Solana wallet available. Connect Phantom or refresh to set up your wallet."
      );
      return;
    }

    setSolBuying(true);
    setSolStep("quoting");

    try {
      const token = await getToken();
      if (!token) {
        setSolError("Authentication failed. Please sign in again.");
        setSolBuying(false);
        setSolStep(null);
        return;
      }

      const rpcUrl =
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
        process.env.NEXT_PUBLIC_SOLANA_RPC ||
        "https://api.devnet.solana.com";

      const source = project?.is_live ? "live_sol" : "sol";

      await payOfferWithSol({
        offerId: pinnedOffer.id,
        source,
        wallet,
        authToken: token,
        rpcUrl,
        onStep: (s) => setSolStep(s),
      });

      // Same post-payment surface Step 6 wired up for the Stripe
      // redirect-back, invoked inline because SOL never leaves
      // the page. Re-fetch so the pinned card's "X left" / sold-
      // out state reflects the just-recorded sale.
      setCheckoutResult("success");
      load();
    } catch (err) {
      const msg =
        err instanceof SolCheckoutError
          ? err.message
          : err instanceof Error
            ? err.message
            : "SOL payment failed";
      setSolError(msg);
    } finally {
      setSolBuying(false);
      setSolStep(null);
    }
  }

  return (
    <main className="min-h-[100dvh] bg-surface-page text-primary px-4 py-4 sm:px-6 sm:py-8">
      {/* Schema.org JSON-LD for the pinned offer. The embed page often
          loads inside a merchant's own iframe, where their site provides
          the LocalBusiness markup; we contribute Product-level data so
          AI crawlers can read what's currently for sale. Emits nothing
          when no offer is pinned. */}
      {project && pinnedOffer && (
        <JsonLd data={buildProductSchema(project, pinnedOffer)} />
      )}

      {/* Reaction-layer keyframes (Step 8). Inlined here so we don't
          have to touch globals.css from an embed-scoped feature. */}
      <style>{`
        @keyframes embed-emoji-float {
          0%   { transform: translateY(0)   scale(0.8); opacity: 0; }
          15%  { transform: translateY(-20px) scale(1);   opacity: 1; }
          100% { transform: translateY(-220px) scale(1.1); opacity: 0; }
        }
        @keyframes embed-sold-flash {
          0%, 100% { background-color: rgba(239, 68, 68, 0); }
          30%      { background-color: rgba(239, 68, 68, 0.18); }
        }
        @keyframes embed-toast-in {
          0%   { transform: translateY(-12px); opacity: 0; }
          100% { transform: translateY(0);     opacity: 1; }
        }
        .embed-emoji-float {
          animation: embed-emoji-float 2.2s ease-out forwards;
        }
        .embed-sold-flash {
          animation: embed-sold-flash 1s ease-in-out;
        }
        .embed-toast-in {
          animation: embed-toast-in 220ms ease-out;
        }
      `}</style>

      {/* Sale-toast stack. Pointer-events-none so a toast hovering
          over the CTA can't intercept a tap. Top-center on small
          screens, top-right on desktop — far from the bottom sticky
          buy bar Step 9 will add. */}
      {saleToasts.length > 0 && (
        <div
          aria-live="polite"
          className="pointer-events-none fixed left-1/2 top-3 z-50 flex w-[calc(100%-1.5rem)] -translate-x-1/2 flex-col items-center gap-2 sm:left-auto sm:right-4 sm:w-auto sm:translate-x-0 sm:items-end"
        >
          {saleToasts.map((t) => (
            <div
              key={t.id}
              className="embed-toast-in flex items-center gap-2 rounded-xl border border-brand-teal bg-surface-card px-3 py-2 text-xs font-bold text-brand-teal shadow-lg backdrop-blur-sm"
            >
              <span aria-hidden>🎉</span>
              <span>
                <span className="text-brand-teal">{t.title}</span>
                <span className="text-brand-teal/70"> just sold!</span>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header — name + slug + live + offer count, kept tight so the
            video and product card dominate the conversion area below.
            Option A — when the merchant viewing their own embed is
            signed in, append a small owner-only "Manage offers ↗"
            chip that opens /project/<slug>/manage in a new tab.
            Discreet emerald pill; doesn't compete with the buyer
            CTAs below. Buyers never see it. */}
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {loading ? "Loading…" : displayName}
          </h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
            <span className="font-mono">{displaySlug}</span>
            <span
              className={
                project?.is_live ? "text-brand-teal" : "text-[var(--color-text-muted)]"
              }
            >
              {liveLabel}
            </span>
            <span>{offers.length} offers</span>
            {isOwner && (
              <a
                href={manageHref}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 rounded-full border border-default bg-brand-teal-soft px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-brand-teal transition hover:border-brand-teal hover:text-brand-teal"
                title="Owner only. Opens your DUM Club admin in a new tab."
              >
                Owner · Manage offers ↗
              </a>
            )}
          </div>
          {error && <p className="text-sm text-state-live">{error}</p>}
        </header>

        {/* ── Stripe redirect-back banner ───────────────────────────
             Success: prominent emerald confirmation; refresh has
             already been triggered above so the pinned card's
             inventory is current.
             Cancelled: small, muted, non-blocking — the viewer is
             still on the page and can retry the CTA at any time. */}
        {checkoutResult === "success" && (
          <div
            role="status"
            className="flex items-start justify-between gap-3 rounded-2xl border border-brand-teal bg-brand-teal-soft px-4 py-3"
          >
            <div>
              <p className="text-sm font-bold text-brand-teal">
                Payment received
              </p>
              <p className="mt-0.5 text-xs text-brand-teal/80">
                Thanks. Your order is on its way. The seller has been
                notified.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCheckoutResult(null)}
              aria-label="Dismiss"
              className="shrink-0 rounded-md px-2 py-1 text-xs text-brand-teal/70 hover:bg-brand-teal-soft hover:text-brand-teal"
            >
              Dismiss
            </button>
          </div>
        )}
        {checkoutResult === "cancelled" && (
          <div
            role="status"
            className="flex items-center justify-between gap-3 rounded-xl border border-default bg-surface-card px-3 py-2 text-xs text-[var(--color-text-muted)]"
          >
            <span>Checkout cancelled</span>
            <button
              type="button"
              onClick={() => setCheckoutResult(null)}
              aria-label="Dismiss"
              className="rounded-md px-1.5 py-0.5 text-secondary hover:bg-surface-muted/60 hover:text-primary"
            >
              ×
            </button>
          </div>
        )}

        {/* ── Conversion layout ──────────────────────────────────────
             Desktop (lg:): video on the left, product card stacked
             above chat on the right.
             Mobile: video first, then product card, then chat. */}
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          {/* LEFT (desktop) / TOP (mobile) — Live video. Wrapped in
              a relative container so the floating emoji burst overlay
              can absolute-position inside the video bounds without
              escaping the conversion grid. */}
          <section
            ref={liveSectionRef}
            aria-label="Live video"
            className="relative"
          >
            {project?.id && ivsActive ? (
              <IVSStageViewer projectId={project.id} userId={viewerUserId} />
            ) : (
              <div
                // Aspect-ratio alone now sizes this — the prior
                // `minHeight: 300` floor created a too-tall "Stream
                // offline" panel on portrait mobile that read as
                // empty grey space pushing the offer card down. The
                // natural 16:9 height (~219px on a 390px phone)
                // tracks the live video's actual size, so the
                // transition between offline and live feels in-place
                // instead of layout-shifting.
                className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-2xl border border-default bg-black text-sm text-secondary"
              >
                {loading ? "Loading video…" : "Stream offline"}
              </div>
            )}

            {/* Floating emoji burst. pointer-events-none so checkout
                CTAs underneath stay tappable. */}
            {emojiBursts.length > 0 && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 overflow-hidden"
              >
                {emojiBursts.map((b) => (
                  <span
                    key={b.id}
                    className="embed-emoji-float absolute bottom-4 select-none text-3xl drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]"
                    style={{
                      left: `${b.left}%`,
                      animationDelay: `${b.delay}ms`,
                    }}
                  >
                    {b.emoji}
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* RIGHT (desktop) / BELOW VIDEO (mobile) — product card + chat.
              On mobile, adds extra bottom padding so the chat (480px+
              tall) and its input never sit underneath the sticky buy
              bar. The sticky bar is ~64-72px tall on standard
              devices and 88-100px on iOS notched devices with
              safe-area-inset-bottom; pb-36 (=9rem) gives ample
              clearance on every viewport tested. The padding is
              removed at lg: where the sticky bar is hidden and the
              chat sits in the right grid column with no overlap
              risk. */}
          <div
            className={`space-y-4 ${pinnedOffer ? "pb-36 lg:pb-0" : ""}`}
          >
            {/* Pinned offer card — title / price / description / stock.
                Adds the embed-sold-flash class for a single ~1s flash
                when an item_updated event arrives with sold_out=true.
                Always visible on every viewport. Previously hidden on
                mobile when pinnedOffer was set (the sticky bottom buy
                bar acted as the only CTA), but that broke the
                "product card visually attached to livestream" cue —
                visitors saw video, then a big chat block, then a
                sticky CTA divorced from the offer it was for. The
                card directly under the video reads as "this is what
                you're watching"; the sticky bar stays as a scroll-
                anywhere fallback. */}
            <section
              aria-label="Pinned offer"
              className={`rounded-2xl border bg-surface-card p-4 transition-colors ${
                soldFlash
                  ? "embed-sold-flash border-[var(--state-live)]/30"
                  : "border-default"
              }`}
            >
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-teal">
                Now showing
              </div>
              {pinnedOffer ? (
                <div className="space-y-3">
                  <h2 className="text-lg font-semibold leading-tight">
                    {pinnedOffer.title || "Untitled offer"}
                  </h2>
                  {pinnedOffer.description && (
                    <p className="text-sm text-secondary line-clamp-3">
                      {pinnedOffer.description}
                    </p>
                  )}
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-2xl font-bold text-brand-teal">
                      ${Number(pinnedOffer.price_usd || 0).toFixed(2)}
                    </span>
                    {pinnedOffer.unlimited_inventory ? (
                      <span className="text-xs text-secondary">Unlimited stock</span>
                    ) : soldOut ? (
                      <span className="rounded-md border border-default px-2 py-1 text-xs font-bold uppercase tracking-wider text-secondary">
                        Sold out
                      </span>
                    ) : remaining !== null ? (
                      <span className="text-xs text-secondary">
                        {remaining} left
                      </span>
                    ) : null}
                  </div>

                  {/* Primary CTA — Pay with Card. Auth gate: if no
                      user, the button triggers Privy login via the
                      existing useAuth flow; the click that follows
                      sign-in actually starts checkout. Sold out is
                      a hard disable.
                      Audit #6 Phase 1 (Q7): "Processing..." replaced
                      by "Opening secure checkout..." so the buyer
                      knows what's about to happen during the 1-3s
                      between click and Stripe redirect. */}
                  {soldOut ? (
                    <button
                      type="button"
                      disabled
                      className="w-full rounded-xl border border-default px-5 py-3 text-sm font-bold text-secondary"
                    >
                      Sold Out
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleBuy}
                      disabled={buying || solBuying}
                      className="w-full rounded-xl bg-brand-teal px-5 py-3 text-sm font-bold text-black transition hover:bg-brand-teal disabled:opacity-40"
                    >
                      {buying
                        ? "Opening secure checkout…"
                        : pinnedOffer
                          ? `Buy now · $${Number(pinnedOffer.price_usd || 0).toFixed(2)}`
                          : "Buy now"}
                    </button>
                  )}

                  {/* Audit #6 Phase 1 (Q4 + Q5) — Stripe trust caption
                      and USD currency note. The trust line mirrors the
                      one shipped on /project/[id] in Audit #4 Phase 2.
                      The USD note pre-warns buyers that Stripe will
                      auto-localise the displayed price (the DOP
                      example a merchant flagged on the
                      topgunmaintenance.com embed install). Buyer-only
                      — sold-out, signed-in-but-pre-click, and pre-
                      sign-in all share the same trust copy. */}
                  {!soldOut && (
                    <p className="text-center text-[11px] leading-relaxed text-secondary">
                      Stripe checkout · Your card never touches DUM Club. <span className="text-muted">Prices in USD; Stripe converts at checkout.</span>
                    </p>
                  )}

                  {/* Iframe-unauth helper. Surfaces only when the
                      buyer is on the merchant's site, not signed
                      in, and about to be redirected to a new tab.
                      Email OTP is the recommended path because it
                      avoids the Google OAuth roundtrip; sign-in
                      stays on dum.club start to finish. */}
                  {!soldOut && !authUser && isInIframe() && (
                    <p className="text-center text-[11px] leading-relaxed text-muted">
                      Use email sign-in to continue checkout.
                    </p>
                  )}

                  {buyError && (
                    <div className="rounded-lg border border-red-500/20 bg-state-live/5 px-3 py-2 text-xs text-state-live">
                      {buyError}
                    </div>
                  )}

                  {/* Secondary CTA — Pay with SOL. Feature-flagged
                      off by default. Hidden entirely when sold out
                      so the conversion path stays clean. Disabled
                      while either rail is in flight to prevent
                      double-payment. */}
                  {SOL_CHECKOUT_ENABLED && !soldOut && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={handlePayWithSol}
                        disabled={buying || solBuying}
                        className="w-full rounded-xl border border-default bg-transparent px-5 py-2 text-xs font-medium text-primary transition hover:border-strong hover:text-white disabled:opacity-40"
                      >
                        {solBuying
                          ? solStep === "signing"
                            ? "Approve in wallet..."
                            : solStep === "confirming"
                              ? "Confirming on Solana..."
                              : solStep === "verifying"
                                ? "Verifying..."
                                : "Processing..."
                          : "or pay with SOL"}
                      </button>
                      {solError && (
                        <div className="rounded-lg border border-red-500/20 bg-state-live/5 px-3 py-2 text-xs text-state-live">
                          {solError}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-secondary">No live offer pinned yet</p>
              )}
            </section>

            {/* All-offers strip — browse beyond the pinned offer.
                Renders the rest of the merchant's active offers as
                view-only tiles. Each tile links out to the offer's
                anchor on /project/[id], where the full storefront
                already exposes per-offer detail + Buy CTA. We
                intentionally do NOT add a second checkout path
                here; keeping checkout on the pinned card avoids
                pulling Stripe auth + sign-in + autobuy resume into
                a new surface. */}
            {(() => {
              const browseOffers = offers.filter(
                (o) =>
                  o.id !== (pinnedOffer ? pinnedOffer.id : null) &&
                  typeof o.title === "string" &&
                  o.title.trim().length > 0,
              );
              if (browseOffers.length === 0) return null;
              return (
                <section
                  aria-label="More offers"
                  className="rounded-2xl border border-default bg-surface-card p-4"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-secondary">
                      More from this seller
                    </div>
                    <div className="text-[10px] font-medium text-muted">
                      {browseOffers.length} more
                    </div>
                  </div>
                  <div className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1 lg:max-h-72 lg:flex-col lg:snap-none lg:overflow-y-auto">
                    {browseOffers.map((o) => {
                      const price =
                        typeof o.price_usd === "number" && isFinite(o.price_usd)
                          ? `$${o.price_usd.toFixed(2)}`
                          : null;
                      const remaining = (() => {
                        if (o.unlimited_inventory) return null;
                        const qa = Number(o.quantity_available || 0);
                        const qs = Number(o.quantity_sold || 0);
                        const left = Math.max(0, qa - qs);
                        if (left <= 0) return "Sold out";
                        if (left <= 5) return `${left} left`;
                        return null;
                      })();
                      const isSoldOut = remaining === "Sold out";
                      return (
                        <a
                          key={o.id}
                          href={`/project/${project?.slug || businessId}#offer-${o.id}`}
                          target="_top"
                          className={`group flex shrink-0 snap-start flex-col gap-1 rounded-xl border border-default bg-surface-page p-3 transition hover:border-brand-teal/50 lg:flex-row lg:items-center lg:gap-3 lg:shrink ${
                            isSoldOut ? "opacity-60" : ""
                          }`}
                          style={{ minWidth: "180px" }}
                          aria-label={`View ${o.title}${price ? ` for ${price}` : ""}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="truncate text-sm font-semibold text-primary">
                              {o.title}
                            </div>
                            {remaining && (
                              <div
                                className={`mt-0.5 text-[10px] font-semibold ${
                                  isSoldOut ? "text-state-live" : "text-amber-400"
                                }`}
                              >
                                {remaining}
                              </div>
                            )}
                          </div>
                          {price && (
                            <div className="font-mono text-sm font-bold text-brand-teal">
                              {price}
                            </div>
                          )}
                          <span
                            aria-hidden="true"
                            className="text-sm leading-none text-brand-teal transition group-hover:translate-x-0.5"
                          >
                            →
                          </span>
                        </a>
                      );
                    })}
                  </div>
                </section>
              );
            })()}

            {/* LiveChatIVS — websocket wiring + basic chat display. The
                component renders its own header showing the live viewer
                count from the WS. onItemUpdate keeps the offers array
                fresh so the pinned card's "X left" / sold-out state
                tracks live without a refetch. */}
            {project?.id && isIVSSession(project) && (
              <section aria-label="Live chat" className="block min-h-[480px]">
                <LiveChatIVS
                  projectId={project.id}
                  userId={viewerUserId}
                  userName={viewerName}
                  isHost={false}
                  onItemUpdate={(data) => {
                    setOffers((prev) =>
                      prev.map((o) =>
                        o.id === data.offer_id
                          ? { ...o, quantity_sold: data.quantity_sold }
                          : o
                      )
                    );
                    setInventoryEventCount((c) => c + 1);
                    pushEvent(
                      `Inventory event received. Offer ${data.offer_id} sold ${data.quantity_sold}${
                        data.sold_out ? " (sold out)" : ""
                      }`
                    );
                    if (data.sold_out) flashSoldOut();
                  }}
                  onItemSold={(data) => {
                    setSoldEventCount((c) => c + 1);
                    // Resolve the freshest title via offersRef. The WS
                    // payload carries a title field, but if a host pin
                    // happened between renders the offers array can
                    // be more current than the broadcast.
                    const fresh = offersRef.current.find(
                      (o) => o.id === data.offer_id
                    );
                    const title = fresh?.title || data.title || "Item";
                    pushEvent(
                      `Sold event received, ${title} (offer ${data.offer_id})`
                    );
                    spawnSaleToast(title);
                    spawnEmojiBurst();
                  }}
                />
              </section>
            )}
          </div>
        </div>

        {/* Event-wire debug — visible confirmation that the WS callbacks
            are firing. Stays in place until real product / checkout UI
            replaces it in later steps. */}
        <section
          aria-label="Event debug"
          className="rounded-2xl border border-default bg-surface-card p-4 text-xs"
        >
          <div className="mb-2 flex gap-4 text-[var(--color-text-muted)]">
            <span>Inventory events: {inventoryEventCount}</span>
            <span>Sold events: {soldEventCount}</span>
          </div>
          {lastEvents.length === 0 ? (
            <p className="text-[var(--color-text-muted)]">No events yet</p>
          ) : (
            <ul className="space-y-1 font-mono">
              {lastEvents.map((ev) => (
                <li key={ev.id}>{ev.text}</li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-xs uppercase tracking-widest text-[var(--color-text-muted)]">
          Embed shell loaded
        </p>
      </div>

      {/* ── Mobile sticky buy bar (Step 9) ─────────────────────────
           Mobile-only (lg:hidden). Renders only when a pinnedOffer
           exists — otherwise there is nothing to buy. Includes
           safe-area-inset-bottom padding for notched devices. The
           inline mobile pinned card above is hidden when this bar
           is active so the buy CTA isn't duplicated.

           Layout: title + price/inventory on the left, primary
           Pay-with-Card on the right (or a Sold Out pill). When
           SOL is enabled, a slim secondary "or pay with SOL" row
           appears beneath the primary row. */}
      {pinnedOffer && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-default bg-surface-card backdrop-blur-sm lg:hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="mx-auto max-w-6xl px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-primary">
                  {pinnedOffer.title || "Untitled offer"}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-sm font-bold text-brand-teal">
                    ${Number(pinnedOffer.price_usd || 0).toFixed(2)}
                  </span>
                  {pinnedOffer.unlimited_inventory ? null : soldOut ? (
                    <span className="text-[10px] uppercase tracking-wider text-secondary">
                      Sold out
                    </span>
                  ) : remaining !== null ? (
                    <span className="text-[10px] text-secondary">
                      {remaining} left
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="shrink-0">
                {soldOut ? (
                  <span className="rounded-lg border border-default px-4 py-2 text-xs font-bold text-secondary">
                    Sold Out
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleBuy}
                    disabled={buying || solBuying}
                    className="min-h-[44px] rounded-lg bg-brand-teal px-5 py-3 text-sm font-bold text-black transition hover:bg-brand-teal disabled:opacity-40"
                  >
                    {buying
                      ? "Opening…"
                      : !authUser
                        ? isInIframe()
                          ? "Sign in →"
                          : "Sign in"
                        : "Pay with Card"}
                  </button>
                )}
              </div>
            </div>
            {SOL_CHECKOUT_ENABLED && !soldOut && (
              <button
                type="button"
                onClick={handlePayWithSol}
                disabled={buying || solBuying}
                className="mt-2 min-h-[44px] w-full rounded-lg border border-default bg-transparent px-3 py-2.5 text-xs font-medium text-primary transition hover:border-strong hover:text-white disabled:opacity-40"
              >
                {solBuying
                  ? solStep === "signing"
                    ? "Approve in wallet..."
                    : solStep === "confirming"
                      ? "Confirming on Solana..."
                      : solStep === "verifying"
                        ? "Verifying..."
                        : "Processing..."
                  : "or pay with SOL"}
              </button>
            )}
            {(buyError || solError) && (
              <p className="mt-1.5 truncate text-[11px] text-state-live">
                {buyError || solError}
              </p>
            )}
          </div>
        </div>
      )}

      {/* DUM Pop-In Seller — Mode C MVP. Fires once the merchant has
           a project id + pinned offer (or the merchant-overridden
           offer). Trigger logic + dismiss + analytics live inside the
           host. Clicking the offer chip runs the same handleBuy()
           that the main offer card uses, so we get auth/Stripe/sold-
           out handling for free. Merchant settings come from
           project.popin_config (PR #135). */}
      <PopInSellerHost
        projectId={project?.id ?? null}
        merchantName={displayName}
        pinnedOffer={
          pinnedOffer
            ? {
                id: pinnedOffer.id,
                title: pinnedOffer.title || "Featured offer",
                price_usd: Number(pinnedOffer.price_usd ?? 0),
              }
            : null
        }
        config={project?.popin_config ?? null}
        resolveOffer={(offerId) => {
          const match = offers.find((o) => o.id === offerId);
          if (!match) return null;
          return {
            id: match.id,
            title: match.title || "Featured offer",
            price_usd: Number(match.price_usd ?? 0),
          };
        }}
        onOfferClick={handleBuy}
        isLiveActive={isLivePresent}
        onLiveClick={handlePopInLiveClick}
      />
    </main>
  );
}
