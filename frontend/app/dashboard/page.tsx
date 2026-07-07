"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, Calendar } from "lucide-react";
import { Eyebrow, Badge } from "../../components/ui";
import { useAuth } from "../../lib/auth/AuthContext";
import { getTier } from "../../lib/dumTiers";
import { hasAnalyticsAccess } from "../../lib/merchantTier";
import { DriveYourMarketAnalytics } from "../../components/DriveYourMarketAnalytics";
import { UpgradeAnalyticsCard } from "../../components/UpgradeAnalyticsCard";
import { PopInSettings } from "../../components/PopInSettings";
import { EmbedDisplayModeCard } from "../../components/EmbedDisplayModeCard";
import { MerchantInbox } from "../../components/dashboard/MerchantInbox";
import { GetLiveSteps } from "../../components/GetLiveSteps";
import { StripeResumeBanner } from "../../components/StripeResumeBanner";
import { TrialCountdownBanner } from "../../components/TrialCountdownBanner";
import { SubscriptionStatusBar } from "../../components/SubscriptionStatusBar";
import { MerchantNextStep } from "../../components/MerchantNextStep";
import { MerchantImageUploader } from "../../components/dashboard/MerchantImageUploader";
import { ScheduleNextLiveCard } from "../../components/ScheduleNextLiveCard";

type Project = {
  id: number | string;
  slug?: string | null;
  name?: string;
  title?: string;
  description?: string;
  template_type?: string;
  status?: string;
  review_status?: string | null;
  // Outer embed display mode (migration 040). Controls how DUM Club
  // appears on the merchant's own website. One of bubble / full /
  // automatic. Default automatic.
  embed_display_mode?: "bubble" | "full" | "automatic" | null;
  // Live state (used by the progress flow).
  is_live?: boolean | null;
  // Pinned-offer signal — non-null id means an offer is pinned as
  // the featured item. Surfaced in GetLiveSteps so the merchant
  // sees pinning as its own checklist step before Go Live.
  pinned_offer_id?: string | null;
  // Next scheduled go-live (ISO 8601, TIMESTAMPTZ in DB). Drives
  // the storefront "Going live..." banner + the dashboard schedule
  // input. Migration 064.
  scheduled_live_at?: string | null;
  // Merchant opt-in: schedule_rollforward cron auto-advances
  // scheduled_live_at by +7 days after each slot passes.
  // Migration 066.
  recurring_weekly?: boolean | null;
  // DUM Pop-In Seller merchant settings (migration 038, PR #135).
  // Recorded-video mode added via PR for Mode B (migration 039 +
  // popin_config.video_url).
  popin_config?: {
    enabled?: boolean;
    greeting?: string;
    returning_greeting?: string;
    delay_seconds?: number;
    once_per_session?: boolean;
    offer_id?: string | null;
    mode?: "bubble" | "recorded" | "live" | "auto";
    video_url?: string | null;
  } | null;
  // Canonical category from the seeded categories table (mig 035).
  // Drives the storefront badge + /discover filter pill. NULL until
  // the merchant picks one in the dashboard.
  category_id?: string | null;
  // Which business this storefront belongs to (projects.business_profile_id,
  // mig 014/055 FK). NULL for legacy/unlinked storefronts. Drives the
  // per-project business pill + the multi-business grid filter.
  business_profile_id?: string | null;
};

// VERB_GROUPED_CATEGORIES comes from lib/discover/verbs.ts — the same
// truth shared with the offer composer's category select (#349). See
// the FK-safety note over there.

import { API_BASE } from "../../lib/apiBase";
import { VERB_GROUPED_CATEGORIES } from "../../lib/discover/verbs";

// Storefront status on the dashboard collapses to two merchant-facing
// states: a published storefront reads LIVE, everything else reads
// OFFLINE. We deliberately don't surface review / approval / pending
// states here — they read like a gatekeeping process to a brand-new
// merchant. The submit-for-review / publish path lives on the
// storefront page itself. Rendered via the LIVE/OFFLINE <Badge> on
// each business card below.

