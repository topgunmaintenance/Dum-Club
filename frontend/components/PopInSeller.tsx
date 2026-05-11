"use client";

/**
 * PopInSeller — small floating bubble UI for the embed page.
 *
 * Pure presentation. The PopInSellerHost owns trigger logic +
 * analytics; this component only renders the bubble + handles user
 * interactions through callback props.
 *
 * MVP shape (Mode C — static poster + greeting + offer chip):
 *   ┌──────────────────────────────────────────┐
 *   │  [avatar]  Welcome to Topgun Maintenance.│  ×
 *   │            Today's featured offer:       │
 *   │            ──────────────────────────    │
 *   │            Full Detail Package  $89  →   │
 *   └──────────────────────────────────────────┘
 *
 * Sits at fixed bottom-right, z-[35] — below the mobile sticky
 * buy bar (z-40) and DumPill (z-[100]), above the embedded chat
 * (z-10). Slide-in on mount, fade-out on dismiss.
 *
 * Mode A (live IVS) and Mode B (recorded video) are deliberately
 * out of scope for this MVP; the host can pass an `avatarUrl` for
 * future poster-frame support without component changes.
 */

import { useEffect, useRef, useState } from "react";

export type PopInOffer = {
  id: string;
  title: string;
  price_usd: number;
};

type PopInSellerProps = {
  greeting: string;
  merchantName: string;
  avatarUrl?: string | null;
  offer: PopInOffer | null;
  onOfferClick: () => void;
  onDismiss: () => void;
  /** When false, drops the fixed-position chrome + slide-in animation
   *  so the same component can be rendered inline (e.g. as a preview
   *  inside the merchant dashboard's PopInSettings). Defaults to true
   *  for the production embed use. */
  floating?: boolean;
  /** Optional recorded video URL. When present, the bubble renders a
   *  16:9 muted + playsInline + loop <video> tile above the greeting
   *  in place of the static avatar. Tap to unmute. Backend sanitizer
   *  enforces http(s) only — frontend trusts the URL is safe. */
  videoUrl?: string | null;
  /** Fires when the bubble first shows with a video — used by the
   *  host to emit popin_video_view. */
  onVideoVisible?: () => void;
  /** Fires when the visitor explicitly interacts with the video to
   *  unmute (the user-gesture moment iOS / Safari require). */
  onVideoPlay?: () => void;
  /** Fires on any click of the video tile. Separate from onVideoPlay
   *  so future affordances (expand) can be distinguished. */
  onVideoClick?: () => void;
};

