/**
 * /investors — public investor page for the DUM Club WeFunder
 * community round. Hosts the embedded pitch deck PDF, key SAFE
 * terms, investment highlights, and the founder bio. Linked from
 * the homepage footer; aliased from /raise and /wefunder via
 * next.config.js redirects.
 *
 * Treat DUM_Club_Deck_Final_Accurate.pdf in public/investors as
 * the source of truth for problem, solution, market, traction,
 * financials, use of funds, and SAFE terms.
 */

import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CircleDollarSign,
  Download,
  ExternalLink,
  FileText,
  Network,
  Plane,
  Radio,
  ShieldCheck,
  Sparkles,
  Store,
  Wallet,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  Container,
  Eyebrow,
  Heading,
  Section,
} from "../../components/ui";

const WEFUNDER_URL = "https://wefunder.com/dumclub";
const DECK_URL = "/investors/DUM_Club_Deck_Final_Accurate.pdf";
const DECK_DOWNLOAD_NAME = "DUM_Club_Investor_Deck.pdf";

export const metadata: Metadata = {
  title: "Invest in DUM Club",
  description:
    "Review the DUM Club investor deck and participate in our WeFunder community round.",
  openGraph: {
    title: "Invest in DUM Club",
    description:
      "Review the DUM Club investor deck and participate in our WeFunder community round. SAFE note, $10M post-money cap, 20% discount, minimum $100.",
    siteName: "DUM Club",
    type: "website",
    url: "/investors",
  },
  twitter: {
    card: "summary_large_image",
    title: "Invest in DUM Club",
    description:
      "Review the DUM Club investor deck and participate in our WeFunder community round.",
  },
};

const QUICK_TERMS: Array<{ label: string; value: string }> = [
  { label: "Instrument", value: "SAFE Note" },
  { label: "Valuation Cap", value: "$10M Post-Money" },
  { label: "Discount", value: "20%" },
  { label: "Minimum", value: "$100" },
];

const HIGHLIGHTS: Array<{
  icon: typeof Store;
  title: string;
  body: string;
}> = [
  {
    icon: Store,
    title: "Live production platform",
    body: "dum.club is publicly deployed. Merchant onboarding, customer checkout, and the discover marketplace are operational today.",
  },
  {
    icon: CircleDollarSign,
    title: "Real Stripe payments processing",
    body: "Stripe Connect Standard is live. Direct merchant payouts. DUM Club never holds funds.",
  },
  {
    icon: Wallet,
    title: "Flat monthly SaaS model",
    body: "$29 to $99 a month. Predictable recurring revenue. 78% projected gross margin by Year 2.",
  },
  {
    icon: ShieldCheck,
    title: "0% platform commission",
    body: "Merchants keep every sale. Stripe processing fees are paid by the buyer at checkout, not by the seller.",
  },
  {
    icon: Radio,
    title: "Merchant website embed",
    body: "One script tag turns any website into a live flash-deal storefront with Stripe checkout and DUM Points loyalty.",
  },
  {
    icon: Network,
    title: "Cross-merchant loyalty network",
    body: "DUM Points (1 pt = $0.10 of merchant credit) earned at any merchant, redeemable across the entire network.",
  },
];

const FOUNDER_FACTS: Array<{ icon: typeof Plane; title: string; body: string }> = [
  {
    icon: Plane,
    title: "FAA-certified A&P mechanic, IA",
    body: "AOG team experience and 12+ years across corporate, charter, rotorcraft, and airline categories. Valedictorian, Teterboro School of Aeronautics.",
  },
  {
    icon: Store,
    title: "Founder, Topgun Maintenance LLC",
    body: "Mobile aviation maintenance serving corporate jets across the Northeast. Founding Merchant #1 on DUM Club, live on the platform today.",
  },
  {
    icon: Sparkles,
    title: "Built DUM Club end-to-end",
    body: "Next.js, FastAPI, Supabase, Stripe Connect, Privy, AWS IVS, plus Solana smart contracts in Rust. Bilingual (English + Spanish), based in Morris County, NJ.",
  },
];

