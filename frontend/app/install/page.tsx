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
}

const PLATFORMS: { key: string; label: string; steps: string[] }[] = [
  {
    key: "wix",
    label: "Wix",
    steps: [
      "In your Wix editor, click Add → Embed → Embed HTML / Custom code.",
      "Paste the snippet from above.",
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
      "Paste the snippet.",
      "Save, then Publish.",
    ],
  },
  {
    key: "shopify",
    label: "Shopify",
    steps: [
      "In your admin, go to Online Store → Themes → Customize.",
      "Add a Custom Liquid block to the footer.",
      "Paste the snippet into the block.",
      "Save.",
    ],
  },
  {
    key: "wordpress",
    label: "WordPress",
    steps: [
      "In your admin, go to Appearance → Theme File Editor (or use a Custom HTML widget).",
      "Open footer.php (or paste into a Custom HTML widget in your footer area).",
      "Paste the snippet just before the closing </body> tag.",
      "Update / Save.",
    ],
  },
];

export default function InstallPage() {
  const { user, loading: authLoading, login } = useAuth();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [testState, setTestState] = useState<"idle" | "ok" | "missing">("idle");
  const [activePlatform, setActivePlatform] = useState<string>("wix");

  // Mark "Add DUM Live to your website" complete on the dashboard
  // checklist (GetLiveSteps step 4). Pasting the snippet is an
  // off-site action we can't observe directly, so "the merchant
  // visited /install and saw their snippet" is the best signal
  // we have until the bubble starts loading on a real merchant
  // origin (which also flips the step true via isLive).
  useEffect(() => {
    try {
      window.sessionStorage.setItem("dum-install-seen", "1");
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
      `Please paste the snippet below into the site's footer (or just before the closing </body> tag), then publish:\n\n` +
      `${snippet}\n\n` +
      `That's it. No other changes needed. Once it's live, customers will see a small circular bubble in the corner that shows our face when we're live, and they can buy directly from our site.\n\nThanks!`,
  );

  function handleTest() {
    if (!slug) return;
    setTestState("idle");
    fetch(
      `${API_BASE}/api/projects/${encodeURIComponent(slug)}/embed-config`,
    )
      .then((r) => {
        if (r.ok) setTestState("ok");
        else setTestState("missing");
      })
      .catch(() => setTestState("missing"));
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
          Embed on your site (optional)
        </h1>
        <p className="mb-6 text-secondary">
          Sign in to grab your install snippet.
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
          Embed on your site (optional)
        </h1>
        <p className="mb-6 text-secondary">
          You'll need a project first. Set one up and come back here for your
          snippet.
        </p>
        <Link
          href="/merchant"
          className="rounded-xl bg-brand-teal px-5 py-3 text-sm font-bold text-black transition hover:bg-brand-teal-hover"
        >
          Set up my project
        </Link>
      </main>
    );
  }

  const activeSteps =
    PLATFORMS.find((p) => p.key === activePlatform)?.steps || [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-3 text-3xl font-bold text-primary">
        Embed on your site (optional)
      </h1>
      <p className="mb-8 text-secondary">
        Paste one line of code into your site. When you go live, a small bubble
        appears in the corner. Customers tap it to watch and buy.
      </p>

      {/* Step 1 — Copy snippet */}
      <section className="mb-8 rounded-2xl border border-default bg-surface-card p-5">
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-teal">
          Step 1 · Copy this snippet
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
            {copyState === "copied" ? "Copied ✓" : "Copy snippet"}
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
          Using a different platform? Paste the snippet anywhere inside your
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
          We'll check that your project is reachable. Once the snippet is on
          your site, refresh your site and look for the bubble in the corner.
        </p>
        <button
          type="button"
          onClick={handleTest}
          className="inline-flex items-center gap-2 rounded-xl border border-brand-teal/40 bg-brand-teal-soft px-4 py-2.5 text-sm font-bold text-brand-navy transition hover:border-brand-teal"
        >
          Test my install
        </button>
        {testState === "ok" && (
          <p className="mt-3 text-sm text-brand-teal">
            ✓ Your project is live and ready. Add the snippet to your site and
            refresh to see the bubble.
          </p>
        )}
        {testState === "missing" && (
          <p className="mt-3 text-sm text-amber-400">
            We couldn't reach your project. Double-check your slug is{" "}
            <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
              {slug}
            </code>{" "}
            and try again.
          </p>
        )}
      </section>
    </main>
  );
}
