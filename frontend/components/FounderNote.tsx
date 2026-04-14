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
    <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6 sm:p-7">
      <div className="flex items-start gap-4">
        {/* Avatar — real photo if /julian.jpg exists, otherwise initials. */}
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-800 bg-gradient-to-br from-emerald-400/15 to-violet-500/15">
          {!imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/julian.jpg"
              alt="Julian, founder of DUM Club"
              className="h-full w-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <span className="text-base font-bold text-white">JM</span>
          )}
        </div>

        <div className="flex-1">
          <p className="text-[13px] leading-relaxed text-zinc-300 sm:text-[14px]">
            <span className="font-semibold text-white">I&apos;m Julian.</span>{" "}
            I built DUM Club because I run a maintenance business in Dover and I was tired of handing 30% to DoorDash and 25% to Angi. If you&apos;re a local shop in Morris County, I want to help you sell direct.
          </p>
          <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">
            — Julian · Topgun Maintenance · Dover, NJ
          </div>
        </div>
      </div>
    </div>
  );
}
