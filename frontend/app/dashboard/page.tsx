"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth/AuthContext";
import { getTier } from "../../lib/dumTiers";
import { hasAnalyticsAccess } from "../../lib/merchantTier";
import { DriveYourMarketAnalytics } from "../../components/DriveYourMarketAnalytics";
import { UpgradeAnalyticsCard } from "../../components/UpgradeAnalyticsCard";
import { PopInSettings } from "../../components/PopInSettings";
import { EmbedDisplayModeCard } from "../../components/EmbedDisplayModeCard";
import { GetLiveSteps } from "../../components/GetLiveSteps";
import { StripeResumeBanner } from "../../components/StripeResumeBanner";
import { TrialCountdownBanner } from "../../components/TrialCountdownBanner";
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
};

import { API_BASE } from "../../lib/apiBase";

function statusLabel(project: Project): { text: string; color: string } {
  const s = project.status || "draft";
  if (s === "live") return { text: "Live", color: "text-brand-teal border-default bg-brand-teal-soft" };
  if (project.review_status === "submitted") return { text: "In Review", color: "text-amber-400 border-amber-400/30 bg-amber-400/10" };
  if (project.review_status === "approved") return { text: "Approved", color: "text-sky-400 border-sky-400/30 bg-sky-400/10" };
  return { text: "Draft", color: "text-secondary border-default bg-surface-muted" };
}

