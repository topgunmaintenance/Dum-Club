/**
 * /pricing — public, indexable pricing page (Phase 12).
 *
 * Replaced the 33-line useEffect redirect to /business?tab=pricing.
 * The redirect produced a 200ms flash, gave Google nothing to index,
 * and forced every "See Pricing" click to load two routes. This is
 * a real page now: tier grid, Enterprise row, Whatnot comparison,
 * FAQ, and a Talk-to-Julian rail.
 *
 * Tier numbers are verbatim per CLAUDE.md §3 (single source of
 * truth). Doctrine compliance:
 *   §3   tier numbers verbatim
 *   §11  comparison framed as "expense replacement"
 *   §12  Rule 1: never charge a % of sales — flat fee only
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

export const metadata: Metadata = {
  title: "Pricing | DUM Club",
  description:
    "Flat $29 to $99 a month. 0% commission. Keep every sale. Founding merchants get preferred pricing after launch.",
  openGraph: {
    title: "Pricing | DUM Club",
    description:
      "One flat monthly fee covers live selling, loyalty, tools that help bring customers back, and local flash sales. 0% commission, ever.",
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
    price: "$29",
    cadence: "/month",
    tagline: "Get on the marketplace and start selling.",
    features: [
      "Storefront on the DUM Club marketplace",
      "DUM Points loyalty built in",
      "Basic sales analytics",
      "Stripe direct payouts",
      "Listed on Discover",
    ],
    ctaLabel: "Start with Starter",
    ctaHref: "/merchant",
  },
  {
    name: "Growth",
    price: "$49",
    cadence: "/month",
    tagline: "Bring customers back automatically.",
    features: [
      "Everything in Starter",
      "Featured placement in category browse",
      "Tools that help bring customers back (point reminders)",
      "Google review display on storefront",
      "Best Deals This Week eligibility",
    ],
    ctaLabel: "Start with Growth",
    ctaHref: "/merchant",
    highlight: true,
  },
  {
    name: "Pro",
    price: "$99",
    cadence: "/month",
    tagline: "Replace your social agency too.",
    features: [
      "Everything in Growth",
      "AI social media management (IG / TikTok / FB)",
      "Homepage featured slot",
      "Cross-business deal promotions",
      "Full analytics dashboard",
      "Priority placement in search",
    ],
    ctaLabel: "Start with Pro",
    ctaHref: "/merchant",
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
      "Dedicated tools that help bring customers back",
      "For mid-size businesses building loyalty",
    ],
    ctaLabel: "Talk to sales",
    ctaHref: "mailto:julian@dum.club?subject=DUM%20Club%20Business%20tier",
  },
];

const FAQS: { q: string; a: string }[] = [
  {
    q: "Do you ever take a percentage of my sales?",
    a: "No. DUM Club charges a flat monthly fee. We never take a per-transaction commission, and we never have. Stripe's standard processing fees (2.9% + $0.30) are paid by the buyer at checkout. DUM Club does not sit between you and your money.",
  },
  {
    q: "What does 'founding merchant' actually get me?",
    a: "60 days free, then locked-in founding pricing for life. You also get a permanent founding-merchant badge on your storefront. The first 100 merchants to sign up qualify.",
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
    q: "What's included in the tools that help bring customers back?",
    a: "Automated point-expiry reminders, deal pushes when customers haven't visited in a while, and a way for customers to find nearby deals across the network (a detailer's customer might get a pizza-shop coupon). Replaces what most businesses pay $500 to $1,000 a month for via direct mail.",
  },
  {
    q: "How is this different from Shopify or Square?",
    a: "Shopify and Square are point-of-sale and storefront tools. They do not include live selling, loyalty, retention, or local discovery. DUM Club bundles all five. The flat fee replaces a stack of separate monthly bills (loyalty SaaS, SMS retention, ad spend, social-agency).",
  },
];

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-surface-page text-primary">
      {/* ── Hero ──────────────────────────────────────────────── */}
      <Section spacing="loose" bg="gradient">
        <Container size="lg">
          <div className="mx-auto max-w-3xl text-center">
            <Eyebrow tone="brand">Pricing · One flat fee</Eyebrow>
            <Heading level="display" className="mt-4">
              Flat <span className="text-brand-navy">$29 to $99 a month</span>.<br />
              0% commission. Keep every sale.
            </Heading>
            <p className="mx-auto mt-6 max-w-2xl text-base text-secondary sm:text-lg">
              Live selling, loyalty, tools that help bring customers back, and
              local flash sales. One monthly fee replaces five separate bills.
              Get 60 days free and lock in founding pricing for life.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button href="/merchant" variant="primary" size="lg">
                Claim Your Founding Spot
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
            <Heading level="h1" className="mt-3">
              Pick the plan that fits.
            </Heading>
            <p className="mx-auto mt-3 max-w-xl text-secondary">
              Same 0% commission on every plan. Upgrade when the next
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

      {/* ── Whatnot vs DUM comparison ─────────────────────────── */}
      <Section spacing="default" bg="muted">
        <Container size="lg">
          <div className="mb-8 text-center">
            <Eyebrow tone="navy">The math</Eyebrow>
            <Heading level="h1" className="mt-3">
              At <span className="text-brand-teal">$10k/month in sales</span>,
              who keeps more?
            </Heading>
            <p className="mx-auto mt-3 max-w-xl text-secondary">
              Same buyer, same checkout, same Stripe processing. The only
              difference is who takes a cut.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card variant="surface" padding="lg">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-secondary">
                Whatnot
              </div>
              <div className="mb-4 font-mono text-4xl font-extrabold text-state-live">
                $1,090<span className="text-base text-secondary"> /month in fees</span>
              </div>
              <ul className="space-y-2 text-[13px] text-primary">
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-state-live" aria-hidden />
                  <span>8% commission on $10,000 = $800</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-state-live" aria-hidden />
                  <span>2.9% + $0.30 processing = ~$290</span>
                </li>
              </ul>
              <p className="mt-4 text-[12px] text-secondary">
                Compounds: $100k/month = $10,900/month in fees.
              </p>
            </Card>

            <Card variant="surface" padding="lg" className="border-brand-teal ring-1 ring-brand-teal">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-brand-teal">
                DUM Club · Growth tier
              </div>
              <div className="mb-4 font-mono text-4xl font-extrabold text-brand-navy">
                $49<span className="text-base text-secondary"> /month flat</span>
              </div>
              <ul className="space-y-2 text-[13px] text-primary">
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-teal" strokeWidth={2.5} aria-hidden />
                  <span>0% commission on $10,000</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-teal" strokeWidth={2.5} aria-hidden />
                  <span>Stripe processing paid by the buyer at checkout</span>
                </li>
              </ul>
              <p className="mt-4 text-[12px] text-secondary">
                $100k/month = same $49. The fee never scales with sales.
              </p>
            </Card>
          </div>

          <p className="mt-8 text-center text-[13px] text-secondary">
            <span className="font-semibold text-brand-navy">$1,041/month</span>{" "}
            saved on Whatnot's fees alone, before the loyalty, retention,
            and AI social tooling Growth includes.
          </p>
        </Container>
      </Section>

      {/* ── FAQ ───────────────────────────────────────────────── */}
      <Section spacing="default" bg="page">
        <Container size="md">
          <div className="mb-8 text-center">
            <Eyebrow tone="muted">FAQ</Eyebrow>
            <Heading level="h1" className="mt-3">
              Questions worth answering up front.
            </Heading>
          </div>

          <div className="space-y-3">
            {FAQS.map((f, i) => (
              <Card key={f.q} variant="surface" padding="md">
                <details className="group" open={i < 2}>
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
