"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Project = {
  id: string;
  name?: string;
  title?: string;
  description?: string;
  template_type?: string;
  status?: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  async function loadPublicProjects() {
    try {
      setLoadingProjects(true);
      const res = await fetch(`${API_BASE}/api/projects/public`);
      if (!res.ok) throw new Error("Failed to load public projects");

      const data = await res.json();
      setProjects((data.projects || []).slice(0, 3));
    } catch (err) {
      console.error(err);
      setProjects([]);
    } finally {
      setLoadingProjects(false);
    }
  }

  useEffect(() => {
    loadPublicProjects();
  }, []);

  return (
    <div className="min-h-screen overflow-hidden bg-black text-white">
      <section className="mx-auto max-w-7xl px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
        <div className="relative overflow-hidden border border-zinc-900 bg-black">
          <div className="absolute inset-0 opacity-20">
            <div className="h-full w-full bg-[radial-gradient(circle_at_top,rgba(0,255,178,0.12),transparent_35%)]" />
          </div>

          <div className="relative px-6 py-16 sm:px-10 sm:py-20 lg:px-16 lg:py-24">
            <div className="mx-auto max-w-5xl text-center">
              <div className="mb-6 inline-flex items-center text-xs uppercase tracking-[0.35em] text-emerald-400">
                ◆ Powered by Solana
              </div>

              <h1 className="font-mono text-5xl font-bold uppercase leading-[0.95] tracking-[-0.04em] text-white sm:text-7xl lg:text-[95px]">
                Turn any idea into an
                <br />
                <span className="text-emerald-400">AI-powered</span>
                <br />
                project.
              </h1>

              <p className="mx-auto mt-8 max-w-3xl text-lg leading-9 text-zinc-400 sm:text-xl">
                Describe your idea. DUM Club builds the AI, the project page,
                and the content engine automatically.
              </p>

              <p className="mx-auto mt-5 max-w-3xl text-base italic text-zinc-600">
                Build the assistant first. Grow the community and token layer after.
              </p>

              <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
                <Link
                  href="/build"
                  className="inline-flex min-w-[260px] items-center justify-center border border-emerald-400 bg-emerald-400 px-8 py-4 font-mono text-sm font-bold uppercase tracking-[0.28em] text-black transition hover:opacity-90"
                >
                  Build a Project →
                </Link>

                <Link
                  href="/discover"
                  className="inline-flex min-w-[260px] items-center justify-center border border-zinc-800 bg-transparent px-8 py-4 font-mono text-sm uppercase tracking-[0.28em] text-zinc-300 transition hover:border-zinc-600 hover:text-white"
                >
                  Explore Feed
                </Link>
              </div>

              <div className="mx-auto mt-16 grid max-w-5xl gap-6 md:grid-cols-3">
                {loadingProjects ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className="border border-zinc-900 bg-black p-6 text-left"
                    >
                      <div className="mb-4 text-zinc-600">Loading...</div>
                    </div>
                  ))
                ) : projects.length > 0 ? (
                  projects.map((project, index) => (
                    <Link
                      key={project.id}
                      href={`/project/${project.id}`}
                      className="border border-zinc-900 bg-black p-6 text-left transition hover:border-emerald-400/40 hover:bg-zinc-950"
                    >
                      <div className="mb-4 text-4xl">
                        {index === 0 ? "💪" : index === 1 ? "🧠" : "🚀"}
                      </div>

                      <div className="font-mono text-2xl font-bold text-white">
                        {project.title || project.name || "Untitled Project"}
                      </div>

                      <div className="mt-3 font-mono text-sm uppercase tracking-[0.2em] text-emerald-400">
                        {project.status || "live"}
                      </div>

                      <div className="mt-5 line-clamp-3 text-zinc-500">
                        {project.description || "No description yet."}
                      </div>
                    </Link>
                  ))
                ) : (
                  <>
                    <div className="border border-zinc-900 bg-black p-6 text-left">
                      <div className="mb-4 text-4xl">💪</div>
                      <div className="font-mono text-2xl font-bold text-white">
                        AI Fitness Coach
                      </div>
                      <div className="mt-3 font-mono text-sm uppercase tracking-[0.2em] text-emerald-400">
                        live
                      </div>
                      <div className="mt-5 text-zinc-500">
                        Beginner AI fitness project for workouts, nutrition, and habit-building.
                      </div>
                    </div>

                    <div className="border border-zinc-900 bg-black p-6 text-left">
                      <div className="mb-4 text-4xl">🧠</div>
                      <div className="font-mono text-2xl font-bold text-white">
                        MathMaster
                      </div>
                      <div className="mt-3 font-mono text-sm uppercase tracking-[0.2em] text-emerald-400">
                        live
                      </div>
                      <div className="mt-5 text-zinc-500">
                        AI-powered tutoring platform for students.
                      </div>
                    </div>

                    <div className="border border-zinc-900 bg-black p-6 text-left">
                      <div className="mb-4 text-4xl">🚀</div>
                      <div className="font-mono text-2xl font-bold text-white">
                        Dum Club
                      </div>
                      <div className="mt-3 font-mono text-sm uppercase tracking-[0.2em] text-emerald-400">
                        live
                      </div>
                      <div className="mt-5 text-zinc-500">
                        Public ecosystem for building and discovering AI-native projects.
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto mt-20 max-w-6xl">
          <div className="mb-3 text-xs uppercase tracking-[0.35em] text-zinc-600">
            Platform Evolution
          </div>

          <h2 className="mb-10 font-mono text-3xl font-bold text-white sm:text-4xl">
            HOW DUM CLUB GROWS YOUR PROJECT
          </h2>

          <div className="grid border border-zinc-900 md:grid-cols-3">
            <div className="border-b border-zinc-900 p-8 md:border-b-0 md:border-r">
              <div className="mb-6 font-mono text-6xl font-bold text-zinc-900">
                01
              </div>
              <h3 className="font-mono text-3xl font-bold text-white">
                Describe
              </h3>
              <p className="mt-5 text-lg leading-8 text-zinc-500">
                Type your idea — a business, a brand, a content channel, or anything.
              </p>
            </div>

            <div className="border-b border-zinc-900 p-8 md:border-b-0 md:border-r">
              <div className="mb-6 font-mono text-6xl font-bold text-zinc-900">
                02
              </div>
              <h3 className="font-mono text-3xl font-bold text-white">
                AI Builds
              </h3>
              <p className="mt-5 text-lg leading-8 text-zinc-500">
                DUM Club generates your AI assistant, project page, and content engine.
              </p>
            </div>

            <div className="p-8">
              <div className="mb-6 font-mono text-6xl font-bold text-zinc-900">
                03
              </div>
              <h3 className="font-mono text-3xl font-bold text-white">Grow</h3>
              <p className="mt-5 text-lg leading-8 text-zinc-500">
                Your community forms, your token launches, and your platform grows.
              </p>
            </div>
          </div>
        </div>

        <div className="mx-auto mt-20 max-w-6xl">
          <div className="mb-6 text-xs uppercase tracking-[0.35em] text-zinc-600">
            Platform Roadmap
          </div>

          <div className="overflow-x-auto">
            <div className="grid min-w-[1100px] grid-cols-5 border border-zinc-900">
              <div className="border-r border-zinc-900 bg-emerald-400/5 p-8">
                <div className="mb-6 font-mono text-6xl font-bold text-emerald-400">
                  01
                </div>
                <h3 className="font-mono text-2xl font-bold text-white">
                  Builder
                </h3>
                <p className="mt-4 text-lg leading-8 text-zinc-500">
                  Create AI projects instantly.
                </p>
                <div className="mt-6 font-mono text-sm uppercase tracking-[0.25em] text-emerald-400">
                  ◆ Active
                </div>
              </div>

              <div className="border-r border-zinc-900 p-8">
                <div className="mb-6 font-mono text-6xl font-bold text-zinc-900">
                  02
                </div>
                <h3 className="font-mono text-2xl font-bold text-zinc-400">
                  AI Co-Founder
                </h3>
                <p className="mt-4 text-lg leading-8 text-zinc-600">
                  AI grows your project.
                </p>
              </div>

              <div className="border-r border-zinc-900 p-8">
                <div className="mb-6 font-mono text-6xl font-bold text-zinc-900">
                  03
                </div>
                <h3 className="font-mono text-2xl font-bold text-zinc-400">
                  Discovery
                </h3>
                <p className="mt-4 text-lg leading-8 text-zinc-600">
                  Content attracts users.
                </p>
              </div>

              <div className="border-r border-zinc-900 p-8">
                <div className="mb-6 font-mono text-6xl font-bold text-zinc-900">
                  04
                </div>
                <h3 className="font-mono text-2xl font-bold text-zinc-400">
                  Creator Economy
                </h3>
                <p className="mt-4 text-lg leading-8 text-zinc-600">
                  Subscriptions and payments.
                </p>
              </div>

              <div className="p-8">
                <div className="mb-6 font-mono text-6xl font-bold text-zinc-900">
                  05
                </div>
                <h3 className="font-mono text-2xl font-bold text-zinc-400">
                  Token Layer
                </h3>
                <p className="mt-4 text-lg leading-8 text-zinc-600">
                  Projects launch tokens.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