export default function DashboardPage() {
  const { user, getToken } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [deletingId, setDeletingId] = useState<string | number | null>(null);
  const [dumBalance, setDumBalance] = useState(0);
  const [bizProfile, setBizProfile] = useState<any>(null);
  const [bizLoading, setBizLoading] = useState(false);
  // Drive Your Market Analytics — merchant subscription_tier drives the
  // tier gate. Loaded once when the user is known; null while loading.
  const [merchant, setMerchant] = useState<{
    subscription_tier?: string;
    stripe_connect_status?: string | null;
  } | null>(null);
  const [showBizForm, setShowBizForm] = useState(false);
  const [bizName, setBizName] = useState("");
  const [bizCategory, setBizCategory] = useState("General");
  const [bizDesc, setBizDesc] = useState("");
  const [bizEmail, setBizEmail] = useState("");
  const [bizWebsite, setBizWebsite] = useState("");
  const [bizSaving, setBizSaving] = useState(false);
  const [analytics, setAnalytics] = useState<any>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

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

  // Load business profile
  useEffect(() => {
    if (!user?.privyId) return;
    async function loadBiz() {
      try {
        const token = await getToken();
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(`${API_BASE}/api/business/me`, { headers });
        if (res.ok) {
          const data = await res.json();
          setBizProfile(data.profile || null);
        }
      } catch {}
    }
    loadBiz();
  }, [user?.privyId]);

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
      }
    })();
  }, [bizProfile, user]);

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
        alert(err.detail || "Failed to create business profile");
      }
    } catch (err) {
      alert("Failed to create business profile");
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
      alert(err instanceof Error ? err.message : "Failed to delete project");
    } finally {
      setDeletingId(null);
    }
  }

  // LIVE counter = published storefronts (status === "live"), NOT
  // currently-broadcasting projects (is_live === true). #231 briefly
  // switched this to is_live and got it wrong — what merchants call
  // "my live storefront" is the published/discoverable state, not the
  // "camera-on, IVS session running" state. Same canonical source as
  // the project page's storefront status badge and /discover
  // discoverability. is_live remains the right field for the host
  // card's broadcast indicator (e.g. line 698 below) — different
  // concept, different consumer.
  const liveCount = projects.filter((p) => p.status === "live").length;

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

  return (
    <div className="relative min-h-screen bg-surface-page px-4 py-12 text-primary sm:px-6">
      <div className="relative z-[1] mx-auto max-w-5xl">

        {/* Header */}
        <div className="mb-10">
          <div className="text-[10px] uppercase tracking-[0.35em] text-muted">
            Dashboard
          </div>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
            Your DUM Club shop
          </h1>
          <p className="mt-2 text-sm text-secondary">Everything you sold, paid, and have left to set up.</p>
        </div>

        {/* Primary action card. Top-of-page so the merchant's main
            job is one click away. Routes to /dashboard/post which
            holds the single-screen composer.
            Pre-first-offer: the headline reads "Create Your First Offer"
            and the copy stays focused on selling, not on live streaming
            — going live is a downstream step that's only useful AFTER
            the merchant has something to sell. Mentioning it up front
            taught the wrong order and reads as alarming.
            After first offer: the merchant has graduated to "Post & Go
            Live" — they have inventory; live streaming is now relevant. */}
        <Link
          href="/dashboard/post"
          className="group mb-8 block rounded-3xl border border-default bg-gradient-to-br from-brand-teal-soft to-surface-card p-6 transition hover:border-brand-teal sm:p-8"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-brand-teal">
                {needsFirstOffer ? "Next step" : "Primary action"}
              </div>
              <div className="mt-2 text-xl font-extrabold tracking-tight text-brand-navy sm:text-2xl">
                {needsFirstOffer ? "Create Your First Offer" : "Post & Go Live"}
              </div>
              <p className="mt-1 text-sm text-secondary">
                {needsFirstOffer
                  ? "Pick one thing you sell and set a price. That's all you need to start selling."
                  : "Take a photo, set a price, start your show."}
              </p>
            </div>
            <span className="shrink-0 rounded-xl bg-brand-teal px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-brand-navy transition group-hover:bg-brand-teal-hover group-hover:text-white">
              Start →
            </span>
          </div>
        </Link>

        {/* Stats + Wallet + CTA row */}
        <div className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Your Storefronts (renamed from "Total Projects" — clearer
              language for non-technical merchants and matches the
              user-facing terminology elsewhere). */}
          <div className="rounded-2xl border border-default bg-surface-card p-6">
            <div className="text-[10px] uppercase tracking-[0.28em] text-secondary">
              Your Storefronts
            </div>
            <div className="mt-2 font-mono text-3xl font-bold text-brand-navy">
              {projects.length}
            </div>
            {user && projects.length === 0 && (
              <p className="mt-2 text-[11px] leading-snug text-muted">
                Don&apos;t see your shop? It might be linked to a different account. Sign in with the same email or Google you used at signup.
              </p>
            )}
          </div>

          {/* Live count — only shown once the merchant has at least
              one project AND there's something to count (live now OR
              has gone live before). Teaching "Live" as a primary
              concept to a brand-new merchant who hasn't created an
              offer is backwards: selling comes first, going live
              comes after. The Live stat surfaces only when relevant. */}
          {projects.length > 0 && (liveCount > 0 || projects.some(p => p.status === "live")) && (
            <div className="rounded-2xl border border-default bg-surface-card p-6">
              <div className="text-[10px] uppercase tracking-[0.28em] text-secondary">
                Live
              </div>
              <div className="mt-2 font-mono text-3xl font-bold text-brand-teal">
                {liveCount}
              </div>
            </div>
          )}

          {/* Account — spans the remaining row width on both breakpoints
              (sm: 2 cols, lg: 4 cols) so the dashboard never shows an empty
              cell beside it. */}
          <div className="rounded-2xl border border-default bg-surface-card p-6 sm:col-span-2 lg:col-span-2">
            <div className="text-[10px] uppercase tracking-[0.28em] text-secondary">
              Account
            </div>
            {user ? (
              <div className="mt-2 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-2 w-2 rounded-full bg-brand-teal" />
                  <span className="text-sm font-medium text-brand-teal">Signed in</span>
                </div>
                <div className="mt-1 text-[11px] text-muted">
                  {user.email || "Account active"}
                </div>
              </div>
            ) : (
              <div className="mt-2 text-sm text-muted">Not signed in</div>
            )}
          </div>
        </div>

        {/* DUM Points — HIDDEN per CLAUDE.md §12 rule 4: "Never show
            DUM Points in navbar until Phase 2." Same rule applies to
            merchant dashboard surfaces. Phase 2 unlock conditions
            (10+ verified sellers AND $1k+ GMV AND legal review of
            purchase flow) are NOT met. The /hub page still exists at
            its direct URL; this is only hiding the dashboard surface.
            Re-enable when Phase 2 unlocks. */}

        {/* Business Profile */}
        {user && (
          <div className="mb-6">
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
                      <div className="text-[11px] text-secondary">{bizProfile.category} · Accepts DUM Points</div>
                    </div>
                  </div>
                  {bizProfile.verification_status === "unverified" && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const token = await getToken();
                          const res = await fetch(`${API_BASE}/api/business/request-verification`, {
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
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-default bg-surface-card p-5">
                {showBizForm ? (
                  <div className="space-y-3">
                    <div className="text-sm font-bold text-primary">Create your business profile</div>
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
                      <p className="mt-1 text-xs text-secondary">Add your business identity, get verified, and accept DUM Points</p>
                    </div>
                    <button
                      onClick={() => setShowBizForm(true)}
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

        {/* Business Analytics */}
        {bizProfile && analytics && (
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
              <div className="rounded-2xl border border-default bg-gradient-to-r from-brand-teal-soft to-surface-card p-5">
                <div className="text-[10px] uppercase tracking-[0.28em] text-brand-teal/60">DUM Received</div>
                <div className="mt-1 font-mono text-2xl font-bold text-brand-teal">{analytics.total_dum_received || 0}</div>
                <div className="mt-1 text-[11px] text-muted">
                  {analytics.dum_discount_orders > 0
                    ? `${analytics.dum_discount_orders} order${analytics.dum_discount_orders !== 1 ? "s" : ""} used DUM discount`
                    : "from customer DUM spending"}
                </div>
              </div>
            </div>

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

            {/* Empty state */}
            {analytics.total_orders === 0 && analytics.total_views === 0 && (
              <div className="rounded-2xl border border-dashed border-default bg-surface-card p-6 text-center">
                <div className="text-sm font-medium text-secondary">No activity yet</div>
                <p className="mt-1 text-xs text-muted">Share your storefront links to start getting views and sales</p>
              </div>
            )}
          </div>
        )}

        {/* Drive Your Market Analytics — gated by merchant.subscription_tier.
             Renders the unlocked dashboard for Founding / Growth / Pro /
             Business / Enterprise; renders an upgrade card otherwise.
             Both states only render once the merchant record has loaded
             (so we don't flash the locked card to a Pro merchant). */}
        {bizProfile && merchant && (
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
        <details className="group mb-6 rounded-2xl border border-default bg-surface-card">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-primary hover:text-brand-teal">
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

        {bizProfile && analyticsLoading && !analytics && (
          <div className="mb-6 rounded-2xl border border-default bg-surface-card p-6 text-center">
            <div className="text-sm text-secondary">Loading analytics...</div>
          </div>
        )}

        {/* Next best action — hidden when needsFirstOffer is true so the
            primary "Post your first offer" card above is the only thing
            asking for the merchant's attention. */}
        {!needsFirstOffer && (
        <div className="mb-6 rounded-2xl border border-default bg-surface-muted/20 p-5">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-secondary">What to do next</div>
          <div className="space-y-2">
            {projects.length === 0 && (
              <Link href="/merchant" className="flex items-center gap-3 rounded-xl border border-default bg-brand-teal-soft px-4 py-3 transition hover:border-default">
                <span className="text-base">🏪</span>
                <div>
                  <div className="text-sm font-bold text-primary">Claim Your Founding Spot</div>
                  <div className="text-[11px] text-secondary">60 days free · Lock in founding pricing for life · 100 spots</div>
                </div>
              </Link>
            )}
            {projects.length > 0 && projects.some(p => p.status === "live") && (
              <Link href={`/project/${projects.find(p => p.status === "live")?.id}#offers-section`} className="flex items-center gap-3 rounded-xl border border-default/30 bg-surface-card px-4 py-3 transition hover:border-default">
                <span className="text-base">🏷️</span>
                <div>
                  <div className="text-sm font-bold text-primary">Add or improve offers</div>
                  <div className="text-[11px] text-secondary">Earn +5 DUM Points per offer</div>
                </div>
              </Link>
            )}
            {dumBalance < 50 && (
              <Link href="/discover" className="flex items-center gap-3 rounded-xl border border-default/30 bg-surface-card px-4 py-3 transition hover:border-default">
                <span className="text-base">💡</span>
                <div>
                  <div className="text-sm font-bold text-primary">Discover local businesses</div>
                  <div className="text-[11px] text-secondary">Earn DUM Points with every purchase</div>
                </div>
              </Link>
            )}
            <Link href="/discover" className="flex items-center gap-3 rounded-xl border border-default/30 bg-surface-card px-4 py-3 transition hover:border-default">
              <span className="text-base">🔍</span>
              <div>
                <div className="text-sm font-bold text-primary">Explore & support other businesses</div>
                <div className="text-[11px] text-secondary">Earn +2 DUM Points per purchase</div>
              </div>
            </Link>
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

        {/* ── Action Prompts ── Hidden when needsFirstOffer is true;
            those Share/Manage/View-orders cards all assume offers
            already exist, and we want the primary "Post your first
            offer" card to be the only ask on screen for that state. */}
        {user && !needsFirstOffer && (
          <div className="mb-10">
            {projects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-default bg-brand-teal-soft p-6 text-center">
                <div className="mb-2 text-2xl">🏪</div>
                <div className="mb-1 text-base font-bold text-primary">Start selling on DUM Club</div>
                <p className="mb-4 text-sm text-secondary">Join the first 100 merchants. Get 60 days free and lock in founding pricing for life. 1% sales fee per order (industry-low; Whatnot takes 8%).</p>
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
                        alert("Link copied! Share it with your audience.");
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
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xs uppercase tracking-[0.3em] text-muted">
              Your Businesses
            </h2>
            <span className="text-xs text-muted">
              {projects.length} project{projects.length !== 1 ? "s" : ""}
            </span>
          </div>

          {!user ? (
            <div className="rounded-2xl border border-default bg-surface-card p-8 text-center">
              <p className="text-sm text-secondary">Sign in to view your businesses.</p>
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-default bg-surface-card p-10 text-center">
              <p className="text-base font-semibold text-primary">No businesses yet.</p>
              <p className="mt-2 text-sm text-secondary">
                Post your first offer and you&apos;re ready to go live.
              </p>
              <Link
                href="/dashboard/post"
                className="mt-5 inline-flex items-center rounded-xl bg-brand-teal px-6 py-2.5 text-sm font-bold text-black transition hover:bg-brand-teal-hover hover:text-white"
              >
                Post your first offer →
              </Link>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {projects.map((project) => {
                const st = statusLabel(project);
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
                    className="group relative rounded-2xl border border-default bg-surface-card transition hover:border-default hover:-translate-y-0.5 hover:shadow-[0_4px_20px_rgba(0,0,0,0.3)]"
                  >
                    <Link href={`/project/${project.id}`} className="block p-6">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-base font-semibold text-primary group-hover:text-brand-teal">
                          {project.title || project.name || "Untitled Project"}
                        </h3>
                        <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${st.color}`}>
                          {st.text}
                        </span>
                      </div>


                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-xs text-muted"> </span>
                        <span className="text-xs text-muted opacity-0 transition group-hover:opacity-100">View →</span>
                      </div>
                    </Link>

                    {/* Copy storefront link — primary post-publish action.
                        Disabled until status='live' so a brand-new
                        merchant can't accidentally share a draft URL
                        with a customer. The disabled state explains
                        what unlocks it instead of pretending the link
                        is dead. */}
                    {isShareable ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (typeof navigator !== "undefined" && navigator.clipboard) {
                            navigator.clipboard.writeText(storefrontUrl).catch(() => {});
                          }
                        }}
                        className="mx-4 mb-3 flex w-[calc(100%-2rem)] items-center justify-center gap-2 rounded-xl border border-default bg-surface-card px-4 py-2.5 text-sm font-bold text-primary transition hover:bg-brand-teal-soft hover:text-brand-teal"
                      >
                        📋 Copy storefront link
                      </button>
                    ) : (
                      <div className="mx-4 mb-3 flex items-center justify-center gap-2 rounded-xl border border-dashed border-default bg-surface-muted px-4 py-2.5 text-xs text-muted">
                        Publish your first offer to unlock sharing
                      </div>
                    )}

                    {/* Go Live — only useful once the merchant has at
                        least one offer to actually sell during the
                        stream. Hidden on draft projects so the dashboard
                        doesn't push "Live" before there's something to
                        sell. Once the project is live, the button is
                        available on the storefront page itself. */}
                    {isShareable && (
                      <Link
                        href={`/project/${project.id}?golive=1`}
                        className="mx-4 mb-3 flex items-center justify-center gap-2 rounded-xl bg-brand-teal px-4 py-2.5 text-sm font-bold text-brand-navy transition hover:bg-brand-teal-hover hover:text-white"
                      >
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-navy opacity-75" />
                          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-navy" />
                        </span>
                        Go Live
                      </Link>
                    )}
                    {/* Preview-as-customer — flips the project page's
                        sessionStorage flag so the merchant sees the
                        storefront the way a buyer would, without the
                        AdminBar / Business Status / Manage controls. */}
                    <Link
                      href={`/project/${project.id}?viewAsCustomer=1`}
                      className="mx-4 mb-4 block text-center text-xs text-muted transition hover:text-primary"
                    >
                      Preview as customer →
                    </Link>

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
      </div>
    </div>
  );
}
