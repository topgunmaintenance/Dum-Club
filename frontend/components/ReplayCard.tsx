"use client";

/**
 * ReplayCard — storefront card surfaced when a project has a
 * replay_url and isn't currently broadcasting. Two affordances:
 *
 *   1. Watch replay → opens the recording directly.
 *   2. Share replay → invokes navigator.share() when available
 *      (the iOS / Android system share sheet — sends to messages,
 *      WhatsApp, IG DM, anywhere the OS can route). Falls back to
 *      copying the storefront URL to the clipboard with a calm
 *      visual confirmation.
 *
 * The share URL is the merchant's STOREFRONT path, not the raw
 * replay_url. Two reasons:
 *   - The storefront's OG metadata (set in app/project/[id]/layout
 *     .tsx) makes the link unfurl with the merchant's name and a
 *     poster image; the raw replay URL would unfurl as a video file.
 *   - The storefront keeps the visitor inside the DUM Club funnel —
 *     they can see other offers, schedule reminders, etc.
 */

import { useState } from "react";

type Props = {
  replayUrl: string;
  recordedAt: string | null;
  businessName: string;
  storefrontPath: string;
};

export function ReplayCard({
  replayUrl,
  recordedAt,
  businessName,
  storefrontPath,
}: Props) {
  const [shareState, setShareState] = useState<"idle" | "copied" | "err">("idle");

  async function share() {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}${storefrontPath}`;
    const title = `${businessName} on DUM Club`;
    const text = `Watch ${businessName}'s last live show`;
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title, text, url });
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setShareState("copied");
        window.setTimeout(() => setShareState("idle"), 2500);
        return;
      }
      // Last-resort fallback: open a window prompting the user to
      // copy. Should be exceedingly rare on modern browsers.
      window.prompt("Copy this link to share:", url);
    } catch {
      setShareState("err");
      window.setTimeout(() => setShareState("idle"), 2500);
    }
  }

  return (
    <div className="mb-8 rounded-3xl border border-default bg-surface-card p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-brand-teal-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-brand-teal">
          Replay
        </span>
        <span className="text-sm text-secondary">
          {recordedAt
            ? `Last live show · ${new Date(recordedAt).toLocaleDateString()}`
            : "Last live show"}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a
          href={replayUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl bg-brand-teal px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-brand-navy transition hover:bg-brand-teal-hover hover:text-white"
        >
          Watch replay →
        </a>
        <button
          type="button"
          onClick={share}
          className="inline-flex items-center gap-2 rounded-xl border border-default bg-surface-page px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-primary transition hover:border-strong"
          aria-label="Share this replay"
        >
          {shareState === "copied"
            ? "✓ Link copied"
            : shareState === "err"
            ? "Try again"
            : "Share replay →"}
        </button>
      </div>
    </div>
  );
}
