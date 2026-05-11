/**
 * UpgradeAnalyticsCard. locked Drive Your Market Analytics tile.
 *
 * Rendered on /dashboard for merchants whose subscription_tier
 * doesn't qualify for analytics (per hasAnalyticsAccess in
 * lib/merchantTier.ts). The CTA links to /upgrade so the merchant
 * can move to a tier that includes the dashboard.
 */

import Link from "next/link";

export function UpgradeAnalyticsCard() {
  return (
    <section
      aria-labelledby="upgrade-analytics-heading"
      className="mt-8 rounded-2xl border border-default border-l-4 border-l-brand-teal bg-gradient-to-br from-brand-teal-soft to-surface-card p-6 shadow-sm sm:p-8"
    >
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.28em] text-brand-teal">
        Drive Your Market Analytics · Locked
      </div>
      <h2
        id="upgrade-analytics-heading"
        className="text-2xl font-extrabold tracking-tight text-brand-navy sm:text-3xl"
      >
        See your Drive Your Market Analytics
      </h2>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-secondary sm:text-base">
        See how many visitors, buyers, repeat customers, and sales
        DUM Club brings to your business. Track the full funnel:
        embed views, offer views, checkout starts, and completed
        purchases. All in one dashboard.
      </p>
      <div className="mt-5">
        <Link
          href="/upgrade"
          className="inline-flex h-11 items-center justify-center rounded-xl bg-brand-teal px-5 text-sm font-semibold text-brand-navy transition hover:bg-brand-teal-hover hover:text-white"
        >
          Upgrade to Drive Your Market →
        </Link>
      </div>
    </section>
  );
}
