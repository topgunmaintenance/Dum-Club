"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth/AuthContext";
import { MerchantNextStep } from "../../components/MerchantNextStep";
import { API_BASE } from "../../lib/apiBase";

type Merchant = {
  id: string;
  business_name: string;
  business_type: string | null;
  location_city: string | null;
  location_state: string | null;
  founding_merchant: boolean;
  subscription_tier: string;
  subscription_price_usd: number;
  stripe_connect_id: string | null;
  stripe_connect_status: string;
  created_at: string;
};

type FoundingStatus = {
  // /api/merchant/founding-status returns only this boolean now —
  // the count fields were stripped from the public response so
  // competitors can't curl the endpoint to derive live merchant
  // counts. Re-adding them here would just type a wire field
  // that no longer exists.
  founding_program_open: boolean;
};

type StripeStatus = {
  status: "not_connected" | "pending_verification" | "verified" | "restricted";
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  requirements_currently_due: string[];
  requirements_eventually_due: string[];
  disabled_reason: string | null;
  stripe_connect_id: string | null;
};

// Standard plan price is pulled from an env var so the UI does not
// hard-code the Starter tier anywhere (CLAUDE.md Section 7 rule). Falls
// back to 39 (Starter base per CLAUDE.md §3) when
// NEXT_PUBLIC_STANDARD_PLAN_PRICE_USD is unset at build time.
const STANDARD_PLAN_PRICE_USD = Number(
  process.env.NEXT_PUBLIC_STANDARD_PLAN_PRICE_USD ?? 39
);

// Fixed category list for Create Your Shop. Required at signup so every
// merchant has a category from day one (drives later category-gated UI
// like the Share Shop CTA). Stored on the merchant via business_type.
const SHOP_CATEGORIES = [
  "Restaurant",
  "Auto & Repair",
  "HVAC",
  "Gym & Wellness",
  "Retail",
  "Service",
  "Other",
] as const;

