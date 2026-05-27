"use client";

/**
 * GetLiveSteps — 6-step visual progress checklist matched to the
 * UX Simplification sprint directive's onboarding plan:
 *
 *   1. Business name set
 *   2. Connect Stripe
 *   3. Create your first offer
 *   4. Pin a featured item
 *   5. Add DUM Live to your website
 *   6. Press Go Live
 *
 * Each step has a clear pass signal we can derive from data the
 * dashboard already loads, plus a CTA so the merchant can finish
 * the step without leaving the dashboard. Completed rows go
 * dimmed with a strikethrough on the label so the visual focus
 * lands on the next pending action.
 *
 * Step-4 ("Add DUM Live to your website") is unknowable from the
 * server alone — pasting the snippet is an off-site action. We
 * approximate "done" two ways:
 *   - hasVisitedInstall: sessionStorage flag set when the
 *     merchant lands on /install (proxy for "they've seen the
 *     snippet")
 *   - isLive: if the merchant has ever flipped is_live=true, the
 *     bubble can't appear on their site without the snippet
 *     being present, so they must have installed it
 * Either signal marks the step done.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  CircleDollarSign,
  Code,
  Pin,
  User,
  Radio,
  Tag,
} from "lucide-react";

type Props = {
  /** Project has a non-empty title — proxy for the merchant
   *  having explicitly named their business. */
  hasBusinessName: boolean;
  stripeVerified: boolean;
  hasOffer: boolean;
  /** Project has a non-null pinned_offer_id — the featured item the
   *  live host surfaces to viewers the moment a stream goes live.
   *  Required by IVSStageHost.startPreview() since PR #269. */
  hasPinnedOffer: boolean;
  isLive: boolean;
  /** Project slug for the step-3 + step-4 + step-5 + step-6 CTA targets. */
  projectSlug?: string;
};

type Step = {
  n: 1 | 2 | 3 | 4 | 5 | 6;
  title: string;
  body: string;
  icon: typeof User;
  done: boolean;
  ctaLabel: string;
  ctaHref: string;
};

