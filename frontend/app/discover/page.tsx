"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Project = {
  id: string;
  name?: string;
  title?: string;
  description?: string | null;
  template_type?: string;
  status?: string;
  created_at?: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const FILTERS = ["All", "Health", "Finance", "Creative", "Business", "Music"];

function getProjectEmoji(project: Project, index: number) {
  const source = `${project.title || project.name || ""} ${project.template_type || ""}`.toLowerCase();

  if (source.includes("fitness") || source.includes("health")) return "💪";
  if (source.includes("math") || source.includes("tutor")) return "🧠";
  if (source.includes("movie") || source.includes("script")) return "🎬";
  if (source.includes("music") || source.includes("beat")) return "🎵";
  if (source.includes("crypto") || source.includes("signal")) return "📈";
  if (source.includes("clean")) return "🧹";

  return ["🚀", "⚡", "🧠", "💡", "📦", "🌐"][index % 6];
}

function getAccent(index: number) {
  const accents = ["#00FFB2", "#FF6B35", "#A78BFA", "#FBBF24", "#38BDF8", "#F472B6"];
  return accents[index % accents.length];
}

function getCategory(project: Project) {
  const source = `${project.title || project.name || ""} ${project.template_type || ""}`.toLowerCase();

  if (source.includes("fitness") || source.includes("health")) return "Health";
  if (source.includes("movie") || source.includes("script")) return "Creative";
  if (source.includes("music") || source.includes("beat")) return "Music";
  if (source.includes("crypto") || source.includes("signal")) return "Finance";
  if (source.includes("clean")) return "Business";
  if (source.includes("math") || source.includes("tutor")) return "Creative";

  return "Business";
}

function getTicker(project: Project) {
  const raw = (project.title || project.name || "")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.slice(0, 2).toUpperCase())
    .join("")
    .slice(0, 6);

  return raw || "";
}

function getProjectLabel(project?: Project) {
  return project?.title || project?.name || "—";
}

function isToday(dateString?: string) {
  if (!dateString) return false;

  const date = new Date(dateString);
  const now = new Date();

  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export default function DiscoverPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [filter, setFilter] = useState("All");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadProjects() {
    try {
      setLoading(true);
      setError("");

      const res = await fetch(`${API_BASE}/api/projects/`, {
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(`Failed to load projects: ${res.status}`);
      }

      const data = await res.json();
      const allProjects = Array.isArray(data?.projects) ? data.projects : [];

      const liveProjects = allProjects.filter(
        (project: Project) => project?.status === "live"
      );

      setProjects(liveProjects);
    } catch (err) {
      console.error("DISCOVER LOAD ERROR:", err);
      setError("Failed to load public projects.");
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  const filteredProjects = useMemo(() => {
    if (filter === "All") return projects;
    return projects.filter((project) => getCategory(project) === filter);
  }, [projects, filter]);

  const totalPublicProjects = projects.length;
  const newestProject = projects[0];
  const mostChattedProject = projects[0];
  const newTodayCount = projects.filter((p) => isToday(p.created_at)).length;

  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto max-w-7xl px-6 py-12">
        <div className="mb-4 text-xs uppercase tracking-[0.35em] text-zinc-600">
          ◆ Discovery Feed
        </div>

        <div className="mb-10 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="font-mono text-4xl font-bold uppercase tracking-[-0.04em] text-white sm:text-6xl">
              Trending Projects
            </h1>
          </div>

          <div className="flex flex-wrap gap-2">
            {FILTERS.map((tag) => {
              const active = filter === tag;

              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setFilter(tag)}
                  className={`border px-4 py-2 font-mono text-xs uppercase tracking-[0.22em] transition ${
                    active
                      ? "border-emerald-400 bg-emerald-400 text-black"
                      : "border-zinc-800 bg-transparent text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mb-8 grid gap-6 border-b border-zinc-900 pb-6 md:grid-cols-4">
          <div>
            <div className="mb-2 text-xs uppercase tracking-[0.3em] text-zinc-600">
              ◆ Public Projects
            </div>
            <div className="text-3xl font-semibold text-white">
              {totalPublicProjects}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs uppercase tracking-[0.3em] text-zinc-600">
              ↑ Newest Live Project
            </div>
            <div className="text-3xl font-semibold text-white">
              {getProjectLabel(newestProject)}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs uppercase tracking-[0.3em] text-zinc-600">
              💬 Most Chatted
            </div>
            <div className="text-3xl font-semibold text-white">
              {getProjectLabel(mostChattedProject)}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs uppercase tracking-[0.3em] text-zinc-600">
              🔥 New Today
            </div>
            <div className="text-3xl font-semibold text-white">
              {newTodayCount}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="border border-zinc-900 bg-zinc-950 p-8 text-zinc-400">
            Loading public projects...
          </div>
        ) : error ? (
          <div className="border border-red-500/20 bg-red-500/10 p-8 text-red-300">
            {error}
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="border border-zinc-900 bg-zinc-950 p-8 text-zinc-400">
            No public projects found for this category.
          </div>
        ) : (
          <div className="grid gap-0 border border-zinc-900 md:grid-cols-2 xl:grid-cols-3">
            {filteredProjects.map((project, index) => {
              const accent = getAccent(index);
              const emoji = getProjectEmoji(project, index);
              const category = getCategory(project);
              const ticker = getTicker(project);

              return (
                <Link key={project.id} href={`/project/${project.id}`}>
                  <div className="h-full border border-zinc-900 bg-black p-8 transition hover:bg-zinc-950">
                    <div className="mb-6 flex items-start justify-between">
                      <div style={{ fontSize: "42px" }}>{emoji}</div>

                      <div className="text-right">
                        <div
                          className="font-mono text-2xl font-bold uppercase"
                          style={{ color: accent }}
                        >
                          ${ticker}
                        </div>
                        <div
                          className="mt-1 font-mono text-xs uppercase tracking-[0.16em]"
                          style={{ color: accent }}
                        >
                          {project.status || "live"}
                        </div>
                      </div>
                    </div>

                    <h3 className="font-mono text-3xl font-bold leading-tight text-white">
                      {project.title || project.name || "Untitled Project"}
                    </h3>

                    <p className="mt-4 min-h-[96px] text-lg leading-8 text-zinc-500">
                      {project.description || "No description yet."}
                    </p>

                    <div className="mt-8 flex items-center justify-between gap-4">
                      <span className="text-sm text-zinc-600">
                        Open project workspace →
                      </span>

                      <span
                        className="border px-3 py-2 font-mono text-xs uppercase tracking-[0.22em]"
                        style={{
                          borderColor: accent,
                          color: accent,
                        }}
                      >
                        {category}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
