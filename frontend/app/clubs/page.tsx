"use client";

/**
 * /clubs — "Your Clubs": the signed-in viewer's followed shops, live first.
 *
 * Reuses the existing Discover plumbing end to end — the same public feed
 * (useProjects), the same favorites API ("follow" is the favorites table),
 * and the same followed-set filtering. No new backend route:
 *   GET  /api/favorites/mine    → the viewer's followed project IDs
 *   POST /api/favorites/counts  → follower counts for the followed shops
 * The feed already carries everything the cards need; we just filter it to
 * the followed set and sort the live ones to the top.
 *
 * Signed-out → a sign-in prompt. Signed-in with no follows → an empty state
 * that points back to Discover. Never a blank screen.
 */

import { useEffect, useMemo, useState } from "react";

import { useProjects } from "../../lib/discover/useProjects";
import { isDiscoverable } from "../../lib/discover/filters";
import { cleanLogoUrl } from "../../lib/imageSrc";
import { API_BASE } from "../../lib/apiBase";
import { useAuth } from "../../lib/auth/AuthContext";
import type { Project } from "../../lib/discover/types";

import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { LoadingGrid } from "../../components/discover/ListingGrid";

export default function ClubsPage() {
  const { projects, loading, error } = useProjects();
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

  /* Live shops first, so a followed show in progress always leads. */
  const sortedFollowed = useMemo(
    () =>
      [...followed].sort(
        (a, b) => (b.is_live === true ? 1 : 0) - (a.is_live === true ? 1 : 0),
      ),
    [followed],
  );
  const ready = !authLoading && followsLoaded;

  return (
    <main className="relative min-h-screen bg-surface-page text-primary">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">
            Your Clubs
          </h1>
          <p className="mt-1 text-sm text-secondary">
            Shops you follow. Live ones first.
          </p>
        </header>

        {/* Signed-out — prompt to sign in. */}
        {ready && !user ? (
          <Card padding="lg" className="text-center">
            <p className="text-base font-bold text-primary">Sign in to see your clubs</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-secondary">
              Follow your favorite local shops and get a heads-up the moment they go live.
            </p>
            <Button onClick={login} className="mt-4">Sign in</Button>
            <div className="mt-3">
              <Button href="/discover" variant="link" className="text-xs">
                Browse shops
              </Button>
            </div>
          </Card>
        ) : !ready || (user && loading && followed.length === 0) ? (
          /* Loading the feed or the follow set. */
          <>
            <p className="mb-4 text-sm text-secondary">Loading your clubs...</p>
            <LoadingGrid count={6} />
          </>
        ) : error ? (
          <Card padding="lg" className="text-center">
            <p className="text-sm text-secondary">{error}</p>
            <Button
              variant="secondary"
              onClick={() => window.location.reload()}
              className="mt-3"
            >
              Try again
            </Button>
          </Card>
        ) : followed.length === 0 ? (
          /* Signed-in, no follows yet. */
          <Card padding="lg" className="text-center">
            <p className="text-base font-bold text-primary">You're not following any shops yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-secondary">
              Tap Follow on any shop and it shows up here. Live shows you follow jump to the top.
            </p>
            <Button href="/discover" className="mt-4">Find shops to follow</Button>
          </Card>
        ) : (
          <div className="space-y-3">
            {sortedFollowed.map((p) => (
              <ClubRow key={p.id} project={p} followerCount={followerCounts[p.id] ?? 0} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

/**
 * One followed-shop row: avatar + name + status line, with a coral Watch
 * button when the shop is live and a neutral View button otherwise. Live
 * rows link straight into the live room; others into the storefront.
 */
function ClubRow({ project, followerCount }: { project: Project; followerCount: number }) {
  const name = project.title || project.name || "Untitled";
  const isLive = project.is_live === true;
  const href = isLive
    ? `/project/${project.slug || project.id}?live=1`
    : `/project/${project.slug || project.id}`;
  const logo = cleanLogoUrl(project.business_profile?.logo_url) || cleanLogoUrl(project.business_profile?.cover_image_url);
  const monogram = (name.trim().charAt(0) || "•").toUpperCase();

  return (
    <Card padding="none" className="flex items-center gap-3 p-3 sm:p-4">
      {/* Avatar */}
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-default bg-brand-teal-soft">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt={name} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-lg font-extrabold text-mint-text">{monogram}</span>
          </div>
        )}
      </div>

      {/* Name + status line */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-primary">{name}</p>
        {isLive ? (
          <span className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-secondary">
            <Badge variant="live" size="sm" dot>Live</Badge>
            {followerCount > 0 && (
              <span className="font-mono text-coral">{followerCount} watching</span>
            )}
          </span>
        ) : (
          <p className="mt-0.5 text-xs text-secondary">Following</p>
        )}
      </div>

      {/* Action — coral Watch for live shows, neutral View otherwise. The
          danger variant is the design-system coral fill (bg-state-live ===
          the coral token), white text, no hover-color fight. */}
      {isLive ? (
        <Button href={href} variant="danger" size="sm" className="shrink-0 shadow-dum-coral">
          Watch
        </Button>
      ) : (
        <Button href={href} variant="secondary" size="sm" className="shrink-0">
          View
        </Button>
      )}
    </Card>
  );
}
