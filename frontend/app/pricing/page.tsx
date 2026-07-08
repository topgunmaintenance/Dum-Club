/**
 * /pricing — public, indexable pricing page (Phase 12).
 *
 * Replaced the 33-line useEffect redirect to /business?tab=pricing.
 * The redirect produced a 200ms flash, gave Google nothing to index,
 * and forced every "See Pricing" click to load two routes. This is
 * the single numbers page now: tier grid, Enterprise row, savings
 * calculator (client island), fee comparison table, FAQ, and a
 * Talk-to-Julian rail. /business carries the story and links here.
 *
 * Tier numbers are verbatim per CLAUDE.md §3 (single source of
 * truth). Doctrine compliance:
 *   §3   tier numbers verbatim
 *   §11  comparison framed as "expense replacement"
 *   §12  Rule 1: 1.5% sales fee + flat subscription tier; never higher
 *   §12  Rule 11: Stripe is the only payment processor
 */

import type { Metadata } from "next";
import { ArrowRight, Check, Mail } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  Container,
  Eyebrow,
  Heading,
  Section,
} from "../../components/ui";
import { SavingsCalculator } from "../../components/pricing/SavingsCalculator";
import { CompareTable } from "../../components/pricing/CompareTable";

export const metadata: Metadata = {
  title: "Pricing, Calculator & Comparisons | DUM Club",
  description:
    "Tiers from $39/month plus a 1.5% sales fee. Run the savings calculator and see the fee comparisons. Every business gets 30 days free.",
  openGraph: {
    title: "Pricing, Calculator & Comparisons | DUM Club",
    description:
      "Tiers from $39/month plus a 1.5% sales fee. Run the savings calculator and see the fee comparisons. Every business gets 30 days free.",
    type: "website",
  },
};

type Tier = {
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  highlight?: boolean;
};

const TIERS: Tier[] = [
  {
    name: "Starter",
    price: "$39",
    cadence: "/month",
    tagline: "Get on the marketplace and start selling.",
    features: [
      "Storefront on the DUM Club marketplace",
      "DUM Points loyalty built in",
      "Basic sales analytics",
      "Stripe direct payouts",
      "Listed on Discover",
      "250 viewer-hours of live/replay watching included, then $0.13 per viewer-hour",
      "1.5% sales fee on every order",
    ],
    ctaLabel: "Start with Starter",
    ctaHref: "/merchant?tier=starter",
  },
  {
    name: "Growth",
    price: "$99",
    cadence: "/month",
    tagline: "Bring customers back automatically.",
    features: [
      "Everything in Starter",
      "Featured placement in category browse",
      "Automatic customer win-back texts (point reminders)",
      "Google review display on storefront",
      "Best Deals This Week eligibility",
      "700 viewer-hours included, then $0.12 per viewer-hour",
      "1.5% sales fee on every order",
    ],
    ctaLabel: "Start with Growth",
    ctaHref: "/merchant?tier=growth",
    highlight: true,
  },
  {
    name: "Pro",
    price: "$299",
    cadence: "/month",
    tagline: "Replace your social agency too.",
    features: [
      "Everything in Growth",
      "AI social media management (IG / TikTok / FB)",
      "Homepage featured slot",
      "Cross-business deal promotions",
      "Full analytics dashboard",
      "Priority placement in search",
      "1,500 viewer-hours included, then $0.10 per viewer-hour",
      "1.5% sales fee on every order",
    ],
    ctaLabel: "Start with Pro",
    ctaHref: "/merchant?tier=pro",
  },
  {
    name: "Business",
    price: "$499",
    cadence: "/month",
    tagline: "White-label DUM Points under your brand.",
    features: [
      "DUM Points under your brand name",
      "Custom rewards rules + earning rates",
      "API access for your own platform",
      "Dedicated automatic customer win-back texts",
      "For mid-size businesses building loyalty",
      "Custom viewer-hour budget, $0.10 per viewer-hour over it",
      "1.5% sales fee on every order",
    ],
    ctaLabel: "Talk to sales",
    ctaHref: "mailto:julian@dum.club?subject=DUM%20Club%20Business%20tier",
  },
];

