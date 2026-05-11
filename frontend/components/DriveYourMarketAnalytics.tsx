/**
 * DriveYourMarketAnalytics — the gated analytics dashboard tile.
 *
 * Renders the funnel block returned by /api/business/analytics
 * under the `drive_your_market` key (computed in business.py
 * _drive_your_market_funnel). Eight summary tiles + a 7d / 30d
 * sub-block + best-performing offer.
 *
 * No charting library — the spec said "no charts unless an
 * existing chart component is already available." All metrics
 * render as numeric tiles + small ratio bars built from divs.
 *
 * Empty / first-week state is handled per-field — zeros render
 * as "—" so the dashboard reads as "no data yet" rather than
 * "broken zeroes."
 */

"use client";

import { useState } from "react";

type WindowMetrics = {
  visitors: number;
  purchases: number;
  revenue_usd: number;
};

export type DriveYourMarketFunnel = {
  embed_views: number;
  project_views: number;
  offer_views: number;
  unique_visitors: number;
  returning_visitors: number;
  checkout_starts: number;
  purchases: number;
  conversion_rate: number;
  repeat_customers: number;
  best_offer: { id: string; title: string; views: number } | null;
  window_7d: WindowMetrics;
  window_30d: WindowMetrics;
};

type Props = {
  funnel: DriveYourMarketFunnel;
  totalRevenueUsd: number;
};

function fmt(n: number): string {
  if (!n) return "—";
  return n.toLocaleString();
}

function fmtMoney(n: number): string {
  if (!n) return "—";
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtPct(n: number): string {
  if (!n) return "—";
  return `${n.toFixed(2)}%`;
}

export function DriveYourMarketAnalytics({ funnel, totalRevenueUsd }: Props) {
  const [window, setWindow] = useState<"all" | "7d" | "30d">("all");

  const view = window === "7d"
    ? {
        visitors: funnel.window_7d.visitors,
        purchases: funnel.window_7d.purchases,
        revenue: funnel.window_7d.revenue_usd,
      }
    : window === "30d"
      ? {
          visitors: funnel.window_30d.visitors,
          purchases: funnel.window_30d.purchases,
          revenue: funnel.window_30d.revenue_usd,
        }
      : {
          visitors: funnel.unique_visitors,
          purchases: funnel.purchases,
          revenue: totalRevenueUsd,
        };

  return (
    <section
      aria-labelledby="dym-analytics-heading"
      className="mt-8 rounded-2xl border border-default bg-surface-card p-6 sm:p-8"
    >
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-brand-teal">
          Drive Your Market Analytics
        </div>
        <div
          role="tablist"
          aria-label="Time window"
          className="inline-flex rounded-lg border border-default bg-surface-muted p-0.5 text-[11px]"
        >
          {(
            [
              ["all", "All time"],
              ["30d", "30 days"],
              ["7d", "7 days"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              type="button"
              aria-selected={window === key}
              onClick={() => setWindow(key)}
              className={`rounded-md px-3 py-1 font-semibold transition ${
                window === key
                  ? "bg-surface-card text-brand-navy shadow-sm"
                  : "text-secondary hover:text-primary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <h2
        id="dym-analytics-heading"
        className="mb-5 text-xl font-extrabold tracking-tight text-brand-navy sm:text-2xl"
      >
        Is DUM Club bringing me visitors and sales?
      </h2>

      {/* Headline funnel — visitors → checkout → purchases */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Visitors"
          value={fmt(view.visitors)}
          sub={
            window === "all"
              ? `${fmt(funnel.returning_visitors)} returning`
              : "in selected window"
          }
        />
        <Tile
          label="Checkout starts"
          value={fmt(funnel.checkout_starts)}
          sub="across all offers"
        />
        <Tile
          label="Purchases"
          value={fmt(view.purchases)}
          sub="completed orders"
        />
        <Tile
          label="Revenue"
          value={fmtMoney(view.revenue)}
          sub="paid through DUM Club"
          accent
        />
      </div>

      {/* Secondary metrics */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Unique visitors"
          value={fmt(funnel.unique_visitors)}
          sub="all time, anonymous"
        />
        <Tile
          label="Conversion rate"
          value={fmtPct(funnel.conversion_rate)}
          sub="visitors → purchases"
        />
        <Tile
          label="Repeat customers"
          value={fmt(funnel.repeat_customers)}
          sub="bought more than once"
        />
        <Tile
          label="Offer views"
          value={fmt(funnel.offer_views)}
          sub={`${fmt(funnel.embed_views)} embed views`}
        />
      </div>

      {/* Best-performing offer */}
      {funnel.best_offer ? (
        <div className="mt-5 rounded-xl border border-default bg-brand-teal-soft px-5 py-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-brand-teal">
            Best-performing offer
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <div className="truncate text-base font-semibold text-brand-navy">
              {funnel.best_offer.title}
            </div>
            <div className="shrink-0 font-mono text-sm text-brand-navy">
              {fmt(funnel.best_offer.views)} views
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-xl border border-dashed border-default bg-surface-muted px-5 py-4">
          <div className="text-[11px] text-muted">
            Best-performing offer will appear here once visitors start
            viewing your offers.
          </div>
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-muted">
        Visitor counts use anonymous, per-merchant identifiers stored
        in the buyer&apos;s browser. We don&apos;t collect IPs, device
        fingerprints, or precise location. Revenue + purchases come
        from your real Stripe orders.
      </p>
    </section>
  );
}

function Tile({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-default p-5 ${
        accent
          ? "bg-gradient-to-r from-brand-teal-soft to-surface-card"
          : "bg-surface-card"
      }`}
    >
      <div
        className={`text-[10px] uppercase tracking-[0.28em] ${
          accent ? "text-brand-teal/70" : "text-secondary"
        }`}
      >
        {label}
      </div>
      <div
        className={`mt-1 font-mono text-2xl font-bold ${
          accent ? "text-brand-teal" : "text-brand-navy"
        }`}
      >
        {value}
      </div>
      {sub ? <div className="mt-1 text-[11px] text-muted">{sub}</div> : null}
    </div>
  );
}
