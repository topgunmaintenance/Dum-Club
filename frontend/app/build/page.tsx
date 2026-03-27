"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth/AuthContext";
import { useSolanaWallets } from "@privy-io/react-auth/solana";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type LaunchState = "idle" | "generating" | "error";

const PROGRESS_STEPS = [
  "Reading your idea...",
  "Generating project metadata...",
  "Creating token identity...",
  "Setting up live market...",
  "Almost there...",
];

const EXAMPLES = [
  "An AI fitness coach that builds custom workout plans",
  "A community-run recipe vault powered by local chefs",
  "A music discovery tool that learns your taste over time",
];

export default function BuildPage() {
  const router = useRouter();
  const { user, login } = useAuth();
  const { wallets } = useSolanaWallets();
  const walletAddress = user?.walletAddress ?? wallets[0]?.address ?? null;
  const [idea, setIdea] = useState("");
  const [state, setState] = useState<LaunchState>("idle");
  const [error, setError] = useState("");
  const [progressStep, setProgressStep] = useState(0);

  useEffect(() => {
    if (state !== "generating") {
      setProgressStep(0);
      return;
    }
    const intervals = PROGRESS_STEPS.map((_, i) =>
      window.setTimeout(() => setProgressStep(i), i * 6000)
    );
    return () => intervals.forEach(clearTimeout);
  }, [state]);

  async function handleLaunch(e: React.FormEvent) {
    e.preventDefault();
    if (!idea.trim() || state === "generating") return;

    setState("generating");
    setError("");

    try {
      const res = await fetch(`${API}/api/launch/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idea: idea.trim(),
          owner_id: user?.privyId ?? null,
          wallet_address: walletAddress,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.detail || "Launch failed — please try again.");
      }

      const data = await res.json();
      router.push(`/project/${data.project_id}?launched=1`);
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  const generating = state === "generating";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-black px-4 text-white">
      <div className="w-full max-w-2xl">

        {/* Eyebrow */}
        <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.35em] text-emerald-400">
          ◆ Powered by Solana
        </div>

        {/* Headline */}
        <h1 className="font-mono text-4xl font-black uppercase leading-tight tracking-[-0.03em] text-white sm:text-5xl">
          Describe your idea.
          <br />
          <span className="text-emerald-400">We launch it.</span>
        </h1>

        <p className="mt-4 max-w-lg text-base leading-relaxed text-zinc-500">
          One sentence is enough. AI generates the project, token, and market —
          then you land on a live page instantly.
        </p>

        {/* Launch form */}
        <form onSubmit={handleLaunch} className="mt-10">
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="An AI fitness coach that builds custom workout plans..."
            rows={4}
            disabled={generating}
            className="w-full resize-none rounded-2xl border border-zinc-800 bg-zinc-950 px-5 py-4 text-base leading-relaxed text-white placeholder-zinc-600 outline-none transition focus:border-emerald-400/60 disabled:opacity-50"
          />

          <button
            type="submit"
            disabled={!idea.trim() || generating || !walletAddress}
            className="mt-4 w-full rounded-2xl border border-emerald-400 bg-emerald-400 px-8 py-4 font-mono text-sm font-bold uppercase tracking-[0.2em] text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? (
              <span className="flex items-center justify-center gap-3">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-black border-t-transparent" />
                <span key={progressStep} className="animate-fade-in">
                  {PROGRESS_STEPS[progressStep]}
                </span>
              </span>
            ) : (
              "Launch →"
            )}
          </button>

          {!generating && !walletAddress && (
            user ? (
              <div className="mt-3 text-center">
                <p className="text-xs text-amber-400/80">A Solana wallet is required to launch.</p>
                <button
                  type="button"
                  onClick={login}
                  className="mt-2 rounded-xl bg-purple-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-purple-500"
                >
                  Connect wallet
                </button>
              </div>
            ) : (
              <p className="mt-2 text-center text-xs text-amber-400/80">Sign in to launch</p>
            )
          )}

          {generating && (
            <p className="mt-3 text-center font-mono text-[11px] uppercase tracking-[0.25em] text-zinc-600">
              Step {progressStep + 1} of {PROGRESS_STEPS.length} · usually under 30s
            </p>
          )}

          {state === "error" && error && (
            <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}
        </form>

        {/* Example ideas */}
        {!generating && (
          <div className="mt-6">
            <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-700">
              Try an example
            </div>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setIdea(ex)}
                  className="rounded-full border border-zinc-800 bg-zinc-950 px-4 py-2 text-xs text-zinc-500 transition hover:border-zinc-600 hover:text-zinc-300"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* How it works */}
        <div className="mt-12 grid grid-cols-3 gap-4 border-t border-zinc-900 pt-8">
          {[
            { step: "01", label: "Describe", desc: "One sentence is enough" },
            { step: "02", label: "Generate", desc: "AI builds the project and token" },
            { step: "03", label: "Live", desc: "Land on a live project page" },
          ].map((s) => (
            <div key={s.step}>
              <div className="font-mono text-xl font-bold text-zinc-800">{s.step}</div>
              <div className="mt-1 font-mono text-sm font-semibold text-white">
                {s.label}
              </div>
              <div className="mt-1 text-xs text-zinc-600">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
