"use client";

/**
 * /install — "Embed on your site (optional)" onboarding page.
 *
 * Plain-English landing for merchants who are stuck on the
 * embed-snippet step of the 5-step checklist. The directive
 * calls this "Add to my website" and demands:
 *
 *   - Copy snippet button
 *   - Email my web person template
 *   - Wix / Squarespace / Shopify / WordPress instructions
 *   - Test my install button
 *   - Plain English, screenshots where possible
 *
 * The merchant must be signed in (we need their project's slug
 * to mint the snippet). The page picks the merchant's first
 * project — same heuristic as FloatingGoLive.
 *
 * No new backend endpoints needed: every fetch here was already
 * shipped before this sprint.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth/AuthContext";
import { API_BASE } from "../../lib/apiBase";

interface ProjectSummary {
  id: string;
  slug?: string | null;
  title?: string | null;
  name?: string | null;
  website_url?: string | null;
}

const PLATFORMS: { key: string; label: string; steps: string[] }[] = [
  {
    key: "wix",
    label: "Wix",
    steps: [
      "In your Wix editor, click Add → Embed → Embed HTML / Custom code.",
      "Paste the code from above.",
      "Drag the box anywhere on the page (the bubble floats to the corner on its own).",
      "Click Publish.",
    ],
  },
  {
    key: "squarespace",
    label: "Squarespace",
    steps: [
      "Open Pages → pick the page you want it on.",
      "Edit the page, click + → Code → Embed.",
      "Paste the code.",
      "Save, then Publish.",
    ],
  },
  {
    key: "shopify",
    label: "Shopify",
    steps: [
      "In your admin, go to Online Store → Themes → Customize.",
      "Add a Custom Liquid block to the footer.",
      "Paste the code into the block.",
      "Save.",
    ],
  },
  {
    key: "godaddy",
    label: "GoDaddy",
    steps: [
      "Open your site in the GoDaddy Website Builder and click Edit Site.",
      "Click Add Section, search for HTML, and pick the HTML section.",
      "Paste the code into the box. Set Forced height to the smallest value.",
      "Click Done, then Publish.",
    ],
  },
  {
    key: "wordpress",
    label: "WordPress",
    steps: [
      "In your admin, go to Appearance → Theme File Editor (or use a Custom HTML widget).",
      "Open footer.php (or paste into a Custom HTML widget in your footer area).",
      "Paste the code just before the closing </body> tag.",
      "Update / Save.",
    ],
  },
];

export default function InstallPage() {
  const { user, loading: authLoading, login } = useAuth();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [testState, setTestState] = useState<"idle" | "checking" | "ok" | "missing" | "unreachable">("idle");
  // The merchant's own site, prefilled from projects.website_url
  // (collected at signup since the 2026-10-19 pivot). Editable here
  // in case they typed it wrong.
  const [siteUrl, setSiteUrl] = useState("");
  const [welcome, setWelcome] = useState(false);
  useEffect(() => {
    try {
      setWelcome(new URLSearchParams(window.location.search).get("welcome") === "1");
    } catch {
      // ignore
    }
  }, []);
  useEffect(() => {
    if (project?.website_url && !siteUrl) setSiteUrl(project.website_url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.website_url]);
  const [activePlatform, setActivePlatform] = useState<string>("wix");

  // Mark "Add DUM Live to your website" complete on the dashboard
  // checklist (GetLiveSteps step 4). Pasting the snippet is an
  // off-site action we can't observe directly, so "the merchant
  // visited /install and saw their snippet" is the best signal
  // we have until the bubble starts loading on a real merchant
  // origin (which also flips the step true via isLive).
  useEffect(() => {
    try {
      window.localStorage.setItem("dum-install-seen", "1");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    // Auth hydration guard. AuthContext starts in loading=true
    // while Privy's `ready` flag is still flipping; user?.privyId
    // is undefined for one render. Without this gate, /install
    // briefly painted the signed-out CTA on hard refresh even for
    // signed-in merchants (QA T4 finding).
    if (authLoading) return;
    if (!user?.privyId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/projects/?owner_id=${encodeURIComponent(user.privyId)}`,
        );
        if (!res.ok) {
          if (!cancelled) setLoading(false);
          return;
        }
        const list = (await res.json()) as ProjectSummary[];
        if (cancelled) return;
        setProject(Array.isArray(list) && list.length > 0 ? list[0] : null);
      } catch {
        // soft fail
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.privyId]);

  const slug = project?.slug || project?.id || "";
  const origin =
    typeof window !== "undefined"
      ? window.location.origin.includes("localhost")
        ? window.location.origin
        : "https://www.dum.club"
      : "https://www.dum.club";

  const snippet = useMemo(() => {
    if (!slug) return "";
    return `<script\n  src="${origin}/embed.js"\n  data-business-id="${slug}"\n  async\n></script>`;
  }, [origin, slug]);

  async function handleCopy() {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopyState("copied");
      // 1500ms per QA spec — long enough to read "Copied ✓",
      // short enough that the button label is back to normal
      // before the merchant returns to the page.
      window.setTimeout(() => setCopyState("idle"), 1500);
    } catch {
      // Older browsers without clipboard API — fall through silently
    }
  }

  const mailtoBody = encodeURIComponent(
    `Hi,\n\nWe'd like to add a small live-selling button to our website.\n\n` +
      `Please paste the code below into the site's footer (or just before the closing </body> tag), then publish:\n\n` +
      `${snippet}\n\n` +
      `That's it. No other changes needed. Once it's live, customers will see a small circular bubble in the corner that shows our face when we're live, and they can buy directly from our site.\n\nThanks!`,
  );

  function handleTest() {
    if (!slug || !siteUrl.trim()) return;
    setTestState("checking");
    fetch(`${API_BASE}/api/projects/${encodeURIComponent(slug)}/install-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: siteUrl.trim() }),
    })
      .then(async (r) => {
        if (!r.ok) {
          setTestState("unreachable");
          return;
        }
        const data = (await r.json()) as { found?: boolean; reachable?: boolean };
        if (data.found) setTestState("ok");
        else if (data.reachable === false) setTestState("unreachable");
        else setTestState("missing");
      })
      .catch(() => setTestState("unreachable"));
  }

  // Show loading skeleton while auth resolves OR our own
  // project fetch is in flight. Either gate alone produces a
  // flash of wrong content: authLoading alone misses the project
  // fetch; loading alone misses the auth-pending window.
  if (authLoading || loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12" aria-busy="true">
        <div className="mb-3 h-8 w-3/4 animate-pulse rounded bg-surface-muted" />
        <div className="mb-8 h-4 w-full animate-pulse rounded bg-surface-muted" />
        <div className="space-y-3">
          <div className="h-40 animate-pulse rounded-2xl bg-surface-card" />
          <div className="h-40 animate-pulse rounded-2xl bg-surface-card" />
        </div>
      </main>
    );
  }

  if (!user?.privyId) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="mb-4 text-3xl font-bold text-primary">
          Add to your website (optional)
        </h1>
        <p className="mb-6 text-secondary">
          Sign in to get your install code.
        </p>
        <button
          type="button"
          onClick={login}
          className="rounded-xl bg-brand-teal px-5 py-3 text-sm font-bold text-black transition hover:bg-brand-teal-hover"
        >
          Sign in
        </button>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="mb-4 text-3xl font-bold text-primary">
          Add to your website (optional)
        </h1>
        <p className="mb-6 text-secondary">
          You'll need a shop first. Set one up and come back here for your
          code.
        </p>
        <Link
          href="/merchant"
          className="rounded-xl bg-brand-teal px-5 py-3 text-sm font-bold text-black transition hover:bg-brand-teal-hover"
        >
          Set up my shop
        </Link>
      </main>
    );
  }

  const activeSteps =
    PLATFORMS.find((p) => p.key === activePlatform)?.steps || [];

  // "Install it for me" mailto. Routes to Julian with the snippet
  // pre-filled so the founder can either paste it for the merchant
  // or coach them through it. Cold-start support path for the
  // non-technical owner who doesn't have a web person OR doesn't
  // want to copy/paste code themselves.
  const installForMeBody = encodeURIComponent(
    `Hi Julian,\n\nI'd like help adding DUM Club to my website. Here's my install code:\n\n${snippet}\n\nMy storefront link: ${origin}/${slug}\n\nThanks!`,
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      {welcome && (
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-dum-red">
          You are in. One last step.
        </p>
      )}
      <h1 className="mb-3 text-3xl font-bold text-primary">
        {siteUrl
          ? `Put your live show on ${siteUrl.replace(/^https?:\/\//, "")}`
          : "Put your live show on your website"}
      </h1>
      <p className="mb-8 text-secondary">
        One line of code goes on your site. After that, every time you go live
        on DUM Club, the show plays in the corner of your own website and
        customers buy right there. Pick the way that fits you.
      </p>

      {/* Three-option chooser — first thing the merchant sees. Each card
          is a self-contained path so a non-technical owner picks the one
          that matches their situation without reading a wall of code. */}
      <section className="mb-10 grid gap-3 sm:grid-cols-3">
        {/* Option A — Install it for me */}
        <a
          href={`mailto:julian@dum.club?subject=${encodeURIComponent("Install help for my DUM Club site")}&body=${installForMeBody}`}
          className="flex flex-col rounded-2xl border-2 border-brand-teal bg-brand-teal-soft p-5 text-left transition hover:bg-brand-teal-soft/80"
        >
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-brand-teal">
            Easiest
          </div>
          <div className="text-base font-bold text-brand-navy">
            Install it for me
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-secondary">
            We'll add it to your site. Send Julian a message and he'll get back same day.
          </p>
          <span className="mt-4 inline-flex items-center text-[12px] font-bold text-brand-teal">
            Email Julian →
          </span>
        </a>

        {/* Option B — Send to my web person */}
        <a
          href={`mailto:?subject=${encodeURIComponent("Please add DUM Club to our website")}&body=${mailtoBody}`}
          className="flex flex-col rounded-2xl border border-default bg-surface-card p-5 text-left transition hover:border-strong"
        >
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">
            Have a web person?
          </div>
          <div className="text-base font-bold text-primary">
            Send to my web person
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-secondary">
            Opens an email with the code and step-by-step instructions. They paste it once.
          </p>
          <span className="mt-4 inline-flex items-center text-[12px] font-bold text-brand-teal">
            Open email →
          </span>
        </a>

        {/* Option C — Copy the code */}
        <a
          href="#copy-snippet"
          className="flex flex-col rounded-2xl border border-default bg-surface-card p-5 text-left transition hover:border-strong"
        >
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">
            Tech-savvy?
          </div>
          <div className="text-base font-bold text-primary">
            Copy the code myself
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-secondary">
            Copy the code below and follow the steps for Wix, Squarespace, Shopify, or WordPress.
          </p>
          <span className="mt-4 inline-flex items-center text-[12px] font-bold text-brand-teal">
            See the code ↓
          </span>
        </a>
      </section>

      {/* Step 1 — Copy snippet (anchored for Option C above) */}
      <section id="copy-snippet" className="mb-8 rounded-2xl border border-default bg-surface-card p-5 scroll-mt-24">
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-teal">
          Step 1 · Copy this code
        </div>
        <pre className="overflow-x-auto rounded-xl border border-default bg-surface-page p-4 font-mono text-xs leading-relaxed text-primary">
{snippet}
        </pre>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-teal px-4 py-2.5 text-sm font-bold text-black transition hover:bg-brand-teal-hover"
          >
            {copyState === "copied" ? "Copied ✓" : "Copy code"}
          </button>
          <a
            href={`mailto:?subject=${encodeURIComponent(
              "Please add DUM Club to our website",
            )}&body=${mailtoBody}`}
            className="inline-flex items-center gap-2 rounded-xl border border-default px-4 py-2.5 text-sm font-bold text-primary transition hover:border-brand-teal/60"
          >
            Email my web person
          </a>
        </div>
      </section>

      {/* Step 2 — Per-platform paste instructions */}
      <section className="mb-8 rounded-2xl border border-default bg-surface-card p-5">
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-teal">
          Step 2 · Paste it into your site
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setActivePlatform(p.key)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                activePlatform === p.key
                  ? "border-brand-teal bg-brand-teal-soft text-brand-navy"
                  : "border-default text-secondary hover:border-strong"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <ol className="space-y-2 text-sm text-primary">
          {activeSteps.map((step, idx) => (
            <li key={idx} className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-teal-soft text-[10px] font-bold text-brand-navy">
                {idx + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-[12px] text-muted">
          Using a different platform? Paste the code anywhere inside your
          page's HTML. Closer to the end is better. It works on any modern
          site.
        </p>
      </section>

      {/* Step 3 — Test my install */}
      <section className="rounded-2xl border border-default bg-surface-card p-5">
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-teal">
          Step 3 · Test the install
        </div>
        <p className="mb-4 text-sm text-secondary">
          Once the code is on your site and published, we will look at your
          page and tell you if we see it.
        </p>
        <label className="mb-1.5 block text-xs font-medium text-secondary" htmlFor="install-site-url">
          Your website
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="install-site-url"
            value={siteUrl}
            onChange={(e) => { setSiteUrl(e.target.value); setTestState("idle"); }}
            placeholder="yourshop.com"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            className="min-w-0 flex-1 rounded-xl border border-default bg-surface-card px-4 py-2.5 text-sm text-primary placeholder:text-muted outline-none transition focus:border-dum-red focus:ring-2 focus:ring-dum-red/30"
          />
          <button
            type="button"
            onClick={handleTest}
            disabled={!siteUrl.trim() || testState === "checking"}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-dum-red px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testState === "checking" ? "Checking..." : "Check my site"}
          </button>
        </div>
        {testState === "ok" && (
          <p className="mt-3 text-sm font-semibold text-dum-red-700">
            It is on your site. You are ready. Next time you go live, your
            customers will see it in the corner.
          </p>
        )}
        {testState === "missing" && (
          <p className="mt-3 text-sm text-amber-600">
            We reached your site but did not see the code yet. Make sure you
            published after pasting, then check again. If you are stuck, use
            Install it for me above.
          </p>
        )}
        {testState === "unreachable" && (
          <p className="mt-3 text-sm text-amber-600">
            We could not open that address. Check the spelling, like
            yourshop.com, and try again.
          </p>
        )}
      </section>
    </main>
  );
}