export default function DashboardPage() {
  const { user, getToken, loading: authLoading } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  // Hydration guards. AuthContext reports loading=true while Privy's
  // `ready` flag is still flipping (user?.privyId undefined for a render
  // or two). Without gating on these, a signed-in merchant briefly saw
  // "Not signed in" and "0 storefronts / wrong next step" on hard
  // refresh before the data fetches returned. Each flag flips true once
  // its fetch settles (success OR failure), so the gates never hang.
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [merchantLoaded, setMerchantLoaded] = useState(false);
  const [bizLoaded, setBizLoaded] = useState(false);
  const [deletingId, setDeletingId] = useState<string | number | null>(null);
  const [dumBalance, setDumBalance] = useState(0);
  const [bizProfile, setBizProfile] = useState<any>(null);
  // All of the owner's businesses (multi-business switcher). The dropdown
  // only renders when length > 1, so single-business owners see no change.
  const [businesses, setBusinesses] = useState<any[]>([]);
  const [creatingStorefront, setCreatingStorefront] = useState(false);
  const [bizLoading, setBizLoading] = useState(false);
  // Drive Your Market Analytics — merchant subscription_tier drives the
  // tier gate. Loaded once when the user is known; null while loading.
  const [merchant, setMerchant] = useState<{
    subscription_tier?: string;
    stripe_connect_status?: string | null;
    business_type?: string | null;
  } | null>(null);
  const [showBizForm, setShowBizForm] = useState(false);
  const [bizName, setBizName] = useState("");
  const [bizCategory, setBizCategory] = useState("General");
  const [bizDesc, setBizDesc] = useState("");
  const [bizEmail, setBizEmail] = useState("");
  const [bizWebsite, setBizWebsite] = useState("");
  // True when the create-business form was prefilled from the connected
  // Stripe account, so we can show the "edit before saving" note.
  const [prefilledFromStripe, setPrefilledFromStripe] = useState(false);
  const [bizSaving, setBizSaving] = useState(false);
  const [analytics, setAnalytics] = useState<any>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  // Settles true once the analytics fetch completes (success OR
  // failure). Used by the next-step gate so a failed analytics call
  // doesn't strand the card in a skeleton forever.
  const [analyticsLoaded, setAnalyticsLoaded] = useState(false);

  // Inline action feedback, replacing the blocking window.alert() this
  // page used to fire. tone drives the color. Auto-dismisses after a few
  // seconds and can be closed by hand.
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  function showNotice(tone: "error" | "success", text: string) {
    setNotice({ tone, text });
  }
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    async function loadDum() {
      const privyId = user?.privyId;
      if (privyId) {
        try {
          const res = await fetch(`${API_BASE}/api/dum/balance/${encodeURIComponent(privyId)}`);
          if (res.ok) {
            const data = await res.json();
            setDumBalance(data.balance ?? 0);
            localStorage.setItem("dum_points", String(data.balance ?? 0));
            return;
          }
        } catch {}
      }
      setDumBalance(Number(localStorage.getItem("dum_points") || "0"));
    }
    loadDum();
    const handler = () => setDumBalance(Number(localStorage.getItem("dum_points") || "0"));
    window.addEventListener("dum-points-update", handler);
    return () => window.removeEventListener("dum-points-update", handler);
  }, [user]);

  const loadProjects = useCallback(async () => {
    if (!user?.privyId) {
      setProjects([]);
      return;
    }
    try {
      const res = await fetch(
        `${API_BASE}/api/projects/?owner_id=${encodeURIComponent(user.privyId)}`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail || "Failed to load projects");
      }
      const data = await res.json();
      setProjects(data.projects || data || []);
    } catch (err) {
      console.error(err);
      setProjects([]);
    } finally {
      setProjectsLoaded(true);
    }
  }, [user?.privyId]);

  useEffect(() => {
    if (!user?.privyId) return;
    fetch(
      `${API_BASE}/api/projects/backfill-owner?owner_id=${encodeURIComponent(user.privyId)}`,
      { method: "POST" }
    )
      .then((r) => r.json())
      .then((data) => {
        // backfill result intentionally not logged; surfaced via UI if needed
        void data;
      })
      .catch(() => {})
      .finally(() => loadProjects());
  }, [user?.privyId, loadProjects]);

  // Load business profile(s). Fetches the full list for the switcher,
  // then loads the first business's full profile into bizProfile.
  useEffect(() => {
    if (!user?.privyId) return;
    async function loadBiz() {
      try {
        const token = await getToken();
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        let list: any[] = [];
        const listRes = await fetch(`${API_BASE}/api/business/list`, { headers });
        if (listRes.ok) {
          list = (await listRes.json()).businesses || [];
          setBusinesses(list);
        }
        // Load the first business's full profile (no business_id => first).
        const meUrl = list[0]?.id
          ? `${API_BASE}/api/business/me?business_id=${encodeURIComponent(list[0].id)}`
          : `${API_BASE}/api/business/me`;
        const res = await fetch(meUrl, { headers });
        if (res.ok) {
          const data = await res.json();
          setBizProfile(data.profile || null);
        }
      } catch {} finally {
        setBizLoaded(true);
      }
    }
    loadBiz();
  }, [user?.privyId]);

  // Switch the active business — loads its full profile so the card +
  // image uploader + verification target the chosen brand.
  async function selectBusiness(id: string) {
    try {
      const token = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(
        `${API_BASE}/api/business/me?business_id=${encodeURIComponent(id)}`,
        { headers },
      );
      if (res.ok) {
        const data = await res.json();
        setBizProfile(data.profile || null);
      }
    } catch {}
  }

  // Create a storefront (project) attached to a chosen business. Per-business
  // idempotent on the backend, so re-clicking returns the existing one.
  async function createStorefrontForBusiness(businessId: string) {
    if (!businessId || creatingStorefront) return;
    setCreatingStorefront(true);
    try {
      const token = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(
        `${API_BASE}/api/merchant/storefront/ensure?business_id=${encodeURIComponent(businessId)}`,
        { method: "POST", headers },
      );
      if (res.ok) {
        const j = await res.json();
        if (j?.ok && j?.project) {
          await loadProjects();
        } else if (j && j.ok === false) {
          showNotice("error", j.error || "We couldn't create your storefront. Please try again.");
        }
      } else {
        console.warn(`[dashboard] storefront ensure failed: HTTP ${res.status}`);
        showNotice("error", "We couldn't set up your storefront. Please try again.");
      }
    } catch {
      showNotice("error", "Network problem. Please check your connection and try again.");
    } finally {
      setCreatingStorefront(false);
    }
  }

  // Load merchant record (for the Drive Your Market Analytics tier gate)
  useEffect(() => {
    if (!user?.privyId) return;
    (async () => {
      try {
        const token = await getToken();
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(`${API_BASE}/api/merchant/me`, { headers });
        if (res.ok) {
          const data = await res.json();
          setMerchant(data.merchant || null);
        }
      } catch {
        // tier gate falls open to "no access" → upgrade card. Safe.
      } finally {
        setMerchantLoaded(true);
      }
    })();
  }, [user?.privyId]);

  // Load business analytics
  useEffect(() => {
    if (!bizProfile || !user) return;
    setAnalyticsLoading(true);
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`${API_BASE}/api/business/analytics`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setAnalytics(data);
        }
        // Non-OK responses (401/etc.) silently no-op — analytics is a
        // best-effort enrichment, not a hard requirement for /dashboard.
      } catch {} finally {
        setAnalyticsLoading(false);
        setAnalyticsLoaded(true);
      }
    })();
  }, [bizProfile, user]);

  // Open the create-business form and, when the owner has a connected
  // Stripe account, prefill identity fields from it. Non-destructive:
  // only fills fields that are still empty, never clobbers typed input.
  async function openBizForm() {
    setShowBizForm(true);
    try {
      const token = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/api/business/stripe-prefill`, { headers });
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.connected || !data?.suggested) return;
      const s = data.suggested;
      let applied = false;
      setBizName((v) => { if (!v.trim() && s.business_name?.trim()) { applied = true; return s.business_name.trim(); } return v; });
      setBizEmail((v) => { if (!v.trim() && s.contact_email?.trim()) { applied = true; return s.contact_email.trim(); } return v; });
      setBizWebsite((v) => { if (!v.trim() && s.website?.trim()) { applied = true; return s.website.trim(); } return v; });
      setBizDesc((v) => { if (!v.trim() && s.short_description?.trim()) { applied = true; return s.short_description.trim(); } return v; });
      setBizCategory((v) => { if ((!v || v === "General") && s.category && s.category !== "General") { applied = true; return s.category; } return v; });
      if (applied) setPrefilledFromStripe(true);
    } catch {
      // Best-effort — a failed prefill just leaves the form blank.
    }
  }

  async function createBusiness() {
    if (!bizName.trim() || bizSaving) return;
    setBizSaving(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/business/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          business_name: bizName.trim(),
          category: bizCategory,
          short_description: bizDesc.trim() || null,
          contact_email: bizEmail.trim() || null,
          website: bizWebsite.trim() || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setBizProfile(data.profile);
        setShowBizForm(false);
      } else {
        const err = await res.json().catch(() => ({}));
        showNotice("error", err.detail || "We couldn't create your business profile. Please try again.");
      }
    } catch (err) {
      console.error("[dashboard] createBusiness failed", err);
      showNotice("error", "We couldn't create your business profile. Please try again.");
    } finally {
      setBizSaving(false);
    }
  }

  async function deleteProject(project: Project) {
    if (!user?.privyId) return;
    const label = project.title || project.name || "this project";
    if (!confirm(`Remove "${label}" from your dashboard? This cannot be undone.`)) return;

    setDeletingId(project.id);
    try {
      const res = await fetch(
        `${API_BASE}/api/projects/${project.id}?owner_id=${encodeURIComponent(user.privyId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail || "Failed to delete project");
      }
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
    } catch (err) {
      console.error(err);
      showNotice("error", err instanceof Error ? err.message : "We couldn't remove that storefront. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  // Set the merchant's canonical category on a specific project. The
  // dropdown only offers mig-035 seed ids, so the FK constraint at
  // DB level can't reject from the UI. We PATCH and update local
  // state optimistically; on error, the alert pattern mirrors the
  // existing dashboard PATCH callers.
  async function updateProjectCategory(projectId: string | number, categoryId: string) {
    if (!user?.privyId || !categoryId) return;
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Owner-Id": user.privyId,
        },
        body: JSON.stringify({ category_id: categoryId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail || "Could not save category");
      }
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, category_id: categoryId } : p)),
      );
    } catch (err) {
      console.error(err);
      showNotice("error", err instanceof Error ? err.message : "We couldn't save the category. Please try again.");
    }
  }

  // LIVE vs broadcasting: a storefront reads "LIVE" to a merchant when
  // status === "live" (published / discoverable), NOT when is_live is
  // true (camera-on, IVS session running). #231 briefly conflated the
  // two and got it wrong. The per-business cards below surface this via
  // the LIVE/OFFLINE badge off project.status; is_live stays the right
  // field for the host card's broadcast indicator — different concept,
  // different consumer.

  // "Fully onboarded" = merchant has finished the three setup steps the
  // dashboard's other cards prompt for. Used to hide the "Become a
  // Merchant" quick-action card so a merchant who already completed
  // signup doesn't see a card pushing them back to signup.
  const isFullyOnboarded = Boolean(
    merchant?.stripe_connect_status === "verified" &&
    bizProfile &&
    projects.some((p) => p.status === "live")
  );

  // "needsFirstOffer" — Stripe is verified and a project exists, but the
  // analytics roll-up shows zero offers. This is the moment where the
  // dashboard should collapse competing prompts and elevate ONE
  // dominant CTA: post the first offer. analytics may be null on first
  // render; when it is, needsFirstOffer stays false so we don't hide
  // surfaces prematurely.
  const needsFirstOffer = Boolean(
    merchant?.stripe_connect_status === "verified" &&
    projects.length > 0 &&
    analytics &&
    (!Array.isArray(analytics.top_offers) || analytics.top_offers.length === 0)
  );

  // "isPreSelling" = STATE_1: a merchant with no posted offer and no
  // sale yet. In this state the dashboard hides activity surfaces
  // (analytics, the My Orders quick action, explore-other-businesses)
  // so the only ask on screen is the primary next step. Mirrors the
  // STATE_1 line in lib/merchantState.ts. Requires analytics to have
  // loaded so we don't hide surfaces during the first render (matches
  // needsFirstOffer's null-guard philosophy).
  const hasPostedOffer = Boolean(
    analytics && Array.isArray(analytics.top_offers) && analytics.top_offers.length > 0
  );
  const hasMadeSale = Boolean(analytics && (analytics.total_orders || 0) > 0);

  const isPreSelling = Boolean(merchant) && Boolean(analytics) && !hasPostedOffer && !hasMadeSale;

  // ── Dashboard tabs (simplification pass, 2026-07-03) ──
  // One action-focused Overview; depth behind Storefronts / Orders /
  // Analytics. Tabs only activate for a real merchant with at least one
  // storefront — brand-new visitors keep the single guided flow.
  const [dashTab, setDashTab] = useState<"overview" | "storefronts" | "orders" | "analytics">("overview");
  // Also requires a business profile and post-first-sale state: a
  // pre-selling merchant would land on empty Orders/Analytics tabs,
  // so they keep the guided single-scroll flow until data exists.
  const tabsActive = Boolean(user && merchant && projects.length > 0 && bizProfile && !isPreSelling);
  const showOverview = !tabsActive || dashTab === "overview";
  const showStorefronts = !tabsActive || dashTab === "storefronts";
  const showOrders = !tabsActive || dashTab === "orders";
  const showAnalytics = !tabsActive || dashTab === "analytics";

  // Core merchant data needed before the next-step card can show an
  // ACCURATE step. Until merchant + business profile + projects settle,
  // deriveMerchantState would walk through wrong early steps ("Create
  // your shop", "Connect Stripe") for an already-set-up merchant.
  // analytics only matters once a business profile exists — it drives
  // the offer/sales counts that separate create_offer / share / repeat;
  // a profile-less merchant doesn't wait on it.
  const analyticsReady = !bizProfile || analyticsLoaded;
  const coreLoaded = merchantLoaded && bizLoaded && projectsLoaded && analyticsReady;

  // Auth-hydration skeleton. While Privy is still resolving, show a
  // neutral skeleton instead of the signed-out "Sign in" CTA / empty
  // dashboard — otherwise a signed-in merchant sees a flash of "Not
  // signed in" on hard refresh. Mirrors the same guard on /install.
  if (authLoading) {
    return (
      <div className="relative min-h-screen bg-surface-page px-4 py-12 text-primary sm:px-6" aria-busy="true">
        <div className="relative z-[1] mx-auto max-w-5xl">
          <div className="mb-6 h-10 w-2/3 animate-pulse rounded bg-surface-muted" />
          <div className="mb-8 h-24 w-full animate-pulse rounded-2xl bg-surface-card" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="h-40 animate-pulse rounded-2xl bg-surface-card" />
            <div className="h-40 animate-pulse rounded-2xl bg-surface-card" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-surface-page px-4 py-12 text-primary sm:px-6">
      {/* Inline action feedback banner (replaces window.alert). */}
      {notice && (
        <div
          role="alert"
          className={`fixed left-1/2 top-4 z-[200] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg ${
            notice.tone === "error"
              ? "border-rose-400/30 bg-rose-500/10 text-rose-200"
              : "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <span>{notice.text}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Dismiss"
              className="shrink-0 text-lg leading-none opacity-70 transition hover:opacity-100"
            >
              ×
            </button>
          </div>
        </div>
      )}
      <div className="relative z-[1] mx-auto max-w-5xl">

        {/* Header */}
        <div className="mb-6">
          <Eyebrow tone="muted">Dashboard</Eyebrow>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-primary sm:text-4xl">
            Your DUM Club shop
          </h1>
          <p className="mt-2 text-sm text-secondary">Everything you sold, paid, and have left to set up.</p>
        </div>

        {/* Subscription status bar. Top of dashboard, above the primary
            action card, because plan / pricing / fee / Stripe state are
            trust signals — the merchant should see them before taking
            any action. Renders one of four variants (founder / trial /
            paid / fallback) based on /api/merchant/trial-status. Never
            blocks the dashboard render. */}
        {user && (
          <SubscriptionStatusBar
            getToken={getToken}
            stripeConnectStatus={merchant?.stripe_connect_status}
          />
        )}

        {/* Tab bar — Whatnot-style seller hub: Overview is the action
            surface; everything deeper lives one tap away. */}
        {tabsActive && (
          <div className="mb-6 flex flex-wrap gap-1 rounded-full border border-default bg-surface-card p-1 shadow-dum-card sm:inline-flex">
            {([
              ["overview", "Overview"],
              ["storefronts", "Storefronts"],
              ["orders", "Orders"],
              ["analytics", "Analytics"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setDashTab(id)}
                aria-pressed={dashTab === id}
                className={`rounded-full px-4 py-2 text-sm font-bold transition ${
                  dashTab === id
                    ? "bg-mint-fill text-mint-fill-ink shadow-sm"
                    : "text-secondary hover:text-primary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Two-column hero row — the "go live, front and center" surface
            from the streamlined-dashboard handoff. LEFT is the dark navy
            Go-Live card (the single obvious entry point, replacing the
            buried go-live links); RIGHT is a condensed setup checklist
            mirroring the four pre-merchant onboarding gates. Both are
            wired to existing entry points / derived state — no new data,
            no new endpoints. Renders once core merchant data settles so
            the checklist and the Go-Live target are accurate. */}
        {showOverview && user && coreLoaded && (() => {
          const primary = projects.find((p) => p.status === "live") ?? projects[0] ?? null;
          const primaryRef = primary ? (primary.slug || primary.id?.toString() || "") : "";
          // Go Live routes to the existing per-project go-live entry
          // (?golive=1) when a storefront exists; otherwise it points the
          // brand-new merchant at the offer composer so there's something
          // to sell before broadcasting.
          const goLiveHref = primaryRef ? `/project/${primaryRef}?golive=1` : "/dashboard/post";
          // Setup checklist mirrors deriveMerchantState's pre-merchant
          // gates so it never disagrees with the Next-Step card below.
          const rawDesc = (primary?.description || "").trim();
          const hasDescription =
            !!rawDesc &&
            rawDesc !== "Auto-created from dashboard." &&
            !rawDesc.startsWith("Project workspace for ");
          const hasCategory = Boolean((merchant?.business_type || "").trim());
          const stripeOk = merchant?.stripe_connect_status === "verified";
          const setup = [
            { label: "Sign in", done: true },
            { label: "Create your shop", done: Boolean(merchant) },
            { label: "Connect Stripe", done: stripeOk },
            {
              label: "Tell customers about your business",
              done: Boolean(bizProfile) && hasDescription && hasCategory,
            },
          ];
          const setupDone = setup.filter((s) => s.done).length;
          const setupComplete = setupDone === setup.length;
          const shareable = primary?.status === "live";
          // Fully set up: ONE primary card, one dominant CTA. The
          // completed checklist is noise once everything is green
          // (dashboard simplification, browser audit 2026-07-03), and
          // Share-your-shop merges in as the single secondary action.
          if (setupComplete) {
            return (
              <div className="mb-8 rounded-2xl bg-dum-navy-card p-6 text-white shadow-dum-dark sm:p-8">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Eyebrow tone="live" className="text-dum-live-accent">
                    Ready when you are
                  </Eyebrow>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">
                    Setup complete
                  </span>
                </div>
                <h2 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">
                  Go live and start selling.
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-dum-navy-body">
                  Feature your offers, talk to customers, and take orders in real time. Your followers get notified the moment you start.
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Link
                    href={goLiveHref}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-coral px-6 py-3 text-sm font-bold text-white shadow-dum-coral transition hover:opacity-90"
                  >
                    <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
                    </span>
                    Go Live now
                  </Link>
                  {shareable && (
                    <button
                      type="button"
                      onClick={() => {
                        const url = `${window.location.origin}/project/${primaryRef}`;
                        navigator.clipboard.writeText(url).catch(() => {});
                        showNotice("success", "Link copied. Share it with your audience.");
                      }}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
                    >
                      <Copy className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                      Share your shop
                    </button>
                  )}
                  <Link
                    href="/orders"
                    className="text-sm font-semibold text-white/70 underline-offset-4 transition hover:text-white hover:underline"
                  >
                    View orders
                  </Link>
                </div>
              </div>
            );
          }
          return (
            <div className="mb-8 grid gap-4 lg:grid-cols-2">
              {/* LEFT — dark navy Go-Live card */}
              <div className="rounded-2xl bg-dum-navy-card p-6 text-white shadow-dum-dark sm:p-7">
                <Eyebrow tone="live" className="text-dum-live-accent">
                  Ready when you are
                </Eyebrow>
                <h2 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">
                  Go live and start selling.
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-dum-navy-body">
                  Feature your offers, talk to customers, and take orders in real time. Your followers get notified the moment you start.
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Link
                    href={goLiveHref}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-coral px-5 py-3 text-sm font-bold text-white shadow-dum-coral transition hover:opacity-90"
                  >
                    <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
                    </span>
                    Go Live now
                  </Link>
                  <Link
                    href="#storefront-tools"
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
                  >
                    <Calendar className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                    Schedule a show
                  </Link>
                </div>
              </div>

              {/* RIGHT — condensed setup checklist */}
              <div className="flex flex-col rounded-2xl border border-default bg-surface-card p-6 shadow-dum-card sm:p-7">
                <div className="flex items-baseline justify-between gap-3">
                  <Eyebrow tone="brand">Setup</Eyebrow>
                  <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-secondary">
                    {setupDone} of {setup.length} done
                  </span>
                </div>
                <ul className="mt-4 space-y-3">
                  {setup.map((s) => (
                    <li key={s.label} className="flex items-center gap-2.5 text-sm">
                      {s.done ? (
                        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-mint-card text-mint-text" aria-hidden="true">
                          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                        </span>
                      ) : (
                        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-default" aria-hidden="true" />
                      )}
                      <span className={s.done ? "font-medium text-mint-text" : "font-semibold text-primary"}>
                        {s.label}
                      </span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/merchant#profile"
                  className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-mint-fill px-5 py-3 text-sm font-bold text-mint-fill-ink transition hover:opacity-90"
                >
                  {setupComplete ? "Manage profile" : "Complete profile"}
                  <span aria-hidden="true" className="ml-1.5">&rarr;</span>
                </Link>
              </div>
            </div>
          );
        })()}

        {/* Next Step card — state-driven primary action. Replaces the
            previous Post-&-Go-Live card. The headline, subhead, primary
            CTA, and (optional) secondary CTA all derive from the
            merchant's lifecycle state via deriveMerchantState. Single
            source of truth shared with /merchant and /project/[id]
            owner-view. */}
        {showOverview && user && !coreLoaded && (
          <div className="mb-8 h-28 w-full animate-pulse rounded-3xl bg-surface-card" aria-busy="true" />
        )}
        {showOverview && user && coreLoaded && (() => {
          const primary = projects.find((p) => p.status === "live") ?? projects[0] ?? null;
          const rawDescNS = (primary?.description || "").trim();
          const setupCompleteNS =
            Boolean(merchant) &&
            merchant?.stripe_connect_status === "verified" &&
            Boolean(bizProfile) &&
            !!rawDescNS &&
            rawDescNS !== "Auto-created from dashboard." &&
            !rawDescNS.startsWith("Project workspace for ") &&
            Boolean((merchant?.business_type || "").trim());
          // Fully set up -> the merged hero above is the one ask on
          // screen; a second next-step card would repeat it.
          if (setupCompleteNS) return null;
          const offerCount = Array.isArray(analytics?.top_offers)
            ? analytics.top_offers.length
            : 0;
          const salesCount = typeof analytics?.orders_count === "number" ? analytics.orders_count : 0;
          const gmvUsd = typeof analytics?.gmv_usd === "number" ? analytics.gmv_usd : 0;
          // Share Shop gate: don't let a merchant share a storefront link
          // until it has a real description (P11) and a category (P10,
          // stored on merchant.business_type). projects.category is
          // hardcoded "service" so it can't be the signal.
          const rawDesc = (primary?.description || "").trim();
          const hasDescription =
            !!rawDesc &&
            rawDesc !== "Auto-created from dashboard." &&
            !rawDesc.startsWith("Project workspace for ");
          const hasCategory = Boolean((merchant?.business_type || "").trim());
          const profileComplete = hasDescription && hasCategory;
          return (
            <MerchantNextStep
              inputs={{
                isAuthenticated: true,
                hasMerchant: Boolean(merchant),
                stripeStatus: merchant?.stripe_connect_status ?? null,
                hasBusinessProfile: Boolean(bizProfile),
                hasProject: projects.length > 0,
                offerCount,
                salesCount,
                gmvUsd,
                primaryProjectSlug: primary ? (primary.slug || primary.id?.toString() || null) : null,
              }}
              variant="card"
              shareDisabledReason={profileComplete ? undefined : "Complete your profile first"}
            />
          );
        })()}

        {/* (Old Storefronts/Orders/Sales tile row removed — it repeated
            Sales/Revenue from Business Performance below. One stat strip
            now, per the dashboard simplification 2026-07-03. Storefront
            count lives in the Storefronts tab header.) */}

        {/* DUM Points — HIDDEN per CLAUDE.md §12 rule 4: "Never show
            DUM Points in navbar until Phase 2." Same rule applies to
            merchant dashboard surfaces (and the streamlined-dashboard
            handoff's 4th "DUM POINTS" stat tile is intentionally NOT
            rendered for this reason — doctrine wins over the visual
            spec). Phase 2 unlock conditions (10+ verified sellers AND
            $1k+ GMV AND legal review of purchase flow) are NOT met. The
            /hub page still exists at its direct URL; this is only hiding
            the dashboard surface. Re-enable when Phase 2 unlocks. */}

        {/* Business Profile */}
        {showStorefronts && user && (
          <div className="mb-6">
            {/* Business switcher — only when the owner has more than one.
                Single-business owners never see this. */}
            {businesses.length > 1 && (
              <div className="mb-3 flex items-center gap-2">
                <label htmlFor="biz-switcher" className="text-[11px] font-bold uppercase tracking-[0.15em] text-secondary">
                  Business
                </label>
                <select
                  id="biz-switcher"
                  value={bizProfile?.id ?? ""}
                  onChange={(e) => selectBusiness(e.target.value)}
                  className="rounded-lg border border-default bg-surface-card px-3 py-1.5 text-sm text-primary outline-none transition hover:border-strong focus:border-brand-teal"
                >
                  {businesses.map((b) => (
                    <option key={b.id} value={b.id}>{b.business_name}</option>
                  ))}
                </select>
              </div>
            )}
            {bizProfile ? (
              <div className="rounded-2xl border border-default bg-surface-card p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-default bg-brand-teal-soft text-lg">
                      🏢
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-brand-navy">{bizProfile.business_name}</span>
                        {bizProfile.verification_status === "verified" && (
                          <span className="rounded-full bg-brand-teal-soft border border-default px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-brand-teal">✓ Verified</span>
                        )}
                        {bizProfile.verification_status === "pending" && (
                          <span className="rounded-full bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-amber-500">Pending</span>
                        )}
                        {bizProfile.verification_status === "unverified" && (
                          <span className="rounded-full bg-surface-muted border border-default px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-secondary">Unverified</span>
                        )}
                      </div>
                      <div className="text-[11px] text-secondary">{bizProfile.category}{hasMadeSale ? " · Accepts DUM Points" : ""}</div>
                    </div>
                  </div>
                  {bizProfile.verification_status === "unverified" && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const token = await getToken();
                          const verifyUrl = bizProfile.id
                            ? `${API_BASE}/api/business/request-verification?business_id=${encodeURIComponent(bizProfile.id)}`
                            : `${API_BASE}/api/business/request-verification`;
                          const res = await fetch(verifyUrl, {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                              ...(token ? { Authorization: `Bearer ${token}` } : {}),
                            },
                            body: JSON.stringify({ website: bizProfile.website, contact_email: bizProfile.contact_email }),
                          });
                          if (res.ok) {
                            const data = await res.json();
                            setBizProfile(data.profile);
                          }
                        } catch {}
                      }}
                      className="shrink-0 rounded-lg border border-default bg-brand-teal/5 px-4 py-2 text-xs font-bold text-brand-teal transition hover:border-brand-teal hover:bg-brand-teal-soft"
                    >
                      Request Verification
                    </button>
                  )}
                </div>
                {bizProfile.short_description && (
                  <p className="mt-3 text-xs text-primary">{bizProfile.short_description}</p>
                )}
                {/* Brand image uploader — logo + cover banner. Reuses the
                    existing offers storage bucket under a per-biz subpath
                    (see MerchantImageUploader). Merchants who don't upload
                    keep the existing emoji avatar / no-banner fallback
                    on their storefront (#341/#342/#344 reader path
                    unchanged). */}
                {bizProfile.id && (
                  <MerchantImageUploader
                    bizId={bizProfile.id}
                    logoUrl={bizProfile.logo_url ?? null}
                    coverImageUrl={bizProfile.cover_image_url ?? null}
                    getToken={getToken}
                    onChange={(next) =>
                      setBizProfile((prev: any) =>
                        prev ? { ...prev, ...next } : prev,
                      )
                    }
                  />
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-default bg-surface-card p-5">
                {showBizForm ? (
                  <div className="space-y-3">
                    <div className="text-sm font-bold text-primary">Create your business profile</div>
                    {prefilledFromStripe && (
                      <p className="text-xs text-brand-teal">
                        Prefilled from your Stripe account. Edit anything before saving.
                      </p>
                    )}
                    <input
                      value={bizName}
                      onChange={(e) => setBizName(e.target.value)}
                      placeholder="Business name"
                      className="w-full rounded-xl border border-default bg-surface-muted px-4 py-2.5 text-sm text-primary placeholder:text-muted outline-none focus:border-default"
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <select
                        value={bizCategory}
                        onChange={(e) => setBizCategory(e.target.value)}
                        className="rounded-xl border border-default bg-surface-muted px-4 py-2.5 text-sm text-primary outline-none"
                      >
                        {["General", "Food & Beverage", "Health & Fitness", "Technology", "Creative", "Services", "Retail", "Gaming", "Education"].map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <input
                        value={bizEmail}
                        onChange={(e) => setBizEmail(e.target.value)}
                        placeholder="Contact email (optional)"
                        className="rounded-xl border border-default bg-surface-muted px-4 py-2.5 text-sm text-primary placeholder:text-muted outline-none focus:border-default"
                      />
                    </div>
                    <textarea
                      value={bizDesc}
                      onChange={(e) => setBizDesc(e.target.value)}
                      placeholder="Short description of your business"
                      rows={2}
                      className="w-full resize-none rounded-xl border border-default bg-surface-muted px-4 py-2.5 text-sm text-primary placeholder:text-muted outline-none focus:border-default"
                    />
                    <input
                      value={bizWebsite}
                      onChange={(e) => setBizWebsite(e.target.value)}
                      placeholder="Website (optional)"
                      className="w-full rounded-xl border border-default bg-surface-muted px-4 py-2.5 text-sm text-primary placeholder:text-muted outline-none focus:border-default"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={createBusiness}
                        disabled={!bizName.trim() || bizSaving}
                        className="rounded-xl bg-brand-teal px-5 py-2.5 text-sm font-bold text-black transition hover:bg-brand-teal-hover disabled:opacity-50"
                      >
                        {bizSaving ? "Creating..." : "Create Business"}
                      </button>
                      <button
                        onClick={() => setShowBizForm(false)}
                        className="rounded-xl border border-default px-5 py-2.5 text-sm text-secondary transition hover:text-primary"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-primary">Set up your business profile</div>
                      <p className="mt-1 text-xs text-secondary">Add your business identity and get verified</p>
                    </div>
                    <button
                      onClick={openBizForm}
                      className="shrink-0 rounded-lg bg-brand-teal px-4 py-2 text-xs font-bold text-black transition hover:bg-brand-teal-hover"
                    >
                      Create Business Profile
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Business Analytics. Hidden in STATE_1 (pre-selling) — an all-
            zero performance panel only confuses a brand-new merchant. */}
        {showOverview && bizProfile && analytics && !isPreSelling && (
          <div className="mb-6">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-secondary">Business Performance</div>

            {/* Headline metrics */}
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-default bg-surface-card p-5">
                <div className="text-[10px] uppercase tracking-[0.28em] text-secondary">Page Views</div>
                <div className="mt-1 font-mono text-2xl font-bold text-brand-navy">{(analytics.total_views || 0).toLocaleString()}</div>
                <div className="mt-1 text-[11px] text-muted">across all projects</div>
              </div>
              <div className="rounded-2xl border border-default bg-surface-card p-5">
                <div className="text-[10px] uppercase tracking-[0.28em] text-secondary">Sales</div>
                <div className="mt-1 font-mono text-2xl font-bold text-brand-teal">{analytics.total_orders || 0}</div>
                <div className="mt-1 text-[11px] text-muted">completed purchases</div>
              </div>
              <div className="rounded-2xl border border-default bg-surface-card p-5">
                <div className="text-[10px] uppercase tracking-[0.28em] text-secondary">Revenue</div>
                <div className="mt-1 font-mono text-2xl font-bold text-brand-navy">
                  ${(analytics.total_revenue_usd || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="mt-1 text-[11px] text-muted">total earned</div>
              </div>
              {/* DUM Received — held back until the merchant's first sale.
                  Before any sale a "DUM Received: 0" tile is just
                  confusing token-style noise on the dashboard. It returns
                  on its own once real sales (and DUM activity) exist. */}
              {hasMadeSale && (
                <div className="rounded-2xl border border-default bg-gradient-to-r from-brand-teal-soft to-surface-card p-5">
                  <div className="text-[10px] uppercase tracking-[0.28em] text-brand-teal/60">DUM Received</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-brand-teal">{analytics.total_dum_received || 0}</div>
                  <div className="mt-1 text-[11px] text-muted">
                    {analytics.dum_discount_orders > 0
                      ? `${analytics.dum_discount_orders} order${analytics.dum_discount_orders !== 1 ? "s" : ""} used DUM discount`
                      : "from customer DUM spending"}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Analytics depth — per-project + top offers (Analytics tab). */}
        {showAnalytics && bizProfile && analytics && !isPreSelling && (
          <div className="mb-6">
            {tabsActive && (
              <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-secondary">Analytics</div>
            )}
            {/* Per-project breakdown */}
            {analytics.projects && analytics.projects.length > 0 && (
              <div className="mb-4 rounded-2xl border border-default bg-surface-card p-5">
                <div className="mb-3 text-xs font-bold text-primary">Project Performance</div>
                <div className="space-y-2">
                  {analytics.projects.map((p: any) => (
                    <Link
                      key={p.id}
                      href={`/project/${p.id}`}
                      className="flex items-center justify-between rounded-xl border border-default bg-surface-card px-4 py-3 transition hover:border-default"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${p.status === "live" ? "bg-brand-teal" : "bg-zinc-600"}`} />
                        <span className="truncate text-sm font-medium text-primary">{p.title}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-4 text-[11px] text-secondary">
                        <span title="Views">{(p.views || 0).toLocaleString()} views</span>
                        <span title="Sales">{p.orders || 0} sales</span>
                        <span title="Revenue" className="font-medium text-primary">${(p.revenue_usd || 0).toFixed(2)}</span>
                        {(p.dum_received || 0) > 0 && (
                          <span title="DUM received" className="text-brand-teal">+{p.dum_received} DUM</span>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Top offers */}
            {analytics.top_offers && analytics.top_offers.length > 0 && analytics.top_offers.some((o: any) => (o.quantity_sold || 0) > 0) && (
              <div className="mb-4 rounded-2xl border border-default bg-surface-card p-5">
                <div className="mb-3 text-xs font-bold text-primary">Top Offers</div>
                <div className="space-y-2">
                  {analytics.top_offers.filter((o: any) => (o.quantity_sold || 0) > 0).map((offer: any) => (
                    <div key={offer.id} className="flex items-center justify-between rounded-xl border border-default bg-surface-card px-4 py-3">
                      <span className="truncate text-sm text-primary">{offer.title}</span>
                      <div className="flex shrink-0 items-center gap-3 text-[11px]">
                        <span className="text-secondary">${Number(offer.price_usd || 0).toFixed(2)}</span>
                        <span className="font-medium text-brand-teal">{offer.quantity_sold} sold</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {analytics.total_orders === 0 && analytics.total_views === 0 && (
              <div className="rounded-2xl border border-dashed border-default bg-surface-card p-6 text-center">
                <div className="text-sm font-medium text-secondary">No activity yet</div>
                <p className="mt-1 text-xs text-muted">Share your storefront links to start getting views and sales</p>
              </div>
            )}
          </div>
        )}

        {/* Orders tab — recent sales + the full orders page. */}
        {showOrders && bizProfile && analytics && !isPreSelling && (
          <div className="mb-6">
            {tabsActive && (
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[10px] font-bold uppercase tracking-widest text-secondary">Orders</div>
                <Link href="/orders" className="text-xs font-bold text-mint-text transition hover:opacity-80">
                  All orders &rarr;
                </Link>
              </div>
            )}
            {/* Recent orders */}
            {analytics.recent_orders && analytics.recent_orders.length > 0 && (
              <div className="rounded-2xl border border-default bg-surface-card p-5">
                <div className="mb-3 text-xs font-bold text-primary">Recent Sales</div>
                <div className="space-y-2">
                  {analytics.recent_orders.slice(0, 5).map((order: any) => (
                    <div key={order.id} className="flex items-center justify-between rounded-xl border border-default bg-surface-card px-4 py-2.5">
                      <div className="min-w-0">
                        <span className="truncate text-sm text-primary">{order.offer_title}</span>
                        {order.dum_discount && (
                          <span className="ml-2 rounded-full border border-default bg-brand-teal/5 px-1.5 py-0.5 text-[8px] font-bold text-brand-teal">DUM</span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-[11px]">
                        <span className="font-medium text-primary">${order.amount.toFixed(2)}</span>
                        <span className="text-muted">{order.date ? new Date(order.date).toLocaleDateString() : ""}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tabsActive && (!analytics.recent_orders || analytics.recent_orders.length === 0) && (
              <div className="rounded-2xl border border-dashed border-default bg-surface-card p-6 text-center">
                <div className="text-sm font-medium text-secondary">No orders yet</div>
                <p className="mt-1 text-xs text-muted">Share your storefront link to land the first one</p>
              </div>
            )}
          </div>
        )}

        {/* Drive Your Market Analytics — gated by merchant.subscription_tier.
             Renders the unlocked dashboard for Founding / Growth / Pro /
             Business / Enterprise; renders an upgrade card otherwise.
             Both states only render once the merchant record has loaded
             (so we don't flash the locked card to a Pro merchant). */}
        {showAnalytics && bizProfile && merchant && (
          hasAnalyticsAccess(merchant) ? (
            analytics?.drive_your_market ? (
              <DriveYourMarketAnalytics
                funnel={analytics.drive_your_market}
                totalRevenueUsd={Number(analytics.total_revenue_usd) || 0}
              />
            ) : null
          ) : (
            <UpgradeAnalyticsCard />
          )
        )}

        {/* Guest-chat inbox: messages from storefront visitors. */}
        {showOverview && projects.length > 0 && (
          <div className="mt-8">
            <MerchantInbox
              projects={projects.map((p) => ({
                id: p.id,
                name: p.title || p.name || "Storefront",
              }))}
              getToken={getToken}
            />
          </div>
        )}

        {/* DUM Pop-In Seller settings (PR #135) + outer Embed Display
             Mode card (migration 040). Renders for the merchant's
             primary live project. The 5-step Get Live in Minutes flow
             above gives a one-glance status. Both surfaces render for
             every merchant — no tier gate.

             Collapsed in a <details> drawer per the dashboard UX
             simplification so the primary action ("Post & Go Live")
             reads as the page's focus. Pop-In + Embed-Display Mode
             content is unchanged inside the drawer — one click to
             expand. */}
        {showStorefronts && (
        <details id="storefront-tools" className="group mb-6 scroll-mt-24 rounded-2xl border border-default bg-surface-card open:shadow-dum-card">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-primary hover:text-mint-text">
            <span>Customize your storefront widget</span>
            <span
              className="text-secondary transition-transform group-open:rotate-45"
              aria-hidden="true"
            >
              +
            </span>
          </summary>
          <div className="border-t border-default p-5">
        {(() => {
          const primary = projects.find((p) => p.status === "live")
            ?? projects[0];
          if (!primary) return null;
          const offers = (analytics?.top_offers ?? []).map((o: {
            id: string;
            title?: string | null;
            price_usd?: number | null;
            project_id?: string | null;
          }) => ({
            id: o.id,
            title: o.title,
            price_usd: o.price_usd,
            project_id: o.project_id,
          }));
          const stripeVerified = merchant?.stripe_connect_status === "verified";
          const hasOffer = offers.length > 0;
          const isLive = primary.is_live === true;
          // Published = storefront status is live (the Publish Store
          // toggle), distinct from is_live broadcasting. Drives the
          // checklist's "Add what you sell" completion.
          const isPublished = primary.status === "live";
          // Display-mode card considered "done" once the merchant has
          // explicitly saved the value (i.e. it differs from the DB
          // default OR the column is non-null). Every fresh project
          // already has 'automatic' as the default, so we treat any
          // non-empty value as a done step — the column existed,
          // therefore the merchant has the option to change it.
          const hasDisplayMode = Boolean(primary.embed_display_mode);
          // Phase 4 progressive-disclosure: when the SIMPLIFIED_DASHBOARD
          // flag is on, the "Display mode" + "Welcome message" cards
          // collapse into a single Settings disclosure so the dashboard
          // shows ONE primary action (the next pending step in
          // GetLiveSteps) instead of three competing panels.
          //
          // Flag is read from NEXT_PUBLIC_SIMPLIFIED_DASHBOARD at build
          // time. Default is off in production until the founder flips
          // it; that gives us a single env-var rollback path if the
          // collapsed view confuses an early merchant.
          const simplifiedDashboard =
            process.env.NEXT_PUBLIC_SIMPLIFIED_DASHBOARD === "true";
          const onboardingComplete =
            Boolean((primary.title || primary.name || "").trim()) &&
            stripeVerified &&
            hasOffer &&
            isLive;
          const settingsCards = (
            <>
              <ScheduleNextLiveCard
                project={{
                  id: String(primary.id),
                  scheduled_live_at: primary.scheduled_live_at ?? null,
                  recurring_weekly: primary.recurring_weekly ?? false,
                }}
                getToken={getToken}
                onSaved={() => loadProjects()}
              />
              <EmbedDisplayModeCard
                project={{
                  id: String(primary.id),
                  embed_display_mode: primary.embed_display_mode ?? "automatic",
                }}
                getToken={getToken}
                onSaved={() => loadProjects()}
              />
              <PopInSettings
                project={{
                  id: String(primary.id),
                  title: primary.title,
                  name: primary.name,
                  popin_config: primary.popin_config ?? null,
                }}
                offers={offers}
                getToken={getToken}
                onSaved={() => loadProjects()}
              />
            </>
          );
          return (
            <>
              <TrialCountdownBanner getToken={getToken} />
              <StripeResumeBanner getToken={getToken} />
              <GetLiveSteps
                hasBusinessName={Boolean((primary.title || primary.name || "").trim())}
                stripeVerified={stripeVerified}
                hasOffer={hasOffer}
                isPublished={isPublished}
                hasPinnedOffer={Boolean(primary.pinned_offer_id)}
                isLive={isLive}
                projectSlug={(primary.slug || primary.id || "").toString()}
              />
              {simplifiedDashboard ? (
                onboardingComplete ? (
                  // 5/5 complete — settings live behind a disclosure so
                  // the merchant sees the action grid first.
                  <details className="mb-6 rounded-3xl border border-default bg-surface-card p-4">
                    <summary className="cursor-pointer list-none px-2 py-2 text-sm font-bold text-primary transition hover:text-brand-teal">
                      Settings
                    </summary>
                    <div className="mt-4 space-y-4">{settingsCards}</div>
                  </details>
                ) : (
                  // Onboarding still in progress — hide the settings
                  // cards entirely so the merchant focuses on the next
                  // step shown in GetLiveSteps above.
                  null
                )
              ) : (
                // Default behaviour (flag off): render both settings
                // cards inline as before. Existing merchants see no
                // change until the flag is flipped.
                settingsCards
              )}
            </>
          );
        })()}
          </div>
        </details>
        )}

        {showOverview && bizProfile && analyticsLoading && !analytics && (
          <div className="mb-6 rounded-2xl border border-default bg-surface-card p-6 text-center">
            <div className="text-sm text-secondary">Loading analytics...</div>
          </div>
        )}

        {/* Next best action — hidden when needsFirstOffer is true so the
            primary "Post your first offer" card above is the only thing
            asking for the merchant's attention. */}
        {!tabsActive && !needsFirstOffer &&
         (projects.length === 0 || projects.some((p) => p.status === "live") || hasMadeSale) && (
        <div className="mb-6 rounded-2xl border border-default bg-surface-muted/20 p-5">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-secondary">What to do next</div>
          <div className="space-y-2">
            {projects.length === 0 && (
              <Link href="/merchant" className="flex items-center gap-3 rounded-xl border border-default bg-brand-teal-soft px-4 py-3 transition hover:border-default">
                <span className="text-base">🏪</span>
                <div>
                  <div className="text-sm font-bold text-primary">Claim Your Founding Spot</div>
                  <div className="text-[11px] text-secondary">30 days free · Lock in founding pricing for life · 100 spots</div>
                </div>
              </Link>
            )}
            {projects.length > 0 && projects.some(p => p.status === "live") && (
              <Link href={`/project/${projects.find(p => p.status === "live")?.id}#offers-section`} className="flex items-center gap-3 rounded-xl border border-default/30 bg-surface-card px-4 py-3 transition hover:border-default">
                <span className="text-base">🏷️</span>
                <div>
                  <div className="text-sm font-bold text-primary">Add or improve offers</div>
                  <div className="text-[11px] text-secondary">Add or edit what you sell</div>
                </div>
              </Link>
            )}
            {/* Discover / explore prompts are about earning DUM Points by
                shopping other stores — off-task noise for a merchant who
                hasn't made their first sale yet. They return once the
                first sale lands. */}
            {hasMadeSale && dumBalance < 50 && (
              <Link href="/discover" className="flex items-center gap-3 rounded-xl border border-default/30 bg-surface-card px-4 py-3 transition hover:border-default">
                <span className="text-base">💡</span>
                <div>
                  <div className="text-sm font-bold text-primary">Discover local businesses</div>
                  <div className="text-[11px] text-secondary">Earn DUM Points with every purchase</div>
                </div>
              </Link>
            )}
            {hasMadeSale && (
              <Link href="/discover" className="flex items-center gap-3 rounded-xl border border-default/30 bg-surface-card px-4 py-3 transition hover:border-default">
                <span className="text-base">🔍</span>
                <div>
                  <div className="text-sm font-bold text-primary">Explore & support other businesses</div>
                  <div className="text-[11px] text-secondary">Earn +2 DUM Points per purchase</div>
                </div>
              </Link>
            )}
          </div>
        </div>
        )}

        {/* Quick actions. The "Become a Merchant" card hides as soon as
            the merchant has any merchants row — previously the gate
            required a live storefront, which left already-onboarded
            merchants seeing a confusing "Become a Merchant" CTA inside
            the merchant dashboard. The simpler gate matches the actual
            user identity: if `merchant` exists, this person IS a
            merchant — never push them back to signup.
            "My Orders" stays for everyone since orders are useful at
            every stage. When "Become a Merchant" is hidden, "My Orders"
            spans the row so the layout doesn't leave a gap. */}
        {/* Hidden for STATE_1 merchants — a brand-new merchant has no
            orders yet, so the My Orders card is just noise. Non-merchants
            still see the Become a Merchant card. */}
        {!merchant && (
        <div className={`mb-10 grid gap-4 ${merchant ? "" : "sm:grid-cols-2"}`}>
          {!merchant && (
            <Link
              href="/merchant"
              className="group flex items-center justify-center gap-3 rounded-2xl border border-default bg-brand-teal/5 px-6 py-6 transition hover:border-default hover:bg-brand-teal-soft hover:-translate-y-0.5 hover:shadow-[0_4px_20px_rgba(0,255,163,0.08)]"
            >
              <span className="text-2xl">🏪</span>
              <span className="text-lg font-bold text-brand-teal">Become a Merchant</span>
            </Link>
          )}
          <Link
            href="/orders"
            className="group flex items-center justify-center gap-3 rounded-2xl border border-default bg-surface-card px-6 py-6 transition hover:border-default hover:-translate-y-0.5"
          >
            <span className="text-2xl">📦</span>
            <span className="text-lg font-bold text-primary">My Orders</span>
          </Link>
        </div>
        )}

        {/* ── Action Prompts ── Hidden when needsFirstOffer is true;
            those Share/Manage/View-orders cards all assume offers
            already exist, and we want the primary "Post your first
            offer" card to be the only ask on screen for that state. */}
        {!tabsActive && user && !needsFirstOffer && (
          <div className="mb-10">
            {projects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-default bg-brand-teal-soft p-6 text-center">
                <div className="mb-2 text-2xl">🏪</div>
                <div className="mb-1 text-base font-bold text-primary">Start selling on DUM Club</div>
                <p className="mb-4 text-sm text-secondary">Join the first 100 merchants. Get 30 days free and lock in founding pricing for life. 1.5% sales fee per order (industry-low; Whatnot takes up to 8%).</p>
                <Link
                  href="/merchant"
                  className="inline-flex items-center rounded-xl bg-brand-teal px-6 py-2.5 text-sm font-bold text-black transition hover:bg-brand-teal-hover"
                >
                  Claim Your Spot →
                </Link>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                {projects.some((p) => p.status === "live") && (
                  <button
                    type="button"
                    onClick={() => {
                      const live = projects.find((p) => p.status === "live");
                      if (live) {
                        const url = `${window.location.origin}/project/${live.id}`;
                        navigator.clipboard.writeText(url).catch(() => {});
                        showNotice("success", "Link copied. Share it with your audience.");
                      }
                    }}
                    className="flex items-center gap-3 rounded-2xl border border-default bg-surface-card p-4 text-left transition hover:border-default hover:bg-brand-teal-soft"
                  >
                    <span className="text-xl">🔗</span>
                    <div>
                      <div className="text-sm font-bold text-primary">Share your page</div>
                      <div className="text-xs text-secondary">Copy your storefront link</div>
                    </div>
                  </button>
                )}
                {projects.some((p) => p.status === "live") && (
                  <Link
                    href={`/project/${projects.find((p) => p.status === "live")?.id}#offers-section`}
                    className="flex items-center gap-3 rounded-2xl border border-default bg-surface-card p-4 text-left transition hover:border-default hover:bg-brand-teal-soft"
                  >
                    <span className="text-xl">🏷️</span>
                    <div>
                      <div className="text-sm font-bold text-primary">Manage your offers</div>
                      <div className="text-xs text-secondary">Add or edit what you sell</div>
                    </div>
                  </Link>
                )}
                <Link
                  href="/orders"
                  className="flex items-center gap-3 rounded-2xl border border-default bg-surface-card p-4 text-left transition hover:border-default hover:bg-brand-teal-soft"
                >
                  <span className="text-xl">📊</span>
                  <div>
                    <div className="text-sm font-bold text-primary">View your orders</div>
                    <div className="text-xs text-secondary">Track sales and fulfillment</div>
                  </div>
                </Link>
              </div>
            )}
          </div>
        )}

        {/* Projects list */}
        {showStorefronts && (() => {
          // Business-name lookup for the per-storefront pill.
          const bizNameById: Record<string, string> = {};
          for (const b of businesses) bizNameById[b.id] = b.business_name;
          const multiBiz = businesses.length > 1;
          // When the owner has multiple businesses, filter the grid to the
          // selected business — plus any unlinked (NULL) storefronts, which
          // stay visible across selections so legacy projects aren't hidden.
          const visibleProjects = multiBiz && bizProfile?.id
            ? projects.filter(
                (p) => p.business_profile_id === bizProfile.id || !p.business_profile_id,
              )
            : projects;
          return (
        <div>
          <div className="mb-4 flex items-center justify-between gap-3">
            <Eyebrow tone="muted">Your businesses</Eyebrow>
            <div className="flex items-center gap-3">
              {/* Add a storefront for the selected business (multi-business). */}
              {multiBiz && bizProfile?.id && (
                <button
                  type="button"
                  onClick={() => createStorefrontForBusiness(bizProfile.id)}
                  disabled={creatingStorefront}
                  className="rounded-lg border border-default bg-mint-card px-3 py-1.5 text-[11px] font-bold text-mint-text transition hover:border-mint-card-border disabled:opacity-50"
                >
                  {creatingStorefront ? "Adding…" : `Add a storefront for ${bizProfile.business_name}`}
                </button>
              )}
              <span className="text-xs text-muted">
                {projectsLoaded ? `${visibleProjects.length} shop${visibleProjects.length !== 1 ? "s" : ""}` : ""}
              </span>
            </div>
          </div>

          {!user ? (
            <div className="rounded-2xl border border-default bg-surface-card p-8 text-center">
              <p className="text-sm text-secondary">Sign in to view your businesses.</p>
            </div>
          ) : !projectsLoaded ? (
            <div className="grid gap-4 sm:grid-cols-2" aria-busy="true">
              <div className="h-40 animate-pulse rounded-2xl bg-surface-card" />
              <div className="h-40 animate-pulse rounded-2xl bg-surface-card" />
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-default bg-surface-card p-10 text-center">
              <p className="text-base font-semibold text-primary">No businesses yet.</p>
              <p className="mt-2 text-sm text-secondary">
                Post your first offer and you&apos;re ready to go live.
              </p>
              <Link
                href="/dashboard/post"
                className="mt-5 inline-flex items-center rounded-xl bg-mint-fill px-6 py-2.5 text-sm font-bold text-mint-fill-ink transition hover:opacity-90"
              >
                Post your first offer →
              </Link>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {visibleProjects.map((project) => {
                const bizLabel = project.business_profile_id
                  ? bizNameById[project.business_profile_id]
                  : null;
                // Storefront is "shareable" once the merchant has
                // published — pre-live, the link points at a draft
                // page and would confuse a real customer. Use the
                // slug when available (cleaner URL) and fall back to
                // the project id.
                const storefrontPath = `/project/${project.slug || project.id}`;
                const storefrontUrl = typeof window !== "undefined"
                  ? `${window.location.origin}${storefrontPath}`
                  : storefrontPath;
                const isShareable = project.status === "live";
                return (
                  <div
                    key={project.id}
                    className="group relative rounded-2xl border border-default bg-surface-card shadow-dum-card transition hover:border-strong hover:-translate-y-0.5 hover:shadow-dum-elev"
                  >
                    <Link href={`/project/${project.id}`} className="block p-6">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-base font-semibold text-primary group-hover:text-mint-text">
                          {project.title || project.name || "Untitled Shop"}
                        </h3>
                        {project.status === "live" ? (
                          <Badge variant="live" size="sm" dot className="shrink-0">
                            Live
                          </Badge>
                        ) : (
                          <Badge variant="muted" size="sm" className="shrink-0">
                            Offline
                          </Badge>
                        )}
                      </div>


                      {/* Business pill — which business this storefront
                          belongs to. Hidden for legacy/unlinked storefronts. */}
                      {bizLabel && (
                        <div className="mt-2">
                          <span className="inline-flex items-center rounded-full border border-default bg-surface-muted px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-secondary">
                            {bizLabel}
                          </span>
                        </div>
                      )}

                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-xs text-muted"> </span>
                        <span className="text-xs text-muted opacity-0 transition group-hover:opacity-100">View →</span>
                      </div>
                    </Link>

                    {/* Category setter — mounted OUTSIDE the wrapping
                        <Link> so clicking the dropdown doesn't navigate.
                        Dropdown offers the 12 mig-035 seed ids + a
                        disabled "Uncategorized" placeholder for the NULL
                        state (set-only in v1; no clear affordance). FK
                        constraint at DB rejects unknown values, but the
                        constrained option list keeps the 500 path
                        unreachable from the UI. */}
                    <div className="mx-4 mb-2 flex items-center justify-between gap-3 rounded-lg border border-default bg-surface-page px-3 py-2">
                      <label
                        htmlFor={`cat-${project.id}`}
                        className="text-[10px] font-bold uppercase tracking-[0.1em] text-secondary"
                      >
                        Category
                      </label>
                      <select
                        id={`cat-${project.id}`}
                        value={project.category_id ?? ""}
                        onChange={(e) => updateProjectCategory(project.id, e.target.value)}
                        className="rounded-lg border border-default bg-surface-card px-2 py-1 text-[11px] text-primary outline-none transition hover:border-strong focus:border-brand-teal"
                      >
                        <option value="" disabled>
                          Uncategorized
                        </option>
                        {VERB_GROUPED_CATEGORIES.map((g) => (
                          <optgroup key={g.id} label={`${g.glyph} ${g.label}`}>
                            {g.options.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>

                    {/* Storefront URL + inline Copy — primary post-publish
                        action. The URL is surfaced so the merchant can see
                        and share their link, not just copy it blind.
                        Disabled until status='live' so a brand-new merchant
                        can't accidentally share a draft URL with a customer;
                        the disabled state explains what unlocks it. */}
                    {isShareable ? (
                      <div className="mx-4 mb-3 flex items-center gap-2 rounded-xl border border-default bg-surface-page px-3 py-2">
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-secondary">
                          dum.club/{project.slug || project.id}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (typeof navigator !== "undefined" && navigator.clipboard) {
                              navigator.clipboard.writeText(storefrontUrl).catch(() => {});
                              showNotice("success", "Link copied. Share it with your audience.");
                            }
                          }}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-bold text-mint-text transition hover:bg-mint-card"
                        >
                          <Copy className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                          Copy
                        </button>
                      </div>
                    ) : (
                      <div className="mx-4 mb-3 flex items-center justify-center gap-2 rounded-xl border border-dashed border-default bg-surface-muted px-4 py-2.5 text-xs text-muted">
                        Publish your first offer to unlock sharing
                      </div>
                    )}

                    {/* Action row — coral Go Live + outline Preview shop.
                        Go Live only renders once the storefront is live
                        (there's something to sell during the stream) and
                        routes to the existing per-project go-live entry
                        (?golive=1). Preview shop flips the project page's
                        view-as-customer flag so the merchant sees the
                        storefront the way a buyer would. */}
                    <div className="mx-4 mb-4 flex items-center gap-2">
                      {isShareable && (
                        <Link
                          href={`/project/${project.id}?golive=1`}
                          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-coral px-4 py-2.5 text-sm font-bold text-white shadow-dum-coral transition hover:opacity-90"
                        >
                          <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
                          </span>
                          Go Live
                        </Link>
                      )}
                      <Link
                        href={`/project/${project.id}?viewAsCustomer=1`}
                        className={`flex items-center justify-center rounded-xl border border-default bg-surface-card px-4 py-2.5 text-sm font-bold text-primary transition hover:border-strong hover:bg-surface-muted ${isShareable ? "flex-1" : "w-full"}`}
                      >
                        Preview shop
                      </Link>
                    </div>

                    <button
                      type="button"
                      onClick={() => deleteProject(project)}
                      disabled={deletingId === project.id}
                      className="absolute right-3 top-3 rounded-lg px-2 py-1 text-xs text-muted opacity-0 transition hover:bg-[var(--state-live)]/10 hover:text-state-live group-hover:opacity-100 disabled:opacity-50"
                      title="Remove project"
                    >
                      {deletingId === project.id ? "…" : "✕"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        );
        })()}
      </div>
    </div>
  );
}
