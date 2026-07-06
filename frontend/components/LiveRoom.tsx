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

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { LiveChatIVS } from "./LiveChatIVS";
import { API_BASE } from "../lib/apiBase";

const IVSStageViewer = dynamic(
  () => import("./IVSStageViewer").then((m) => ({ default: m.IVSStageViewer })),
  { ssr: false },
);

export type LiveRoomOffer = {
  id: string;
  title: string;
  price_usd: number;
  compare_at_price?: number | null;
  primary_image_url: string | null;
  quantity_available: number | null;
  quantity_sold: number;
  unlimited_inventory: boolean;
  promo_copy?: string | null;
};

export type LiveRoomAuction = {
  id: string;
  status: string;
  current_bid: number | null;
  current_bidder: string | null;
  current_bidder_display: string | null;
  starting_price: number;
  ends_at: string;
  bid_count: number;
};

type LiveRoomProps = {
  projectId: string;
  userId: string;
  userName: string;
  isOwner: boolean;
  // Live auction (optional). When present + active, the room shows a Bid bar
  // instead of the Buy bar. Seeded from the page; LiveRoom polls for realtime
  // current-bid sync and posts bids itself (auctions API, user_id header).
  auction: LiveRoomAuction | null;
  auctionItem: { title: string; image: string | null } | null;
  upNext: { id: string; title: string; image: string | null }[];
  onBidPlaced?: (displayName: string, amount: number) => void;
  shop: { name: string; logoUrl: string | null; verbLabel: string };
  // Follow (favorites) — driven by the page so counts stay in sync.
  isFollowing: boolean;
  followerCount: number;
  onToggleFollow: () => void;
  // Pinned offer + checkout.
  pinnedOffer: LiveRoomOffer | null;
  // Host-set flash-timer deadline (projects.pinned_until, ISO). Drives the
  // coral "Ends in M:SS" urgency chip on the offer card. Kept fresh by the
  // page's live-state poll, so a mid-show re-pin updates every viewer.
  pinnedUntil?: string | null;
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

type Heart = { id: number; drift: number; emoji: string; dur: number; right: number };

export function LiveRoom({
  projectId,
  userId,
  userName,
  isOwner,
  auction,
  auctionItem,
  upNext,
  onBidPlaced,
  shop,
  isFollowing,
  followerCount,
  onToggleFollow,
  pinnedOffer,
  pinnedUntil,
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

  // Flash-timer countdown (host-set pinned_until). Same Postgres-to-ISO
  // normalization as the storefront/embed countdowns so all three surfaces
  // agree on the remaining time. Ticks only while a future deadline exists.
  const [flashNow, setFlashNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!pinnedUntil) return;
    setFlashNow(Date.now());
    const t = window.setInterval(() => setFlashNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [pinnedUntil]);
  const flashSecondsLeft = useMemo<number | null>(() => {
    if (!pinnedUntil) return null;
    const iso = pinnedUntil
      .replace(" ", "T")
      .replace(/(\.\d{3})\d+/, "$1")
      .replace(/([+-]\d{2})$/, "$1:00");
    const end = Date.parse(iso);
    if (Number.isNaN(end)) return null;
    const s = Math.floor((end - flashNow) / 1000);
    return s > 0 ? s : 0;
  }, [pinnedUntil, flashNow]);
  const [likeCount, setLikeCount] = useState(0);
  // SOLD splash (Whatnot-parity, 2026-07-04): center-screen celebration
  // when anything sells, driven by the existing item_sold socket event.
  const [soldSplash, setSoldSplash] = useState<string | null>(null);
  const soldTimerRef = useRef<number | null>(null);
  function celebrateSale(title: string) {
    setSoldSplash(title || "Item");
    for (let i = 0; i < 7; i++) {
      window.setTimeout(() => spawnHeart("🎉"), i * 90);
    }
    if (soldTimerRef.current) window.clearTimeout(soldTimerRef.current);
    // 3300ms ≥ the 3.2s sold-cloud animation so the card isn't yanked mid-float.
    soldTimerRef.current = window.setTimeout(() => setSoldSplash(null), 3300);
  }
  const heartSeq = useRef(0);
  const chatWrapRef = useRef<HTMLDivElement | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  // Filled by LiveChatIVS with a function that sends a like over the live
  // socket, so likes are real + shared across viewers (not a local-only
  // animation). The displayed count comes back from the server.
  const likeSenderRef = useRef<(() => void) | null>(null);

  const reactionSenderRef = useRef<((emoji: string) => void) | null>(null);

  function spawnHeart(emoji = "❤️") {
    // Sequential id (not Math.random) keeps keys stable. Reverse rainfall
    // (owner request 2026-07-06): each emoji gets a deterministic sideways
    // drift, launch column and speed so a rapid tap-stream fans out and
    // climbs the full video height at staggered rates instead of stacking.
    heartSeq.current += 1;
    const id = heartSeq.current;
    const drift = ((id * 37) % 90) - 45; // sideways fan, -45..44px
    const right = 12 + ((id * 53) % 88); // launch column, 12..99px from right
    const dur = 2.2 + ((id * 13) % 10) / 10; // 2.2s..3.1s rise
    setHearts((h) => [...h, { id, drift, emoji, dur, right }]);
  }

  function popHeart() {
    // Instant local heart for snappy feedback, then broadcast the like. The
    // count updates from the server's authoritative total (via onLikeCount),
    // and every other viewer floats a heart when our like echoes back.
    spawnHeart();
    likeSenderRef.current?.();
  }

  function focusChat() {
    const el = chatWrapRef.current?.querySelector<HTMLElement>("textarea, input");
    el?.focus();
  }

  // Share targets. Facebook / X / WhatsApp expose real web-share URLs we can
  // link straight to. Instagram and TikTok do NOT — neither lets a website
  // pre-fill a post or DM — so for those the honest path is "copy the link,
  // open the app, paste," which the Copy link button + note below cover.
  const shareUrl = typeof window !== "undefined" ? window.location.href : "";
  const shareText = `Watch ${shop.name} live on DUM Club`;
  const shareTargets = [
    {
      label: "Facebook",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
    },
    {
      label: "X",
      href: `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`,
    },
    {
      label: "WhatsApp",
      href: `https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`,
    },
  ];

  async function copyShareLink() {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2000);
      }
    } catch {
      /* clipboard blocked — nothing to do */
    }
  }

  async function nativeShare() {
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: shop.name, text: shareText, url: shareUrl });
        setShareOpen(false);
      }
    } catch {
      /* user cancelled the OS share sheet — nothing to do */
    }
  }

  // ── Live auction ──
  const [auc, setAuc] = useState<LiveRoomAuction | null>(auction);
  useEffect(() => { setAuc(auction); }, [auction]);
  const [bidding, setBidding] = useState(false);
  const [bidError, setBidError] = useState<string | null>(null);
  // Custom bid entry (Whatnot-parity, 2026-07-04).
  const [customOpen, setCustomOpen] = useState(false);
  const [customVal, setCustomVal] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());

  const aucActive = !!auc && auc.status === "active";
  const aucId = auc?.id;

  // While the auction is active: a 250ms tick for the countdown and a 2.5s
  // poll of the auction endpoint so another buyer's bid shows up in realtime
  // (place_bid doesn't broadcast over the chat socket server-side).
  useEffect(() => {
    if (!aucActive || !aucId) return;
    const tick = setInterval(() => setNowMs(Date.now()), 250);
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auctions/${aucId}`);
        if (res.ok) { const d = await res.json(); if (d?.id) setAuc(d); }
      } catch { /* transient — next tick retries */ }
    }, 2500);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [aucActive, aucId]);

  const aucEndMs = auc
    ? Date.parse(auc.ends_at.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"))
    : NaN;
  const secsLeft = Number.isFinite(aucEndMs) ? Math.max(0, Math.ceil((aucEndMs - nowMs) / 1000)) : null;
  const countdown = secsLeft != null ? `${Math.floor(secsLeft / 60)}:${String(secsLeft % 60).padStart(2, "0")}` : "";
  const currentBid = auc?.current_bid != null ? Number(auc.current_bid) : null;
  const isTopBidder = !!auc?.current_bidder && auc.current_bidder === userId;
  const nextBid = (currentBid != null ? currentBid : auc ? Number(auc.starting_price) : 0) + 1;

  async function placeBid(amountOverride?: number) {
    if (!auc || bidding) return;
    if (!userId) { onRequestSignIn(); return; }
    const amount = amountOverride ?? nextBid;
    setBidding(true);
    setBidError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auctions/${auc.id}/bid`, {
        method: "POST",
        headers: { "Content-Type": "application/json", user_id: userId },
        body: JSON.stringify({ amount }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.auction) setAuc(data.auction);
        onBidPlaced?.(data?.your_display_name || "You", amount);
        setCustomOpen(false);
        setCustomVal("");
      } else {
        const e = await res.json().catch(() => ({}));
        setBidError(typeof e.detail === "string" ? e.detail : "Bid failed");
        // Re-sync so the bid we lost to shows.
        try {
          const r = await fetch(`${API_BASE}/api/auctions/${auc.id}`);
          if (r.ok) { const d = await r.json(); if (d?.id) setAuc(d); }
        } catch { /* ignore */ }
      }
    } catch {
      setBidError("Network error. Try again.");
    } finally {
      setBidding(false);
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
        {/* "Tap for sound" lives at the TOP of the video (TikTok-style),
            clear of the chat input, action rail, offer card, and Buy bar
            that all stack at the bottom (on-air mobile audit 2026-07-03:
            the bottom positions kept colliding as the stack grew). */}
        <IVSStageViewer projectId={projectId} userId={userId} fit="cover" soundPromptClass="top-28" />
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
      <div className={`absolute right-3 z-20 flex flex-col items-center gap-5 ${aucActive ? "bottom-[16.5rem]" : pinnedOffer ? "bottom-[14.5rem]" : "bottom-28"}`}>
        <RailButton
          label={likeCount > 0 ? <span className="text-mint-text">{likeCount.toLocaleString()}</span> : "Like"}
          onClick={popHeart}
          aria-label="Like"
        >
          <svg className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 21s-7.2-4.6-9.6-9.2C.9 8.7 2.3 5.5 5.3 5.1c1.8-.2 3.4.7 4.7 2.2C11.3 5.8 12.9 4.9 14.7 5.1c3 .4 4.4 3.6 2.9 6.7C19.2 16.4 12 21 12 21z" />
          </svg>
        </RailButton>
        {/* Emoji reactions (2026-07-04) — ephemeral, socket-synced. */}
        {(["🔥", "👏", "😂"] as const).map((em) => (
          <button
            key={em}
            type="button"
            aria-label={`React ${em}`}
            onClick={() => {
              spawnHeart(em);
              reactionSenderRef.current?.(em);
            }}
            className="text-2xl drop-shadow-[0_1px_5px_rgba(0,0,0,0.6)] transition active:scale-90"
          >
            {em}
          </button>
        ))}
        {/* Chat rail icon removed (owner decision 2026-07-02): the public
            chat + input are always visible bottom-left, so the icon only
            duplicated something already on screen. Rail is Like + Share. */}
        <div className="relative">
          <RailButton
            label={shareCopied ? <span className="text-mint-text">Copied</span> : "Share"}
            onClick={() => setShareOpen((o) => !o)}
            aria-label="Share"
            aria-haspopup="menu"
            aria-expanded={shareOpen}
          >
            <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </RailButton>
          {shareOpen && (
            <>
              {/* Click-away backdrop. Earlier in DOM order than the menu so the
                  menu paints on top and its links stay clickable. */}
              <button
                type="button"
                aria-label="Close share menu"
                onClick={() => setShareOpen(false)}
                className="fixed inset-0 cursor-default"
              />
              <div
                role="menu"
                className="absolute bottom-0 right-full mr-3 w-44 rounded-2xl border border-white/15 bg-black/85 p-1.5 text-left shadow-xl backdrop-blur-md"
              >
                {shareTargets.map((t) => (
                  <a
                    key={t.label}
                    href={t.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setShareOpen(false)}
                    className="block rounded-lg px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                  >
                    {t.label}
                  </a>
                ))}
                {/* Instagram + TikTok have no web share link, so these copy
                    the link for the user to paste in the app. */}
                {["Instagram", "TikTok"].map((appName) => (
                  <button
                    key={appName}
                    type="button"
                    onClick={() => {
                      copyShareLink();
                      setShareOpen(false);
                    }}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-white transition hover:bg-white/10"
                  >
                    {appName}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    copyShareLink();
                    setShareOpen(false);
                  }}
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Copy link
                </button>
                <button
                  type="button"
                  onClick={nativeShare}
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  More options
                </button>
                <p className="px-3 pb-1 pt-1.5 text-[10px] leading-snug text-white/55">
                  Instagram and TikTok have no web link, so those copy it for you to paste in the app.
                </p>
              </div>
            </>
          )}
        </div>

      </div>

      {/* Reverse rainfall — reactions launch at the bottom of the screen
          and climb the full height of the video (owner request 2026-07-06).
          Full-screen overlay so the travel isn't clipped to the rail. */}
      <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
        {hearts.map((h) => (
          <span
            key={h.id}
            className="float-rise absolute bottom-4 text-2xl"
            style={{
              right: `${h.right}px`,
              ["--drift" as string]: `${h.drift}px`,
              ["--dur" as string]: `${h.dur}s`,
              ["--rise" as string]: "88vh",
            }}
            onAnimationEnd={() => setHearts((list) => list.filter((x) => x.id !== h.id))}
          >
            {h.emoji}
          </span>
        ))}
      </div>

      {/* ── Live chat (overlaid, bottom-left) ──
          Width leaves ~6.75rem clear on the right for the Like/Chat/Share
          rail so the Send button never renders underneath it (72vw alone
          overlapped the rail on narrow phones; spacing audit 2026-07-02). */}
      <div
        ref={chatWrapRef}
        className={`absolute left-2 z-20 w-[min(72vw,calc(100vw-6.75rem))] max-w-sm ${aucActive ? "bottom-[16rem]" : pinnedOffer ? "bottom-[14rem]" : "bottom-24"}`}
      >
        {/* Label so the public broadcast chat reads as distinct from the
            private "Message the shop" DM bubble docked below it. */}
        <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/85 backdrop-blur-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-state-live" />
          Live chat · everyone sees this
        </div>
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
          onItemSold={(data) => {
            celebrateSale(data?.title || "Item");
            onItemSold(data);
          }}
          onItemUpdate={onItemUpdate}
          likeSenderRef={likeSenderRef}
          reactionSenderRef={reactionSenderRef}
          onReaction={(emoji) => spawnHeart(emoji)}
          onLikeCount={(count, animate) => {
            setLikeCount(count);
            // Float a heart for likes from other viewers (our own already
            // floated instantly in popHeart); skip the initial count sync.
            if (animate) spawnHeart();
          }}
        />
      </div>

      {/* ── SOLD cloud — floats up the screen like a cloud when anything
          sells (owner request 2026-07-06; replaces the static splash) ── */}
      {soldSplash && (
        <div className="pointer-events-none absolute inset-x-0 bottom-1/4 z-30 flex justify-center overflow-visible px-6">
          <div className="sold-cloud rounded-[2rem] border border-mint-fill/60 bg-black/80 px-7 py-4 text-center shadow-2xl backdrop-blur-md">
            <div className="text-2xl" aria-hidden="true">🎉</div>
            <div className="mt-1 text-lg font-extrabold uppercase tracking-[0.14em] text-mint-fill">Sold!</div>
            <div className="mt-0.5 max-w-[16rem] truncate text-sm font-semibold text-white">{soldSplash}</div>
          </div>
        </div>
      )}

      {/* ── Auction Bid bar (when a live auction is active) OR Offer + BUY bar ── */}
      {aucActive && auc ? (
        <div className="absolute inset-x-0 bottom-0 z-20 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-md">
            {/* Up next — the shop's other items, real catalog (no fake queue). */}
            {upNext.length > 0 && (
              <div className="mb-2">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/60">
                  Up next · {upNext.length}
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden">
                  {upNext.map((it) => (
                    <span
                      key={it.id}
                      title={it.title}
                      className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/15 bg-black/40"
                    >
                      {it.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={resolveImageUrl(it.image)} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-[11px] font-bold text-white/70">
                          {(it.title.trim().charAt(0) || "•").toUpperCase()}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Current item + current bid + countdown */}
            <div className="mb-2 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/55 p-2.5 text-white shadow-lg backdrop-blur-md">
              {auctionItem?.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={resolveImageUrl(auctionItem.image)} alt="" className="h-14 w-14 flex-shrink-0 rounded-xl object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <span className="mb-0.5 inline-block rounded-full bg-state-live/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-state-live">
                  Live auction
                </span>
                <div className="truncate text-sm font-bold text-white">{auctionItem?.title || "Current item"}</div>
                <div className="flex flex-wrap items-center gap-x-2 text-[11px]">
                  <span className="text-white/60">current bid</span>
                  <span className="font-mono text-base font-extrabold text-white">
                    ${(currentBid != null ? currentBid : Number(auc.starting_price)).toFixed(0)}
                  </span>
                  {isTopBidder ? (
                    <span className="font-bold text-mint-text">· you&apos;re top</span>
                  ) : auc.current_bidder_display ? (
                    <span className="truncate text-white/60">· {auc.current_bidder_display}</span>
                  ) : null}
                </div>
              </div>
              <div className="flex-shrink-0 text-right">
                <div className={`font-mono text-xl font-extrabold ${secsLeft != null && secsLeft <= 10 ? "text-state-live" : "text-white"}`}>
                  {countdown}
                </div>
                <div className="text-[9px] uppercase tracking-wide text-white/50">
                  {auc.bid_count > 0 ? `${auc.bid_count} bid${auc.bid_count === 1 ? "" : "s"} · ending` : "ending"}
                </div>
              </div>
            </div>

            {/* Bid bar (coral — auction urgency) + custom amount entry */}
            {customOpen && secsLeft !== 0 ? (
              <div className="flex items-stretch gap-2">
                <div className="flex flex-1 items-center rounded-2xl bg-white/15 px-3 backdrop-blur-sm">
                  <span className="text-sm font-bold text-white/70">$</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={nextBid}
                    step="1"
                    autoFocus
                    value={customVal}
                    onChange={(e) => setCustomVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const v = Number(customVal);
                        if (v >= nextBid) placeBid(v);
                        else setBidError(`Bid at least $${nextBid.toFixed(0)}`);
                      }
                    }}
                    placeholder={`${nextBid.toFixed(0)} or more`}
                    className="w-full bg-transparent px-2 py-3.5 text-sm font-bold text-white placeholder:text-white/40 outline-none"
                  />
                </div>
                <button
                  type="button"
                  disabled={bidding || Number(customVal) < nextBid}
                  onClick={() => placeBid(Number(customVal))}
                  className="rounded-2xl bg-state-live px-5 text-sm font-extrabold uppercase tracking-[0.08em] text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {bidding ? "…" : "Bid"}
                </button>
                <button
                  type="button"
                  onClick={() => { setCustomOpen(false); setCustomVal(""); setBidError(null); }}
                  aria-label="Cancel custom bid"
                  className="rounded-2xl bg-white/10 px-4 text-sm font-bold text-white transition hover:bg-white/20"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={() => placeBid()}
                  disabled={bidding || secsLeft === 0}
                  className="flex-1 rounded-2xl bg-state-live py-3.5 text-center text-sm font-extrabold uppercase tracking-[0.08em] text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {secsLeft === 0 ? "Auction ended" : bidding ? "Placing…" : `Bid $${nextBid.toFixed(0)}`}
                </button>
                {secsLeft !== 0 && (
                  <button
                    type="button"
                    onClick={() => setCustomOpen(true)}
                    className="rounded-2xl bg-white/15 px-4 text-sm font-bold text-white backdrop-blur-sm transition hover:bg-white/25"
                  >
                    Custom
                  </button>
                )}
              </div>
            )}
            {bidError && <p className="mt-1 text-center text-[11px] text-state-live">{bidError}</p>}
          </div>
        </div>
      ) : pinnedOffer ? (
        // Extra bottom padding keeps the DUM Points line clear of the
        // phone's gesture bar (safe-area + breathing room).
        <div className="absolute inset-x-0 bottom-0 z-20 px-3 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.5rem))]">
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
                  {pinnedOffer.compare_at_price != null &&
                    pinnedOffer.compare_at_price > pinnedOffer.price_usd && (
                      <span className="font-mono text-xs text-white/50 line-through">
                        ${Number(pinnedOffer.compare_at_price).toFixed(2)}
                      </span>
                    )}
                  {typeof remaining === "number" && remaining > 0 && (
                    <span className="rounded-full bg-state-live/20 px-1.5 py-0.5 text-[10px] font-bold text-state-live">
                      {remaining} left
                    </span>
                  )}
                  {/* Host-set flash timer — coral urgency (doctrine: coral is
                      live status + urgency only, and this is exactly that). */}
                  {flashSecondsLeft !== null && flashSecondsLeft > 0 && (
                    <span className="rounded-full bg-state-live/20 px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-state-live">
                      Ends in {Math.floor(flashSecondsLeft / 60)}:{String(flashSecondsLeft % 60).padStart(2, "0")}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* BUY bar. Flash-sale enforcement (founder decision
                2026-07-02): when the host set a timer and it hit zero, the
                sale STOPS — the bar disables until the host re-pins (same
                offer or another, any timer). The regular storefront catalog
                is unaffected; only the live flash window closes. The page's
                live-state poll refreshes pinned_until, so a re-pin re-arms
                every viewer within seconds. */}
            <div className="flex items-center gap-2">
              {flashSecondsLeft === 0 ? (
                <span className="flex-1 rounded-2xl bg-white/15 py-3.5 text-center text-sm font-bold text-white/70">
                  Sale ended · watch for the next drop
                </span>
              ) : isSoldOut ? (
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

            {/* DUM Points earn line — display only (CLAUDE.md §5: no purchase
                flow surfaced). Mirrors the award rule min(50, 10 + floor($/5))
                so the number matches what the webhook actually grants. */}
            {!isSoldOut && flashSecondsLeft !== 0 && (
              <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-white/65">
                <span className="h-1.5 w-1.5 rounded-full bg-dum-live-accent" aria-hidden="true" />
                Earn{" "}
                <span className="font-semibold text-dum-live-accent">
                  +{Math.min(50, 10 + Math.floor(Number(pinnedOffer.price_usd) / 5))} DUM Points
                </span>{" "}
                on this order
              </p>
            )}
          </div>
        </div>
      ) : null}
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
