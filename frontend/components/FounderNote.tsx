"use client";

/**
 * FounderNote — fallback for the empty ProofOfMotion slot.
 *
 * Phase 0A replacement when ProofOfMotion has nothing honest to show.
 * Direct first-person note from Julian explaining why DUM Club exists.
 * Trust through honesty instead of trust through metrics. Stripe,
 * Gumroad, and Linear all used a version of this in their first year.
 *
 * To replace the placeholder initials with a real photo, drop a JPG
 * at frontend/public/julian.jpg. The component falls back gracefully
 * to "JM" initials if the file is missing — no broken image icon.
 */

import { useState } from "react";

export function FounderNote() {
  const [imgError, setImgError] = useState(false);

  return (
    <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-zinc-700/50 border-l-2 border-l-emerald-400/30 bg-zinc-900/60 p-6 backdrop-blur-sm sm:p-7">
      <div className="flex items-start gap-4">
        {/* Avatar — real photo if /julian.jpg exists, otherwise initials. */}
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-emerald-400/25 shadow-[0_0_12px_rgba(0,255,163,0.1)] bg-gradient-to-br from-emerald-400/15 to-violet-500/15">
          {!imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/Julian.jpeg"
              alt="Julian Mero, founder of DUM Club"
              className="h-full w-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <span className="text-base font-bold text-white">JM</span>
          )}
        </div>

        <div className="flex-1">
          <p className="text-[13px] leading-relaxed text-zinc-300 sm:text-[14px]">
            <span className="font-semibold text-white">I&apos;m Julian</span>{" "}
            — A&amp;P mechanic, small business owner, and the guy who got tired of watching platforms extract value from businesses that actually do the work. DUM Club puts that value back where it belongs.
          </p>
          <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">
            — Julian · Topgun Maintenance LLC · Morristown, NJ
          </div>
        </div>
      </div>
    </div>
  );
}