export function GetLiveSteps({
  hasBusinessName,
  stripeVerified,
  hasOffer,
  hasPinnedOffer,
  isLive,
  projectSlug,
}: Props) {
  // Step 4 — has the merchant installed the embed snippet on
  // their website? Read sessionStorage flag set by /install.
  // isLive=true also implies the snippet must be in place,
  // so accept either signal.
  const [installSeen, setInstallSeen] = useState(false);
  useEffect(() => {
    try {
      setInstallSeen(
        window.sessionStorage.getItem("dum-install-seen") === "1",
      );
    } catch {
      // Private mode or disabled storage — keep false; relying
      // on isLive as the secondary signal is still accurate.
    }
  }, []);

  const installDone = installSeen || isLive;

  const projectHref = projectSlug ? `/project/${projectSlug}` : "/dashboard";

  const steps: Step[] = [
    {
      n: 1,
      title: "Business name set",
      body: "Pick a clear name customers will recognise.",
      icon: User,
      done: hasBusinessName,
      ctaLabel: hasBusinessName ? "Edit" : "Set name",
      ctaHref: `${projectHref}/manage#settings`,
    },
    {
      n: 2,
      title: "Connect Stripe",
      body: "Money goes straight to your bank. DUM Club never holds it.",
      icon: CircleDollarSign,
      done: stripeVerified,
      ctaLabel: stripeVerified ? "Manage" : "Connect Stripe",
      ctaHref: "/merchant",
    },
    {
      n: 3,
      title: "Create a Deal",
      body: "Pick what you sell. Set a price.",
      icon: Tag,
      done: hasOffer,
      ctaLabel: hasOffer ? "Add another" : "Create a Deal",
      ctaHref: `${projectHref}/manage#offers`,
    },
    {
      n: 4,
      title: "Pin a featured item",
      body: "Mark one offer as featured. Viewers see it the moment your stream starts.",
      icon: Pin,
      done: hasPinnedOffer,
      ctaLabel: hasPinnedOffer ? "Change pinned item" : "Pin an item",
      ctaHref: `${projectHref}/manage#offers`,
    },
    {
      n: 5,
      title: "Add DUM Club to Your Website",
      body: "Paste one line of code. Bubble appears in the corner.",
      icon: Code,
      done: installDone,
      ctaLabel: installDone ? "View snippet" : "Add to My Website",
      ctaHref: "/install",
    },
    {
      n: 6,
      title: "Press Go Live",
      body: "Camera and mic on. Customers see you in real time.",
      icon: Radio,
      done: isLive,
      ctaLabel: isLive ? "Open broadcast" : "Go Live",
      ctaHref: `${projectHref}#project-live-host`,
    },
  ];

  // First step that is not yet done is the merchant's next action.
  const nextIdx = steps.findIndex((s) => !s.done);
  const completedCount = steps.filter((s) => s.done).length;

  const progressPct = Math.round((completedCount / steps.length) * 100);

  return (
    <section
      aria-labelledby="get-live-heading"
      className="mb-6 rounded-3xl border border-default bg-surface-card p-6 shadow-sm sm:p-8"
    >
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-brand-teal">
          Get Live in Minutes
        </div>
        <div className="font-mono text-[11px] text-secondary">
          {completedCount} of {steps.length} done
        </div>
      </div>
      <h2
        id="get-live-heading"
        className="text-xl font-extrabold tracking-tight text-brand-navy sm:text-2xl"
      >
        Six steps to your first live sale.
      </h2>
      <p className="mt-1 text-sm text-secondary">
        Click below to set up each step. You can go live the same day.
      </p>

      {/* Progress bar — quick visual gauge so the merchant can
          see "I'm 60% there" at a glance. */}
      <div
        className="mt-5 h-2 w-full overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
        aria-valuenow={progressPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Onboarding progress"
      >
        <div
          className="h-full rounded-full bg-brand-teal transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <ol className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {steps.map((s, i) => {
          const isNext = i === nextIdx;
          const isDone = s.done;
          const Icon = s.icon;
          return (
            <li
              key={s.n}
              className={`relative flex flex-col gap-2 rounded-2xl border p-4 transition ${
                isDone
                  ? "border-brand-teal/30 bg-brand-teal-soft"
                  : isNext
                  ? "border-brand-teal bg-surface-card ring-2 ring-brand-teal/30"
                  : "border-default bg-surface-card"
              }`}
            >
              <span
                className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border ${
                  isDone
                    ? "border-brand-teal bg-brand-teal text-brand-navy"
                    : isNext
                    ? "border-brand-teal bg-brand-teal-soft text-brand-teal"
                    : "border-default bg-surface-page text-secondary"
                }`}
                aria-hidden="true"
              >
                {isDone ? (
                  <Check className="h-4 w-4" strokeWidth={2.5} />
                ) : (
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                )}
              </span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-brand-teal">
                  Step {s.n}
                </span>
                {isNext && (
                  <span className="rounded-full bg-brand-teal px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-brand-navy">
                    Next
                  </span>
                )}
              </div>
              <div
                className={`text-sm font-bold ${
                  isDone ? "text-secondary line-through" : "text-brand-navy"
                }`}
              >
                {s.title}
              </div>
              <p
                className={`text-[12px] leading-relaxed ${
                  isDone ? "text-muted line-through" : "text-secondary"
                }`}
              >
                {s.body}
              </p>
              <Link
                href={s.ctaHref}
                className={`mt-auto inline-flex items-center gap-1.5 self-start rounded-lg px-3 py-1.5 text-[11px] font-bold transition ${
                  isDone
                    ? "border border-default text-secondary hover:border-strong"
                    : "bg-brand-teal text-brand-navy hover:bg-brand-teal-hover"
                }`}
              >
                {s.ctaLabel} →
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