export function PopInSeller({
  greeting,
  merchantName,
  avatarUrl,
  offer,
  onOfferClick,
  onDismiss,
  floating = true,
  videoUrl = null,
  onVideoVisible,
  onVideoPlay,
  onVideoClick,
}: PopInSellerProps) {
  // Slide-in animation gate. We render `mounted=false` for one frame
  // so the initial transform applies before transitioning to the
  // resting position. Skipped in inline (preview) mode so the
  // dashboard preview is static.
  const [mounted, setMounted] = useState(!floating);
  useEffect(() => {
    if (!floating) return;
    const id = window.setTimeout(() => setMounted(true), 16);
    return () => window.clearTimeout(id);
  }, [floating]);

  // Video unmute state. iOS / Safari / Chrome block autoplay with
  // audio, so the <video> starts muted=true and only unmutes after
  // an explicit user gesture (tap on the video tile or its overlay
  // unmute affordance). Once unmuted, we don't re-mute on subsequent
  // taps — that would surprise the user.
  const [videoMuted, setVideoMuted] = useState(true);
  const [videoErrored, setVideoErrored] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Fire popin_video_view exactly once when the bubble shows WITH a
  // video and the video hasn't errored. Parallel to the host's
  // popin_view; the funnel summary can compare video vs static
  // impressions.
  const sawVideoRef = useRef(false);
  useEffect(() => {
    if (!floating) return;
    if (!videoUrl) return;
    if (videoErrored) return;
    if (sawVideoRef.current) return;
    sawVideoRef.current = true;
    onVideoVisible?.();
  }, [floating, videoUrl, videoErrored, onVideoVisible]);

  const handleVideoTap = () => {
    onVideoClick?.();
    if (videoMuted) {
      setVideoMuted(false);
      onVideoPlay?.();
      // Some browsers don't auto-resume muted-paused → audible-paused
      // on the mute toggle alone. Kick playback explicitly. Silently
      // swallow the promise rejection that fires when the play call
      // races with an existing playing state.
      const v = videoRef.current;
      if (v) {
        v.muted = false;
        const p = v.play();
        if (p && typeof p.catch === "function") {
          p.catch(() => {});
        }
      }
    }
  };

  const showVideo = Boolean(videoUrl) && !videoErrored;

  return (
    <div
      role="dialog"
      aria-label={`Greeting from ${merchantName}`}
      className={[
        floating
          ? "pointer-events-auto fixed bottom-20 right-4 z-[35]"
          : "pointer-events-auto relative",
        "w-[320px] max-w-[calc(100vw-2rem)]",
        "rounded-2xl border border-default bg-surface-card shadow-[0_12px_40px_rgba(11,18,32,0.18)] backdrop-blur-md",
        floating ? "transition-all duration-300 ease-out" : "",
        floating
          ? mounted
            ? "translate-y-0 opacity-100"
            : "translate-y-3 opacity-0"
          : "",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-secondary transition hover:bg-surface-muted hover:text-primary"
      >
        ×
      </button>

      {/* When a video is configured we render a 16:9 tile across the
           full bubble width above the greeting + offer chip. The
           static avatar / initials variant stays for Mode A (bubble
           default) — same row layout as PR #133. */}
      {showVideo ? (
        <div className="px-4 pt-4 pr-9">
          <div
            role="button"
            tabIndex={0}
            aria-label={
              videoMuted
                ? "Tap to unmute video"
                : `Video from ${merchantName}`
            }
            onClick={handleVideoTap}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleVideoTap();
              }
            }}
            className="relative aspect-video w-full cursor-pointer overflow-hidden rounded-xl border border-default bg-surface-muted"
          >
            <video
              ref={videoRef}
              src={videoUrl ?? undefined}
              autoPlay
              muted={videoMuted}
              playsInline
              loop
              preload="metadata"
              onError={() => setVideoErrored(true)}
              className="h-full w-full object-cover"
            />
            {/* Mute / unmute affordance — small pill at the bottom-
                 right of the tile. Hidden once unmuted so the tile
                 reads as ambient video. */}
            {videoMuted && (
              <span
                className="pointer-events-none absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-brand-navy/85 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white"
                aria-hidden="true"
              >
                Tap to unmute
              </span>
            )}
          </div>
        </div>
      ) : null}

      <div className={`flex items-start gap-3 p-4 pr-9 ${showVideo ? "pt-3" : ""}`}>
        {!showVideo && (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-default bg-brand-teal-soft">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt=""
                aria-hidden="true"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-sm font-bold text-brand-navy">
                {initialsOf(merchantName)}
              </span>
            )}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug text-primary">{greeting}</p>

          {offer ? (
            <button
              type="button"
              onClick={onOfferClick}
              className="mt-3 flex w-full items-center justify-between gap-3 rounded-xl border border-default bg-brand-teal-soft px-3 py-2.5 text-left transition hover:border-brand-teal"
            >
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-teal">
                  Featured offer
                </div>
                <div className="mt-0.5 truncate text-sm font-semibold text-brand-navy">
                  {offer.title}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-sm font-bold text-brand-navy">
                  ${offer.price_usd.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
                <div className="text-[10px] font-semibold text-brand-teal">
                  View →
                </div>
              </div>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
