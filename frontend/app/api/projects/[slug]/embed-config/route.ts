import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "../../../../../lib/ai/supabase-service";

/**
 * GET /api/projects/{slug}/embed-config
 *
 * Public read powering the DUM Club embed bubble on third-party
 * merchant sites (e.g. https://www.topgunmaintenance.com loads
 * https://dum.club/embed.js, which then hits this endpoint to
 * pull the merchant's dashboard-saved Pop-In Seller settings).
 *
 * Mirrors the FastAPI backend route of the same name at
 * backend/api/routes/projects.py:get_embed_config. Both are kept
 * in sync because embed.js targets the script-origin host
 * (dum.club = Vercel), which lacks a generic /api/* proxy back
 * to Railway — every public endpoint embed.js touches must have
 * a corresponding Next.js route handler.
 *
 * Resilience contract:
 *   This endpoint MUST NOT 5xx. embed.js loads on third-party
 *   merchant sites; an upstream 5xx collapses the embed into a
 *   confusing failure mode (the v1 bug that made the topgun
 *   bubble disappear). Any unexpected Supabase error
 *   soft-degrades to a 200 with conservative defaults. Real
 *   "project not found" still returns 404 — that's a slug or
 *   snippet mistake, not transient infra.
 *
 * Response shape — every field is included in BOTH camelCase
 * (the dashboard-shaped contract) and snake_case (so the
 * existing embed.js readers that grab popin_config.greeting
 * etc. keep working without a same-PR client change).
 */

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function corsHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  // Wildcard ACAO: this endpoint is intentionally public so any
  // merchant origin can read it. No auth, no cookies consulted,
  // allow-credentials NOT set (browsers reject "*" ACAO when
  // credentials are included).
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extra,
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

function coerceDelaySeconds(value: unknown): number {
  // Clamp the merchant-supplied delay into [0, 60]. Default to 0
  // when missing, non-numeric, or out of range — a malformed write
  // shouldn't strand the embed waiting forever.
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 60) return 60;
  return Math.floor(n);
}

function softFallback(slug: string, reason: string) {
  // Log slug + reason so Vercel logs capture the real cause without
  // leaking an exception to the merchant's page.
  console.warn(`[embed-config] soft-degraded slug=${slug} reason=${reason}`);
  return NextResponse.json(
    {
      // Schema fingerprint — bump whenever fields change. Lets a
      // curl against production confirm the shim ran:
      //   curl ... | grep schema_version  →  "v1.7"
      schema_version: "v1.7",
      // Identifiers (camelCase + snake_case mirrors)
      projectSlug: slug,
      businessSlug: slug,
      id: null,
      slug,
      // No row available; surface the slug as the visible identity
      // line so the bubble doesn't render blank.
      title: slug,
      // Outer embed display mode — automatic is the safest default
      // because embed.js falls back to bubble on its own when this
      // endpoint can't load.
      displayMode: "automatic",
      embed_display_mode: "automatic",
      // Pop-in defaults
      popInEnabled: true,
      firstVisitGreeting: "",
      returningVisitorGreeting: "",
      displayDelaySeconds: 0,
      showOncePerSession: false,
      popinMode: "bubble",
      popin_config: {
        enabled: true,
        greeting: "",
        returning_greeting: "",
        delay_seconds: 0,
        once_per_session: false,
        offer_id: null,
        mode: "bubble",
        video_url: null,
      },
      // Public live-state booleans
      is_live: false,
      live_provider: null,
      ivs_stage_arn: null,
      pinned_offer_id: null,
      pinned_until: null,
      // Commerce surface fields (mirror Railway's shape — v1.7).
      // Soft-degraded path emits empty/null values; the bubble
      // gracefully treats these as "no commerce surface" and
      // shows just the bubble itself.
      pinned_offer: null,
      active_offers: [],
      live_session: null,
      viewer_count: 0,
      degraded: true,
    },
    {
      status: 200,
      // Shorter cache window on degraded responses so a recovery
      // is picked up quickly without thundering-herd retries.
      headers: corsHeaders({ "Cache-Control": "public, max-age=30" }),
    },
  );
}

