"use client";

/**
 * LiveRoomDesktop — Whatnot-style 3-column live viewing layout for wide
 * screens: a browsable shop rail on the left, the video + featured item +
 * Buy Now bar in the center, and chat in its own right column.
 *
 * Sibling to LiveRoom (the mobile-first full-bleed overlay), not a
 * replacement — the parent page mounts exactly one of the two based on
 * viewport width, never both. Reuses the same IVSStageViewer and
 * LiveChatIVS components LiveRoom uses; IVSStageViewer's module-level
 * claim/wait dedup already tolerates multiple mounted instances per
 * project, so switching between this and LiveRoom on resize is safe.
 *
 * Scope note: auction/bidding support isn't built here yet — that state
 * (polling, countdown, placeBid) currently lives inside LiveRoom itself.
 * This component covers the standard Buy Now path; an active auction
 * still falls back to the mobile LiveRoom overlay via the parent's
 * `!isAuctionActive` check where this component is mounted.
 */

import { useState } from "react";
import dynamic from "next/dynamic";
import { LiveChatIVS } from "./LiveChatIVS";
import type { LiveRoomOffer } from "./LiveRoom";

const IVSStageViewer = dynamic(
  () => import("./IVSStageViewer").then((m) => ({ default: m.IVSStageViewer })),
  { ssr: false },
);

