"use client";

/**
 * LiveRoom — immersive, full-bleed live shopping room (PR 3).
 *
 * A TikTok-style overlay for a live storefront: full-screen IVS video behind
 * everything, gradient scrims for legibility, a vertical action rail with
 * tap-to-like floating hearts, overlaid chat, a glassy offer card, and a
 * pinned BUY bar. This is LAYOUT + STYLING only — it reuses the existing
 * plumbing passed in as props:
 *   - IVSStageViewer (the real Real-Time viewer)
 *   - LiveChatIVS (the real chat / item-sold / viewer-count channel)
 *   - onBuy → the storefront's buyOffer() Stripe Connect checkout
 *   - the page's follow state (favorites table)
 *
 * No new backend, no new tables. Floating hearts are purely visual.
 * Rendered by the storefront only for non-owner visitors while the shop is
 * live; the page suppresses its inline video/chat so nothing double-mounts.
 *
 * Brand: dark immersive surface (the video is the content) with the mint
 * action color + coral live/urgency from the shipped token set. Tuned to the
 * brief; a brand mock can refine the exact spacing/scrims later.
 */

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { LiveChatIVS } from "./LiveChatIVS";

const IVSStageViewer = dynamic(
  () => import("./IVSStageViewer").then((m) => ({ default: m.IVSStageViewer })),
  { ssr: false },
);

export type LiveRoomOffer = {
  id: string;
  title: string;
  price_usd: number;
  primary_image_url: string | null;
  quantity_available: number | null;
  quantity_sold: number;
  unlimited_inventory: boolean;
  promo_copy?: string | null;
};

type LiveRoomProps = {
  projectId: string;
  userId: string;
  userName: string;
  isOwner: boolean;
  shop: { name: string; logoUrl: string | null; verbLabel: string };
  // Follow (favorites) — driven by the page so counts stay in sync.
  isFollowing: boolean;
  followerCount: number;
  onToggleFollow: () => void;
  // Pinned offer + checkout.
  pinnedOffer: LiveRoomOffer | null;
  buyingOfferId: string | null;
  onBuy: (offer: LiveRoomOffer) => void;
  resolveImageUrl: (url: string | null | undefined) => string;
  // Live state + chat passthrough.
  viewerCount: number;
  salesCount: number;
  getToken: () => Promise<string | null>;
  onRequestSignIn: () => void;
  onCommentBuy: (text: string) => void;
  onViewerCountChange: (n: number) => void;
  onItemSold: (data: { offer_id: string; title: string }) => void;
  onItemUpdate: (data: { offer_id: string; quantity_sold: number }) => void;
  onClose: () => void;
};

type Heart = { id: number; drift: number };