export default function MerchantPage() {
  const { user, getToken, login } = useAuth();

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSignup, setShowSignup] = useState(false);

  // Founding program status. pulled from a public endpoint, no auth needed.
  const [foundingStatus, setFoundingStatus] = useState<FoundingStatus | null>(null);

  // Signup form
  const [bizName, setBizName] = useState("");
  const [bizType, setBizType] = useState("");
  // Self-identity (Whatnot-style two-card selector): individual or
  // registered business. Required - two taps max, no typing.
  const [entityType, setEntityType] = useState<"" | "individual" | "registered_business">("");
  const [bizDescription, setBizDescription] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  // Tier selected on /pricing or /upgrade (CTA hrefs carry `?tier=`).
  // Empty string when the user landed on /merchant directly — backend
  // defaults to growth in that case. Read once on mount from the URL.
  const [tier, setTier] = useState<string>("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const raw = (params.get("tier") || "").toLowerCase();
    if (raw === "starter" || raw === "growth" || raw === "pro") {
      setTier(raw);
    }
  }, []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Analytics from existing business profile
  const [analytics, setAnalytics] = useState<any>(null);

  // First project (for the "Add DUM Live to your website" deep-link).
  // The merchant audit Phase 3 added a 4th checklist step that deep-
  // links into the Activate-DUM-Live wizard on the merchant's
  // project page. If no project exists yet, the link falls back to
  // /dashboard so the merchant creates one first. We only need id
  // + slug; ignore the rest of the project payload.
  const [firstProject, setFirstProject] = useState<{
    id: string;
    slug: string | null;
    description: string | null;
    status: string | null;
    review_status: string | null;
    verified: boolean | null;
  } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  // Live Stripe Connect verification. fetched from
  // /api/merchant/stripe-connect/status which does a fresh
  // Stripe.Account.retrieve and writes the resolved status back to
  // the merchants row. The shape includes charges/payouts/details
  // booleans and the requirements lists Stripe surfaces during
  // onboarding. `null` while loading; `error` if the backend's
  // Stripe.Account.retrieve fails (typically a key/account mismatch
  //. most often surfaces while live OAuth is still being set up).
  const [stripeStatus, setStripeStatus] = useState<StripeStatus | null>(null);
  const [stripeStatusError, setStripeStatusError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  // True while a manual "Check status" re-poll is in flight, so the
  // button can show a busy label and prevent double-taps.
  const [checkingStripe, setCheckingStripe] = useState(false);

  // Stripe Connect return banner. Set from `?stripe=connected` or
  // `?stripe=error&reason=<code>` which the /merchant/stripe-callback
  // page redirects here with. We clean the URL after reading so a
  // refresh doesn't re-trigger the banner.
  const [stripeBanner, setStripeBanner] = useState<
    | { kind: "success" }
    | { kind: "error"; reason: string; detail: string | null }
    | null
  >(null);

  // ── 5-step checklist state (hoisted above all early returns) ──
  // These four hooks + two effects used to live below the
  //   if (!merchant) return null;
  // guard further down in the component (introduced in PR #187 /
  // QA T2). That violated the rules of hooks: on the first render
  // (merchant=null) zero of these hooks were called; on a later
  // render (merchant loaded) all six were called — React #310:
  // "Rendered more hooks than during the previous render."
  // /merchant white-screened for every signed-in merchant.
  //
  // Hoisting fixes the crash without changing behaviour: the
  // hooks now run on every render regardless of whether the
  // checklist JSX downstream actually renders. The JSX itself
  // still gates on merchant + firstProject + offer-fetch state.
  const [hasOffer, setHasOffer] = useState(false);
  // True once the async checklist signals (first project -> offers +
  // live-status) have settled. Until then the checklist shows a
  // "checking" line instead of a false low count - a fresh session
  // used to flash "1 of 5" while the fetches were still in flight.
  const [signalsReady, setSignalsReady] = useState(false);
  const [installSeen, setInstallSeen] = useState(false);
  const [qrPrinted, setQrPrinted] = useState(false);
  const [stepLive, setStepLive] = useState(false);
  // Replay loop (queue 17): the merchant's "record my shows + loop the
  // latest while I'm offline" switch, backed by /api/ivs/replay-status.
  const [replayEnabled, setReplayEnabled] = useState<boolean | null>(null);
  const [replayInfo, setReplayInfo] = useState<{ playback_url: string | null; recorded_at: string | null; recording_armed: boolean } | null>(null);
  const [replaySaving, setReplaySaving] = useState(false);
  // Showcase upload (queue 18): record/upload a video without going
  // live. On phones the file input opens the camera (capture attr).
  const [showcaseVideos, setShowcaseVideos] = useState<{ source: string; playback_url: string | null; recorded_at: string | null; is_active: boolean }[]>([]);
  const [showcaseUploadEnabled, setShowcaseUploadEnabled] = useState(false);
  const [showcaseUploading, setShowcaseUploading] = useState(false);
  const [showcaseError, setShowcaseError] = useState<string | null>(null);
  const showcaseFileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const status = sp.get("stripe");
    if (!status) return;

    if (status === "connected") {
      setStripeBanner({ kind: "success" });
    } else if (status === "error") {
      setStripeBanner({
        kind: "error",
        reason: sp.get("reason") || "unknown",
        detail: sp.get("code"),
      });
    }

    // Strip the stripe-related params from the URL without a reload.
    sp.delete("stripe");
    sp.delete("reason");
    sp.delete("code");
    const clean = sp.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${clean ? `?${clean}` : ""}`,
    );
  }, []);

  useEffect(() => {
    // Founding-status is public. fetch on mount regardless of auth so
    // unauthenticated visitors see the counter on the signup form too.
    fetch(`${API_BASE}/api/merchant/founding-status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setFoundingStatus(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    loadMerchant();
  }, [user]);

  // Checklist signal effects — hoisted alongside the state above
  // so all hooks run on every render, regardless of which JSX
  // branch the early returns below ultimately pick.
  useEffect(() => {
    try {
      // localStorage so the one-time onboarding flags survive new
      // browser sessions (they used to reset the checklist to 1/5 on
      // every fresh session). sessionStorage read kept for sessions
      // that set the flag before this change deployed.
      setInstallSeen(
        window.localStorage.getItem("dum-install-seen") === "1" ||
          window.sessionStorage.getItem("dum-install-seen") === "1",
      );
      setQrPrinted(
        window.localStorage.getItem("dum-qr-seen") === "1" ||
          window.sessionStorage.getItem("dum-qr-seen") === "1",
      );
    } catch {
      // private mode — both stay false; non-blocking
    }
  }, []);

  useEffect(() => {
    if (!firstProject?.id) {
      setHasOffer(false);
      setStepLive(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [offersRes, statusRes] = await Promise.all([
          fetch(`${API_BASE}/api/offers/${encodeURIComponent(firstProject.id)}`),
          fetch(
            `${API_BASE}/api/projects/${encodeURIComponent(firstProject.id)}/live-status`,
          ),
        ]);
        if (cancelled) return;
        if (offersRes.ok) {
          const arr = await offersRes.json();
          setHasOffer(Array.isArray(arr) && arr.length > 0);
        }
        if (statusRes.ok) {
          const j = await statusRes.json();
          setStepLive(!!j.is_live);
        }
      } catch {
        // soft fail
      }
      if (!cancelled) setSignalsReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [firstProject?.id]);

  async function loadMerchant() {
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/merchant/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.merchant) {
          setMerchant(data.merchant);
          loadAnalytics(token!);
          loadFirstProject();
          if (data.merchant.stripe_connect_id) {
            loadStripeStatus(token!);
          }
        } else {
          setShowSignup(true);
        }
      }
    } catch {}
    setLoading(false);
  }

  async function loadFirstProject() {
    // No auth header needed. /api/projects/ accepts owner_id as a
    // public filter. We only care about (id, slug) so a thrown
    // request or a missing field is non-fatal: firstProject stays
    // null and the checklist falls back to a "create your storefront
    // first" path via /dashboard.
    if (!user?.privyId) return;
    try {
      const res = await fetch(
        `${API_BASE}/api/projects/?owner_id=${encodeURIComponent(user.privyId)}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      const list = (data?.projects ?? data ?? []) as Array<{
        id?: string;
        slug?: string | null;
        description?: string | null;
        status?: string | null;
        review_status?: string | null;
        verified?: boolean | null;
      }>;
      const first = list.find((p) => !!p?.id);
      if (first?.id) {
        setFirstProject({
          id: first.id,
          slug: first.slug ?? null,
          description: first.description ?? null,
          status: first.status ?? null,
          review_status: first.review_status ?? null,
          verified: first.verified ?? null,
        });
      }
    } catch {
      // non-fatal. checklist still renders, just lands on /dashboard
    } finally {
      // No project found -> the offers effect never runs; the
      // checklist signals are as settled as they will get.
      setTimeout(() => setSignalsReady(true), 0);
    }
  }

  async function loadStripeStatus(token: string) {
    try {
      const res = await fetch(`${API_BASE}/api/merchant/stripe-connect/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data: StripeStatus = await res.json();
        setStripeStatus(data);
        setStripeStatusError(null);
        // Keep the merchant row's cached status field aligned with
        // what the live endpoint just returned. Avoids a stale
        // "connected" rendering downstream while the page is open.
        setMerchant((m) => (m ? { ...m, stripe_connect_status: data.status } : m));
      } else {
        const detail = await res.json().catch(() => ({}));
        setStripeStatusError(
          typeof detail.detail === "string" ? detail.detail : `HTTP ${res.status}`,
        );
      }
    } catch (err) {
      setStripeStatusError(err instanceof Error ? err.message : "Network error");
    }
  }

  // Manual re-check of Stripe verification. After a merchant finishes
  // Stripe onboarding their account can sit in "still reviewing" for a
  // while before it flips to verified; this lets them re-pull the live
  // status on demand instead of waiting blind. loadStripeStatus writes
  // the resolved status back to the merchant row, so a successful
  // re-check immediately updates the published/discoverable messaging.
  async function recheckStripeStatus() {
    setCheckingStripe(true);
    try {
      const t = await getToken();
      if (t) await loadStripeStatus(t);
    } finally {
      setCheckingStripe(false);
    }
  }

  async function loadAnalytics(token: string) {
    try {
      const res = await fetch(`${API_BASE}/api/business/analytics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setAnalytics(await res.json());
    } catch {}
  }

  async function handleSignup() {
    if (!bizName.trim()) { setError("Business name required"); return; }
    if (!entityType) { setError("Tell us if you sell as an individual or a registered business"); return; }
    if (!bizType) { setError("Pick a category"); return; }
    if (bizDescription.trim().length < 20) {
      setError("Add a short description (at least 20 characters) so people know what you do.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/merchant/signup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          business_name: bizName.trim(),
          business_type: bizType.trim() || null,
          entity_type: entityType || null,
          description: bizDescription.trim(),
          location_city: city.trim() || null,
          location_state: state.trim() || null,
          location_postal_code: zip.trim() || null,
          // Only include tier when one was selected via /pricing or
          // /upgrade. Omitting (null) lets the backend keep its
          // existing growth default for direct /merchant arrivals.
          tier: tier || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setMerchant(data.merchant);
        setShowSignup(false);
        // Backend auto-creates a storefront project on signup; reload
        // the project so step 2 ("Add your first offer") renders its
        // CTA pointing at the freshly-created /project/<slug>/manage.
        loadFirstProject();
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.detail || "Signup failed");
      }
    } catch {
      setError("Network error");
    }
    setSaving(false);
  }

  // Replay loop (queue 17): read the merchant's replay opt-in + latest
  // recording once the first project is known.
  useEffect(() => {
    if (!firstProject?.id || !user?.privyId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/ivs/replay-status?project_id=${encodeURIComponent(firstProject.id)}`,
          { headers: { user_id: user.privyId } },
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        setReplayEnabled(!!data.enabled);
        setReplayInfo({
          playback_url: data.playback_url ?? null,
          recorded_at: data.recorded_at ?? null,
          recording_armed: !!data.recording_armed,
        });
        setShowcaseVideos(Array.isArray(data.videos) ? data.videos : []);
        setShowcaseUploadEnabled(!!data.upload_enabled);
      } catch {
        /* leave null — card renders nothing until status loads */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firstProject?.id, user?.privyId]);

  async function toggleReplay() {
    if (!firstProject?.id || !user?.privyId || replayEnabled === null) return;
    const next = !replayEnabled;
    setReplaySaving(true);
    setReplayEnabled(next); // optimistic
    try {
      const res = await fetch(`${API_BASE}/api/ivs/replay-toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", user_id: user.privyId },
        body: JSON.stringify({ project_id: firstProject.id, enabled: next }),
      });
      if (!res.ok) setReplayEnabled(!next); // revert on failure
    } catch {
      setReplayEnabled(!next);
    } finally {
      setReplaySaving(false);
    }
  }

  async function refreshShowcase() {
    if (!firstProject?.id || !user?.privyId) return;
    try {
      const res = await fetch(
        `${API_BASE}/api/ivs/replay-status?project_id=${encodeURIComponent(firstProject.id)}`,
        { headers: { user_id: user.privyId } },
      );
      if (!res.ok) return;
      const data = await res.json();
      setShowcaseVideos(Array.isArray(data.videos) ? data.videos : []);
      setReplayInfo((prev) => ({
        playback_url: data.playback_url ?? null,
        recorded_at: data.recorded_at ?? null,
        recording_armed: !!data.recording_armed,
      }));
    } catch {}
  }

  async function handleShowcaseFile(file: File | null) {
    if (!file || !firstProject?.id || !user?.privyId) return;
    setShowcaseError(null);
    if (file.size > 500 * 1024 * 1024) {
      setShowcaseError("That video is over 500MB. Aim for 5 minutes or less.");
      return;
    }
    const contentType = file.type || "video/mp4";
    setShowcaseUploading(true);
    try {
      const urlRes = await fetch(`${API_BASE}/api/ivs/showcase-upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json", user_id: user.privyId },
        body: JSON.stringify({ project_id: firstProject.id, content_type: contentType }),
      });
      if (!urlRes.ok) {
        const d = await urlRes.json().catch(() => null);
        throw new Error(typeof d?.detail === "string" ? d.detail : "Could not start the upload");
      }
      const { upload_url, key } = await urlRes.json();
      const putRes = await fetch(upload_url, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
      });
      if (!putRes.ok) throw new Error("Upload failed partway. Check your connection and retry.");
      const confirmRes = await fetch(`${API_BASE}/api/ivs/showcase-uploaded`, {
        method: "POST",
        headers: { "Content-Type": "application/json", user_id: user.privyId },
        body: JSON.stringify({ project_id: firstProject.id, key }),
      });
      if (!confirmRes.ok) {
        const d = await confirmRes.json().catch(() => null);
        throw new Error(typeof d?.detail === "string" ? d.detail : "Could not save the video");
      }
      await refreshShowcase();
    } catch (e: any) {
      setShowcaseError(e?.message || "Upload failed. Try again.");
    } finally {
      setShowcaseUploading(false);
      if (showcaseFileRef.current) showcaseFileRef.current.value = "";
    }
  }

  async function activateShowcase(source: string) {
    if (!firstProject?.id || !user?.privyId) return;
    // Optimistic flip
    setShowcaseVideos((v) => v.map((x) => ({ ...x, is_active: x.source === source })));
    try {
      await fetch(`${API_BASE}/api/ivs/showcase-activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", user_id: user.privyId },
        body: JSON.stringify({ project_id: firstProject.id, source }),
      });
    } catch {
      refreshShowcase();
    }
  }

  async function publishStorefront() {
    if (!firstProject?.id || !user?.privyId) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/projects/${encodeURIComponent(firstProject.id)}/publish`,
        {
          method: "POST",
          headers: { user_id: user.privyId },
        },
      );
      if (res.ok) {
        loadFirstProject();
      } else {
        const data = await res.json().catch(() => null);
        setPublishError(
          typeof data?.detail === "string"
            ? data.detail
            : "Could not publish right now. Try again in a moment."
        );
      }
    } catch {
      setPublishError("Network error. Try again in a moment.");
    } finally {
      setPublishing(false);
    }
  }

  async function unpublishStorefront() {
    if (!firstProject?.id || !user?.privyId) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/projects/${encodeURIComponent(firstProject.id)}/unpublish`,
        {
          method: "POST",
          headers: { user_id: user.privyId },
        },
      );
      if (res.ok) {
        loadFirstProject();
      } else {
        const data = await res.json().catch(() => null);
        setPublishError(
          typeof data?.detail === "string"
            ? data.detail
            : "Could not move to draft right now. Try again in a moment."
        );
      }
    } catch {
      setPublishError("Network error. Try again in a moment.");
    } finally {
      setPublishing(false);
    }
  }

  async function connectStripe() {
    setConnectError(null);
    setConnecting(true);
    try {
      const token = await getToken();
      if (!token) {
        setConnectError("Please sign in again, then click Connect Stripe.");
        return;
      }
      const res = await fetch(`${API_BASE}/api/merchant/stripe-connect/authorize`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.url) {
          window.location.href = data.url;
          return;
        }
        setConnectError("We couldn't start Stripe setup. Please try again in a moment.");
        return;
      }
      setConnectError("We couldn't reach Stripe just now. Please try again in a moment.");
    } catch (err) {
      console.error("[merchant] connectStripe failed", err);
      setConnectError("Network problem reaching Stripe. Check your connection and try again.");
    } finally {
      setConnecting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-card">
        <span className="text-sm text-secondary">Loading...</span>
      </div>
    );
  }

  if (!user) {
    // CRITICAL FIX: pre-fix this screen had no sign-in button at all —
    // every "Claim Your Free Spot" homepage click from a logged-out
    // visitor hit a dead end. Now renders a proper sign-in CTA that
    // kicks the Privy login flow, plus the founding-100 program-open
    // signal so we can flip CTA copy when slots close.
    const programOpen = foundingStatus?.founding_program_open ?? true;

    return (
      <div className="min-h-screen bg-surface-card px-4 pb-20 pt-28">
        <div className="mx-auto w-full max-w-md text-center">
          {/* Founding-100 scarcity pill removed — we no longer surface
              public merchant-count metrics. The H1 + description below
              still carry the "60 days free / lock in founding pricing"
              copy, so the value prop is intact. */}

          <h1 className="text-3xl font-extrabold tracking-tight text-primary sm:text-4xl">
            Join the first 100 merchants.{" "}
            <span className="text-mint-text">Lock in founding pricing for life.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-sm text-base font-medium text-primary">
            Get 60 days free, then keep founding pricing for life. Flat monthly subscription plus a 1.5% sales fee. Industry-low (Whatnot takes up to 8%). No credit card.
          </p>
          <p className="mx-auto mt-2 max-w-sm text-[13px] font-semibold text-secondary">
            Plans start at $39/month after your trial. Cancel anytime.
          </p>

          <button
            onClick={() => login()}
            className="mt-8 inline-flex h-12 items-center justify-center rounded-xl bg-mint-fill px-8 text-[13px] font-bold uppercase tracking-[0.12em] text-mint-fill-ink transition hover:opacity-90"
          >
            Claim Your Founding Spot →
          </button>

          <p className="mt-2 text-[11px] text-secondary">
            Sign in with email or Google · Takes 30 seconds
          </p>
          <p className="mt-1 text-[11px] text-muted">
            Tip: pick one sign-in method and stick with it, so your shop is always under one account.
          </p>
          <p className="mt-4 text-[13px] font-semibold text-secondary">
            Want to see it first?{" "}
            <Link href="/demo" className="text-mint-text underline underline-offset-2 hover:opacity-80">
              Preview the live bubble on your own website
            </Link>
          </p>
        </div>

        {/* What happens after you sign up — 3 steps */}
        <div className="mx-auto mt-16 w-full max-w-2xl">
          <h2 className="text-center text-lg font-extrabold tracking-tight text-primary">
            What happens after you sign up
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {[
              { n: "1", title: "Sign in", body: "Use your email or Google. No password to remember." },
              { n: "2", title: "Tell us about your shop", body: "Name, category, and one sentence about what you do. About a minute." },
              { n: "3", title: "Connect Stripe", body: "When you're ready to take payments. Money goes straight to your bank." },
              { n: "4", title: "Create your first offer", body: "Add a photo, set a price. Takes 30 seconds." },
              { n: "5", title: "You're live", body: "Share your link. Customers can buy immediately." },
            ].map((step) => (
              <div key={step.n} className="rounded-2xl border border-default bg-surface-page p-5 text-center">
                <div className="mx-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-default bg-mint-card font-mono text-sm font-extrabold text-mint-text">
                  {step.n}
                </div>
                <div className="mt-3 text-sm font-bold text-primary">{step.title}</div>
                <p className="mt-1 text-[12px] leading-relaxed text-secondary">{step.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Mini FAQ */}
        <div className="mx-auto mt-14 w-full max-w-2xl">
          <h2 className="text-center text-lg font-extrabold tracking-tight text-primary">
            Quick questions
          </h2>
          <div className="mt-5 space-y-3">
            {[
              { q: "Do I need a website?", a: "No. You get a shop page on DUM Club either way. If you do have a website, you can add one line of code to show your live shop there too." },
              { q: "Do I need to be a Stripe user already?", a: "No. We set up Stripe for you in about 60 seconds when you're ready to take payments. Money goes straight to your bank." },
              { q: "How long does setup take?", a: "A few minutes. Sign in, enter your business name, and you're in. Connect Stripe whenever you're ready to sell." },
              { q: "What if I get stuck?", a: "Email or call Julian, the founder. Real person, same-day reply." },
            ].map((f) => (
              <details key={f.q} className="group rounded-2xl border border-default bg-surface-page p-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[14px] font-semibold text-primary">
                  {f.q}
                  <span className="text-secondary transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                </summary>
                <p className="mt-2 text-[13px] leading-relaxed text-secondary">{f.a}</p>
              </details>
            ))}
          </div>
        </div>

        {/* Prefer to talk first */}
        <div className="mx-auto mt-12 w-full max-w-2xl text-center">
          <p className="text-sm text-secondary">
            Prefer to ask a question first? Use the inquiry form above. We respond within 24 hours.
          </p>
        </div>
      </div>
    );
  }

  // ── Signup form ──
  if (showSignup) {
    const programOpen = foundingStatus?.founding_program_open ?? true;

    return (
      <div className="min-h-screen bg-surface-card pt-24 px-4 pb-16">
        <div className="mx-auto max-w-2xl">

          {/* ── HERO ──
               Continues the homepage pitch instead of dropping a form
               in a void. Founding-100 scarcity pill removed — we no
               longer surface public merchant-count metrics; the H1 +
               paragraph below still carry "60 days free / lock in
               founding pricing for life" so the messaging is intact. */}

          <div className="mb-8 text-center">
            <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight text-primary sm:text-5xl">
              Join the first{" "}
              <span className="text-mint-text" style={{ textShadow: "0 0 30px rgba(0,255,163,0.3)" }}>
                100 merchants.
              </span>{" "}
              Lock in founding pricing for life.
            </h1>
            <p className="mx-auto mt-5 max-w-lg text-base font-medium leading-relaxed text-primary">
              {programOpen
                ? "Get 60 days free, then keep founding pricing for life. Flat monthly subscription plus a 1.5% sales fee. Industry-low (Whatnot takes up to 8%). No credit card."
                : `Standard plan $${STANDARD_PLAN_PRICE_USD}/month plus a 1.5% sales fee per order. Loyalty rewards built in. No card today.`}
            </p>
          </div>

          {/* ── The form. one field only ──
               Dropped from 4 fields to 1. Rule of thumb: each extra
               field on a cold signup CTA costs ~10% completion. Biz
               type + city + state move to progressive profile after
               signup. Phase 4 of the merchant audit moved the form
               above the 5-expense-line comparison, the 3-point sell,
               and the founder testimonial. on a 393px-wide phone
               the input was previously ~2.5 screens of scroll below
               the H1, costing visible mobile abandonment. The proof
               / sell content sits below the form for hesitant
               readers; merchants who already know they want in see
               the form immediately. */}
          {/* The deal, stated BEFORE any field (borrowed from Whatnot's
              onboarding: expectations first, data second). Four plain
              lines, no surprises later. The form itself is unchanged -
              our one-page 60-second signup converts better than a
              multi-screen wizard at this stage (founder call
              2026-07-03), so the wizard idea was reduced to this. */}
          <div className="mb-4 grid gap-2 rounded-2xl border border-default bg-surface-card p-4 sm:grid-cols-2 sm:p-5">
            {[
              ["💵", "One flat monthly fee + 1.5% per sale. Never more."],
              ["🎁", "60 days free. Founding pricing locked for life."],
              ["🏦", "Payouts straight to your bank. Buyers cover card fees."],
              ["🤝", "Your customers stay yours. QR, your own site, win-back."],
            ].map(([icon, line]) => (
              <div key={line} className="flex items-start gap-2.5">
                <span className="text-base" aria-hidden="true">{icon}</span>
                <span className="text-[13px] font-medium leading-snug text-primary">{line}</span>
              </div>
            ))}
          </div>

          <div className="mb-6 rounded-2xl border border-default bg-mint-card p-6 sm:p-8">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-mint-text">
              {programOpen ? "Claim your founding spot" : "Start a merchant account"}
            </div>
            <h2 className="mb-5 text-2xl font-extrabold text-primary">
              {programOpen ? "60 seconds. No card." : `$${STANDARD_PLAN_PRICE_USD}/mo. Cancel anytime.`}
            </h2>

            {error && <p className="mb-4 text-sm text-state-live">{error}</p>}

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-secondary">You&apos;re selling as</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ["individual", "Individual", "Just me, selling under my own name"],
                    ["registered_business", "Registered business", "LLC, corporation, or registered trade name"],
                  ] as const).map(([val, title, body]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setEntityType(val)}
                      aria-pressed={entityType === val}
                      className={`rounded-xl border p-3.5 text-left transition ${
                        entityType === val
                          ? "border-mint-fill bg-surface-card ring-2 ring-mint-fill/30"
                          : "border-default bg-surface-card hover:border-strong"
                      }`}
                    >
                      <span className="block text-sm font-bold text-primary">{title}</span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-secondary">{body}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-secondary">Business Name</label>
                <input
                  value={bizName}
                  onChange={(e) => setBizName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSignup(); }}
                  placeholder="e.g. Topgun Maintenance LLC"
                  autoFocus
                  className="w-full rounded-xl border border-default bg-surface-card px-4 py-3 text-base text-primary placeholder:text-muted outline-none transition focus:border-mint-fill focus:ring-2 focus:ring-mint-fill/30"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-secondary">What does your business do?</label>
                <textarea
                  value={bizDescription}
                  onChange={(e) => setBizDescription(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="e.g. Family-owned diner in Morristown serving classic American breakfast and lunch."
                  className="w-full rounded-xl border border-default bg-surface-card px-4 py-3 text-base text-primary placeholder:text-muted outline-none transition focus:border-mint-fill focus:ring-2 focus:ring-mint-fill/30"
                />
                <p
                  className={`mt-1.5 text-xs ${
                    bizDescription.trim().length === 0
                      ? "text-muted"
                      : bizDescription.trim().length < 20
                      ? "text-state-live"
                      : "text-secondary"
                  }`}
                >
                  {bizDescription.trim().length === 0
                    ? "At least 20 characters. This shows on your storefront."
                    : bizDescription.trim().length < 20
                    ? `A few more words helps people understand what you do. (${bizDescription.trim().length}/20)`
                    : "Looks good."}
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-secondary">Category</label>
                <select
                  value={bizType}
                  onChange={(e) => setBizType(e.target.value)}
                  className="w-full rounded-xl border border-default bg-surface-card px-4 py-3 text-base text-primary outline-none transition focus:border-mint-fill focus:ring-2 focus:ring-mint-fill/30"
                >
                  <option value="" disabled>Pick a category</option>
                  {SHOP_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-secondary">
                  Where are you located? <span className="text-muted">(optional, helps local customers find you)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="City"
                    className="min-w-0 flex-1 rounded-xl border border-default bg-surface-card px-4 py-3 text-base text-primary placeholder:text-muted outline-none transition focus:border-mint-fill focus:ring-2 focus:ring-mint-fill/30"
                  />
                  <input
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    placeholder="ST"
                    maxLength={2}
                    className="w-16 rounded-xl border border-default bg-surface-card px-3 py-3 text-base uppercase text-primary placeholder:normal-case placeholder:text-muted outline-none transition focus:border-mint-fill focus:ring-2 focus:ring-mint-fill/30"
                  />
                  <input
                    value={zip}
                    onChange={(e) => setZip(e.target.value)}
                    placeholder="ZIP"
                    inputMode="numeric"
                    maxLength={5}
                    className="w-24 rounded-xl border border-default bg-surface-card px-3 py-3 text-base text-primary placeholder:text-muted outline-none transition focus:border-mint-fill focus:ring-2 focus:ring-mint-fill/30"
                  />
                </div>
              </div>
              <button
                onClick={handleSignup}
                disabled={saving || !entityType || !bizName.trim() || !bizType || bizDescription.trim().length < 20}
                className="w-full rounded-xl bg-mint-fill py-4 text-sm font-bold uppercase tracking-[0.12em] text-mint-fill-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving
                  ? "Claiming your spot..."
                  : programOpen
                  ? "Claim Your Founding Spot →"
                  : "Create Merchant Account →"}
              </button>
              <p className="text-center text-[11px] text-secondary">
                You can add your offers and go live on the next step.
              </p>
            </div>
          </div>

          {/* ── One-fee-replaces-five comparison ──
               Phase 4 of the merchant audit replaced the prior
               Whatnot-only contrast box with the same 5-expense-line
               framing used on the homepage. A barber, restaurant
               owner, mechanic, gym, contractor, or local shop has
               typically NEVER used Whatnot. leading the signup
               with "you'd save vs Whatnot" alienates the very
               audience this page is meant to convert. The five
               expense lines below are the bills a normal local
               business already pays today. */}
          <div className="mb-6 rounded-2xl border border-default bg-gradient-to-br from-mint-card to-surface-muted p-5 sm:p-6">
            <div className="mb-4 text-center">
              <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-mint-text">
                One flat fee instead of five
              </div>
              <div className="mt-2 text-base font-bold text-primary">
                DUM Club replaces five expense lines you already pay.
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { name: "Delivery apps", fees: "15 to 30%", detail: "of every order" },
                { name: "Live selling", fees: "up to 8% + fees", detail: "per sale" },
                { name: "Loyalty software", fees: "$50 to $300", detail: "per month" },
                { name: "SMS retention", fees: "$20 to $200", detail: "per month" },
              ].map((p) => (
                <div
                  key={p.name}
                  className="rounded-xl border border-red-500/15 bg-surface-card p-3 text-center"
                >
                  <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-secondary">
                    {p.name}
                  </div>
                  <div className="mt-1 font-mono text-base font-extrabold text-state-live/80">
                    {p.fees}
                  </div>
                  <div className="text-[10px] text-secondary">{p.detail}</div>
                </div>
              ))}
              <div className="col-span-2 rounded-xl border-2 border-mint-fill bg-gradient-to-b from-mint-card to-surface-muted p-3 text-center">
                <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-mint-text">
                  DUM Club
                </div>
                <div className="mt-1 font-mono text-base font-extrabold text-mint-text">
                  From $39
                </div>
                <div className="text-[10px] text-mint-text">
                  flat / month · 1.5% sales fee
                </div>
              </div>
            </div>
            <div className="mt-4 text-center text-xs text-primary">
              One bill. <span className="font-bold text-mint-text">Keep your revenue.</span>
            </div>
          </div>

          {/* ── 3-point sell ── */}
          <div className="mb-6 rounded-2xl border border-default bg-surface-muted p-5 sm:p-6">
            <ul className="space-y-3">
              {[
                "Just a 1.5% sales fee per order (Whatnot takes up to 8%, DoorDash takes 15-30%)",
                "Built-in loyalty rewards bring customers back to your shop and every DUM Club business, so you keep them without paying for ads",
                "Get 60 days free and lock in founding pricing for life when you join the first 100 merchants",
              ].map((line) => (
                <li
                  key={line}
                  className="flex items-start gap-3 text-sm font-medium leading-relaxed text-primary"
                >
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[11px] font-bold text-mint-text">
                    ✓
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* ── Founder testimonial. social proof, real face ── */}
          <div className="mb-6 rounded-2xl border border-default bg-surface-muted p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <img
                src="/Julian.jpeg"
                alt="Julian Mero. founder, Topgun Maintenance LLC"
                className="h-12 w-12 shrink-0 rounded-full border border-default object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-relaxed text-primary">
                  &ldquo;I&apos;ve run my maintenance business for years. DUM Club is the first platform that does not charge Whatnot-scale commission. Flat monthly fee plus just 1.5% per sale. It just works.&rdquo;
                </p>
                <div className="mt-3 text-[11px] text-secondary">
                  <span className="font-bold text-primary">Julian Mero</span> · Founder · Topgun Maintenance LLC · Founding Merchant #1
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Merchant dashboard ──
  if (!merchant) return null;

  // Build the QR target URL. During SSR `window` is undefined; fall back to
  // the public site host so the URL is always absolute (Google's old chart
  // API is dead, the new generator we use below requires a real URL or it
  // 404s the image).
  const qrOrigin =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_SITE_URL || "https://dum.club";
  const qrUrl = `${qrOrigin}/business/${merchant.id}`;

  // ── Onboarding progress ──
  // A merchant who just signed up has an account + a founding spot. They
  // have NOT yet: connected Stripe (required to get paid), and made
  // their first sale. Surface those as a checklist at the very top of
  // the dashboard so "what's my next step?" is never ambiguous.
  //
  // stepStripe is true the moment OAuth completes. i.e. as soon as a
  // stripe_connect_id is on the row. The cached stripe_connect_status
  // string drifts through "connected" → "pending_verification" →
  // "verified" as Stripe's verification progresses, but the checklist
  // is asking "did you connect Stripe?", not "did Stripe verify you?".
  // Verification state is surfaced separately by the Stripe
  // Verification card below.
  const stepStripe = !!merchant.stripe_connect_id;
  // Step 3. "Add DUM Live to your website". has no direct
  // signal we can read (we don't have a server-side "embed
  // installed" flag, and even if we did, "merchant pasted the
  // snippet on a page we never see" can't be verified
  // remotely). A confirmed first sale proves the install
  // works end-to-end, so we use that as the completion proxy.
  // Until then, the step shows as the active next-action with
  // a deep-link CTA.
  const stepFirstSale = (analytics?.total_orders ?? 0) > 0;
  const stepInstall = stepFirstSale;

  // QA spec 5-step checklist. Same data signals — re-grouped to
  // match the directive's order + adds two new steps the previous
  // 4-step version didn't surface:
  //
  //   1. Connect Stripe              → stepStripe
  //   2. Add your first offer         → hasOffer (fetched in
  //                                      the effect below)
  //   3. Paste the snippet on your site
  //                                   → stepInstall (proxied via
  //                                      first sale or sessionStorage
  //                                      "dum-install-seen" set by
  //                                      /install)
  //   4. Print your QR                → printed flag in
  //                                      sessionStorage when /qr
  //                                      visited
  //   5. Go live for the first time   → stepLive (project.is_live
  //                                      or has-ever-been-live flag)
  //
  // The page always renders the checklist now, even when complete —
  // a 5/5 celebration line replaces the next-step copy.
  // (Hooks for hasOffer / installSeen / qrPrinted / stepLive +
  // their effects live above the early returns near line 95 to
  // satisfy the rules of hooks. See the "5-step checklist state"
  // block in the top hook section.)

  const stepSnippet = installSeen || stepInstall;
  const stepLiveEver = stepLive || stepFirstSale;

  // All-green hub state (merchant-hub consolidation, 2026-07-02): when the
  // shop is founding + published + Stripe-verified, the four separate
  // status cards (Founding badge, Storefront published, business info,
  // Payment connections) collapse into ONE identity strip — the Whatnot
  // rule: say each thing once. Any not-green state keeps its actionable
  // card exactly as before.
  const hubStripeOk =
    stripeStatus?.status === "verified" ||
    merchant?.stripe_connect_status === "verified";
  const hubPublished =
    firstProject?.status === "live" && firstProject?.review_status === "approved";
  const hubAllGreen = !!merchant && hubPublished && hubStripeOk;
  const completedSteps = [
    stepStripe,
    hasOffer,
    stepSnippet,
    qrPrinted,
    stepLiveEver,
  ].filter(Boolean).length;
  const totalSteps = 5;
  // Where the "Add DUM Live to your website" CTA sends the
  // merchant. If they have at least one project, deep-link
  // straight to that project's page (the Activate-DUM-Live
  // card lives there). Otherwise route to /dashboard so they
  // create a project first.
  const installLink = firstProject
    ? `/project/${firstProject.slug || firstProject.id}`
    : "/dashboard";

  // Human-readable copy for each Stripe-callback failure reason.
  // Keep error codes stable; map to friendly text only at render time.
  const stripeErrorCopy = (reason: string, detail: string | null): string => {
    switch (reason) {
      case "missing_code":
        return "Stripe didn't return an authorization code. Please try connecting again.";
      case "missing_state":
        return "The secure connection token was lost between Stripe and this page. Try connecting again, and don't use a back-button or stale link.";
      case "stripe_denied":
        // access_denied is Stripe's generic "the OAuth flow was exited
        // before finishing" - closing the tab, hitting back, hesitating
        // at the SSN/EIN screen. It is NOT a decline of the merchant
        // (verified by walking the flow, 2026-07-03), so don't scare
        // them: invite them to resume. Individuals are fully supported -
        // Stripe's form has an Individual/Sole-proprietor option that
        // takes an SSN instead of an EIN.
        if ((detail || "").toLowerCase() === "access_denied") {
          return "Looks like the Stripe window closed before finishing. Nothing went wrong - hit Connect Stripe to pick up where you left off. Individuals are welcome: choose Individual on Stripe's form and use your SSN (no EIN needed).";
        }
        return detail
          ? `Stripe declined the connection (${detail}). Try again or contact support.`
          : "Stripe declined the connection. Try again or contact support.";
      case "not_signed_in":
        return "Your session expired during Stripe onboarding. Sign in and retry.";
      case "no_auth_token":
        return "Could not retrieve your auth token. Sign out and back in, then retry.";
      case "backend_error":
        if (detail === "oauth_state_expired")
          return "Stripe onboarding took too long (over 10 minutes). Click Connect Stripe again for a fresh link.";
        if (detail === "oauth_state_user_mismatch")
          return "The connection link was initiated by a different account. Sign in as the account that started the flow.";
        if (detail === "oauth_state_signature_invalid")
          return "The connection token was tampered with or isn't recognized. Click Connect Stripe again.";
        return detail
          ? `Backend rejected the connection: ${detail}`
          : "Backend rejected the connection. Check Railway logs.";
      case "network_error":
        return "Network error reaching the backend. Retry, then check your connection.";
      default:
        return "Something went wrong connecting Stripe. Please try again.";
    }
  };

  return (
    <div className="min-h-screen bg-surface-card pt-28 px-4 pb-12">
      <div className="mx-auto max-w-2xl space-y-6">

        {/* Stripe Connect return banner. Populated by the useEffect
            that reads ?stripe=connected|error from the callback-page
            redirect, then auto-dismissible. */}
        {stripeBanner?.kind === "success" && (
          <div className="rounded-2xl border border-default bg-mint-card px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-mint-text">
                  Stripe connected
                </div>
                <div className="mt-1 text-xs text-mint-text">
                  Stripe may take a few minutes to finish checking your
                  account. You show up on the Discover page once they say
                  you are ready to take payments. Tap Check status to see
                  where you are.
                </div>
                <button
                  type="button"
                  onClick={recheckStripeStatus}
                  disabled={checkingStripe}
                  className="mt-3 inline-flex items-center rounded-lg bg-mint-fill px-4 py-2 text-xs font-bold text-mint-fill-ink transition hover:opacity-90 disabled:opacity-50"
                >
                  {checkingStripe ? "Checking..." : "Check status"}
                </button>
              </div>
              <button
                onClick={() => setStripeBanner(null)}
                className="text-xs text-mint-text/60 hover:text-mint-text"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        )}
        {stripeBanner?.kind === "error" && (
          <div className="rounded-2xl border border-red-400/30 bg-red-400/[0.06] px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-bold text-state-live">
                  Stripe connection didn&apos;t go through
                </div>
                <div className="mt-1 break-words text-xs text-state-live/80">
                  {stripeErrorCopy(stripeBanner.reason, stripeBanner.detail)}
                </div>
                {/* Inline retry. Every error reason here is retriable —
                    expired tokens, lost state, network blips, even a
                    Stripe-side cancel — and the only path forward is
                    to start a fresh authorize call. Before this button
                    the merchant had to scroll past the banner, find
                    the Stripe step card, and click "Connect Stripe"
                    there. Now the recovery action lives next to the
                    error explaining why they need it. */}
                <button
                  type="button"
                  onClick={() => {
                    setStripeBanner(null);
                    connectStripe();
                  }}
                  className="mt-3 inline-flex items-center rounded-lg bg-mint-fill px-4 py-2 text-xs font-bold text-mint-fill-ink transition hover:opacity-90"
                >
                  Try connecting again →
                </button>
                {/* Diagnostic identifier hidden behind a disclosure so
                    the merchant sees calm copy by default; support
                    can still ask "click Show technical details and
                    paste it back" without confusing the merchant
                    with raw reason / detail strings up front. */}
                <details className="mt-3">
                  <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.12em] text-state-live/50 hover:text-state-live/80">
                    Show technical details
                  </summary>
                  <div className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-state-live/50">
                    reason: {stripeBanner.reason}
                    {stripeBanner.detail ? ` · detail: ${stripeBanner.detail}` : ""}
                  </div>
                </details>
              </div>
              <button
                onClick={() => setStripeBanner(null)}
                className="text-xs text-state-live/60 hover:text-state-live"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* ── Consolidated identity strip (all-green hub) ── */}
        {hubAllGreen && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-default bg-surface-card px-5 py-4 shadow-sm">
            <div className="min-w-0">
              <div className="truncate text-base font-bold text-primary">{merchant.business_name}</div>
              {merchant.location_city && (
                <div className="text-xs text-secondary">
                  {merchant.location_city}{merchant.location_state ? `, ${merchant.location_state}` : ""}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {merchant.founding_merchant && (
                <span className="rounded-full bg-mint-card px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-mint-text">Founding</span>
              )}
              <span className="rounded-full bg-mint-card px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-mint-text">Published ✓</span>
              <span className="rounded-full bg-mint-card px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-mint-text">Stripe ✓</span>
              <button
                onClick={unpublishStorefront}
                disabled={publishing}
                className="text-[11px] font-medium text-secondary underline-offset-4 transition hover:text-primary hover:underline disabled:opacity-50"
              >
                Move to draft
              </button>
            </div>
          </div>
        )}
        {hubAllGreen && publishError && (
          <p className="text-xs text-state-live">{publishError}</p>
        )}

        {/* Founding badge (kept for any not-all-green state) */}
        {merchant.founding_merchant && !hubAllGreen && (
          <div className="rounded-2xl border border-default bg-mint-card px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-black">F</span>
              <div>
                <div className="text-sm font-bold text-mint-text">Founding Merchant</div>
                <div className="text-xs text-mint-text/60">60 days free · Lock in founding pricing for life · 1.5% sales fee</div>
              </div>
            </div>
          </div>
        )}

        {/* Storefront publish status (owner D4, PR 5). Surfaces the
            self-serve publish action when the project is in draft, and
            a confirmation badge when it's live + approved. Backend gates
            on description + offer + Stripe Connect — the 400 detail is
            rendered inline below the button when a gate fails. */}
        {firstProject && (() => {
          const isPubliclyLive =
            firstProject.status === "live" && firstProject.review_status === "approved";
          // Discoverability now also requires a Stripe-verified merchant
          // (the /discover gate). Read the live status first, fall back to
          // the cached merchant row. A storefront can be "published"
          // (live + approved) yet still be off Discover until Stripe
          // finishes verifying — surface that honestly instead of a flat
          // "published" badge that over-promises.
          const stripeVerified =
            stripeStatus?.status === "verified" ||
            merchant?.stripe_connect_status === "verified";

          // Published AND Stripe-verified: the consolidated identity strip
          // above already says this (with Move to draft) — skip the card.
          if (isPubliclyLive && stripeVerified) return null;
          // (unreachable legacy card kept out of the tree)
          if (false) {
            return (
              <div className="rounded-2xl border border-mint-fill bg-mint-card px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-black">✓</span>
                    <div>
                      <div className="text-sm font-bold text-mint-text">Storefront published</div>
                      <div className="text-xs text-mint-text/60">
                        Customers can find you on Discover and buy from your shop.
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={unpublishStorefront}
                    disabled={publishing}
                    className="text-xs font-medium text-mint-text/70 underline-offset-4 transition hover:text-mint-text hover:underline disabled:opacity-50"
                  >
                    Move to draft
                  </button>
                </div>
                {publishError && (
                  <p className="mt-3 text-xs text-state-live">{publishError}</p>
                )}
              </div>
            );
          }

          // Published but NOT yet Stripe-verified: live as a page but
          // hidden from Discover until Stripe finishes. Tell them plainly
          // and give them the re-check action.
          if (isPubliclyLive && !stripeVerified) {
            return (
              <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-500">Storefront status</div>
                    <div className="mt-1 text-sm font-semibold text-primary">Published, but not on Discover yet</div>
                    <div className="mt-1 text-xs text-secondary">
                      Your shop page is live. To show up on the Discover page,
                      Stripe needs to finish checking your account so you can
                      take payments. This usually takes a few minutes.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={recheckStripeStatus}
                    disabled={checkingStripe}
                    className="rounded-xl bg-mint-fill px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-black transition hover:opacity-90 disabled:opacity-50"
                  >
                    {checkingStripe ? "Checking..." : "Check status"}
                  </button>
                </div>
                {publishError && (
                  <p className="mt-3 text-xs text-state-live">{publishError}</p>
                )}
              </div>
            );
          }

          // Draft: not published yet.
          return (
            <div className="rounded-2xl border border-default bg-surface-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-secondary">Storefront status</div>
                  <div className="mt-1 text-sm font-semibold text-primary">Draft · not published yet</div>
                </div>
                <button
                  onClick={publishStorefront}
                  disabled={publishing}
                  className="rounded-xl bg-mint-fill px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-black transition hover:opacity-90 disabled:opacity-50"
                >
                  {publishing ? "Publishing..." : "Publish storefront"}
                </button>
              </div>
              {publishError && (
                <p className="mt-3 text-xs text-state-live">{publishError}</p>
              )}
              {!publishError && (
                <p className="mt-3 text-[11px] text-secondary">
                  Connect Stripe, write a description, and add at least one offer to publish your storefront on DUM Club.
                </p>
              )}
            </div>
          );
        })()}

        {/* Next Step — shared component, single source of truth. The
            detailed Launch Checklist below it covers the same ground
            with finer-grained per-step actions; this card is the
            dominant "what should I do RIGHT NOW" prompt. */}
        {merchant && (() => {
          // Share Shop gate: block sharing the storefront link until it
          // has a real description (P11) and a category (P10, on
          // merchant.business_type). Mirrors the dashboard gate.
          const rawDesc = (firstProject?.description || "").trim();
          const hasDescription =
            !!rawDesc &&
            rawDesc !== "Auto-created from dashboard." &&
            !rawDesc.startsWith("Project workspace for ");
          const hasCategory = Boolean((merchant.business_type || "").trim());
          const profileComplete = hasDescription && hasCategory;
          return (
            <MerchantNextStep
              inputs={{
                isAuthenticated: true,
                hasMerchant: true,
                stripeStatus: merchant.stripe_connect_status ?? null,
                hasBusinessProfile: Boolean(merchant.business_name),
                hasProject: Boolean(firstProject),
                offerCount: hasOffer ? 1 : 0,
                // Real numbers from the same analytics fetch the stat tiles
                // use. These were hardcoded 0/0, which pinned the card on
                // "Share your shop with your first customer" forever — the
                // lifecycle could never advance past State 2 (founder bug
                // report 2026-07-06).
                salesCount: analytics?.total_orders ?? 0,
                gmvUsd: analytics?.total_revenue_usd ?? 0,
                primaryProjectSlug: firstProject?.slug || firstProject?.id || null,
              }}
              variant="card"
              shareDisabledReason={profileComplete ? undefined : "Complete your profile first"}
            />
          );
        })()}

        {/* ── Onboarding checklist ──
            Always rendered. Even at 5 of 5 we keep the row visible
            with a celebration line so merchants can revisit /qr or
            /install, instead of the checklist disappearing once
            "complete". */}
        {(
          <div className="rounded-2xl border border-default bg-gradient-to-br from-mint-card to-surface-muted p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-mint-text">Your Launch Checklist</div>
                <div className="mt-1 text-sm font-semibold text-primary">
                  {!signalsReady ? (
                    <span className="text-secondary">Checking your setup…</span>
                  ) : (
                  <>
                  {completedSteps} of {totalSteps} complete.{" "}
                  <span className="text-mint-text">
                    {!hasOffer
                      ? "Add your first offer"
                      : !stepStripe
                        ? "Connect Stripe to start getting paid (bank + ID, about 5 minutes, verifies fast)"
                        : !stepLiveEver
                          ? "Go live for the first time"
                          : !stepSnippet
                            ? "Add DUM Club to your website (optional)"
                            : !qrPrinted
                              ? "Print your QR"
                              : "You are set. Go live and start selling."}
                  </span>
                  </>
                  )}
                </div>
              </div>
              <div className="text-xs font-mono text-mint-text">
                {signalsReady ? `${Math.round((completedSteps / totalSteps) * 100)}%` : ""}
              </div>
            </div>

            {/* Progress bar */}
            <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-surface-muted">
              <div
                className="h-full rounded-full bg-mint-fill transition-all"
                style={{ width: `${(completedSteps / totalSteps) * 100}%` }}
              />
            </div>

            <ul className="space-y-3">
              {/* Step 1 — Add your first offer */}
              <li className="flex items-start gap-3">
                {hasOffer ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-black">✓</span>
                ) : stepStripe ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-mint-fill" />
                ) : (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-default" />
                )}
                <div className="flex-1">
                  <div className={`text-sm font-semibold ${hasOffer ? "text-primary line-through decoration-mint-text" : "text-primary"}`}>
                    Add your first offer
                  </div>
                  <div className="text-xs text-secondary">
                    {hasOffer
                      ? "You have a live product or service customers can buy."
                      : "Pick one thing you sell and set a price."}
                  </div>
                  {!hasOffer && (
                    // Always route through /dashboard/post — the composer
                    // that calls /api/merchant/storefront/ensure on load,
                    // so the shop is created-or-found before the offer is
                    // added. The old `firstProject ? .../manage#offers`
                    // branch sent merchants who already had a storefront to
                    // the manage page, which has no offer form (settings /
                    // availability / bookings only) — a dead-end.
                    <Link
                      href="/dashboard/post"
                      className="mt-3 inline-flex items-center gap-2 rounded-lg bg-mint-fill px-5 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-mint-fill-ink transition hover:opacity-90"
                    >
                      Add offer →
                    </Link>
                  )}
                </div>
              </li>

              {/* Step 2 — Connect Stripe (after the fun part: offers first, SSN second) */}
              <li className="flex items-start gap-3">
                {stepStripe ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-black">✓</span>
                ) : (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-mint-fill" />
                )}
                <div className="flex-1">
                  <div className={`text-sm font-semibold ${stepStripe ? "text-primary line-through decoration-mint-text" : "text-primary"}`}>
                    Connect Stripe
                  </div>
                  <div className="text-xs text-secondary">
                    {stepStripe
                      ? "Your bank account is connected. You get paid directly on every sale."
                      : "Safe payout setup. Money goes straight to your bank. Takes about 2 minutes."}
                  </div>
                  {!stepStripe && (
                    <>
                      <div className="mt-3 rounded-xl border border-default bg-surface-muted/40 p-4">
                        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-mint-text">
                          Have these handy before you start
                        </div>
                        <ul className="mt-2 space-y-1.5 text-xs text-primary">
                          <li>• Business name and address</li>
                          <li>• Bank account and routing numbers (so we know where to send your money)</li>
                          <li>• Your SSN or EIN (same ID a bank asks for when you open an account)</li>
                        </ul>
                        <div className="mt-3 text-[11px] text-muted">
                          This is safe payout setup. Stripe is the same payment service Whatnot, Shopify, and Uber Eats use to pay their sellers. DUM Club never sees or stores your bank info. Stripe handles every sale and pays you directly.
                        </div>
                      </div>
                      <button
                        onClick={connectStripe}
                        disabled={connecting}
                        className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-mint-fill px-6 text-sm font-bold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                      >
                        {connecting ? "Opening Stripe..." : "Connect Stripe →"}
                      </button>
                      {connectError && (
                        <p role="alert" className="mt-2 text-xs font-medium text-rose-300">
                          {connectError}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </li>

              {/* Step 3 — Paste the snippet on your site */}
              <li className="flex items-start gap-3">
                {stepSnippet ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-black">✓</span>
                ) : hasOffer ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-mint-fill" />
                ) : (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-default" />
                )}
                <div className="flex-1">
                  <div className={`text-sm font-semibold ${stepSnippet ? "text-primary line-through decoration-mint-text" : "text-primary"}`}>
                    Add DUM Club to your website <span className="text-[11px] font-normal text-secondary">(optional)</span>
                  </div>
                  <div className="text-xs text-secondary">
                    {stepSnippet
                      ? "Your storefront is wired to your website."
                      : "One line of code. We walk you through it for Wix, Squarespace, Shopify, and WordPress. No website? Skip ahead, customers can still find your storefront on DUM Club."}
                  </div>
                  {!stepSnippet && (
                    <Link
                      href="/install"
                      className="mt-3 inline-flex items-center gap-2 rounded-lg bg-mint-fill px-5 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-mint-fill-ink transition hover:opacity-90"
                    >
                      Get my snippet →
                    </Link>
                  )}
                </div>
              </li>

              {/* Step 4 — Print your QR */}
              <li className="flex items-start gap-3">
                {qrPrinted ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-black">✓</span>
                ) : stepSnippet ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-mint-fill" />
                ) : (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-default" />
                )}
                <div className="flex-1">
                  <div className={`text-sm font-semibold ${qrPrinted ? "text-primary line-through decoration-mint-text" : "text-primary"}`}>
                    Print your QR
                  </div>
                  <div className="text-xs text-secondary">
                    {qrPrinted
                      ? "Stick it at your counter, register, or window."
                      : "A code customers scan to land on your storefront."}
                  </div>
                  {!qrPrinted && (
                    <Link
                      href="/qr"
                      className="mt-3 inline-flex items-center gap-2 rounded-lg bg-mint-fill px-5 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-mint-fill-ink transition hover:opacity-90"
                    >
                      Print my QR →
                    </Link>
                  )}
                </div>
              </li>

              {/* Step 5 — Go live for the first time */}
              <li className="flex items-start gap-3">
                {stepLiveEver ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-black">✓</span>
                ) : qrPrinted ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-mint-fill" />
                ) : (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-default" />
                )}
                <div className="flex-1">
                  <div className={`text-sm font-semibold ${stepLiveEver ? "text-primary line-through decoration-mint-text" : "text-primary"}`}>
                    Go live for the first time
                  </div>
                  <div className="text-xs text-secondary">
                    {stepLiveEver
                      ? "Customers can watch you and buy in real time."
                      : "Camera and mic on. Customers see you in real time on your own site."}
                  </div>
                  {!stepLiveEver && firstProject && (
                    <Link
                      href={`/project/${firstProject.slug || firstProject.id}#project-live-host`}
                      className="mt-3 inline-flex items-center gap-2 rounded-lg bg-mint-fill px-5 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-mint-fill-ink transition hover:opacity-90"
                    >
                      Go Live →
                    </Link>
                  )}
                </div>
              </li>
            </ul>
          </div>
        )}

        {/* Business info — folded into the identity strip when all green */}
        {!hubAllGreen && (
        <div className="rounded-2xl border border-default bg-surface-muted p-5">
          <h2 className="text-lg font-bold text-primary">{merchant.business_name}</h2>
          <div className="mt-1 flex items-center gap-2 text-sm text-secondary">
            {/* Some merchant rows carry the business NAME in business_type
                (signup prefill quirk), which printed the name twice back to
                back and read as a rendering bug (owner feedback,
                2026-07-02). Only show the type when it's a real type. */}
            {merchant.business_type &&
              merchant.business_type.trim().toLowerCase() !== (merchant.business_name || "").trim().toLowerCase() && (
                <span>{merchant.business_type}</span>
              )}
            {merchant.location_city && (
              <span>{merchant.location_city}{merchant.location_state ? `, ${merchant.location_state}` : ""}</span>
            )}
          </div>
        </div>
        )}

        {/* Connections. once onboarding is done this is the durable
            surface for managing the Stripe connection. While onboarding
            is in progress the checklist above is the primary CTA, so we
            only render this card when Stripe is already connected (to
            avoid duplicate "Connect" buttons). All-green hub: the strip's
            "Stripe ✓" chip covers it, so the card folds away too. */}
        {stepStripe && !hubAllGreen && (
        <div className="rounded-2xl border border-default bg-surface-muted p-5">
          <h3 className="mb-4 text-[11px] font-bold uppercase tracking-[0.2em] text-secondary">Payment Connections</h3>
          <div className="space-y-3">
            {/* Stripe Connect */}
            <div className="flex items-center justify-between rounded-xl border border-default bg-surface-card px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-sm font-bold text-violet-400">S</span>
                <div>
                  <div className="text-sm font-semibold text-primary">Stripe</div>
                  <div className="text-[11px] text-secondary">Receive payouts from live sales</div>
                </div>
              </div>
              {merchant.stripe_connect_id ? (
                <span className="rounded-full border border-default bg-mint-card px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-mint-text">Connected</span>
              ) : (
                <button onClick={connectStripe} disabled={connecting} className="rounded-lg border border-violet-400/30 bg-violet-400/10 px-4 py-2 text-xs font-bold text-violet-400 transition hover:bg-violet-400/20 disabled:cursor-not-allowed disabled:opacity-60">
                  {connecting ? "Opening..." : "Connect"}
                </button>
              )}
            </div>
            {connectError && (
              <p role="alert" className="mt-2 text-xs font-medium text-rose-300">
                {connectError}
              </p>
            )}
          </div>
        </div>
        )}

        {/* ── Stripe Verification card ──
            Re-skinned in Phase 2 of the merchant audit. The previous
            version always rendered with three "No"s right after
            Stripe connect, which read as "I'm broken" to a non-
            technical merchant. even though that's the normal
            "Stripe is reviewing your account" state.
            Render rules now (Q12):
              - status = verified    → not rendered (the checklist
                                       already says "Connect Stripe ✓")
              - has currently_due / disabled_reason → full diagnostic
              - status = pending and no issues → calm reassurance only
              - retrieve error          → support-friendly red panel
            Labels swapped from raw Stripe terms to merchant English
            (Q7); the raw API booleans now live behind a "What does
            this mean?" disclosure. */}
        {merchant.stripe_connect_id && (() => {
          // Compute render mode up-front so the JSX below stays
          // readable. Verified + no issues = nothing to show.
          const hasRetrieveError = !!stripeStatusError;
          const hasOpenRequirements =
            !!stripeStatus &&
            (stripeStatus.requirements_currently_due.length > 0 ||
              !!stripeStatus.disabled_reason);
          const isVerified =
            !!stripeStatus && stripeStatus.status === "verified";
          const isPendingClean =
            !!stripeStatus &&
            !isVerified &&
            !hasOpenRequirements;

          // Skip rendering entirely when fully verified. the
          // checklist already conveys the success state and a
          // "Verified" pill on its own is noise.
          if (isVerified && !hasRetrieveError) return null;

          // Also skip when the live status check merely failed but the
          // cached merchant row already says Stripe is connected. The
          // "Payment connections · CONNECTED" card right above is the
          // truth the merchant needs; an amber "Couldn't reach Stripe
          // just now" box directly under a green CONNECTED badge read
          // as a contradiction and made the page feel broken (owner
          // feedback, 2026-07-02). The next visit re-checks quietly.
          if (
            hasRetrieveError &&
            !stripeStatus &&
            (merchant?.stripe_connect_status === "connected" ||
              merchant?.stripe_connect_status === "verified")
          ) return null;

          return (
            <div className="rounded-2xl border border-default bg-surface-muted p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-secondary">Stripe</h3>
                {stripeStatus && (
                  <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${
                    stripeStatus.status === "verified"
                      ? "border-default bg-mint-card text-mint-text"
                      : stripeStatus.status === "restricted"
                        ? "border-red-400/30 bg-red-400/10 text-state-live"
                        : "border-amber-400/30 bg-amber-400/10 text-amber-400"
                  }`}>
                    {stripeStatus.status === "pending_verification"
                      ? "Stripe is reviewing"
                      : stripeStatus.status === "verified"
                        ? "Verified"
                        : stripeStatus.status === "restricted"
                          ? "Action needed"
                          : "Not connected"}
                  </span>
                )}
              </div>

              {hasRetrieveError ? (
                // Soft amber, not red. The "Payment Connections" panel
                // above already shows Stripe as CONNECTED from the cached
                // merchant row, so a retrieve failure here is a transient
                // network blip. not a "your account is broken" event.
                // The amber colour reflects "we'll re-check"; the inline
                // Retry button gives the merchant agency without forcing
                // a full page refresh.
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
                  <div className="text-xs font-bold text-amber-300">Couldn&apos;t reach Stripe just now</div>
                  <div className="mt-1 text-[11px] text-secondary">
                    Your Stripe connection is fine. We just couldn&apos;t pull the live verification status this time. Try again in a moment.
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const t = await getToken();
                      if (t) loadStripeStatus(t);
                    }}
                    className="mt-3 inline-flex items-center gap-1 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-300 transition hover:border-amber-400/50 hover:text-amber-200"
                  >
                    Retry verification
                  </button>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.12em] text-amber-300/50 hover:text-amber-300/80">
                      Show technical details
                    </summary>
                    <div className="mt-1.5 font-mono text-[10px] text-amber-300/60 break-all">
                      {stripeStatusError}
                    </div>
                  </details>
                </div>
              ) : !stripeStatus ? (
                <div className="text-[11px] text-secondary">Loading…</div>
              ) : isPendingClean ? (
                /* Q8: calm reassurance for the common post-connect
                   case. Stripe is reviewing, nothing for the
                   merchant to do, no scary "all No" grid. */
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
                  <div className="text-sm font-bold text-amber-400">
                    Stripe is reviewing your account
                  </div>
                  <div className="mt-1 text-[12px] leading-relaxed text-primary">
                    This usually takes a few minutes. We&apos;ll show
                    &ldquo;Verified&rdquo; here as soon as Stripe finishes. you don&apos;t need to do anything else right now.
                  </div>
                  {/* Raw booleans behind a disclosure for the
                      curious / for support sessions. Default-collapsed
                      so a normal merchant never sees them. */}
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.12em] text-secondary hover:text-primary">
                      What does this mean?
                    </summary>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {([
                        ["Can accept payments", stripeStatus.charges_enabled],
                        ["Can receive payouts", stripeStatus.payouts_enabled],
                        ["Identity submitted", stripeStatus.details_submitted],
                      ] as const).map(([label, ok]) => (
                        <div key={label} className="rounded-lg border border-default bg-surface-card px-3 py-2">
                          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-secondary">{label}</div>
                          <div className={`mt-0.5 text-xs font-bold ${ok ? "text-mint-text" : "text-secondary"}`}>
                            {ok ? "✓ Ready" : "— Pending"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              ) : (
                /* Action-needed case: full diagnostic with merchant-
                   language labels and a Finish-on-Stripe CTA. */
                <div className="space-y-4">
                  {stripeStatus.disabled_reason && (
                    <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-state-live">Action needed</div>
                      <div className="mt-1 text-[11px] text-secondary">
                        Stripe has paused this account. Open the Stripe dashboard to see what&apos;s needed and resolve it.
                      </div>
                      {/* Raw Stripe disabled_reason hidden behind
                          disclosure. it's typically a code string
                          like "rejected.platform_fraud" that
                          confuses merchants. */}
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.12em] text-state-live/60 hover:text-state-live/80">
                          Show technical details
                        </summary>
                        <div className="mt-1.5 font-mono text-[10px] text-state-live/60 break-all">
                          {stripeStatus.disabled_reason}
                        </div>
                      </details>
                    </div>
                  )}

                  {stripeStatus.requirements_currently_due.length > 0 && (
                    <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-400">
                        Stripe needs a bit more info ({stripeStatus.requirements_currently_due.length} item{stripeStatus.requirements_currently_due.length === 1 ? "" : "s"})
                      </div>
                      <div className="mt-1 text-[11px] text-secondary">
                        Open the Stripe dashboard to finish. you&apos;ll come right back here when it&apos;s done.
                      </div>
                      {/* Raw requirement codes behind a disclosure.
                          They look like "external_account",
                          "tos_acceptance.date", "person.dob.day" —
                          jargon to a non-technical merchant. */}
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.12em] text-secondary hover:text-primary">
                          Show technical details
                        </summary>
                        <ul className="mt-1.5 space-y-0.5 text-[11px] text-secondary">
                          {stripeStatus.requirements_currently_due.map((r) => (
                            <li key={r} className="font-mono">• {r}</li>
                          ))}
                        </ul>
                      </details>
                      <a
                        href="https://dashboard.stripe.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex items-center gap-1 rounded-lg bg-amber-400/15 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-400 transition hover:bg-amber-400/25"
                      >
                        Finish on Stripe →
                      </a>
                    </div>
                  )}

                  {/* Eventually-due requirements stay behind a
                      disclosure. same as before; not surfaced to
                      casual readers. */}
                  {stripeStatus.requirements_eventually_due.length > 0 && (
                    <details className="rounded-xl border border-default bg-surface-card p-3">
                      <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.12em] text-secondary">
                        Coming up later ({stripeStatus.requirements_eventually_due.length})
                      </summary>
                      <div className="mt-1.5 text-[11px] text-secondary">
                        Stripe will ask for these eventually. No rush.
                      </div>
                      <ul className="mt-1.5 space-y-0.5 text-[11px] text-secondary">
                        {stripeStatus.requirements_eventually_due.map((r) => (
                          <li key={r} className="font-mono">• {r}</li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {/* Raw boolean grid hidden behind a "What does this
                      mean?" disclosure. Phase 2 surfaces only
                      merchant-language labels by default. */}
                  <details className="rounded-xl border border-default bg-surface-card p-3">
                    <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.12em] text-secondary hover:text-primary">
                      What does this mean?
                    </summary>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {([
                        ["Can accept payments", stripeStatus.charges_enabled],
                        ["Can receive payouts", stripeStatus.payouts_enabled],
                        ["Identity submitted", stripeStatus.details_submitted],
                      ] as const).map(([label, ok]) => (
                        <div key={label} className="rounded-lg border border-default bg-surface-card px-3 py-2">
                          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-secondary">{label}</div>
                          <div className={`mt-0.5 text-xs font-bold ${ok ? "text-mint-text" : "text-secondary"}`}>
                            {ok ? "✓ Ready" : "— Pending"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}
            </div>
          );
        })()}

        {/* Stats
            Empty-state: until the first sale lands, showing four zeros
            is demoralising and useless. Replace with a single "no data
            yet" panel and a concrete next-action CTA. The real grid
            only kicks in once there's something to measure. */}
        {stepFirstSale ? (
          /* Stat tiles — handoff light system (merchant-hub-modern,
             2026-07-06): white cards, hairline borders, soft shadow,
             GeistMono numerals, mint for money. Replaces the four
             mismatched gray boxes with legacy teal/amber accents. */
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl border border-default bg-surface-card p-5 shadow-sm">
              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-secondary">Transactions</div>
              <div className="mt-2 font-mono text-2xl font-bold text-primary">{analytics?.total_orders ?? 0}</div>
              <div className="text-xs text-muted">total</div>
            </div>
            <div className="rounded-2xl border border-default bg-surface-card p-5 shadow-sm">
              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-secondary">Revenue</div>
              <div className="mt-2 font-mono text-2xl font-bold text-mint-text">${(analytics?.total_revenue_usd ?? 0).toFixed(2)}</div>
              <div className="text-xs text-muted">you keep 98.5% · 1.5% sales fee</div>
            </div>
            <div className="rounded-2xl border border-default bg-surface-card p-5 shadow-sm">
              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-secondary">DUM Issued</div>
              <div className="mt-2 font-mono text-2xl font-bold text-primary">{analytics?.total_dum_received ?? 0}</div>
              <div className="text-xs text-muted">to customers</div>
            </div>
            <div className="rounded-2xl border border-default bg-surface-card p-5 shadow-sm">
              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-secondary">Page Views</div>
              <div className="mt-2 font-mono text-2xl font-bold text-primary">{analytics?.total_views ?? 0}</div>
              <div className="text-xs text-muted">total</div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-default bg-surface-muted p-6 text-center">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-secondary">
              Your numbers show up here
            </div>
            <div className="text-base font-semibold text-primary">
              Transactions · Revenue · Page Views
            </div>
            <p className="mx-auto mt-2 max-w-sm text-sm text-secondary">
              Once your first sale lands, this panel lights up with live stats.
              No data yet. let's get you your first sale.
            </p>
            <Link
              href="/dashboard"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-mint-fill px-5 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-mint-fill-ink transition hover:opacity-90"
            >
              Set Up My Listing →
            </Link>
          </div>
        )}

        {/* Replay loop (queue 17) — record shows, loop the latest while
            offline. Renders once status loads; hides entirely when the
            operator hasn't armed recording AND nothing is recorded, so
            merchants never see a switch that can't do anything. */}
        {replayEnabled !== null && (replayInfo?.recording_armed || replayInfo?.playback_url || showcaseUploadEnabled) && (
          <div className="rounded-2xl border border-default bg-surface-card p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-secondary">Your Shop Video</h3>
                <p className="mt-1 text-sm font-semibold text-primary">
                  Loop my last show while I&apos;m offline
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {replayInfo?.playback_url
                    ? `Latest recording${replayInfo.recorded_at ? ` · ${new Date(replayInfo.recorded_at).toLocaleDateString()}` : ""} plays on your storefront when you're not live.`
                    : "Your next live show records automatically and starts looping on your storefront."}
                </p>
              </div>
              <button
                type="button"
                onClick={toggleReplay}
                disabled={replaySaving}
                aria-pressed={replayEnabled}
                className={`relative h-7 w-12 shrink-0 rounded-full transition ${replayEnabled ? "bg-mint-fill" : "bg-surface-muted border border-default"} disabled:opacity-50`}
              >
                <span
                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${replayEnabled ? "left-[1.4rem]" : "left-0.5"}`}
                />
              </button>
            </div>

            {/* Showcase upload (queue 18): video without going live. On a
                phone this opens the camera; on desktop it's a file picker.
                5-minute guidance, 500MB hard cap (also enforced server-side). */}
            {showcaseUploadEnabled && (
              <div className="mt-4 border-t border-default pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-primary">No time to go live?</p>
                    <p className="text-xs text-muted">
                      Film up to 5 minutes on your phone. It plays on your shop the same way.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => showcaseFileRef.current?.click()}
                    disabled={showcaseUploading}
                    className="rounded-lg bg-mint-fill px-4 py-2 text-xs font-bold uppercase tracking-[0.1em] text-mint-fill-ink transition hover:opacity-90 disabled:opacity-50"
                  >
                    {showcaseUploading ? "Uploading…" : "Record or upload"}
                  </button>
                  <input
                    ref={showcaseFileRef}
                    type="file"
                    accept="video/mp4,video/quicktime,video/webm"
                    capture
                    className="hidden"
                    onChange={(e) => handleShowcaseFile(e.target.files?.[0] ?? null)}
                  />
                </div>
                {showcaseError && (
                  <p className="mt-2 text-xs font-medium text-state-live">{showcaseError}</p>
                )}
                {/* Picker — only when BOTH sources exist (founder decision:
                    the merchant chooses what plays). */}
                {showcaseVideos.length > 1 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {showcaseVideos.map((v) => (
                      <button
                        key={v.source}
                        type="button"
                        onClick={() => activateShowcase(v.source)}
                        aria-pressed={v.is_active}
                        className={`rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${
                          v.is_active
                            ? "border-mint-fill bg-mint-fill/15 text-mint-text"
                            : "border-default bg-surface-card text-secondary hover:border-strong"
                        }`}
                      >
                        {v.source === "upload" ? "My uploaded video" : "Last live show"}
                        {v.is_active ? " · plays on your shop" : ""}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* QR Code */}
        <div className="rounded-2xl border border-default bg-surface-muted p-5">
          <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-secondary">Your QR Code</h3>
          <div className="flex items-center gap-4">
            <div className="flex h-32 w-32 items-center justify-center rounded-xl border border-default bg-white p-2">
              {/* QR code generator. Google's chart.googleapis.com endpoint
                  was retired in 2024 and now 404s, which is why this image
                  was rendering as a broken placeholder. Switched to the
                  free api.qrserver.com generator (same query shape, returns
                  a PNG of the encoded URL). */}
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrUrl)}`}
                alt="QR Code"
                className="h-full w-full"
              />
            </div>
            <div>
              <p className="text-sm text-secondary">Print this and display at your register.</p>
              <p className="text-xs text-secondary mt-1">Customers scan to open your storefront.</p>
              <a
                href={`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qrUrl)}`}
                download="dum-club-qr.png"
                onClick={() => {
                  // Downloading the QR from THIS card is printing your QR —
                  // the checklist step used to complete only via the /qr
                  // page, so merchants who used this card stayed 4/5
                  // forever (founder bug report 2026-07-06).
                  try {
                    window.localStorage.setItem("dum-qr-seen", "1");
                  } catch {
                    /* private mode — non-blocking */
                  }
                  setQrPrinted(true);
                }}
                className="mt-3 inline-block rounded-lg border border-default px-4 py-2 text-xs font-semibold text-primary transition hover:border-strong"
              >
                Download QR
              </a>
            </div>
          </div>
        </div>

        {/* Quick links. the two next-actions a converted merchant
            actually needs. The previous bottom-row had "Manage My
            Business" + "Browse Marketplace"; the second one routed
            converted merchants to the buyer-side /discover page,
            which is the wrong audience after they've already signed
            up. Phase 3 of the merchant audit replaced it with the
            "Add DUM Live to your website" deep-link so the merchant
            home consistently surfaces the activation moment instead
            of letting it hide on the project page. */}
        <div className="flex gap-3">
          <Link
            href={installLink}
            className="flex-1 rounded-xl border border-default bg-mint-card px-4 py-3 text-center text-sm font-semibold text-mint-text transition hover:bg-mint-card"
          >
            Add DUM Live to your website →
          </Link>
          <Link
            href="/dashboard"
            className="flex-1 rounded-xl border border-default bg-surface-muted px-4 py-3 text-center text-sm text-secondary transition hover:border-default hover:text-primary"
          >
            Manage My Business
          </Link>
        </div>
      </div>
    </div>
  );
}
