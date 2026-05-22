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
};

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-default bg-surface-card p-5 sm:p-6">
      <div className="mb-4 h-20 animate-pulse rounded-lg bg-zinc-800/50" />
      <div className="mb-2 h-3 w-16 animate-pulse rounded bg-zinc-800/50" />
      <div className="mb-2 h-5 w-3/4 animate-pulse rounded bg-zinc-800/50" />
      <div className="mb-1 h-3 w-full animate-pulse rounded bg-zinc-800/50" />
      <div className="mb-4 h-3 w-2/3 animate-pulse rounded bg-zinc-800/50" />
      <div className="border-t border-default pt-4">
        <div className="h-3 w-20 animate-pulse rounded bg-zinc-800/50" />
      </div>
    </div>
  );
}

export function LoadingGrid({ count = 6 }: { count?: number }) {
  // Cap at 12 so a large cached/expected count never floods the page
  // with skeletons (the jarring 36-card flash this avoids).
  const n = Math.min(Math.max(count, 1), 12);
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: n }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function ListingGrid({ projects, marketByProject, pulseId }: ListingGridProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project, index) => (
        <ListingCard
          key={project.id}
          project={project}
          index={index}
          marketSnapshot={marketByProject[project.id]}
          isPulsing={pulseId === project.id}
        />
      ))}
    </div>
  );
}