export default function InvestorsPage() {
  return (
    <main className="min-h-screen bg-surface-page text-primary">
      {/* ── Hero ──────────────────────────────────────────────── */}
      <Section spacing="loose" bg="gradient">
        <Container size="lg">
          <div className="mx-auto max-w-3xl text-center">
            <Eyebrow tone="brand">WeFunder Community Round · Open Now</Eyebrow>
            <Heading level="display" className="mt-4">
              Invest in the Future of{" "}
              <span className="text-brand-navy">Local Commerce</span>.
            </Heading>
            <p className="mx-auto mt-6 max-w-2xl text-base text-secondary sm:text-lg">
              DUM Club is building a live commerce platform that helps local
              businesses sell online, keep every sale, and grow with built-in
              loyalty.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button href={WEFUNDER_URL} variant="primary" size="lg">
                Invest on WeFunder
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button href="#deck" variant="secondary" size="lg">
                <FileText className="h-4 w-4" aria-hidden="true" />
                Download Pitch Deck
              </Button>
            </div>

            <ul className="mx-auto mt-10 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
              {QUICK_TERMS.map((t) => (
                <li
                  key={t.label}
                  className="rounded-xl border border-default bg-surface-card px-3 py-3 text-center"
                >
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-teal">
                    {t.label}
                  </div>
                  <div className="mt-1 font-mono text-sm font-extrabold text-brand-navy sm:text-base">
                    {t.value}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </Section>

      {/* ── Investment Highlights ─────────────────────────────── */}
      <Section spacing="default" bg="page">
        <Container size="xl">
          <div className="mb-10 text-center">
            <Eyebrow tone="muted">Investment Highlights</Eyebrow>
            <Heading level="h1" className="mt-3">
              A live platform, not a pitch idea.
            </Heading>
            <p className="mx-auto mt-3 max-w-2xl text-secondary">
              Every claim below ships in production today. The deck below
              walks through the full thesis.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {HIGHLIGHTS.map(({ icon: Icon, title, body }) => (
              <Card key={title} variant="surface" padding="lg">
                <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-teal-soft text-brand-teal">
                  <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                </div>
                <div className="mb-1 text-base font-bold text-brand-navy">
                  {title}
                </div>
                <p className="text-[13px] leading-relaxed text-secondary">{body}</p>
              </Card>
            ))}
          </div>
        </Container>
      </Section>

      {/* ── Embedded Pitch Deck ───────────────────────────────── */}
      <Section spacing="default" bg="muted">
        <Container size="lg">
          <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <Eyebrow tone="navy" id="deck">
                Pitch Deck · 18 slides
              </Eyebrow>
              <Heading level="h1" className="mt-3">
                The full investor deck.
              </Heading>
              <p className="mt-2 max-w-xl text-secondary">
                Problem, solution, product, business model, market, technology,
                traction, financials, use of funds, and SAFE terms.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={DECK_URL}
                download={DECK_DOWNLOAD_NAME}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-teal px-5 text-sm font-semibold text-brand-navy transition-colors hover:bg-brand-teal-hover hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
              >
                <Download className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                Download PDF
              </a>
              <a
                href={DECK_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 items-center gap-2 rounded-xl border border-default bg-surface-card px-5 text-sm font-semibold text-brand-navy transition-colors hover:border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
              >
                <ExternalLink className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                Open in new tab
              </a>
            </div>
          </div>

          {/* Inline embed. Hidden on small screens (where iframe PDF
              viewing is unreliable on iOS Safari and Chrome Android)
              in favor of a clean call-to-action that opens the PDF
              in the device's native viewer. */}
          <div className="hidden overflow-hidden rounded-2xl border border-default bg-surface-card shadow-sm md:block">
            <object
              data={`${DECK_URL}#view=FitH&toolbar=1`}
              type="application/pdf"
              aria-label="DUM Club investor pitch deck, 18 slides"
              className="block h-[900px] w-full"
            >
              <div className="flex h-[400px] flex-col items-center justify-center gap-3 p-8 text-center">
                <FileText
                  className="h-10 w-10 text-brand-teal"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <p className="text-sm text-secondary">
                  Your browser cannot display the embedded PDF. Use the buttons
                  above to download or open it in a new tab.
                </p>
              </div>
            </object>
          </div>

          {/* Mobile: open the PDF in the device's native viewer rather
              than trying to render it inline. iOS Safari + most Android
              browsers handle a native PDF tab better than an iframe. */}
          <div className="md:hidden">
            <a
              href={DECK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 rounded-2xl border border-default bg-surface-card p-5 shadow-sm transition hover:border-strong"
            >
              <span className="flex items-center gap-3">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-brand-teal-soft text-brand-teal">
                  <FileText className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-brand-navy">
                    DUM Club Investor Deck
                  </span>
                  <span className="block text-[12px] text-secondary">
                    18 slides · Opens in a new tab
                  </span>
                </span>
              </span>
              <span className="text-brand-teal">
                <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </span>
            </a>
          </div>
        </Container>
      </Section>

      {/* ── Founder ───────────────────────────────────────────── */}
      <Section spacing="default" bg="page">
        <Container size="lg">
          <div className="grid items-start gap-10 lg:grid-cols-[320px_1fr]">
            <div>
              <div className="rounded-2xl border border-default bg-surface-card p-6 shadow-sm">
                <div className="mx-auto mb-4 flex h-32 w-32 items-center justify-center overflow-hidden rounded-2xl border border-default bg-brand-teal-soft">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/Julian.jpeg"
                    alt="Julian Mero, founder of DUM Club"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="text-center">
                  <div className="text-base font-bold text-brand-navy">
                    Julian Mero
                  </div>
                  <div className="mt-1 text-[12px] text-secondary">
                    Founder &amp; CEO
                  </div>
                  <div className="mt-3 inline-flex items-center gap-1 rounded-full border border-default bg-brand-teal-soft px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-brand-teal">
                    Founding Merchant #1
                  </div>
                  <div className="mt-4 flex flex-col gap-1 font-mono text-[11px] text-secondary">
                    <a
                      href="mailto:julian@dum.club"
                      className="text-brand-teal transition hover:text-brand-teal-hover"
                    >
                      julian@dum.club
                    </a>
                    <span>Morris County, NJ</span>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <Eyebrow tone="brand">Founder</Eyebrow>
              <Heading level="h1" className="mt-3">
                The platform was built by a working merchant.
              </Heading>
              <p className="mt-4 text-base leading-relaxed text-secondary sm:text-lg">
                Julian Mero is an FAA-certified aviation mechanic and the
                founder of Topgun Maintenance LLC. He built DUM Club end-to-end
                because every existing platform took a cut of every job. Today
                Topgun Maintenance is the first verified merchant on the
                network and serves as the live case study for the rest of the
                founding 100.
              </p>

              <div className="mt-6 space-y-3">
                {FOUNDER_FACTS.map(({ icon: Icon, title, body }) => (
                  <div
                    key={title}
                    className="flex items-start gap-3 rounded-xl border border-default bg-surface-card p-4"
                  >
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-teal-soft text-brand-teal">
                      <Icon
                        className="h-4 w-4"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-brand-navy">
                        {title}
                      </div>
                      <p className="mt-1 text-[13px] leading-relaxed text-secondary">
                        {body}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <blockquote className="mt-8 border-l-4 border-brand-teal bg-surface-card p-5 text-[15px] leading-relaxed text-primary">
                &ldquo;I built DUM Club because I run a real business. I was
                tired of platforms taking a cut every time I made a sale.&rdquo;
                <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-secondary">
                  Julian Mero · Founder
                </div>
              </blockquote>
            </div>
          </div>
        </Container>
      </Section>

      {/* ── Final CTA ─────────────────────────────────────────── */}
      <Section spacing="loose" bg="muted">
        <Container size="md">
          <Card variant="surface" padding="lg" className="text-center">
            <Badge variant="accent" size="sm">
              WeFunder Community Round · Open Now
            </Badge>
            <Heading level="h1" className="mt-4">
              Join the Community Round.
            </Heading>
            <p className="mx-auto mt-3 max-w-xl text-secondary">
              SAFE note. $10M post-money cap. 20% discount. Minimum $100. Every
              dollar maps to engineering, merchant acquisition, and the cross-
              merchant loyalty network.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Button href={WEFUNDER_URL} variant="primary" size="lg">
                Invest on WeFunder
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
              <a
                href={DECK_URL}
                download={DECK_DOWNLOAD_NAME}
                className="inline-flex h-12 items-center gap-2 rounded-xl border border-default bg-surface-card px-6 text-sm font-semibold text-brand-navy transition-colors hover:border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
              >
                <Download className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                Download Deck
              </a>
            </div>
            <p className="mx-auto mt-6 max-w-xl text-[11px] leading-relaxed text-muted">
              Projections in the deck are management estimates only and not a
              guarantee. Investing in early-stage companies involves risk,
              including the risk of total loss. See the WeFunder campaign for
              full risk factors and offering documents.
            </p>
          </Card>
        </Container>
      </Section>
    </main>
  );
}
