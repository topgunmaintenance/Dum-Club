"use client";

/**
 * /clubs — "Your Clubs": the signed-in viewer's followed shops, live first.
 *
 * Reuses the existing Discover plumbing end to end — the same public feed
 * (useProjects), the same favorites API ("follow" is the favorites table),
 * and the same LiveRail + ListingGrid components. No new backend route:
 *   GET  /api/favorites/mine    → the viewer's followed project IDs
 *   POST /api/favorites/counts  → follower counts for the followed shops
 * The feed already carries everything the cards need; we just filter it to
 * the followed set and let LiveRail surface the live ones at the top.
 *
 * Signed-out → a sign-in prompt. Signed-in with no follows → an empty state
 * that points back to Discover. Never a blank screen.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { useProjects } from "../../lib/discover/useProjects";
import { isDiscoverable, withoutLive } from "../../lib/discover/filters";
import { API_BASE } from "../../lib/apiBase";
import { useAuth } from "../../lib/auth/AuthContext";

import { LiveNowGrid } from "../../components/discover/LiveNowGrid";
import { ListingGrid, LoadingGrid } from "../../components/discover/ListingGrid";

export default function ClubsPage() {
  const { projects, marketByProject, loading, error } = useProjects();
  const { user, loading: authLoading, login, getToken } = useAuth();

  const [followingSet, setFollowingSet] = useState<Set<string>>(() => new Set());
  const [followsLoaded, setFollowsLoaded] = useState(false);
  const [followerCounts, setFollowerCounts] = useState<Record<string, number>>({});

  /* The viewer's followed shops (IDs only — the feed carries the rest). */
  useEffect(() => {
    if (!user) {
      setFollowingSet(new Set());
      setFollowsLoaded(true);
      return;
    }
    let cancelled = false;
    setFollowsLoaded(false);
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_BASE}/api/favorites/mine`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && Array.isArray(data?.favorites)) {
            setFollowingSet(new Set(data.favorites.map((f: { project_id: string }) => f.project_id)));
          }
        }
      } catch {
        /* best-effort: an empty set just renders the empty state */
      } finally {
        if (!cancelled) setFollowsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user, getToken]);

  /* Followed shops, drawn from the same public feed (no per-shop fetch). */
  const followed = useMemo(
    () =>
      followingSet.size
        ? projects.filter((p) => isDiscoverable(p) && followingSet.has(p.id))
        : [],
    [projects, followingSet],
  );

  /* Follower counts for the followed shops, one batched request. */
  useEffect(() => {
    const ids = followed.map((p) => p.id).filter(Boolean);
    if (ids.length === 0) { setFollowerCounts({}); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/favorites/counts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_ids: ids }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.counts) setFollowerCounts(data.counts);
      } catch { /* best-effort: cards just show no count */ }
    })();
    return () => { cancelled = true; };
  }, [followed]);

  const followedNonLive = useMemo(() => withoutLive(followed), [followed]);
  const ready = !authLoading && followsLoaded;

  return (
    <main className="relative min-h-screen bg-surface-page text-primary">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">
            Your Clubs
          </h1>
          <p className="mt-1 text-sm text-secondary">
            Shops you follow. Live ones first, so you never miss a show.
          </p>
        </header>

        {/* Signed-out — prompt to sign in. */}
        {ready && !user ? (
          <div className="rounded-2xl border border-default bg-surface-card p-8 text-center">
            <p className="text-base font-bold text-primary">Sign in to see your clubs</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-secondary">
              Follow your favorite local shops and get a heads-up the moment they go live.
            </p>
            <button
              type="button"
              onClick={login}
              className="mt-4 inline-flex items-center justify-center rounded-xl bg-mint-fill px-5 py-2.5 text-sm font-bold text-mint-fill-ink transition hover:opacity-90"
            >
              Sign in
            </button>
            <div className="mt-3">
              <Link href="/discover" className="text-xs font-bold uppercase tracking-[0.12em] text-secondary transition hover:text-brand-teal">
                Browse shops →
              </Link>
            </div>
          </div>
        ) : !ready || (user && loading && followed.length === 0) ? (
          /* Loading the feed or the follow set. */
          <>
            <p className="mb-4 text-sm text-secondary">Loading your clubs…</p>
            <LoadingGrid count={6} />
          </>
        ) : error ? (
          <div className="rounded-2xl border border-default bg-surface-card p-8 text-center">
            <p className="text-sm text-secondary">{error}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-3 inline-flex items-center rounded-xl border border-default bg-surface-muted px-4 py-2 text-sm font-semibold text-primary transition hover:border-strong"
            >
              Try again
            </button>
          </div>
        ) : followed.length === 0 ? (
          /* Signed-in, no follows yet. */
          <div className="rounded-2xl border border-default bg-surface-card p-8 text-center">
            <p className="text-base font-bold text-primary">You're not following any shops yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-secondary">
              Tap Follow on any shop and it shows up here. Live shows you follow jump to the top.
            </p>
            <Link
              href="/discover"
              className="mt-4 inline-flex items-center justify-center rounded-xl bg-mint-fill px-5 py-2.5 text-sm font-bold text-mint-fill-ink transition hover:opacity-90"
            >
              Find shops to follow
            </Link>
          </div>
        ) : (
          <>
            {/* Live followed shows lead (self-hides if none live), in the same
                2-up Club style as /discover. */}
            <LiveNowGrid projects={followed} />

            {/* The rest of the followed shops. */}
            {followedNonLive.length > 0 && (
              <section>
                <div className="mb-3">
                  <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-secondary">
                    Following · {followed.length}
                  </h2>
                </div>
                <ListingGrid
                  projects={followedNonLive}
                  marketByProject={marketByProject}
                  pulseId={null}
                  followerCounts={followerCounts}
                  followingSet={followingSet}
                />
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
