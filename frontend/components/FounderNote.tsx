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
    <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-default border-l-4 border-l-brand-teal bg-surface-card p-6 shadow-sm sm:p-7">
      <div className="flex items-start gap-4">
        {/* Avatar — real photo if /julian.jpg exists, otherwise initials. */}
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-default bg-brand-teal-soft">
          {!imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/Julian.jpeg"
              alt="Julian Mero, founder of DUM Club"
              className="h-full w-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <span className="text-base font-bold text-brand-navy">JM</span>
          )}
        </div>

        <div className="flex-1">
          <p className="text-[14px] leading-relaxed text-primary sm:text-[15px]">
            <span className="font-semibold text-brand-navy">I&apos;m Julian.</span>{" "}
            I built DUM Club because I run a real business too. I was tired of platforms taking a cut every time a business made a sale. DUM Club is built to help local businesses sell direct, keep more revenue, and turn their own websites into live storefronts.
          </p>
          <div className="mt-4 font-caveat text-[18px] leading-none text-brand-navy">
            Julian
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.15em] text-secondary">
            Topgun Maintenance LLC · Morristown, NJ
          </div>
        </div>
      </div>
    </div>
  );
}