const FAQS: { q: string; a: string }[] = [
  {
    q: "Do you take a percentage of my sales?",
    a: "Yes. 1.5% per paid order, deducted from your Stripe payout. That's industry-low: Whatnot takes up to 8%, DoorDash takes 15-30%, Etsy takes 6.5%. The 1.5% is your only per-sale fee on DUM Club. Stripe's standard processing fees (2.9% + $0.30) are paid by the buyer at checkout, not by you.",
  },
  {
    q: "What does 'founding merchant' actually get me?",
    a: "Every business gets 30 days free, and you can cancel any time during the trial. As a quiet perk, the first 100 merchants to sign up also keep founding pricing for life and get a permanent founding-merchant badge on their storefront.",
  },
  {
    q: "Why is there no Free tier?",
    a: "We charge for the platform so we can keep the platform running without taking a cut from you. A free tier would force a commission model later. We'd rather be upfront and aligned with you from day one.",
  },
  {
    q: "Can I cancel any time?",
    a: "Yes. Cancel from your dashboard, no questions asked. Your storefront stays accessible to existing customers for 30 days while you migrate, then archives.",
  },
  {
    q: "Do I need to integrate Stripe?",
    a: "Yes. Stripe is the only payment processor on DUM Club, the same one Whatnot, Square, and Shopify use. Connecting takes about 60 seconds via Stripe Connect, and payouts land in your bank on Stripe's standard schedule.",
  },
  {
    q: "What's included in the automatic customer win-back texts?",
    a: "Automated point-expiry reminders, deal pushes when customers haven't visited in a while, and a way for customers to find nearby deals across the network (a detailer's customer might get a pizza-shop coupon). Replaces what most businesses pay $500 to $1,000 a month for via direct mail.",
  },
  {
    q: "How is this different from Shopify or Square?",
    a: "Shopify and Square are point-of-sale and storefront tools. They do not include live selling, loyalty, retention, or local discovery. DUM Club bundles all five. The flat fee replaces a stack of separate monthly bills (loyalty SaaS, SMS retention, ad spend, social-agency).",
  },
];

// FAQ items expanded by default. The first three answers give quick
// context; the conversion audit (P16) adds the cancellation and Stripe
// objections so those answers are visible without a click.
const DEFAULT_OPEN_FAQS = new Set<string>([
  "Can I cancel any time?",
  "Do I need to integrate Stripe?",
]);

