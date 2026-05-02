"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { API_BASE } from "../../../lib/apiBase";
import { useAuth } from "../../../lib/auth/AuthContext";
import { isIVSSession } from "../../../lib/liveProvider";
import { LiveChatIVS } from "../../../components/LiveChatIVS";

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
 * pinned offer card, and Pay-with-Card checkout.
 *
 * Step 5 of the DUM Live Embed build. Adds the Stripe Checkout CTA
 * to the pinned card. Reuses the same /api/checkout/create-payment-
 * intent endpoint and request shape as /project/[id]'s buyOffer; in
 * an iframe context the returned checkout_url opens in a new tab so
 * the merchant's host page is never replaced; in a top-level context
 * we redirect normally.
 *
 * Still no Solana / SOL surface, and no reaction animations — those
 * land later. No DUM Club chrome (gated by SiteChrome from Step 1).
 */
export default function EmbedShellPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = params?.businessId;

  const { user: authUser, login, getToken } = useAuth();
  const viewerUserId = authUser?.privyId || "";
  const viewerName = authUser?.email || "Viewer";

  const [project, setProject] = useState<EmbedProject | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Checkout state — only one pinned offer is buyable from this card,
  // so a single in-flight flag + a single error string is enough.
  const [buying, setBuying] = useState<boolean>(false);
  const [buyError, setBuyError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!businessId) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`${API_BASE}/api/projects/${businessId}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Failed to load project (${res.status})`);

        const data = await res.json();
        const p: EmbedProject = data?.project || data;
        if (cancelled) return;
        setProject(p);

        if (p?.id) {
          try {
            const offersRes = await fetch(`${API_BASE}/api/offers/${p.id}`, {
              cache: "no-store",
            });
            if (offersRes.ok) {
              const list: Offer[] = await offersRes.json();
              if (!cancelled) {
                setOffers(Array.isArray(list) ? list : []);
              }
            } else if (!cancelled) {
              setOffers([]);
            }
          } catch {
            if (!cancelled) setOffers([]);
          }
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

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

      // Strip any query params so Stripe's success/cancel redirect
      // lands on a clean URL — same pattern /project/[id] uses to
      // avoid malformed URLs on repeat purchases.
      const cleanUrl =
        typeof window !== "undefined"
          ? window.location.origin + window.location.pathname
          : "";

      const payload = {
        offer_id: pinnedOffer.id,
        success_url: cleanUrl,
        cancel_url: cleanUrl,
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
                      disabled={buying}
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
