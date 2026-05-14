"use client";

/**
 * /embed/bubble/[businessId]
 *
 * Lightweight IVS-only viewer for the host-site circular bubble.
 *
 * The merchant's website (e.g. topgunmaintenance.com) loads
 * `frontend/public/embed.js`, which renders a circular `<iframe>`
 * pointing here whenever `is_live === true`. This route is the
 * minimum payload that lets us mount one IVS Stage participant
 * subscription per visitor without dragging the full embed shell
 * (chat + offers + checkout + websockets) onto every merchant
 * page-load. The full overlay still loads `/embed/[businessId]`
 * — that contract is preserved.
 *
 * What this page renders:
 *   - When `is_live` and an IVS stage exists: the existing
 *     `IVSStageViewer` filling the viewport, `object-fit: cover`,
 *     muted by default. The host-side circular clip on embed.js
 *     gives the rendered video its circular shape.
 *   - When the merchant goes offline: a poster image (or initials)
 *     so the bubble stays branded without a black square.
 *
 * postMessage protocol with the embed.js host page:
 *   - Outbound `{ type: "bubble-live-state", live: boolean }` —
 *     fires after embed-config resolves so the host can paint the
 *     gold ring conditionally.
 *   - Inbound  `{ type: "bubble-pause" }`  — tear down the IVS
 *     Stage so opening the full overlay doesn't double-count
 *     against `MAX_VIEWERS_PER_STREAM` on the backend.
 *   - Inbound  `{ type: "bubble-resume" }` — re-mount the viewer
 *     when the overlay closes.
 *
 * Hard requirements:
 *   - Never render DUM Club chrome (no Navbar / Footer). The
 *     iframe is layered inside the merchant's own visual bubble.
 *   - Never autoplay audio. The viewer mounts muted; visitors
 *     unmute by clicking through to the full overlay.
 *   - Soft-fail every network call: a 404 / 500 leaves the bubble
 *     showing the offline poster, never an error message visible
 *     on the merchant's site.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { API_BASE } from "../../../../lib/apiBase";

const IVSStageViewer = dynamic(
  () =>
    import("../../../../components/IVSStageViewer").then((m) => ({
      default: m.IVSStageViewer,
    })),
  { ssr: false },
);

type BubbleConfig = {
  id: string | null;
  is_live: boolean;
  ivs_stage_arn: string | null;
  live_provider: string | null;
  popin_config?: {
    title?: string;
    avatar_url?: string;
    poster_url?: string;
  } | null;
};

export default function BubblePreviewPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = params?.businessId || "";

  const [config, setConfig] = useState<BubbleConfig | null>(null);
  const [paused, setPaused] = useState<boolean>(false);

  // Anonymous viewer id — same shape as the full embed page so the
  // backend's per-viewer rate limiting + viewer-count buckets stay
  // consistent across the bubble and the overlay. Lives in
  // sessionStorage so a refresh inside the same tab keeps the slot.
  const [anonId, setAnonId] = useState<string>("");
  useEffect(() => {
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
      setAnonId(`anon-${Math.random().toString(36).slice(2, 10)}`);
    }
  }, [businessId]);

  // Fetch embed-config to learn whether the merchant is live and
  // which IVS stage to subscribe to. Soft-fail to "offline" on any
  // error — this page must never render an error visible to the
  // merchant's visitors.
  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/projects/${encodeURIComponent(businessId)}/embed-config`,
          { method: "GET", credentials: "omit" },
        );
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as BubbleConfig;
        if (!cancelled) setConfig(data);
      } catch {
        if (!cancelled) {
          setConfig({
            id: null,
            is_live: false,
            ivs_stage_arn: null,
            live_provider: null,
            popin_config: null,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  // Tell the host-page embed.js when we know the live state so it
  // can paint the gold ring conditionally without a second fetch.
  useEffect(() => {
    if (!config) return;
    if (typeof window === "undefined") return;
    try {
      window.parent.postMessage(
        { type: "bubble-live-state", live: !!config.is_live },
        "*",
      );
    } catch {
      // no-op — host page may be opaque to us
    }
  }, [config]);

  // Push the active-offer list up to embed.js via postMessage.
  // This bypasses the host-page embed-config dependency for the
  // product stack: even if the merchant origin is hitting a stale
  // Railway backend that doesn't return active_offers, this
  // route is same-origin to dum.club and can hit /api/offers
  // directly. embed.js's onBubbleMessage handler builds the
  // product panel from this payload when it didn't already get
  // one from embed-config.
  useEffect(() => {
    if (!config?.id) return;
    if (typeof window === "undefined") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/offers/${encodeURIComponent(config.id!)}`,
          { method: "GET", credentials: "omit" },
        );
        if (!res.ok) return;
        const raw = await res.json();
        if (cancelled || !Array.isArray(raw)) return;
        // Reshape into the same { id, title, price_usd,
        // quantity_remaining } contract the embed-config server
        // path emits, so embed.js consumes both paths with one
        // builder. Cap at 3. Filter out untitled / inactive rows
        // defensively (the endpoint already filters is_active
        // server-side but we re-check here as belt-and-suspenders).
        const active = raw
          .filter(
            (o: any) =>
              o &&
              typeof o === "object" &&
              o.is_active !== false &&
              typeof o.title === "string" &&
              o.title.trim().length > 0,
          )
          .slice(0, 3)
          .map((o: any) => {
            const priceRaw = o.price_usd;
            const priceNum =
              typeof priceRaw === "number"
                ? priceRaw
                : typeof priceRaw === "string"
                  ? parseFloat(priceRaw)
                  : null;
            let qr: number | null = null;
            if (o.unlimited_inventory !== true) {
              const qa =
                typeof o.quantity_available === "number"
                  ? o.quantity_available
                  : null;
              const qs =
                typeof o.quantity_sold === "number" ? o.quantity_sold : 0;
              if (qa !== null) qr = Math.max(0, qa - qs);
            }
            return {
              id: o.id,
              title: o.title,
              price_usd:
                typeof priceNum === "number" && isFinite(priceNum)
                  ? priceNum
                  : null,
              quantity_remaining: qr,
            };
          });
        try {
          window.parent.postMessage(
            { type: "bubble-offers", active_offers: active },
            "*",
          );
        } catch {
          // no-op — opaque parent
        }
      } catch {
        // Soft-fail. The host page already has its own
        // active_offers path via embed-config; if both this
        // fetch and that one fail, the bubble simply shows
        // no commerce surface — never an error.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config?.id]);

  // Listen for pause / resume so the full overlay can claim the
  // single viewer slot per visitor.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onMessage(ev: MessageEvent) {
      const data = ev.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "bubble-pause") setPaused(true);
      else if (data.type === "bubble-resume") setPaused(false);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const ivsActive =
    !!config &&
    config.is_live &&
    config.live_provider === "ivs_realtime" &&
    !!config.ivs_stage_arn &&
    !!config.id;

  const popin = config?.popin_config || {};
  const posterUrl =
    (typeof popin.poster_url === "string" && popin.poster_url) ||
    (typeof popin.avatar_url === "string" && popin.avatar_url) ||
    "";
  const merchantTitle =
    (typeof popin.title === "string" && popin.title.trim()) ||
    businessId
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  const initials =
    merchantTitle
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join("") || "•";

  // Body styles — the iframe consumer sees only what's painted
  // here, so we want full-bleed black with no scrollbars and no
  // inherited body margin. Doing this inline (instead of touching
  // globals.css) keeps the rule scoped to this route alone.
  return (
    <>
      <style jsx global>{`
        html,
        body {
          margin: 0;
          padding: 0;
          background: #060606;
          width: 100%;
          height: 100%;
          overflow: hidden;
        }
      `}</style>

      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#060606",
          overflow: "hidden",
        }}
        aria-label={`${merchantTitle} live preview`}
      >
        {ivsActive && !paused ? (
          // The IVSStageViewer renders its own 16:9 video element
          // by default. We override the visible bounds with a
          // wrapper that stretches the video to a square crop so
          // the host-side circular clip on embed.js produces a
          // clean circle without letterboxing.
          <div
            style={{
              position: "absolute",
              inset: 0,
              // object-fit on the inner <video> handles aspect
              // mismatch; the wrapper just gives it a square box
              // to fill.
            }}
          >
            <BubbleIVSWrapper
              projectId={config!.id!}
              userId={anonId}
            />
          </div>
        ) : posterUrl ? (
          <img
            src={posterUrl}
            alt=""
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(135deg, #00d1a4 0%, #00ffa3 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#0b2545",
              fontFamily:
                "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
              fontWeight: 700,
              // Roughly track the host-side bubble diameters
              // (140px desktop, 96px mobile). The iframe rescales
              // with the bubble so this clamp stays readable on
              // both.
              fontSize: "clamp(28px, 28vw, 56px)",
              letterSpacing: "0.02em",
              userSelect: "none",
            }}
            aria-hidden="true"
          >
            {initials}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Square crop of `IVSStageViewer`. The shared component renders a
 * 16:9 box with `aspect-ratio: 16/9` baked in; here we override
 * the surrounding bounds and let `object-fit: cover` on the inner
 * video crop the centre of the frame to fill the square. That
 * combined with a `border-radius: 50%; overflow: hidden` parent
 * on the host site is what produces a true circle.
 *
 * No additional IVS subscription happens here — the viewer's
 * module-level `_activeStageProjectId` guard ensures the bubble
 * route only ever holds one Stage participant at a time per
 * project per iframe.
 */
function BubbleIVSWrapper({
  projectId,
  userId,
}: {
  projectId: string;
  userId: string;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        // Hide the IVSStageViewer's own rounded border / status
        // overlays so the host-side circular clip is the only
        // visible chrome.
      }}
    >
      <style jsx>{`
        div :global(div[style*="border"]) {
          border: 0 !important;
          border-radius: 0 !important;
          background: transparent !important;
        }
        div :global(video) {
          width: 100% !important;
          height: 100% !important;
          min-height: 0 !important;
          aspect-ratio: auto !important;
          object-fit: cover !important;
        }
      `}</style>
      <IVSStageViewer projectId={projectId} userId={userId} />
    </div>
  );
}
