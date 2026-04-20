import { NextRequest, NextResponse } from "next/server";

/**
 * Stripe Connect OAuth redirect landing.
 *
 * Stripe's dashboard is configured with this exact URL as the redirect
 * target. Stripe hard-requires the `redirect_uri` OAuth parameter to
 * match a registered URI verbatim — that's why the backend sends
 * `https://dum.club/api/stripe/oauth/callback` as `redirect_uri` when
 * building the authorize URL.
 *
 * This handler exists purely to satisfy that URI contract without
 * abandoning the hardened security pattern on the callback. Rather
 * than handle the token exchange here (which would force us to drop
 * the Privy bearer check, since browser navigations from Stripe can't
 * carry Authorization headers), we 302-redirect to the existing
 * frontend callback page at `/merchant/stripe-callback`. That page
 * then does an authenticated `fetch` to the backend's hardened
 * callback endpoint with the Privy bearer token, preserving the
 * two-layer defense (auth + HMAC state) already in place.
 *
 * Security notes:
 * - No code exchange or secret handling happens here. All secrets
 *   stay backend-only.
 * - The `code` and `state` query params pass through unchanged so
 *   HMAC state verification on the backend still works.
 * - Uses `req.url` to build the absolute redirect so we stay on the
 *   same host (dum.club stays on dum.club, preview deploys stay on
 *   their preview host).
 */
export async function GET(req: NextRequest) {
  const incoming = req.nextUrl;
  const code = incoming.searchParams.get("code");
  const state = incoming.searchParams.get("state");
  const error = incoming.searchParams.get("error");
  const errorDescription = incoming.searchParams.get("error_description");

  const next = new URL("/merchant/stripe-callback", req.url);

  // Forward every relevant OAuth param exactly as Stripe supplied it.
  // Missing code/state is an error case the frontend page already
  // surfaces clearly ("Missing authorization code"), so no special
  // handling needed here.
  if (code) next.searchParams.set("code", code);
  if (state) next.searchParams.set("state", state);
  if (error) next.searchParams.set("error", error);
  if (errorDescription) next.searchParams.set("error_description", errorDescription);

  return NextResponse.redirect(next, { status: 302 });
}
