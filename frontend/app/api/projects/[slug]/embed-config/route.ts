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
      // Identifiers (camelCase + snake_case mirrors)
      projectSlug: slug,
      businessSlug: slug,
      id: null,
      slug,
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
        "id, slug, embed_display_mode, is_live, live_provider, ivs_stage_arn, pinned_offer_id, popin_config",
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

    console.info(
      `[embed-config] ok slug=${slug} project_id=${row.id} ` +
        `display_mode=${displayMode} popin_enabled=${popInEnabled} ` +
        `popin_mode=${popinMode}`,
    );

    return NextResponse.json(
      {
        // Identifiers
        projectSlug: row.slug ?? slug,
        businessSlug: row.slug ?? slug,
        id: row.id,
        slug: row.slug ?? slug,
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
      },
      {
        status: 200,
        headers: corsHeaders({ "Cache-Control": "public, max-age=60" }),
      },
    );
  } catch (e: unknown) {
    const name = e instanceof Error ? e.name : "unknown";
    return softFallback(slug, `query_threw:${name}`);
  }
}
