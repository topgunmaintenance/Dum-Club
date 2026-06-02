"use client";

/**
 * /dashboard/post — single-screen "Post & Go Live" composer.
 *
 * Loads the merchant + their primary project, then mounts the
 * PostAndGoLive form. All the actual composer logic (image upload,
 * Stripe gating, offer create, pin, auto-go-live redirect) lives in
 * components/dashboard/PostAndGoLive.tsx so it stays reusable.
 *
 * Storefront-ensure: if the projects query returns nothing, we call
 * POST /api/merchant/storefront/ensure to lazily create the project.
 * This replaces the previous "You need a shop page first" dead-end —
 * the project is now created on demand, and if creation genuinely
 * fails the user sees the actual error message (with the failing
 * column name, if Postgres gave one) rather than a useless loop.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../lib/auth/AuthContext";
import { API_BASE } from "../../../lib/apiBase";
import { PostAndGoLive } from "../../../components/dashboard/PostAndGoLive";

type Project = {
  id: string;
  slug?: string | null;
  title?: string | null;
  name?: string | null;
  status?: string | null;
};

type Merchant = {
  id?: string;
  stripe_connect_status?: string;
};

type EnsureError = {
  code?: string;
  error: string;
  missing_column?: string | null;
};

export default function DashboardPostPage() {
  const { user, getToken, login } = useAuth();

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [ensureError, setEnsureError] = useState<EnsureError | null>(null);

  useEffect(() => {
    if (!user?.privyId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
        const [mRes, pRes] = await Promise.all([
          fetch(`${API_BASE}/api/merchant/me`, { headers }),
          fetch(
            `${API_BASE}/api/projects/?owner_id=${encodeURIComponent(user.privyId)}`,
            { headers },
          ),
        ]);
        if (cancelled) return;
        if (mRes.ok) {
          const data = await mRes.json();
          setMerchant(data.merchant || null);
        }
        let list: Project[] = [];
        if (pRes.ok) {
          const data = await pRes.json();
          list = Array.isArray(data?.projects)
            ? data.projects
            : Array.isArray(data)
              ? data
              : [];
          setProjects(list);
        }

        // If no project yet, call ensure-storefront to lazily create one.
        // Idempotent on the backend — safe to retry on every mount.
        if (list.length === 0) {
          const eRes = await fetch(`${API_BASE}/api/merchant/storefront/ensure`, {
            method: "POST",
            headers,
          });
          if (cancelled) return;
          if (eRes.ok) {
            const ej = await eRes.json();
            if (ej?.ok && ej?.project) {
              setProjects([ej.project]);
            } else if (ej && ej.ok === false) {
              setEnsureError({
                code: ej.code,
                error: ej.error || "Could not create storefront.",
                missing_column: ej.missing_column,
              });
            }
          } else {
            setEnsureError({
              error: `Storefront setup failed (HTTP ${eRes.status}). Please refresh and try again.`,
            });
          }
        }
      } catch (err) {
        console.error("[dashboard/post] load failed:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.privyId, getToken]);

  // Pick the merchant's primary project: prefer a live one, else the
  // first in the list. Matches the dashboard's existing convention
  // (dashboard/page.tsx:625 "primary = projects.find(live) ?? projects[0]").
  const primaryProject =
    projects.find((p) => p.status === "live") ?? projects[0] ?? null;

  const stripeVerified = merchant?.stripe_connect_status === "verified";

  return (
    <main className="min-h-screen bg-surface-page px-4 pb-12 pt-24 sm:px-6">
      <div className="mx-auto w-full max-w-xl">
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/dashboard"
            className="text-[12px] font-semibold uppercase tracking-[0.18em] text-secondary transition hover:text-brand-teal"
          >
            ← Dashboard
          </Link>
        </div>

        <header className="mb-6">
          <h1 className="text-2xl font-extrabold tracking-tight text-primary sm:text-3xl">
            Post & Go Live
          </h1>
          <p className="mt-1 text-sm text-secondary">
            Take a photo, set a price, and start your show.
          </p>
        </header>

        {!user ? (
          <div className="rounded-2xl border border-default bg-surface-card p-8 text-center">
            <p className="mb-4 text-sm text-secondary">Sign in to post an item.</p>
            <button
              type="button"
              onClick={() => login()}
              className="rounded-xl bg-brand-teal px-6 py-3 text-sm font-bold uppercase tracking-[0.12em] text-brand-navy transition hover:bg-brand-teal-hover hover:text-white"
            >
              Sign in
            </button>
          </div>
        ) : loading ? (
          <div className="rounded-2xl border border-default bg-surface-card p-8 text-center text-sm text-secondary">
            Setting up your store…
          </div>
        ) : ensureError ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-8">
            <p className="mb-2 text-sm font-semibold text-red-400">
              We hit a snag setting up your store.
            </p>
            <p className="mb-4 text-sm text-secondary break-words">
              {ensureError.error}
            </p>
            {ensureError.missing_column && (
              <p className="mb-4 text-xs text-muted">
                Detail: missing required field <code className="rounded bg-surface-muted px-1.5 py-0.5">{ensureError.missing_column}</code>.
                Please report this to support so we can fix it.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-xl bg-brand-teal px-5 py-2.5 text-sm font-bold uppercase tracking-[0.12em] text-brand-navy transition hover:bg-brand-teal-hover hover:text-white"
              >
                Try again →
              </button>
              <a
                href="mailto:julian@dum.club?subject=Store%20setup%20issue"
                className="rounded-xl border border-default bg-surface-card px-5 py-2.5 text-sm font-semibold text-secondary transition hover:text-primary"
              >
                Contact support
              </a>
            </div>
          </div>
        ) : !primaryProject ? (
          // Shouldn't be reachable after the ensure call, but defensive:
          // if ensure succeeded but somehow no project showed up, retry.
          <div className="rounded-2xl border border-default bg-surface-card p-8 text-center">
            <p className="mb-4 text-sm text-secondary">
              Finishing up your store… give it a moment.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-xl bg-brand-teal px-6 py-3 text-sm font-bold uppercase tracking-[0.12em] text-brand-navy transition hover:bg-brand-teal-hover hover:text-white"
            >
              Refresh
            </button>
          </div>
        ) : (
          <PostAndGoLive
            project={primaryProject}
            stripeVerified={stripeVerified}
            getToken={getToken}
          />
        )}
      </div>
    </main>
  );
}
