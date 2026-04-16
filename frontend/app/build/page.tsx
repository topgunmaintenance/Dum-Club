"use client";

/**
 * /build — formerly the v1 AI business builder ("describe your idea,
 * AI builds your storefront"). Deprecated per CLAUDE.md v5.0 §12
 * Rule 7: "We are NOT an AI business launcher."
 *
 * Now redirects to /merchant (the founding seller signup flow).
 * The backend /api/launch/ endpoint still exists for internal use
 * but is no longer consumer-surfaced.
 *
 * Anyone who bookmarked /build sees a brief explanation + redirect.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function BuildRedirect() {
  const router = useRouter();
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          router.replace("/merchant");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#060606] px-4 text-white">
      <div className="w-full max-w-md text-center">
        <div className="mb-4 text-[11px] font-bold uppercase tracking-[0.3em] text-emerald-400">
          Page moved
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight">
          We&apos;ve upgraded.
        </h1>
        <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-zinc-400">
          The business builder has been replaced with our founding merchant signup — claim your free spot and set up your storefront in minutes.
        </p>
        <p className="mt-6 font-mono text-sm text-zinc-500">
          Redirecting in {countdown}s...
        </p>
        <Link
          href="/merchant"
          className="mt-6 inline-flex items-center justify-center rounded-xl bg-emerald-400 px-8 py-4 text-sm font-bold text-black transition hover:bg-emerald-300"
        >
          Go to Merchant Signup →
        </Link>
      </div>
    </div>
  );
}
