"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth/AuthContext";
import { createClient } from "../../lib/supabase/client";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BUILD_STEPS = [
  "Analyzing your idea",
  "Creating project",
  "Generating app",
  "Seeding starter memory",
  "Opening workspace",
];

const EXAMPLES = [
  "AI fitness coach for New Jersey",
  "Comedy content creator bot",
  "House cleaning business assistant",
  "Movie script builder on Solana",
];

type WizardStep = "describe" | "configure" | "generating";

function deriveTokenSymbolFromIdea(idea: string): string {
  const words = idea.trim().split(/\s+/).filter(Boolean);
  const letters = words
    .map((w) => w.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2))
    .join("")
    .slice(0, 5);
  const base =
    letters.length >= 3 ? letters : (letters + "DUM").slice(0, 5);
  return base.slice(0, 10);
}

export default function BuildPage() {
  const router = useRouter();
  const { user } = useAuth();
  const walletAddress = user?.walletAddress ?? null;

  const [idea, setIdea] = useState("");
  const [tokenSymbolOverride, setTokenSymbolOverride] = useState("");
  const [wizardStep, setWizardStep] = useState<WizardStep>("describe");
  const [progressStep, setProgressStep] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleGenerate() {
    if (!idea.trim() || loading) return;

    if (!walletAddress) {
      setError("Please connect your wallet first.");
      return;
    }

    setError("");
    setLoading(true);
    setWizardStep("generating");

    try {
      setProgressStep(0);

      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.id || !UUID_RE.test(user.id)) {
        throw new Error("Please sign in to generate a project.");
      }
      const userId = user.id;

      const tokenSymbol = tokenSymbolOverride.trim()
        ? tokenSymbolOverride.trim().toUpperCase().slice(0, 10)
        : deriveTokenSymbolFromIdea(idea);

      setProgressStep(1);

      const projectRes = await fetch(`${API_BASE}/api/projects/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          user_id: userId,
        },
        body: JSON.stringify({
          wallet_address: walletAddress,
          name: idea.trim(),
          title: idea.trim(),
          description: idea.trim(),
          category: "ai",
          utility_type: "access",
          utility_value: "Access to the project utility",
          token_supply: 21000000,
          token_symbol: tokenSymbol,
        }),
      });

      const projectData = await projectRes.json().catch(() => ({}));
      console.log("build create project response:", projectData);
      if (!projectRes.ok) {
        throw new Error(
          projectData?.detail
            ? JSON.stringify(projectData.detail)
            : projectData?.message || "Failed to create project."
        );
      }
      const projectId = projectData?.project?.id;

      if (!projectId) {
        throw new Error("Project ID missing.");
      }

      setProgressStep(2);

      const generateRes = await fetch(`${API_BASE}/api/generate-app/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: idea.trim(),
          wallet_address: walletAddress,
          owner_id: userId,
          project_id: projectId,
        }),
      });

      if (!generateRes.ok) {
        const text = await generateRes.text();
        throw new Error(`Project generation failed: ${text}`);
      }

      setProgressStep(3);

      try {
        const memoryRes = await fetch(`${API_BASE}/api/memories/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            project_id: projectId,
            content_text: `Project idea: ${idea.trim()}. This is a Solana-native AI app being built inside DUM Club. Initial goal: launch a simple MVP with clear user value.`,
            content_type: "text",
          }),
        });

        if (!memoryRes.ok) {
          const memoryText = await memoryRes.text();
          console.error("Starter memory failed:", memoryText);
        }
      } catch (memoryErr) {
        console.error("Starter memory request failed:", memoryErr);
      }

      setProgressStep(4);

      router.push(`/project/${projectId}`);
    } catch (err: unknown) {
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while generating the project."
      );
      setLoading(false);
      setProgressStep(-1);
      setWizardStep("configure");
      return;
    }

    setLoading(false);
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto flex min-h-screen max-w-4xl items-center px-6 py-20">
        <div className="w-full">
          <div className="mb-4 inline-flex rounded-full border border-purple-500/30 bg-purple-500/10 px-4 py-2 text-sm font-medium text-purple-200">
            Solana-native AI project builder
          </div>

          <h1 className="max-w-3xl text-4xl font-bold leading-tight md:text-6xl">
            Describe your idea.
          </h1>

          <p className="mt-4 max-w-2xl text-base text-zinc-400 md:text-lg">
            DUM Club will create a real project workspace connected to your backend, seed starter
            memory, and send you straight into the build flow.
          </p>

          {wizardStep !== "generating" && (
            <div className="mt-10 space-y-4">
              {wizardStep === "describe" && (
                <>
                  <textarea
                    value={idea}
                    onChange={(e) => setIdea(e.target.value)}
                    placeholder="Example: A Solana-native AI tutor that creates study plans, tracks student progress, and rewards consistency."
                    className="fade-up min-h-[180px] w-full rounded-3xl border border-zinc-800 bg-zinc-950 p-5 text-white outline-none placeholder:text-zinc-500"
                  />

                  <div className="flex flex-wrap gap-2">
                    {EXAMPLES.map((example) => (
                      <button
                        key={example}
                        type="button"
                        onClick={() => setIdea(example)}
                        className="rounded-full border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:border-purple-500 hover:text-purple-300"
                      >
                        {example}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (!idea.trim()) {
                        setError("Add a short description of your idea.");
                        return;
                      }
                      setError("");
                      setWizardStep("configure");
                    }}
                    className="rounded-2xl border border-zinc-700 bg-zinc-900 px-6 py-3 font-semibold text-white transition hover:border-emerald-500/40 hover:bg-zinc-800"
                  >
                    Next: configure token
                  </button>
                </>
              )}

              {wizardStep === "configure" && (
                <div className="fade-up space-y-4 rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
                  <div className="text-sm text-zinc-400">
                    Optional: set a short ticker (letters/numbers, max 10). Leave blank for an
                    auto-generated symbol from your idea.
                  </div>
                  <input
                    value={tokenSymbolOverride}
                    onChange={(e) =>
                      setTokenSymbolOverride(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))
                    }
                    placeholder="e.g. DUMFIT"
                    maxLength={10}
                    className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 font-mono uppercase text-white outline-none placeholder:text-zinc-600"
                  />
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => setWizardStep("describe")}
                      className="rounded-2xl border border-zinc-700 px-5 py-2.5 text-sm text-zinc-300 hover:border-zinc-500"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleGenerate}
                      disabled={loading}
                      className="rounded-2xl bg-purple-600 px-6 py-3 font-semibold text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Generate project
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
                  {error}
                </div>
              )}
            </div>
          )}

          {(loading || wizardStep === "generating") && (
            <div className="mt-8 rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
              <div className="mb-4 text-sm uppercase tracking-[0.2em] text-zinc-500">
                Build log
              </div>

              <div className="space-y-3">
                {BUILD_STEPS.map((label, index) => {
                  const complete = index < progressStep;
                  const active = index === progressStep;

                  return (
                    <div key={label} className="flex items-center gap-3">
                      <div
                        className={`h-2.5 w-2.5 rounded-full ${
                          complete
                            ? "bg-purple-500"
                            : active
                            ? "bg-white"
                            : "bg-zinc-700"
                        }`}
                      />
                      <div
                        className={`text-sm ${
                          complete
                            ? "text-purple-300"
                            : active
                            ? "text-white"
                            : "text-zinc-500"
                        }`}
                      >
                        {label}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
