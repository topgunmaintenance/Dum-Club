"use client";

/**
 * GetLiveSteps — Loom-style 5-step visual progress flow.
 *
 * Sits at the top of the merchant dashboard so a non-technical
 * owner can see exactly how close they are to selling live.
 *
 *   1. Choose Display Mode
 *   2. Connect Stripe
 *   3. Create Flash Sale
 *   4. Go Live
 *   5. Start Selling
 *
 * Status is derived from props the dashboard already loads:
 *
 *   - hasDisplayMode  → projects.embed_display_mode is set (always
 *                       true once the row exists, since the column
 *                       has a default; treated as "active" once the
 *                       merchant has clicked Activate at least once)
 *   - stripeVerified  → merchants.stripe_connect_status === "verified"
 *   - hasOffer        → at least one active offer exists
 *   - isLive          → projects.is_live === true
 *   - hasSale         → orders count > 0 (best-effort, optional)
 *
 * The component is presentation-only: status checkmarks light up,
 * the next pending step renders with a brand-teal ring, completed
 * steps fade slightly. No CTAs (each step has its own surface
 * elsewhere on the dashboard).
 */

import {
  Check,
  CircleDollarSign,
  Layout,
  Radio,
  ShoppingBag,
  Tag,
} from "lucide-react";

type Props = {
  hasDisplayMode: boolean;
  stripeVerified: boolean;
  hasOffer: boolean;
  isLive: boolean;
  hasSale: boolean;
};

type Step = {
  n: 1 | 2 | 3 | 4 | 5;
  title: string;
  body: string;
  icon: typeof Layout;
  done: boolean;
};

export function GetLiveSteps({
  hasDisplayMode,
  stripeVerified,
  hasOffer,
  isLive,
  hasSale,
}: Props) {
  const steps: Step[] = [
    {
      n: 1,
      title: "Choose Display Mode",
      body: "Bubble, Full Sale, or Automatic. Set it once below.",
      icon: Layout,
      done: hasDisplayMode,
    },
    {
      n: 2,
      title: "Connect Stripe",
      body: "Money goes straight to your bank. DUM Club never holds it.",
      icon: CircleDollarSign,
      done: stripeVerified,
    },
    {
      n: 3,
      title: "Create Flash Sale",
      body: "Add a service or product, set the price, and pin it as featured.",
      icon: Tag,
      done: hasOffer,
    },
    {
      n: 4,
      title: "Go Live",
      body: "Camera and mic on. Customers see you in real time.",
      icon: Radio,
      done: isLive,
    },
    {
      n: 5,
      title: "Start Selling",
      body: "Customers buy with one tap. Payouts hit Stripe.",
      icon: ShoppingBag,
      done: hasSale,
    },
  ];

  // First step that is not yet done is the merchant's next action.
  const nextIdx = steps.findIndex((s) => !s.done);
  const completedCount = steps.filter((s) => s.done).length;

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
        Five steps to your first live sale.
      </h2>
      <p className="mt-1 text-sm text-secondary">
        Click below to set up each step. You can go live the same day.
      </p>

      <ol className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
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
              <div className="text-sm font-bold text-brand-navy">{s.title}</div>
              <p className="text-[12px] leading-relaxed text-secondary">{s.body}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
