"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type Memory = {
  id: string;
  content_text?: string;
  content?: string;
};

type Project = {
  id: string;
  name?: string;
  title?: string;
  description?: string;
  status?: string;
  template_type?: string;
  prompt?: string;
  token_utility?: string;
  ai_output?: {
    title?: string;
    description?: string;
    template_type?: string;
    token_utility?: string;
    [key: string]: any;
  } | null;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function getProjectEmoji(project: Project | null) {
  const source = `${project?.title || project?.name || ""} ${project?.template_type || ""}`.toLowerCase();

  if (source.includes("fitness") || source.includes("health")) return "💪";
  if (source.includes("math") || source.includes("tutor")) return "🧠";
  if (source.includes("movie") || source.includes("script")) return "🎬";
  if (source.includes("music") || source.includes("beat")) return "🎵";
  if (source.includes("crypto") || source.includes("signal")) return "📈";
  if (source.includes("clean")) return "🧹";

  return "🚀";
}

function getCategory(project: Project | null) {
  const source = `${project?.title || project?.name || ""} ${project?.template_type || ""}`.toLowerCase();

  if (source.includes("fitness") || source.includes("health")) return "Health";
  if (source.includes("math") || source.includes("tutor")) return "Education";
  if (source.includes("movie") || source.includes("script")) return "Creative";
  if (source.includes("music") || source.includes("beat")) return "Music";
  if (source.includes("crypto") || source.includes("signal")) return "Finance";
  if (source.includes("clean")) return "Business";

  return "AI Project";
}

function getAccent(project: Project | null) {
  const source = `${project?.title || project?.name || ""} ${project?.template_type || ""}`.toLowerCase();

  if (source.includes("fitness") || source.includes("health")) return "#00FFB2";
  if (source.includes("math") || source.includes("tutor")) return "#38BDF8";
  if (source.includes("movie") || source.includes("script")) return "#FBBF24";
  if (source.includes("music") || source.includes("beat")) return "#F472B6";
  if (source.includes("crypto") || source.includes("signal")) return "#38BDF8";
  if (source.includes("clean")) return "#A78BFA";

  return "#00FFB2";
}

function makeDefaultTokenName(project: Project | null) {
  return (project?.title || project?.name || "DUM Project Token").slice(0, 32);
}

function makeDefaultTokenSymbol(project: Project | null) {
  const base = (project?.title || project?.name || "DUM")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.slice(0, 3).toUpperCase())
    .join("")
    .slice(0, 6);

  return base || "DUM";
}