type LiveRoomDesktopProps = {
  projectId: string;
  userId: string;
  userName: string;
  shop: { name: string; logoUrl: string | null; verbLabel: string };
  isFollowing: boolean;
  followerCount: number;
  onToggleFollow: () => void;
  // The shop's full active-offer list (for the rail) and which one is
  // currently featured (for the center card). onBuyOffer is generic —
  // the rail can buy any offer, not just the featured one.
  offers: LiveRoomOffer[];
  pinnedOffer: LiveRoomOffer | null;
  buyingOfferId: string | null;
  onBuyOffer: (offer: LiveRoomOffer) => void;
  resolveImageUrl: (url: string | null | undefined) => string;
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

export function LiveRoomDesktop({
  projectId,
  userId,
  userName,
  shop,
  isFollowing,
  followerCount,
  onToggleFollow,
  offers,
  pinnedOffer,
  buyingOfferId,
  onBuyOffer,
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
}: LiveRoomDesktopProps) {
  const [imgFallback, setImgFallback] = useState<Record<string, boolean>>({});

  const isSoldOut = (o: LiveRoomOffer) =>
    !o.unlimited_inventory &&
    (o.quantity_available || 0) > 0 &&
    (o.quantity_available || 0) - (o.quantity_sold || 0) <= 0;

  const rail = offers.filter((o) => o.id !== pinnedOffer?.id);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-surface-page">
      {/* ── Top bar: shop identity, live stats, close ── */}
      <div className="flex shrink-0 items-center gap-3 border-b border-default bg-surface-card px-6 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-default bg-surface-muted">
          {shop.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shop.logoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-sm font-bold text-mint-text">{shop.name.slice(0, 1).toUpperCase()}</span>
          )}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-primary">{shop.name}</div>
          <div className="text-[11px] uppercase tracking-[0.1em] text-secondary">{shop.verbLabel}</div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-coral px-2.5 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-white" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-wide text-white">Live</span>
        </span>
        {viewerCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 font-mono text-[11px] font-semibold text-secondary">
            👀 {viewerCount.toLocaleString()}
          </span>
        )}
        {salesCount > 0 && (
          <span className="rounded-full bg-mint-card px-2.5 py-1 font-mono text-[11px] font-semibold text-mint-text">
            {salesCount.toLocaleString()} sold
          </span>
        )}
        <button
          type="button"
          onClick={onToggleFollow}
          aria-pressed={isFollowing}
          className={`ml-2 rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.06em] transition ${
            isFollowing
              ? "border border-default text-primary"
              : "bg-mint-fill text-mint-fill-ink hover:opacity-90"
          }`}
        >
          {isFollowing ? "Following" : "Follow"}
          {followerCount > 0 && <span className="ml-1 opacity-70">· {followerCount.toLocaleString()}</span>}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close live room"
          className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-full text-secondary transition hover:bg-surface-muted hover:text-primary"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* ── Three columns: shop rail | video + featured item | chat ── */}
      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_360px]">
        {/* LEFT — browsable shop rail. Every active offer is independently
            buyable here, not just the one currently featured. */}
        <div className="overflow-y-auto border-r border-default bg-surface-card p-3">
          <div className="mb-2 px-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-secondary">
            Shop
          </div>
          <div className="space-y-2">
            {rail.map((o) => {
              const soldOut = isSoldOut(o);
              const busy = buyingOfferId === o.id;
              return (
                <div key={o.id} className="flex items-center gap-2.5 rounded-xl border border-default p-2">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-muted">
                    {o.primary_image_url && !imgFallback[o.id] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={resolveImageUrl(o.primary_image_url)}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={() => setImgFallback((p) => ({ ...p, [o.id]: true }))}
                      />
                    ) : (
                      <span className="text-xs text-muted">·</span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-primary">{o.title}</div>
                    <div className="font-mono text-[12px] text-mint-text">${Number(o.price_usd).toFixed(0)}</div>
                  </div>
                  {soldOut ? (
                    <span className="shrink-0 text-[11px] font-semibold text-muted">Sold out</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onBuyOffer(o)}
                      disabled={busy}
                      className="shrink-0 rounded-lg bg-brand-navy px-3 py-1.5 text-[11px] font-bold text-white transition hover:opacity-90 disabled:opacity-50"
                    >
                      {busy ? "…" : "Buy now"}
                    </button>
                  )}
                </div>
              );
            })}
            {rail.length === 0 && (
              <p className="px-1 text-[12px] text-muted">Nothing else in stock right now.</p>
            )}
          </div>
        </div>

        {/* CENTER — video + featured item + Buy Now bar */}
        <div className="flex min-h-0 flex-col bg-black">
          <div className="relative min-h-0 flex-1">
            <div className="absolute inset-0 [&_video]:h-full [&_video]:w-full [&_video]:object-cover [&>div]:h-full">
              <IVSStageViewer projectId={projectId} userId={userId} fit="cover" />
            </div>
          </div>
          {pinnedOffer && (
            <div className="flex shrink-0 items-center gap-4 border-t border-default bg-surface-card p-4">
              {pinnedOffer.primary_image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={resolveImageUrl(pinnedOffer.primary_image_url)}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-xl object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-mint-text">
                  Now showing
                </div>
                <div className="truncate text-sm font-bold text-primary">{pinnedOffer.title}</div>
                <div className="font-mono text-base font-extrabold text-primary">
                  ${Number(pinnedOffer.price_usd).toFixed(2)}
                </div>
              </div>
              {isSoldOut(pinnedOffer) ? (
                <span className="shrink-0 rounded-xl bg-surface-muted px-6 py-3 text-sm font-bold text-secondary">
                  Sold out
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onBuyOffer(pinnedOffer)}
                  disabled={buyingOfferId === pinnedOffer.id}
                  className="shrink-0 rounded-xl bg-mint-fill px-6 py-3 text-sm font-extrabold uppercase tracking-[0.06em] text-mint-fill-ink transition hover:opacity-90 disabled:opacity-50"
                >
                  {buyingOfferId === pinnedOffer.id
                    ? "Opening…"
                    : `Buy now · $${Number(pinnedOffer.price_usd).toFixed(2)}`}
                </button>
              )}
            </div>
          )}
        </div>

        {/* RIGHT — chat, its own column */}
        <div className="flex min-h-0 flex-col border-l border-default bg-surface-card">
          <LiveChatIVS
            projectId={projectId}
            userId={userId}
            userName={userName}
            isHost={false}
            fillHeight
            onRequestSignIn={onRequestSignIn}
            getToken={getToken}
            onCommentBuy={onCommentBuy}
            onViewerCountChange={onViewerCountChange}
            onItemSold={onItemSold}
            onItemUpdate={onItemUpdate}
          />
        </div>
      </div>
    </div>
  );
}