// ISR: marketing content changes rarely. Serve a statically generated
// page, regenerate at most once an hour. Absorbs traffic without hitting
// the backend on every view.
export const revalidate = 3600;

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-surface-page text-primary">
      {/* ── Hero ──────────────────────────────────────────────── */}
      <Section spacing="loose" bg="gradient">
        <Container size="lg">
          <div className="mx-auto max-w-3xl text-center">
            <Eyebrow tone="brand">Pricing · One flat fee</Eyebrow>
            <Heading level="display" className="mt-4">
              Starting at <span className="text-brand-navy">$39/month + 1.5% sales fee</span>.<br />
              Keep more of every dollar.
            </Heading>
            <p className="mx-auto mt-6 max-w-2xl text-base text-secondary sm:text-lg">
              Live selling, loyalty, automatic customer win-back texts, and
              local flash sales. One monthly fee replaces five separate bills.
              Every business gets 30 days free.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button href="/merchant" variant="primary" size="lg">
                Start Free for 30 Days
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button href="#tiers" variant="secondary" size="lg">
                Compare tiers
              </Button>
            </div>
          </div>
        </Container>
      </Section>

      {/* ── Tier grid ─────────────────────────────────────────── */}
      <Section id="tiers" spacing="default" bg="page">
        <Container size="xl">
          <div className="mb-10 text-center">
            <Eyebrow tone="muted">Tiers</Eyebrow>
            <Heading level="h1" as="h2" className="mt-3">
              Pick the plan that fits.
            </Heading>
            <p className="mx-auto mt-3 max-w-xl text-secondary">
              Same 1.5% sales fee on every plan. Upgrade when the next
              capability earns its keep.
            </p>
          </div>

          {/* Phase 4 visibility rule: show Starter / Growth / Pro by
              default. Business is hidden behind the "Need a bigger
              plan?" link below — most local businesses never need it
              and the four-column grid was visually busy. */}
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-3">
            {TIERS.filter((t) => t.name !== "Business").map((tier) => (
              <Card
                key={tier.name}
                variant={tier.highlight ? "elevated" : "surface"}
                padding="lg"
                className={
                  tier.highlight
                    ? "border-brand-teal ring-1 ring-brand-teal"
                    : undefined
                }
              >
                {tier.highlight && (
                  <div className="mb-3">
                    <Badge variant="accent" size="sm">
                      Most popular
                    </Badge>
                  </div>
                )}
                <div className="mb-1 text-sm font-semibold text-brand-navy">
                  {tier.name}
                </div>
                <div className="mb-3 flex items-baseline gap-1">
                  <span className="font-mono text-4xl font-extrabold text-primary">
                    {tier.price}
                  </span>
                  <span className="text-sm text-secondary">{tier.cadence}</span>
                </div>
                <p className="mb-5 text-sm text-secondary">{tier.tagline}</p>
                <ul className="mb-6 space-y-2">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[13px] text-primary">
                      <Check
                        className="mt-0.5 h-4 w-4 shrink-0 text-brand-teal"
                        strokeWidth={2.5}
                        aria-hidden="true"
                      />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  href={tier.ctaHref}
                  variant={tier.highlight ? "primary" : "secondary"}
                  size="md"
                  fullWidth
                >
                  {tier.ctaLabel}
                </Button>
              </Card>
            ))}
          </div>
        </Container>
      </Section>

      {/* ── Bigger plans (collapsed) ────────────────────────────
           Phase 4 visibility rule: Business + Enterprise tiers are
           hidden behind a single disclosure link. Local businesses
           almost never need them and surfacing them by default made
           the page look like enterprise SaaS. The full content is
           preserved inside the <details> so anyone who clicks "Need
           a bigger plan?" still sees both. */}
      <Section spacing="tight" bg="page">
        <Container size="xl">
          <details className="group">
            <summary className="cursor-pointer list-none text-center text-sm font-bold text-brand-teal transition hover:text-brand-teal-hover">
              Need a bigger plan? →
            </summary>
            <div className="mt-6 space-y-6">
              {/* Business tier card (lifted from TIERS list above). */}
              {TIERS.filter((t) => t.name === "Business").map((tier) => (
                <Card key={tier.name} variant="surface" padding="lg" className="max-w-3xl mx-auto">
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-brand-teal">
                    {tier.name} · {tier.price}{tier.cadence}
                  </div>
                  <div className="mb-2 text-2xl font-bold tracking-tight text-primary">
                    {tier.tagline}
                  </div>
                  <ul className="mt-4 mb-6 space-y-2">
                    {tier.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-[13px] text-primary">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-teal" strokeWidth={2.5} aria-hidden="true" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Button href={tier.ctaHref} variant="secondary" size="md">{tier.ctaLabel}</Button>
                </Card>
              ))}

              {/* Enterprise full-width row (unchanged copy, just moved
                  inside the disclosure). */}
              <Card variant="surface" padding="lg" className="bg-brand-navy text-white border-brand-navy">
                <div className="flex flex-col items-start gap-6 lg:flex-row lg:items-center lg:justify-between">
                  <div className="max-w-2xl">
                    <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-brand-teal">
                      Enterprise · $2,000+/month
                    </div>
                    <div className="mb-2 text-2xl font-bold tracking-tight">
                      Full white-label loyalty infrastructure.
                    </div>
                    <p className="text-[14px] leading-relaxed text-white/80">
                      Multi-location support, custom POS / CRM / ERP integrations,
                      dedicated account manager. For hotel chains, retail chains,
                      franchise networks, and grocery groups that want their own
                      loyalty network without building it.
                    </p>
                    <p className="mt-2 text-[13px] leading-relaxed text-white/70">
                      Custom viewer-hour budget, $0.08 per viewer-hour over it.
                      1.5% sales fee on every order.
                    </p>
                  </div>
                  <a
                    href="mailto:julian@dum.club?subject=DUM%20Club%20Enterprise"
                    className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl bg-brand-teal px-6 text-sm font-semibold text-brand-navy transition-colors hover:bg-brand-teal-hover hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-navy"
                  >
                    Contact sales
                    <ArrowRight className="h-4 w-4" />
                  </a>
                </div>
              </Card>
            </div>
          </details>
        </Container>
      </Section>

      {/* ── Savings calculator (client island) ─────────────────── */}
      <Section spacing="default" bg="muted">
        <Container size="lg">
          <SavingsCalculator />
        </Container>
      </Section>

      {/* ── Fee comparisons ─────────────────────────────────────── */}
      <Section spacing="default" bg="page">
        <Container size="lg">
          <CompareTable />
        </Container>
      </Section>

      {/* ── FAQ ───────────────────────────────────────────────── */}
      <Section spacing="default" bg="page">
        <Container size="md">
          <div className="mb-8 text-center">
            <Eyebrow tone="muted">FAQ</Eyebrow>
            <Heading level="h1" as="h2" className="mt-3">
              Questions worth answering up front.
            </Heading>
          </div>

          <div className="space-y-3">
            {FAQS.map((f, i) => (
              <Card key={f.q} variant="surface" padding="md">
                <details className="group" open={i < 3 || DEFAULT_OPEN_FAQS.has(f.q)}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold text-primary">
                    {f.q}
                    <span
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-default bg-surface-muted text-secondary transition-transform group-open:rotate-45"
                      aria-hidden="true"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-[14px] leading-relaxed text-secondary">
                    {f.a}
                  </p>
                </details>
              </Card>
            ))}
          </div>
        </Container>
      </Section>

      {/* ── Talk to Julian rail ──────────────────────────────── */}
      <Section spacing="loose" bg="muted">
        <Container size="md">
          <Card variant="surface" padding="lg">
            <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-default bg-brand-teal-soft">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/Julian.jpeg"
                  alt="Julian Mero, founder of DUM Club"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="flex-1">
                <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-teal">
                  Still deciding?
                </div>
                <div className="mt-1 text-[18px] font-bold text-primary">
                  Talk to Julian directly.
                </div>
                <p className="mt-1 text-[14px] text-secondary">
                  I built DUM Club because I run a real business too. If you
                  want to walk through which tier fits your shop, email me.
                </p>
              </div>
              <a
                href="mailto:julian@dum.club?subject=Question%20about%20DUM%20Club%20pricing"
                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-brand-teal px-5 text-sm font-semibold text-brand-navy transition-colors hover:bg-brand-teal-hover hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
              >
                <Mail className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                Email Julian
              </a>
            </div>
          </Card>
        </Container>
      </Section>
    </main>
  );
}
