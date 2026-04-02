"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../lib/auth/AuthContext";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { Starfield } from "../../components/Starfield";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type LaunchState = "idle" | "generating" | "error";

const PROGRESS_STEPS = [
  "Reading your idea...",
  "Generating project metadata...",
  "Setting up your brand...",
  "Configuring payments...",
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
  const { wallets, createWallet } = useSolanaWallets();
  const walletAddress = user?.walletAddress ?? wallets[0]?.address ?? null;
  const [idea, setIdea] = useState("");
  const [state, setState] = useState<LaunchState>("idle");

  // Prefill from homepage pending idea
  useEffect(() => {
    const pending = localStorage.getItem("pendingIdea");
    if (pending) {
      setIdea(pending);
      localStorage.removeItem("pendingIdea");
    }
  }, []);
  const [error, setError] = useState("");
  const [progressStep, setProgressStep] = useState(0);
  const [showLimitModal, setShowLimitModal] = useState(false);

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
        if (res.status === 429) {
          setState("idle");
          setShowLimitModal(true);
          return;
        }
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
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-base px-4 text-white">
      <Starfield count={80} />

      {/* Launch limit modal */}
      {showLimitModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm"
          onClick={() => setShowLimitModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 p-8 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-amber-400">
              Daily limit reached
            </div>
            <h2 className="mt-3 text-xl font-black text-white">
              You&apos;ve hit your launch limit.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              Upgrade for more launches, or grow your existing project to
              unlock unlimited access.
            </p>
            <button
              type="button"
              className="mt-6 w-full rounded-xl bg-emerald-400 px-6 py-3 font-mono text-sm font-bold uppercase tracking-[0.15em] text-black transition hover:bg-emerald-300"
              onClick={() => { setShowLimitModal(false); router.push("/upgrade"); }}
            >
              See upgrade options
            </button>
            <button
              type="button"
              className="mt-3 w-full rounded-xl px-6 py-2 text-sm text-zinc-600 transition hover:text-zinc-400"
              onClick={() => setShowLimitModal(false)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="w-full max-w-2xl">

        {/* Eyebrow */}
        <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.35em] text-violet-400">
          ◆ Advanced Builder
        </div>

        {/* Headline */}
        <h1 className="font-mono text-4xl font-black uppercase leading-tight tracking-[-0.03em] text-white sm:text-5xl">
          Build with
          <br />
          <span className="text-emerald-400">more control.</span>
        </h1>

        <p className="mt-4 max-w-lg text-base leading-relaxed text-zinc-500">
          Write a detailed description of your idea. The more context you give, the better AI builds your storefront, offers, and pricing.
        </p>

        <div className="mt-4 flex items-center gap-3 rounded-lg border border-zinc-800/40 bg-zinc-900/30 px-4 py-2.5">
          <span className="text-sm">💡</span>
          <span className="text-[12px] text-zinc-500">
            Want to launch fast? Use the <Link href="/" className="text-emerald-400 underline decoration-emerald-400/30 hover:text-emerald-300">homepage launcher</Link> instead.
          </span>
        </div>

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

          {!generating && !user && (
            <div className="mt-6 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] p-5 text-center">
              <div className="mb-2 text-lg font-bold text-white">Ready to launch?</div>
              <p className="mb-4 text-sm text-zinc-400">
                Sign in with Google to create your project. It takes 5 seconds — no technical knowledge needed.
              </p>
              <button
                type="button"
                onClick={() => login()}
                className="w-full rounded-xl bg-emerald-400 px-6 py-3 text-sm font-bold uppercase tracking-[0.12em] text-black transition hover:bg-emerald-300"
              >
                Sign in with Google →
              </button>
            </div>
          )}

          {!generating && user && !walletAddress && (
            <div className="mt-6 rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-5 text-center">
              <div className="mb-2 text-lg font-bold text-white">One more step</div>
              <p className="mb-4 text-sm text-zinc-400">
                Your project needs a wallet to go live. We&apos;ll create one for you automatically — no setup, no seed phrases, no hassle.
              </p>
              <button
                type="button"
                onClick={() => createWallet()}
                className="w-full rounded-xl bg-violet-500 px-6 py-3 text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-violet-400"
              >
                Create Wallet →
              </button>
              <p className="mt-2 text-[11px] text-zinc-600">Powered by Privy · takes a few seconds</p>
            </div>
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
        <div className="mt-12 grid grid-cols-1 gap-4 border-t border-zinc-900 pt-8 sm:grid-cols-3">
          {[
            { step: "01", label: "Describe", desc: "One sentence is enough" },
            { step: "02", label: "Generate", desc: "AI builds your storefront and offers" },
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
