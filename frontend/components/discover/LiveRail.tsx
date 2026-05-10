"use client";

/**
 * Live Rail — horizontal scroll of live sellers.
 *
 * Renders ONLY if items.some(isLive). Returns null otherwise.
 * No Mux autoplay on cards (perf/bandwidth).
 * Static thumbnail + LIVE badge only.
 */

import Link from "next/link";
import type { Project } from "../../lib/discover/types";
import { getProjectEmoji, getAccent, lowestOfferPrice } from "../../lib/discover/filters";
import { classifyProject } from "../../lib/categories";

export function LiveRail({ projects }: { projects: Project[] }) {
  const liveProjects = projects.filter((p) => p.is_live === true);
  if (liveProjects.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
        </span>
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-primary">
          Live Now
        </h2>
        <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-400">
          {liveProjects.length}
        </span>
      </div>

      <div
        className="flex gap-3 overflow-x-auto pb-2 [&::-webkit-scrollbar]:hidden"
        style={{ scrollSnapType: "x mandatory" }}
      >
        {liveProjects.map((project, index) => {
          const emoji = getProjectEmoji(project, index);
          const category = classifyProject(project);
          const accent = getAccent(index);
          const price = lowestOfferPrice(project);

          return (
            <Link
              key={project.id}
              href={`/project/${project.slug || project.id}?live=1`}
              className="flex w-[280px] flex-shrink-0 flex-col rounded-xl border border-[var(--state-live)]/30 bg-surface-card p-4 transition hover:border-[var(--state-live)]/30"
              style={{ scrollSnapAlign: "start" }}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-2xl">{emoji}</span>
                <div className="flex items-center gap-2">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
                  </span>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-red-400">
                    LIVE
                  </span>
                </div>
              </div>

              <h3 className="text-sm font-bold text-primary">
                {project.title || project.name || "Untitled"}
              </h3>
              <p className="mt-1 line-clamp-2 text-[11px] text-muted">
                {project.description || ""}
              </p>

              <div className="mt-auto flex items-center justify-between pt-3">
                {price != null && (
                  <span className="text-xs font-bold text-brand-teal">
                    From ${price < 1 ? price.toFixed(2) : Math.round(price)}
                  </span>
                )}
                <span className="ml-auto text-[10px] font-medium text-red-400">
                  Watch live →
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
