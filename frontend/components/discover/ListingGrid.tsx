"use client";

/**
 * ListingGrid — grid wrapper with loading skeletons.
 *
 * 1 col mobile, 2 col tablet, 3 col desktop.
 */

import type { Project, MarketSnapshot } from "../../lib/discover/types";
import { ListingCard } from "./ListingCard";

type ListingGridProps = {
  projects: Project[];
  marketByProject: Record<string, MarketSnapshot>;
  pulseId: string | null;
  followerCounts?: Record<string, number>;
  followingSet?: Set<string>;
};

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-default bg-surface-card p-4 shadow-dum-card">
      <div className="mb-3 flex items-center gap-2.5">
        <div className="h-[30px] w-[30px] animate-pulse rounded-lg bg-surface-muted" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-surface-muted" />
      </div>
      <div className="mb-3 h-[150px] animate-pulse rounded-xl bg-surface-muted" />
      <div className="mb-2 h-3 w-16 animate-pulse rounded bg-surface-muted" />
      <div className="mb-1 h-4 w-full animate-pulse rounded bg-surface-muted" />
      <div className="mb-4 h-4 w-2/3 animate-pulse rounded bg-surface-muted" />
      <div className="border-t border-default pt-3.5">
        <div className="h-3 w-20 animate-pulse rounded bg-surface-muted" />
      </div>
    </div>
  );
}

export function LoadingGrid({ count = 6 }: { count?: number }) {
  // Cap at 12 so a large cached/expected count never floods the page
  // with skeletons (the jarring 36-card flash this avoids).
  const n = Math.min(Math.max(count, 1), 12);
  return (
    <div className="grid gap-4 sm:grid-cols-2 sm:gap-[18px]">
      {Array.from({ length: n }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function ListingGrid({ projects, marketByProject, pulseId, followerCounts, followingSet }: ListingGridProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 sm:gap-[18px]">
      {projects.map((project, index) => (
        <ListingCard
          key={project.id}
          project={project}
          index={index}
          marketSnapshot={marketByProject[project.id]}
          isPulsing={pulseId === project.id}
          followerCount={followerCounts?.[project.id] ?? 0}
          isFollowing={followingSet?.has(project.id) ?? false}
        />
      ))}
    </div>
  );
}
