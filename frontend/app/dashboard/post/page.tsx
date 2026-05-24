"use client";

/**
 * /dashboard/post — single-screen "Post & Go Live" composer.
 *
 * Loads the merchant + their primary project, then mounts the
 * PostAndGoLive form. All the actual composer logic (image upload,
 * Stripe gating, offer create, pin, auto-go-live redirect) lives in
 * components/dashboard/PostAndGoLive.tsx so it stays reusable.
 *
 * Fallbacks:
 *   - signed out -> sign-in CTA
 *   - no merchant row -> route to /merchant signup
 *   - no project -> route to /merchant (project creation happens during
 *     merchant signup; the composer needs a project_id to attach the
 *     offer to)
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

export default function DashboardPostPage() {
  const { user, getToken, login } = useAuth();

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

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
        if (pRes.ok) {
          const data = await pRes.json();
          const list: Project[] = Array.isArray(data?.projects)
            ? data.projects
            : Array.isArray(data)
              ? data
              : [];
          setProjects(list);
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
            Loading…
          </div>
        ) : !primaryProject ? (
          <div className="rounded-2xl border border-default bg-surface-card p-8 text-center">
            <p className="mb-2 text-sm font-semibold text-primary">
              You need a shop page first.
            </p>
            <p className="mb-4 text-sm text-secondary">
              Finish merchant signup to create your storefront, then come back here to post.
            </p>
            <Link
              href="/merchant"
              className="inline-block rounded-xl bg-brand-teal px-6 py-3 text-sm font-bold uppercase tracking-[0.12em] text-brand-navy transition hover:bg-brand-teal-hover hover:text-white"
            >
              Go to merchant signup →
            </Link>
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
