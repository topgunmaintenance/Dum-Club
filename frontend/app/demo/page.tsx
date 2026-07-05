"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

/**
 * /demo (2026-07): "See it on your site" sales tool.
 *
 * A prospect types their website address and we render their real
 * site in a browser-styled preview frame with the DUM live bubble
 * sitting on top of it, exactly where embed.js would put it.
 *
 * Honesty rules (CLAUDE.md section 12): the demo bubble NEVER says
 * LIVE, never uses the coral live color, and never shows viewer
 * counts or countdowns. It carries a mint DEMO pill instead. The
 * coral pill and real timers appear only on real broadcasts.
 *
 * Preview strategy: iframes get blocked by X-Frame-Options on many
 * sites, which would mean a blank window mid-pitch. Instead we show
 * a server-side screenshot of the prospect's homepage via thum.io
 * (keyless free tier, 1k captures/month) and overlay the bubble on
 * the image. A photo cannot be blocked, so this works for any
 * public website. If the capture errors, we fall back to the
 * sample shop.
 */

const screenshotUrl = (target: string) =>
  `https://image.thum.io/get/width/1000/${target}`;

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProto = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const u = new URL(withProto);
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function DemoBubble() {
  return (
    <div className="pointer-events-none absolute bottom-5 right-5 z-20 flex flex-col items-center">
      <div className="relative">
        <div
          className="flex h-[120px] w-[120px] items-center justify-center rounded-full bg-[#0B1220] text-center"
          style={{
            boxShadow:
              "0 0 0 3px #FFD24A, 0 0 0 8px rgba(255,210,74,0.25), 0 16px 36px rgba(11,18,32,0.32)",
          }}
        >
          <span className="px-4 text-[11px] font-bold leading-snug text-white">
            Your live show plays here
          </span>
        </div>
        <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-mint-fill px-3 py-0.5 text-[10px] font-black uppercase tracking-wider text-mint-fill-ink shadow-md ring-2 ring-white">
          Demo
        </span>
      </div>
      <span className="mt-4 rounded-full bg-white/90 px-3 py-1 text-[10px] font-semibold text-[#0B1220] shadow-sm">
        Customers tap the bubble to watch and buy
      </span>
    </div>
  );
}

