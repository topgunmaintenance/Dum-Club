"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { useWallet } from "@solana/wallet-adapter-react";
import { API_BASE } from "../../../lib/apiBase";
import { useAuth } from "../../../lib/auth/AuthContext";
import { isIVSSession } from "../../../lib/liveProvider";
import { LiveChatIVS } from "../../../components/LiveChatIVS";
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
 * and (when feature-flagged on) a secondary Pay-with-SOL CTA.
 *
 * Step 7 of the DUM Live Embed build. Adds SOL as a non-dominant
 * second rail under the primary Stripe button, gated by
 * SOL_CHECKOUT_ENABLED (NEXT_PUBLIC_ENABLE_SOL_CHECKOUT). Reuses the
 * existing payOfferWithSol orchestrator from frontend/lib/
 * solanaCheckout.ts — quote → on-chain transfer → backend confirm —
 * so this page contains zero Solana protocol logic of its own. No
 * webhook redirect for SOL: payment completes inline, so success
 * triggers the same banner and load() refresh that the Stripe
 * redirect-back path uses.
 *
 * Still no reaction animations — those land later. No DUM Club
 * chrome (gated by SiteChrome from Step 1).
 */
export default function EmbedShellPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = params?.businessId;

  const { user: authUser, login, getToken } = useAuth();
  const viewerUserId = authUser?.privyId || "";
  const viewerName = authUser?.email || "Viewer";

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

  const displayName = project?.name || project?.title || "—";
  const displaySlug = project?.slug || businessId || "—";
  const liveLabel = project?.is_live ? "live" : "offline";
  const ivsActive = !!project && isIVSSession(project) && !!project.ivs_stage_arn;

  // Pinned offer derivation — single source of truth for the card.
  const pinnedOffer = useMemo<Offer | null>(() => {
    if (!project?.pinned_offer_id) return null;
    return offers.find((o) => o.id === project.pinned_offer_id) || null;
  }, [offers, project?.pinned_offer_id]);

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

  async function handleBuy() {
    if (!pinnedOffer) return;
    if (soldOut) return;

    setBuyError(null);

    // Existing auth pattern: if no user yet, kick off Privy login. The
    // button copy below switches to "Sign in to buy" so this click is
    // the user's first auth gesture. Privy renders its own modal; we
    // do not implement a separate sign-in UI here.
    if (!authUser) {
      try {
        login();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Sign-in failed";
        setBuyError(msg);
      }
      return;
    }

    setBuying(true);

    try {
      const token = await getToken();
      if (!token) {
        setBuyError("Authentication failed — please sign in again");
        setBuying(false);
        return;
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
          Authorization: `Bearer ${token}`,
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
          setBuyError("Pop-up blocked — allow pop-ups for this site and try again");
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
        setSolError("Authentication failed — please sign in again");
        setSolBuying(false);
        setSolStep(null);
        return;
      }

      const rpcUrl =
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
        process.env.NEXT_PUBLIC_SOLANA_RPC ||
        "https://api.mainnet-beta.solana.com";

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
    <main className="min-h-screen bg-base text-[var(--color-text-primary)] px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header — name + slug + live + offer count, kept tight so the
            video and product card dominate the conversion area below. */}
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {loading ? "Loading…" : displayName}
          </h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
            <span className="font-mono">{displaySlug}</span>
            <span
              className={
                project?.is_live ? "text-emerald-400" : "text-[var(--color-text-muted)]"
              }
            >
              {liveLabel}
            </span>
            <span>{offers.length} offers</span>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
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
            className="flex items-start justify-between gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3"
          >
            <div>
              <p className="text-sm font-bold text-emerald-300">
                Payment received
              </p>
              <p className="mt-0.5 text-xs text-emerald-200/80">
                Thanks — your order is on its way. The seller has been
                notified.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCheckoutResult(null)}
              aria-label="Dismiss"
              className="shrink-0 rounded-md px-2 py-1 text-xs text-emerald-300/70 hover:bg-emerald-500/10 hover:text-emerald-200"
            >
              Dismiss
            </button>
          </div>
        )}
        {checkoutResult === "cancelled" && (
          <div
            role="status"
            className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs text-[var(--color-text-muted)]"
          >
            <span>Checkout cancelled</span>
            <button
              type="button"
              onClick={() => setCheckoutResult(null)}
              aria-label="Dismiss"
              className="rounded-md px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300"
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
          {/* LEFT (desktop) / TOP (mobile) — Live video. */}
          <section aria-label="Live video">
            {project?.id && ivsActive ? (
              <IVSStageViewer projectId={project.id} userId={viewerUserId} />
            ) : (
              <div
                className="flex items-center justify-center overflow-hidden rounded-2xl border border-zinc-800 bg-black text-sm text-zinc-500"
                style={{ minHeight: 300, aspectRatio: "16/9" }}
              >
                {loading ? "Loading video…" : "Stream offline"}
              </div>
            )}
          </section>

          {/* RIGHT (desktop) / BELOW VIDEO (mobile) — product card + chat. */}
          <div className="space-y-4">
            {/* Pinned offer card — title / price / description / stock. */}
            <section
              aria-label="Pinned offer"
              className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4"
            >
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400/80">
                Now showing
              </div>
              {pinnedOffer ? (
                <div className="space-y-3">
                  <h2 className="text-lg font-semibold leading-tight">
                    {pinnedOffer.title || "Untitled offer"}
                  </h2>
                  {pinnedOffer.description && (
                    <p className="text-sm text-zinc-400 line-clamp-3">
                      {pinnedOffer.description}
                    </p>
                  )}
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-2xl font-bold text-emerald-400">
                      ${Number(pinnedOffer.price_usd || 0).toFixed(2)}
                    </span>
                    {pinnedOffer.unlimited_inventory ? (
                      <span className="text-xs text-zinc-500">Unlimited stock</span>
                    ) : soldOut ? (
                      <span className="rounded-md border border-zinc-700 px-2 py-1 text-xs font-bold uppercase tracking-wider text-zinc-400">
                        Sold out
                      </span>
                    ) : remaining !== null ? (
                      <span className="text-xs text-zinc-500">
                        {remaining} left
                      </span>
                    ) : null}
                  </div>

                  {/* Primary CTA — Pay with Card. Auth gate: if no
                      user, the button triggers Privy login via the
                      existing useAuth flow; the click that follows
                      sign-in actually starts checkout. Sold out is
                      a hard disable. */}
                  {soldOut ? (
                    <button
                      type="button"
                      disabled
                      className="w-full rounded-xl border border-zinc-700 px-5 py-3 text-sm font-bold text-zinc-500"
                    >
                      Sold Out
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleBuy}
                      disabled={buying || solBuying}
                      className="w-full rounded-xl bg-emerald-500 px-5 py-3 text-sm font-bold text-black transition hover:bg-emerald-400 disabled:opacity-40"
                    >
                      {buying
                        ? "Processing..."
                        : !authUser
                          ? "Sign in to buy"
                          : "Pay with Card"}
                    </button>
                  )}

                  {buyError && (
                    <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
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
                        className="w-full rounded-xl border border-zinc-700 bg-transparent px-5 py-2 text-xs font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:opacity-40"
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
                        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
                          {solError}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">No live offer pinned yet</p>
              )}
            </section>

            {/* LiveChatIVS — websocket wiring + basic chat display. The
                component renders its own header showing the live viewer
                count from the WS. onItemUpdate keeps the offers array
                fresh so the pinned card's "X left" / sold-out state
                tracks live without a refetch. */}
            {project?.id && isIVSSession(project) && (
              <section aria-label="Live chat">
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
                      `Inventory event received — offer ${data.offer_id} sold ${data.quantity_sold}${
                        data.sold_out ? " (sold out)" : ""
                      }`
                    );
                  }}
                  onItemSold={(data) => {
                    setSoldEventCount((c) => c + 1);
                    pushEvent(
                      `Sold event received — ${data.title || "Item"} (offer ${data.offer_id})`
                    );
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
          className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4 text-xs"
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
    </main>
  );
}