function notFound(slug: string) {
  console.warn(`[embed-config] not_found slug=${slug}`);
  return NextResponse.json(
    {
      error: "Project not found",
      projectSlug: slug,
      slug,
    },
    {
      status: 404,
      headers: corsHeaders({ "Cache-Control": "no-store" }),
    },
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug: rawSlug } = await params;
  const slug = (rawSlug || "").trim();
  if (!slug) return notFound(rawSlug || "");

  let supabase;
  try {
    supabase = getServiceClient();
  } catch (e: unknown) {
    const name = e instanceof Error ? e.name : "unknown";
    return softFallback(slug, `supabase_init:${name}`);
  }

  // Slug-or-UUID resolution. The <script data-business-id="..."> on
  // the merchant site might be either form; mirror the FastAPI
  // resolver in backend/api/routes/projects.py:resolve_project_uuid.
  const isUuid = UUID_RE.test(slug);

  try {
    const base = supabase
      .from("projects")
      .select(
        // title is included so the embed bubble can render the
        // merchant's name as identity (e.g. "Topgun Maintenance").
        // The bubble falls back to the slug + a derived initial
        // when title is null/empty, so this select staying string-
        // shaped is correctness-preserving for older rows.
        "id, slug, title, embed_display_mode, is_live, live_provider, ivs_stage_arn, pinned_offer_id, pinned_until, popin_config",
      )
      .eq("is_deleted", false)
      .limit(1);

    const { data, error } = await (isUuid
      ? base.eq("id", slug)
      : base.eq("slug", slug));

    if (error) {
      return softFallback(
        slug,
        `projects_select:${error.code || error.message || "unknown"}`,
      );
    }
    if (!data || data.length === 0) {
      return notFound(slug);
    }

    const row = data[0];
    const popin =
      row.popin_config && typeof row.popin_config === "object"
        ? (row.popin_config as Record<string, unknown>)
        : {};

    const popInEnabled = popin.enabled !== false;
    const firstVisitGreeting =
      typeof popin.greeting === "string" ? popin.greeting : "";
    const returningVisitorGreeting =
      typeof popin.returning_greeting === "string"
        ? popin.returning_greeting
        : "";
    const displayDelaySeconds = coerceDelaySeconds(popin.delay_seconds);
    const showOncePerSession = popin.once_per_session === true;
    const popinMode =
      typeof popin.mode === "string" && popin.mode.length > 0
        ? popin.mode
        : "bubble";
    const displayMode = row.embed_display_mode || "automatic";

    // ── Commerce surface (v1.7) ────────────────────────────
    // Resolve pinned_offer + active_offers (up to 3) via a
    // single Supabase query. The Railway FastAPI path does the
    // same join in backend/api/routes/projects.py — this shim
    // mirrors that contract so embed.js can rely on identical
    // shape regardless of which origin serves the response.
    let pinnedOffer: {
      id: string;
      title: string;
      price_usd: number | null;
    } | null = null;
    let activeOffers: Array<{
      id: string;
      title: string;
      price_usd: number | null;
      quantity_remaining: number | null;
      pinned: boolean;
    }> = [];
    try {
      const offersRes = await supabase
        .from("offers")
        .select(
          "id, title, price_usd, quantity_available, quantity_sold, unlimited_inventory",
        )
        .eq("project_id", row.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(4);
      const offers = offersRes.data || [];
      // Pinned first, then most-recent. Dedupe the pinned id
      // from the latest-4 window without a second round trip.
      const ordered: typeof offers = [];
      if (row.pinned_offer_id) {
        const p = offers.find((o) => o.id === row.pinned_offer_id);
        if (p) ordered.push(p);
      }
      for (const o of offers) {
        if (o.id === row.pinned_offer_id) continue;
        ordered.push(o);
        if (ordered.length >= 3) break;
      }
      const top = ordered.slice(0, 3);
      activeOffers = top.map((o) => {
        const priceRaw = o.price_usd;
        const priceNum =
          typeof priceRaw === "number"
            ? priceRaw
            : typeof priceRaw === "string"
              ? parseFloat(priceRaw)
              : null;
        let qr: number | null = null;
        if (!o.unlimited_inventory) {
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
          title: o.title || "",
          price_usd:
            typeof priceNum === "number" && Number.isFinite(priceNum)
              ? priceNum
              : null,
          quantity_remaining: qr,
          pinned: !!(row.pinned_offer_id && o.id === row.pinned_offer_id),
        };
      });
      if (row.pinned_offer_id) {
        const pin = activeOffers.find((o) => o.pinned);
        if (pin) {
          pinnedOffer = {
            id: pin.id,
            title: pin.title,
            price_usd: pin.price_usd,
          };
        }
      }
    } catch {
      // Soft fail — commerce surface drops out, rest of the
      // bubble still loads.
      activeOffers = [];
      pinnedOffer = null;
    }

    // ── Live presence (viewer_count + remaining_seconds) ───
    // These live in Railway's in-process state (chat WS counters
    // + stream-duration tracker). Vercel can't compute them; fetch
    // from Railway with a tight timeout and degrade gracefully if
    // the call fails. Only attempt when the project is live —
    // saves a cross-origin hop on every offline embed-config call.
    let liveSession: { remaining_seconds: number; viewer_count: number } | null = null;
    let topLevelViewerCount = 0;
    if (row.is_live) {
      const railwayBase = (
        process.env.NEXT_PUBLIC_API_URL ||
        process.env.BACKEND_API_URL ||
        ""
      ).replace(/\/+$/, "");
      if (railwayBase) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 1200);
          const r = await fetch(
            `${railwayBase}/api/projects/${encodeURIComponent(row.id)}/live-status`,
            { signal: controller.signal },
          );
          clearTimeout(timeoutId);
          if (r.ok) {
            const live = (await r.json()) as {
              viewer_count?: number;
              remaining_seconds?: number;
            };
            const vc =
              typeof live.viewer_count === "number" ? live.viewer_count : 0;
            const rs =
              typeof live.remaining_seconds === "number"
                ? live.remaining_seconds
                : 0;
            topLevelViewerCount = vc;
            if (rs > 0 || vc > 0) {
              liveSession = { remaining_seconds: rs, viewer_count: vc };
            }
          }
        } catch {
          // Timeout or network error — leave liveSession null.
          // The bubble silently drops the countdown + viewer chip.
        }
      }
    }

    console.info(
      `[embed-config] ok slug=${slug} project_id=${row.id} ` +
        `display_mode=${displayMode} popin_enabled=${popInEnabled} ` +
        `popin_mode=${popinMode}`,
    );

    return NextResponse.json(
      {
        // Schema fingerprint — bumped whenever the response
        // shape changes. v1.7 added pinned_offer, active_offers,
        // live_session, viewer_count.
        schema_version: "v1.7",
        // Identifiers
        projectSlug: row.slug ?? slug,
        businessSlug: row.slug ?? slug,
        id: row.id,
        slug: row.slug ?? slug,
        // Human-friendly merchant name. The embed bubble renders
        // this as the identity line; falls back to the slug
        // server-side so the bubble never displays a blank.
        title: row.title || row.slug || slug,
        // Outer embed display mode (bubble / full / automatic)
        displayMode,
        embed_display_mode: displayMode,
        // Pop-in seller payload — camelCase aliases for the
        // dashboard-shaped contract listed in the task spec, plus
        // the existing popin_config snake-case block embed.js
        // already reads.
        popInEnabled,
        firstVisitGreeting,
        returningVisitorGreeting,
        displayDelaySeconds,
        showOncePerSession,
        popinMode,
        popin_config: {
          enabled: popInEnabled,
          greeting: firstVisitGreeting,
          returning_greeting: returningVisitorGreeting,
          delay_seconds: displayDelaySeconds,
          once_per_session: showOncePerSession,
          offer_id: popin.offer_id ?? null,
          mode: popinMode,
          video_url: popin.video_url ?? null,
        },
        // Public live-state booleans
        is_live: !!row.is_live,
        live_provider: row.live_provider ?? null,
        ivs_stage_arn: row.ivs_stage_arn ?? null,
        pinned_offer_id: row.pinned_offer_id ?? null,
        pinned_until: (() => {
          const raw = row.pinned_until;
          if (!raw) return null;
          const t = Date.parse(String(raw).replace(" ", "T"));
          if (Number.isNaN(t) || t <= Date.now()) return null;
          return raw;
        })(),
        // Commerce surface (v1.7) — mirrors Railway's shape so
        // embed.js consumes both origins identically.
        pinned_offer: pinnedOffer,
        active_offers: activeOffers,
        // Live presence — null when offline or Railway is
        // unreachable. Bubble + Discover treat null/0 as
        // "no live signal" and skip the countdown / viewer
        // chip silently.
        live_session: liveSession,
        viewer_count: topLevelViewerCount,
      },
      {
        status: 200,
        // 2s cache so a Go-Live transition surfaces to embed-bubble
        // viewers within ~2-3s of the backend state flip, instead of
        // up to 15-45s previously (15s cache + 30s offline poll in
        // embed.js). Vercel CDN still absorbs the load: with the
        // bubble polling at 3s while offline, viewers within the same
        // 2s window share one origin fetch and the rest are edge hits.
        // The optional Railway live-status fetch inside this handler
        // only fires when is_live=true, so the offline path stays
        // cheap even at the tighter cadence.
        headers: corsHeaders({ "Cache-Control": "public, max-age=2" }),
      },
    );
  } catch (e: unknown) {
    const name = e instanceof Error ? e.name : "unknown";
    return softFallback(slug, `query_threw:${name}`);
  }
}