function SampleShop() {
  return (
    <div className="h-full w-full overflow-hidden bg-[#FBF7F1]">
      <div className="flex items-center justify-between border-b border-[#E8DFD2] bg-white px-5 py-3">
        <span className="text-sm font-black tracking-tight text-[#3A2E22]">
          Marco&apos;s Pizzeria
        </span>
        <div className="flex gap-4 text-[11px] font-semibold text-[#8A7A64]">
          <span>Menu</span>
          <span>Catering</span>
          <span>Hours</span>
          <span>Contact</span>
        </div>
      </div>
      <div className="px-5 py-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#B08D57]">
          Family owned since 1987
        </p>
        <h3 className="mt-1 text-xl font-black text-[#3A2E22]">
          Brick oven pizza, made the slow way
        </h3>
        <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-[#8A7A64]">
          Fresh dough every morning. Order at the counter or call ahead
          for pickup.
        </p>
        <div className="mt-5 grid grid-cols-3 gap-3">
          {[
            ["Grandma pie", "$23"],
            ["Chicken parm", "$15"],
            ["Cannoli", "$6"],
          ].map(([name, price]) => (
            <div
              key={name}
              className="rounded-xl border border-[#E8DFD2] bg-white p-3"
            >
              <div className="h-10 rounded-lg bg-[#F0E7DA]" />
              <p className="mt-2 text-[11px] font-bold text-[#3A2E22]">
                {name}
              </p>
              <p className="text-[11px] font-semibold text-[#B08D57]">
                {price}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-[10px] text-[#B9AC99]">
          Example shop page, for preview only
        </p>
      </div>
    </div>
  );
}

const SNIPPET =
  '<script src="https://dum.club/embed.js" data-business-id="your-shop" async></script>';

export default function DemoPage() {
  const [input, setInput] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [inputError, setInputError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shotLoading, setShotLoading] = useState(false);
  const [shotFailed, setShotFailed] = useState(false);

  const displayHost = useMemo(() => {
    if (!previewUrl) return "sample shop";
    try {
      return new URL(previewUrl).hostname;
    } catch {
      return previewUrl;
    }
  }, [previewUrl]);

  const loadPreview = () => {
    const normalized = normalizeUrl(input);
    if (!normalized) {
      setInputError(true);
      return;
    }
    setInputError(false);
    setShotFailed(false);
    setShotLoading(true);
    setPreviewUrl(normalized);
  };

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(SNIPPET);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable; the snippet is selectable */
    }
  };

  return (
    <div className="min-h-screen bg-surface-page px-4 pb-24 pt-28">
      <div className="mx-auto max-w-3xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-mint-text">
          Try it on your site
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-primary sm:text-4xl">
          See the live bubble on your own website.
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-secondary">
          Type your website address and watch where DUM Live sits on
          your page. When you go live, your customers see your show
          right there and can buy without leaving your site.
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            inputMode="url"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setInputError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") loadPreview();
            }}
            placeholder="yourshop.com"
            className="w-full flex-1 rounded-xl border border-default bg-surface-card px-4 py-3 text-sm text-primary outline-none transition focus:border-mint-text"
          />
          <button
            onClick={loadPreview}
            className="rounded-xl bg-mint-fill px-6 py-3 text-sm font-bold text-mint-fill-ink transition hover:brightness-95"
          >
            Preview my site
          </button>
        </div>
        {inputError && (
          <p className="mt-2 text-xs font-semibold text-state-live">
            That does not look like a website address. Try something
            like yourshop.com
          </p>
        )}

        <div className="mt-6 overflow-hidden rounded-2xl border border-default bg-surface-card shadow-sm">
          <div className="flex items-center gap-2 border-b border-default bg-surface-muted px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
            <span className="ml-3 flex-1 truncate rounded-full bg-surface-card px-3 py-1 text-[11px] text-muted">
              {displayHost}
            </span>
          </div>
          <div className="relative h-[420px] w-full overflow-hidden bg-white">
            {previewUrl && !shotFailed ? (
              <>
                <img
                  key={previewUrl}
                  src={screenshotUrl(previewUrl)}
                  alt={`Preview of ${displayHost} with the DUM live bubble`}
                  className="w-full object-cover object-top"
                  onLoad={() => setShotLoading(false)}
                  onError={() => {
                    setShotLoading(false);
                    setShotFailed(true);
                  }}
                />
                {shotLoading && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white">
                    <span className="h-6 w-6 animate-spin rounded-full border-2 border-mint-text border-t-transparent" />
                    <p className="text-xs font-semibold text-secondary">
                      Taking a picture of {displayHost}...
                    </p>
                    <p className="text-[11px] text-muted">
                      First look can take a few seconds
                    </p>
                  </div>
                )}
              </>
            ) : (
              <SampleShop />
            )}
            <DemoBubble />
          </div>
        </div>

        <div className="mt-3 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
          <p className="text-xs leading-relaxed text-muted">
            {previewUrl && shotFailed
              ? "We could not get a picture of that site right now, so here is a sample shop. The bubble works the same on the real thing."
              : "This is a picture of the site with the bubble drawn on top. Nothing is installed until a shop signs up and pastes its line."}
          </p>
          {previewUrl && !shotFailed && (
            <button
              onClick={() => {
                setPreviewUrl(null);
                setShotFailed(false);
                setShotLoading(false);
              }}
              className="whitespace-nowrap rounded-full border border-default bg-surface-card px-4 py-1.5 text-xs font-semibold text-secondary transition hover:border-mint-text hover:text-mint-text"
            >
              Show the sample shop instead
            </button>
          )}
        </div>

        <div className="mt-12 rounded-2xl border border-default bg-surface-card p-5 sm:p-7">
          <h2 className="text-xl font-black tracking-tight text-primary">
            One line of code. That is the whole install.
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-secondary">
            Paste this before the closing body tag of your site. Works
            on Wix, Squarespace, WordPress, GoDaddy and any site
            builder that lets you add a line of code. Your shop gets
            its own line when you sign up.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-xl bg-[#0B1220] px-4 py-3 font-mono text-[11px] text-[#9FE1CB]">
              {SNIPPET}
            </code>
            <button
              onClick={copySnippet}
              className="whitespace-nowrap rounded-xl border border-default px-5 py-3 text-sm font-bold text-primary transition hover:border-mint-text hover:text-mint-text"
            >
              {copied ? "Copied" : "Copy the line"}
            </button>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              [
                "1. Paste the line",
                "Two minutes in your site editor. No developer needed.",
              ],
              [
                "2. Nothing shows until you go live",
                "Your site looks exactly the same on a normal day.",
              ],
              [
                "3. Go live from your phone",
                "The bubble appears on its own, and disappears when your show ends.",
              ],
            ].map(([title, body]) => (
              <div key={title}>
                <p className="text-sm font-bold text-primary">{title}</p>
                <p className="mt-1 text-xs leading-relaxed text-secondary">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 text-center">
          <p className="text-sm font-semibold text-secondary">
            Join the first 100 merchants. Get 60 days free and lock in
            founding pricing for life.
          </p>
          <p className="mt-1 text-xs text-muted">
            Flat monthly subscription + 1.5% sales fee. Industry-low
            (Whatnot takes up to 8%). Keep more of every sale.
          </p>
          <Link
            href="/merchant"
            className="mt-5 inline-block rounded-xl bg-mint-fill px-8 py-3.5 text-sm font-black text-mint-fill-ink transition hover:brightness-95"
          >
            Claim Your Founding Spot
          </Link>
        </div>
      </div>
    </div>
  );
}
