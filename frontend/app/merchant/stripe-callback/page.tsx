"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { API_BASE } from "../../../lib/apiBase";
import { useAuth } from "../../../lib/auth/AuthContext";

/**
 * Stripe Connect OAuth landing page (client-side arm).
 *
 * The Stripe dashboard redirect URI is `/api/stripe/oauth/callback`
 * (handled by a thin Next.js route handler that 302s here while
 * preserving `code`, `state`, and any Stripe error params). This page
 * then does the authenticated handoff to the hardened backend
 * endpoint.
 *
 * UX contract with the rest of the merchant surface:
 *   - Success → router.replace("/merchant?stripe=connected")
 *   - Any failure → router.replace("/merchant?stripe=error&reason=<code>")
 * The `/merchant` page reads that query param and shows a banner, then
 * cleans the URL so a refresh doesn't re-trigger it.
 *
 * Failure reasons emitted (stable identifiers the `/merchant` page
 * can map to user-friendly copy without Stripe-specific knowledge):
 *   missing_code       - Stripe returned no `code`; usually a
 *                        redirect-chain bug or Stripe error
 *   missing_state      - `state` was stripped between Stripe and us;
 *                        most common real-world failure
 *   stripe_denied      - Stripe sent back `?error=access_denied` etc
 *                        (e.g. user clicked Cancel in Stripe onboarding)
 *   not_signed_in      - User's Privy session didn't rehydrate before
 *                        we tried to call the backend
 *   no_auth_token      - getToken() returned null despite a user
 *                        object (very rare; indicates Privy SDK issue)
 *   backend_error      - Backend callback returned non-2xx; detail
 *                        logged to console for forensics
 *   network_error      - Fetch threw (offline, CORS, Railway down)
 */
function StripeCallbackInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { getToken, loading: authLoading, user } = useAuth();
  const [statusLine, setStatusLine] = useState("Setting up your payments…");
  const [inFlight, setInFlight] = useState(false);

  useEffect(() => {
    // Wait for Privy to rehydrate the session after Stripe's browser
    // redirect. Without this, getToken() returns null and the backend
    // correctly rejects the request.
    if (authLoading) return;
    if (inFlight) return;

    const code = params.get("code");
    const state = params.get("state");
    const stripeError = params.get("error");
    const stripeErrorDescription = params.get("error_description");

    // Diagnostic: log exactly what arrived so browser DevTools (and
    // any support session) can see what was missing, not just the
    // post-fact redirect URL.
    console.log("[stripe-callback] landed", {
      code_present: Boolean(code),
      state_present: Boolean(state),
      stripe_error: stripeError ?? null,
      stripe_error_description: stripeErrorDescription ?? null,
      auth_user_present: Boolean(user),
    });

    // 1. Stripe-originated refusal (user clicked Cancel, or their
    //    account isn't eligible, etc). Stripe returns error+description
    //    instead of code+state.
    if (stripeError) {
      console.warn(
        "[stripe-callback] stripe returned error",
        stripeError,
        stripeErrorDescription,
      );
      setStatusLine("Stripe declined the connection. Taking you back…");
      router.replace(
        `/merchant?stripe=error&reason=stripe_denied&code=${encodeURIComponent(
          stripeError,
        )}`,
      );
      return;
    }

    // 2. Discriminated missing-param errors — previously both
    //    conditions produced the misleading "Missing authorization
    //    code" message even when the actual missing piece was state.
    if (!code) {
      console.warn("[stripe-callback] code missing from URL");
      router.replace("/merchant?stripe=error&reason=missing_code");
      return;
    }
    if (!state) {
      console.warn("[stripe-callback] state missing from URL");
      router.replace("/merchant?stripe=error&reason=missing_state");
      return;
    }

    // 3. Privy session must be live before we can talk to the backend.
    if (!user) {
      console.warn("[stripe-callback] no authenticated user after rehydrate");
      router.replace("/merchant?stripe=error&reason=not_signed_in");
      return;
    }

    // 4. Happy path: authenticated exchange. Token exchange itself
    //    happens entirely server-side in the backend callback —
    //    STRIPE_SECRET_KEY never touches the browser.
    setInFlight(true);
    setStatusLine("Almost done. Confirming your details…");

    (async () => {
      const token = await getToken();
      if (!token) {
        console.warn("[stripe-callback] getToken() returned null");
        router.replace("/merchant?stripe=error&reason=no_auth_token");
        return;
      }

      try {
        const res = await fetch(
          `${API_BASE}/api/merchant/stripe-connect/callback?code=${encodeURIComponent(
            code,
          )}&state=${encodeURIComponent(state)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (res.ok) {
          console.log("[stripe-callback] backend linked merchant ok");
          router.replace("/merchant?stripe=connected");
        } else {
          const data = await res.json().catch(() => ({}));
          const detail =
            typeof data?.detail === "string"
              ? data.detail
              : data?.detail?.code ?? `http_${res.status}`;
          console.error("[stripe-callback] backend error", res.status, data);
          router.replace(
            `/merchant?stripe=error&reason=backend_error&code=${encodeURIComponent(
              detail,
            )}`,
          );
        }
      } catch (err) {
        console.error("[stripe-callback] network error", err);
        router.replace("/merchant?stripe=error&reason=network_error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <div className="text-center">
        <div className="mb-3 text-lg font-bold text-white">{statusLine}</div>
        <p className="text-sm text-zinc-400">
          You&apos;ll be redirected automatically.
        </p>
      </div>
    </div>
  );
}

export default function StripeCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-zinc-950">
          <span className="text-sm text-zinc-500">Loading…</span>
        </div>
      }
    >
      <StripeCallbackInner />
    </Suspense>
  );
}