export default function ProjectPage() {
  const params = useParams();
  const id = params?.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [projectName, setProjectName] = useState("Untitled Project");
  const [projectStatus, setProjectStatus] = useState("draft");

  const [memoryText, setMemoryText] = useState("");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState("No response yet.");
  const [refinePrompt, setRefinePrompt] = useState("");

  const [tokenName, setTokenName] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [tokenSupply, setTokenSupply] = useState("1000000");

  const [loadingMemory, setLoadingMemory] = useState(false);
  const [loadingAsk, setLoadingAsk] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [loadingRefine, setLoadingRefine] = useState(false);

  async function loadProject() {
    if (!id) return;

    try {
      const res = await fetch(`${API_BASE}/api/projects/${id}`);
      if (!res.ok) throw new Error("Failed to load project");

      const data = await res.json();
      const projectData = data?.project || data;

      setProject(projectData);

      const resolvedName =
        projectData?.title ||
        projectData?.name ||
        "Untitled Project";

      setProjectName(resolvedName);
      setProjectStatus(projectData?.status || "draft");
      setTokenName(makeDefaultTokenName(projectData));
      setTokenSymbol(makeDefaultTokenSymbol(projectData));
    } catch (err) {
      console.error(err);
      setProject(null);
      setProjectName("Untitled Project");
      setProjectStatus("draft");
    }
  }

  async function loadMemories() {
    if (!id) return;

    try {
      const res = await fetch(`${API_BASE}/api/memories?project_id=${id}`);
      if (!res.ok) throw new Error("Failed to load memories");

      const data = await res.json();
      setMemories(data.memories || data || []);
    } catch (err) {
      console.error(err);
      setMemories([]);
    }
  }

  async function saveMemory(e: React.FormEvent) {
    e.preventDefault();

    if (!memoryText.trim()) return;

    try {
      setLoadingMemory(true);

      const res = await fetch(`${API_BASE}/api/memories/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          project_id: id,
          content_text: memoryText.trim(),
          content_type: "text",
        }),
      });

      if (!res.ok) throw new Error("Failed to save memory");

      setMemoryText("");
      await loadMemories();
    } catch (err) {
      console.error(err);
      alert("Failed to save memory");
    } finally {
      setLoadingMemory(false);
    }
  }

  async function askAI(e: React.FormEvent) {
    e.preventDefault();

    if (!question.trim()) return;

    try {
      setLoadingAsk(true);
      setResponse("Thinking...");

      const res = await fetch(`${API_BASE}/api/chat/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          project_id: id,
          message: question.trim(),
        }),
      });

      if (!res.ok) throw new Error("Failed to ask AI");

      const data = await res.json();
      setResponse(data.response || data.answer || "No response returned.");
    } catch (err) {
      console.error(err);
      setResponse("Failed to get AI response.");
    } finally {
      setLoadingAsk(false);
    }
  }

  async function refineProject(e: React.FormEvent) {
    e.preventDefault();

    if (!id || !refinePrompt.trim()) return;

    try {
      setLoadingRefine(true);

      const res = await fetch(`${API_BASE}/api/refine-project`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          project_id: id,
          prompt: refinePrompt.trim(),
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to refine project");
      }

      const data = await res.json();

      setProject((prev) =>
        prev
          ? {
              ...prev,
              description: data.updated_description,
            }
          : prev
      );

      setRefinePrompt("");
    } catch (err) {
      console.error(err);
      alert("Failed to refine project");
    } finally {
      setLoadingRefine(false);
    }
  }

  async function updateProjectStatus(nextStatus: "draft" | "live") {
    if (!id) return;

    try {
      setLoadingStatus(true);

      const res = await fetch(`${API_BASE}/api/projects/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: nextStatus,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to update project status");
      }

      await loadProject();
    } catch (err) {
      console.error(err);
      alert("Failed to update project status");
    } finally {
      setLoadingStatus(false);
    }
  }

  function handleLaunchToken(e: React.FormEvent) {
    e.preventDefault();

    if (!tokenName.trim() || !tokenSymbol.trim() || !tokenSupply.trim()) {
      alert("Please complete token name, symbol, and supply.");
      return;
    }

    alert(
      `Token launch stub ready.\n\nProject: ${projectName}\nToken Name: ${tokenName}\nToken Symbol: ${tokenSymbol}\nSupply: ${tokenSupply}\n\nNext step: connect this to real Solana mint logic.`
    );
  }

  useEffect(() => {
    loadProject();
    loadMemories();
  }, [id]);

  const isLive = projectStatus === "live";
  const emoji = useMemo(() => getProjectEmoji(project), [project]);
  const category = useMemo(() => getCategory(project), [project]);
  const accent = useMemo(() => getAccent(project), [project]);

  return (
    <div className="min-h-screen bg-black px-4 py-10 text-white sm:px-6">
      <div className="mx-auto max-w-7xl">
        <Link
          href="/discover"
          className="mb-8 inline-flex text-xs uppercase tracking-[0.25em] text-zinc-500 transition hover:text-zinc-300"
        >
          ← Back to Feed
        </Link>

        <div
          className="mb-8 border border-zinc-900 bg-black p-8"
          style={{ borderTop: `3px solid ${accent}` }}
        >
          <div className="flex flex-col gap-8 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex gap-6">
              <div className="text-6xl">{emoji}</div>

              <div>
                <div className="mb-3 text-xs uppercase tracking-[0.35em] text-zinc-600">
                  Project Profile
                </div>

                <h1 className="font-mono text-4xl font-bold leading-tight text-white sm:text-6xl">
                  {projectName}
                </h1>

                <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-zinc-400">
                  <span
                    className="border px-3 py-1 font-mono text-xs uppercase tracking-[0.18em]"
                    style={{ borderColor: accent, color: accent }}
                  >
                    {category}
                  </span>

                  <span className="border border-zinc-700 px-3 py-1 font-mono text-xs uppercase tracking-[0.18em] text-zinc-300">
                    {project?.template_type || "ai_project"}
                  </span>

                  <span
                    className={`border px-3 py-1 font-mono text-xs uppercase tracking-[0.18em] ${
                      isLive
                        ? "border-emerald-400/30 text-emerald-300"
                        : "border-zinc-700 text-zinc-300"
                    }`}
                  >
                    {projectStatus}
                  </span>
                </div>

                <p className="mt-5 max-w-3xl text-lg leading-8 text-zinc-400">
                  {project?.description ||
                    "This project is live inside DUM Club and ready to be expanded with memory, AI, and discovery."}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              {isLive ? (
                <button
                  type="button"
                  disabled={loadingStatus}
                  onClick={() => updateProjectStatus("draft")}
                  className="border border-zinc-700 bg-zinc-900 px-5 py-3 font-mono text-sm uppercase tracking-[0.18em] text-white transition hover:bg-zinc-800 disabled:opacity-50"
                >
                  {loadingStatus ? "Updating..." : "Move to Draft"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={loadingStatus}
                  onClick={() => updateProjectStatus("live")}
                  className="px-5 py-3 font-mono text-sm uppercase tracking-[0.18em] text-black transition hover:opacity-90 disabled:opacity-50"
                  style={{ background: accent }}
                >
                  {loadingStatus ? "Publishing..." : "Publish Project"}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="mb-8 grid gap-0 border border-zinc-900 md:grid-cols-4">
          <div className="border-b border-zinc-900 p-6 md:border-b-0 md:border-r">
            <div className="mb-2 text-xs uppercase tracking-[0.3em] text-zinc-600">
              Project ID
            </div>
            <div className="text-sm break-all text-zinc-300">{id}</div>
          </div>

          <div className="border-b border-zinc-900 p-6 md:border-b-0 md:border-r">
            <div className="mb-2 text-xs uppercase tracking-[0.3em] text-zinc-600">
              Category
            </div>
            <div className="text-2xl font-semibold text-white">{category}</div>
          </div>

          <div className="border-b border-zinc-900 p-6 md:border-b-0 md:border-r">
            <div className="mb-2 text-xs uppercase tracking-[0.3em] text-zinc-600">
              Status
            </div>
            <div className="text-2xl font-semibold text-white">{projectStatus}</div>
          </div>

          <div className="p-6">
            <div className="mb-2 text-xs uppercase tracking-[0.3em] text-zinc-600">
              Memory Count
            </div>
            <div className="text-2xl font-semibold text-white">{memories.length}</div>
          </div>
        </div>

        <div className="mb-8 border border-zinc-900 bg-zinc-950 p-6">
          <div className="mb-4 text-xs uppercase tracking-[0.3em] text-zinc-600">
            AI Blueprint
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h2 className="font-mono text-2xl font-bold text-white">
                Original Prompt
              </h2>
              <p className="mt-3 text-zinc-400">
                {project?.prompt || "No prompt saved yet."}
              </p>
            </div>

            <div>
              <h2 className="font-mono text-2xl font-bold text-white">
                Token Utility
              </h2>
              <p className="mt-3 text-zinc-400">
                {project?.token_utility ||
                  project?.ai_output?.token_utility ||
                  "No token utility generated yet."}
              </p>
            </div>
          </div>

          <div className="mt-8">
            <h2 className="font-mono text-2xl font-bold text-white">
              Full AI Output
            </h2>

            <div className="mt-4 overflow-x-auto border border-zinc-800 bg-black p-4 text-sm text-zinc-300">
              <pre className="whitespace-pre-wrap break-words">
                {project?.ai_output
                  ? JSON.stringify(project.ai_output, null, 2)
                  : "No AI blueprint saved yet."}
              </pre>
            </div>
          </div>
        </div>

        <div className="mb-8 border border-zinc-900 bg-zinc-950 p-6">
          <div className="mb-6 text-xs uppercase tracking-[0.3em] text-zinc-600">
            AI Refiner
          </div>

          <h2 className="font-mono text-3xl font-bold text-white">
            Refine Project
          </h2>

          <p className="mt-3 max-w-3xl text-zinc-500">
            Tell the AI how to improve this project. You can make it more viral,
            more useful, more monetizable, or more aligned with Solana users.
          </p>

          <form onSubmit={refineProject} className="mt-6 space-y-4">
            <textarea
              value={refinePrompt}
              onChange={(e) => setRefinePrompt(e.target.value)}
              placeholder="Example: Make this more viral, community-driven, and better for Solana creators."
              rows={5}
              className="w-full border border-zinc-800 bg-black px-4 py-3 text-white outline-none transition focus:border-emerald-400"
            />

            <button
              type="submit"
              disabled={loadingRefine || !refinePrompt.trim()}
              className="w-full px-5 py-3 font-mono text-sm uppercase tracking-[0.18em] text-black transition hover:opacity-90 disabled:opacity-50"
              style={{ background: accent }}
            >
              {loadingRefine ? "Refining..." : "Refine with AI"}
            </button>
          </form>
        </div>

        <div className="mb-8 border border-zinc-900 bg-zinc-950 p-6">
          <div className="mb-6 text-xs uppercase tracking-[0.3em] text-zinc-600">
            Token Launcher
          </div>

          <h2 className="font-mono text-3xl font-bold text-white">
            Launch Token
          </h2>

          <p className="mt-3 max-w-3xl text-zinc-500">
            Prepare this project for token launch. This is the next step toward
            turning DUM Club into a launchpad for AI-powered Solana apps.
          </p>

          <form onSubmit={handleLaunchToken} className="mt-6 grid gap-4 md:grid-cols-3">
            <input
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              placeholder="Token Name"
              className="border border-zinc-800 bg-black px-4 py-3 text-white outline-none transition focus:border-emerald-400"
            />

            <input
              value={tokenSymbol}
              onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
              placeholder="Symbol"
              maxLength={10}
              className="border border-zinc-800 bg-black px-4 py-3 text-white outline-none transition focus:border-emerald-400"
            />

            <input
              value={tokenSupply}
              onChange={(e) => setTokenSupply(e.target.value)}
              placeholder="Total Supply"
              className="border border-zinc-800 bg-black px-4 py-3 text-white outline-none transition focus:border-emerald-400"
            />

            <div className="md:col-span-3">
              <button
                type="submit"
                className="w-full px-5 py-3 font-mono text-sm uppercase tracking-[0.18em] text-black transition hover:opacity-90"
                style={{ background: accent }}
              >
                Launch Token
              </button>
            </div>
          </form>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="border border-zinc-900 bg-zinc-950 p-6">
            <div className="mb-6 text-xs uppercase tracking-[0.3em] text-zinc-600">
              Project Memory
            </div>

            <h2 className="font-mono text-3xl font-bold text-white">
              Add Memory
            </h2>

            <p className="mt-3 max-w-2xl text-zinc-500">
              Paste a memory, note, creator post, transcript, or product insight
              so your AI can use it later.
            </p>

            <form onSubmit={saveMemory} className="mt-6 space-y-4">
              <textarea
                value={memoryText}
                onChange={(e) => setMemoryText(e.target.value)}
                placeholder="Paste a memory, story, creator post, transcript, or note..."
                rows={7}
                className="w-full border border-zinc-800 bg-black px-4 py-3 text-white outline-none transition focus:border-emerald-400"
              />

              <button
                type="submit"
                disabled={loadingMemory}
                className="w-full px-5 py-3 font-mono text-sm uppercase tracking-[0.18em] text-black transition hover:opacity-90 disabled:opacity-50"
                style={{ background: accent }}
              >
                {loadingMemory ? "Saving..." : "Save Memory"}
              </button>
            </form>

            <div className="mt-10">
              <h3 className="font-mono text-2xl font-bold text-white">
                Saved Memories ({memories.length})
              </h3>

              {memories.length === 0 ? (
                <p className="mt-4 text-zinc-400">No memories saved yet.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {memories.map((memory) => (
                    <div
                      key={memory.id}
                      className="border border-zinc-800 bg-black p-4 text-zinc-300"
                    >
                      {memory.content_text || memory.content || "Empty memory"}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="border border-zinc-900 bg-zinc-950 p-6">
            <div className="mb-6 text-xs uppercase tracking-[0.3em] text-zinc-600">
              AI Workspace
            </div>

            <h2 className="font-mono text-3xl font-bold text-white">
              Ask AI
            </h2>

            <p className="mt-3 text-zinc-500">
              Ask questions about this project’s memory and use the AI as a
              co-founder for planning, writing, and direction.
            </p>

            <form onSubmit={askAI} className="mt-6 space-y-4">
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={`Ask something about ${projectName}...`}
                rows={5}
                className="w-full border border-zinc-800 bg-black px-4 py-3 text-white outline-none transition focus:border-emerald-400"
              />

              <button
                type="submit"
                disabled={loadingAsk}
                className="w-full border border-zinc-800 bg-zinc-900 px-5 py-3 font-mono text-sm uppercase tracking-[0.18em] text-white transition hover:bg-zinc-800 disabled:opacity-50"
              >
                {loadingAsk ? "Asking..." : "Ask AI"}
              </button>
            </form>

            <div className="mt-10">
              <h3 className="font-mono text-2xl font-bold text-white">
                AI Response
              </h3>

              <div className="mt-4 min-h-[220px] border border-zinc-800 bg-black p-4 text-zinc-300 whitespace-pre-wrap">
                {response}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