export function LiveRoom({
  projectId,
  userId,
  userName,
  isOwner,
  shop,
  isFollowing,
  followerCount,
  onToggleFollow,
  pinnedOffer,
  buyingOfferId,
  onBuy,
  resolveImageUrl,
  viewerCount,
  salesCount,
  getToken,
  onRequestSignIn,
  onCommentBuy,
  onViewerCountChange,
  onItemSold,
  onItemUpdate,
  onClose,
}: LiveRoomProps) {
  const [hearts, setHearts] = useState<Heart[]>([]);
  const [likeCount, setLikeCount] = useState(0);
  const heartSeq = useRef(0);
  const chatWrapRef = useRef<HTMLDivElement | null>(null);

  function popHeart() {
    // Sequential id (not Math.random) keeps keys stable; drift varies the
    // sideways travel so a rapid tap-stream fans out instead of stacking.
    heartSeq.current += 1;
    const id = heartSeq.current;
    const drift = ((id * 37) % 60) - 30; // deterministic spread, -30..29px
    setHearts((h) => [...h, { id, drift }]);
    setLikeCount((c) => c + 1);
  }

  function focusChat() {
    const el = chatWrapRef.current?.querySelector<HTMLElement>("textarea, input");
    el?.focus();
  }

  async function share() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: shop.name, url });
      } else if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      /* user cancelled the share sheet — nothing to do */
    }
  }

  // Pinned-offer stock math (mirrors the storefront's sticky buy bar).
  const hasCap =
    pinnedOffer != null &&
    !pinnedOffer.unlimited_inventory &&
    (pinnedOffer.quantity_available || 0) > 0;
  const remaining = hasCap
    ? Math.max(0, (pinnedOffer!.quantity_available || 0) - (pinnedOffer!.quantity_sold || 0))
    : null;
  const isSoldOut = hasCap && (remaining ?? 0) <= 0;
  const buying = pinnedOffer != null && buyingOfferId === pinnedOffer.id;

  return (
    <div className="fixed inset-0 z-[60] overflow-hidden bg-black text-white">
      {/* ── Full-bleed video ── */}
      <div className="absolute inset-0 [&_video]:h-full [&_video]:w-full [&_video]:object-cover [&>div]:h-full">
        <IVSStageViewer projectId={projectId} userId={userId} fit="cover" />
      </div>

      {/* Scrims — top + bottom gradients so the chrome stays legible over any
          frame without dimming the middle of the video. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-80 bg-gradient-to-t from-black/80 to-transparent" />

      {/* ── Top bar ── */}
      <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-state-live px-2.5 py-1 shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-white" />
          <span className="text-[11px] font-bold uppercase tracking-wide">Live</span>
        </span>
        {viewerCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 font-mono text-[11px] font-semibold text-white backdrop-blur-sm">
            <span aria-hidden="true">👀</span>
            {viewerCount.toLocaleString()}
          </span>
        )}
        {salesCount > 0 && (
          <span className="rounded-full bg-black/55 px-2.5 py-1 font-mono text-[11px] font-semibold text-mint-text backdrop-blur-sm">
            {salesCount.toLocaleString()} sold
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close live room"
          className="ml-auto inline-flex h-9 w-9 items-center justify-center text-white/90 drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)] transition hover:text-white"
        >
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* ── Shop chip — sits on the video over the top scrim (no pill), text
           carries its own drop-shadow for legibility. ── */}
      <div className="absolute left-4 top-16 z-20 flex items-center gap-2.5 drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)]">
        <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/30 bg-white/10">
          {shop.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shop.logoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-sm font-bold">{shop.name.slice(0, 1).toUpperCase()}</span>
          )}
        </span>
        <span className="min-w-0">
          <span className="block max-w-[44vw] truncate text-sm font-bold leading-tight">{shop.name}</span>
          <span className="block text-[10px] tracking-[0.08em] text-white/75">
            <span className="uppercase">{shop.verbLabel}</span>
            {followerCount > 0 && <> · {followerCount.toLocaleString()} followers</>}
          </span>
        </span>
        {!isOwner && (
          <button
            type="button"
            onClick={onToggleFollow}
            aria-pressed={isFollowing}
            className={`ml-1 flex-shrink-0 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.06em] transition ${
              isFollowing
                ? "border border-white/40 bg-transparent text-white"
                : "bg-mint-fill text-mint-fill-ink hover:opacity-90"
            }`}
          >
            {isFollowing ? "Following" : "Follow"}
          </button>
        )}
      </div>

      {/* ── Right action rail ── */}
      <div className="absolute bottom-44 right-3 z-20 flex flex-col items-center gap-5">
        <RailButton
          label={likeCount > 0 ? <span className="text-mint-text">{likeCount.toLocaleString()}</span> : "Like"}
          onClick={popHeart}
          aria-label="Like"
        >
          <svg className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 21s-7.2-4.6-9.6-9.2C.9 8.7 2.3 5.5 5.3 5.1c1.8-.2 3.4.7 4.7 2.2C11.3 5.8 12.9 4.9 14.7 5.1c3 .4 4.4 3.6 2.9 6.7C19.2 16.4 12 21 12 21z" />
          </svg>
        </RailButton>
        <RailButton label="Chat" onClick={focusChat} aria-label="Comment">
          <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-5.3A8 8 0 1 1 21 12z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </RailButton>
        <RailButton label="Share" onClick={share} aria-label="Share">
          <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </RailButton>

        {/* Floating hearts rise out of the like button. */}
        <div className="pointer-events-none absolute bottom-16 right-2 h-72 w-16">
          {hearts.map((h) => (
            <span
              key={h.id}
              className="float-heart absolute bottom-0 right-3 text-2xl"
              style={{ ["--drift" as string]: `${h.drift}px` }}
              onAnimationEnd={() => setHearts((list) => list.filter((x) => x.id !== h.id))}
            >
              ❤️
            </span>
          ))}
        </div>
      </div>

      {/* ── Live chat (overlaid, bottom-left) ── */}
      <div
        ref={chatWrapRef}
        className="absolute bottom-40 left-2 z-20 w-[72vw] max-w-sm"
      >
        <LiveChatIVS
          projectId={projectId}
          userId={userId}
          userName={userName}
          isHost={isOwner}
          overlay
          onRequestSignIn={onRequestSignIn}
          getToken={getToken}
          onCommentBuy={onCommentBuy}
          onViewerCountChange={onViewerCountChange}
          onItemSold={onItemSold}
          onItemUpdate={onItemUpdate}
        />
      </div>

      {/* ── Offer card + BUY bar ── */}
      {pinnedOffer && (
        <div className="absolute inset-x-0 bottom-0 z-20 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-md">
            {/* Dark glassy offer card (the video shows through). */}
            <div className="mb-2 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/55 p-2.5 text-white shadow-lg backdrop-blur-md">
              {pinnedOffer.primary_image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={resolveImageUrl(pinnedOffer.primary_image_url)}
                  alt=""
                  className="h-14 w-14 flex-shrink-0 rounded-xl object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                {pinnedOffer.promo_copy && (
                  <span className="mb-0.5 inline-block rounded-full bg-mint-text/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-mint-text">
                    Slow hour flash deal
                  </span>
                )}
                <div className="truncate text-sm font-bold text-white">{pinnedOffer.title}</div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-base font-extrabold text-white">
                    ${Number(pinnedOffer.price_usd).toFixed(2)}
                  </span>
                  {typeof remaining === "number" && remaining > 0 && (
                    <span className="rounded-full bg-state-live/20 px-1.5 py-0.5 text-[10px] font-bold text-state-live">
                      {remaining} left
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* BUY bar */}
            <div className="flex items-center gap-2">
              {isSoldOut ? (
                <span className="flex-1 rounded-2xl bg-white/15 py-3.5 text-center text-sm font-bold text-white/70">
                  Sold out
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onBuy(pinnedOffer)}
                  disabled={!!buyingOfferId}
                  className="flex-1 rounded-2xl bg-mint-fill py-3.5 text-center text-sm font-extrabold uppercase tracking-[0.08em] text-mint-fill-ink transition hover:opacity-90 disabled:opacity-50"
                >
                  {buying ? "Opening…" : `Buy now · $${Number(pinnedOffer.price_usd).toFixed(2)}`}
                </button>
              )}
              {/* Browse-all-offers — drops to the full storefront. */}
              <button
                type="button"
                onClick={onClose}
                aria-label="Browse all offers"
                className="flex h-[52px] w-[52px] flex-shrink-0 items-center justify-center rounded-2xl bg-mint-fill/15 text-xl text-mint-text transition hover:bg-mint-fill/25"
              >
                🛍️
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RailButton({
  children,
  label,
  onClick,
  ...rest
}: {
  children: React.ReactNode;
  label: React.ReactNode;
  onClick: () => void;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1 text-white drop-shadow-[0_1px_5px_rgba(0,0,0,0.6)] transition active:scale-90"
      {...rest}
    >
      {children}
      <span className="text-[11px] font-bold">{label}</span>
    </button>
  );
}
