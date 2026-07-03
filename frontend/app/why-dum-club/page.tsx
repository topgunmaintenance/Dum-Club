/**
 * /why-dum-club — merchant acquisition comparison surface.
 *
 * Targeted at local business owners who already pay for Instagram
 * Live (no checkout, customers get rented to IG), DoorDash (15-30%
 * commission), or Whatnot (up to 8% per sale). The page makes the
 * comparison concrete by trade: pizza shop, mechanic, boutique,
 * food truck, barber, gym, salon. Each trade has one specific
 * line of why DUM Club helps that exact business fill slow hours,
 * sell direct, and own its customer relationship.
 *
 * Doctrine: CLAUDE.md §11 (expense-replacement framing only —
 * never "another marketplace"). Copy follows the human-copy
 * guard rules: no AI/SaaS marketing jargon, plain English.
 *
 * ISR: marketing content, regenerate at most hourly.
 */

import type { Metadata } from "next";
import Link from "next/link";

import {
  Badge,
  Card,
  Container,
  Eyebrow,
  Heading,
  Section,
} from "../../components/ui";

export const metadata: Metadata = {
  title: "Why DUM Club vs Instagram Live, DoorDash, Whatnot",
  description:
    "Why local businesses pick DUM Club over Instagram Live, DoorDash, or Whatnot. Own your customers, fill slow hours, sell direct, lower platform dependency. From $39/month plus a 1.5% sales fee.",
  openGraph: {
    title: "Why DUM Club vs Instagram Live, DoorDash, Whatnot",
    description:
      "Built for pizza shops, mechanics, boutiques, food trucks, barbers, gyms, salons. Own your customers. Sell direct. Lower platform dependency.",
    type: "website",
  },
};

export const revalidate = 3600;

/* ───────────────────────────────────────────────────────────
   1. Three-up comparison: Instagram Live · DoorDash · Whatnot
   vs DUM Club. Each row is one concrete thing a local business
   owner actually cares about.
   ─────────────────────────────────────────────────────────── */
type CompareRow = {
  label: string;
  ig: string;
  doordash: string;
  whatnot: string;
  dum: string;
};

const COMPARE_ROWS: CompareRow[] = [
  {
    label: "Who gets paid",
    ig: "You. But no checkout. Customers DM you and you handle it.",
    doordash: "DoorDash. Cut goes to them. You see net after commission.",
    whatnot: "Whatnot. Cut goes to them. You see net after up to 8% + processing.",
    dum: "You. Stripe sends every sale straight to your bank.",
  },
  {
    label: "Per-sale cut",
    ig: "0% (no checkout). You lose the customer data to the platform.",
    doordash: "15 to 30% of every order.",
    whatnot: "Up to 8% per sale + 2.9% processing.",
    dum: "1.5% per sale. Stripe processing paid by the buyer.",
  },
  {
    label: "Where you sell",
    ig: "Inside Instagram. They can change the rules anytime.",
    doordash: "Inside DoorDash app. You live in their search results.",
    whatnot: "Inside Whatnot app. You live in their search results.",
    dum: "On your own storefront page. Embed on your own website too.",
  },
  {
    label: "Who owns the customer",
    ig: "Instagram. Algorithm decides who sees you next time.",
    doordash: "DoorDash. You never get the customer phone or email.",
    whatnot: "Whatnot. Buyer data stays inside their app.",
    dum: "You. Repeat customers come back via reminders and DUM Points.",
  },
  {
    label: "Going live",
    ig: "Yes, but no buy button. Customers DM, then chase you.",
    doordash: "No.",
    whatnot: "Yes. Built for live selling.",
    dum: "Yes. Pinned-offer checkout right on the live page. Mobile-ready.",
  },
  {
    label: "Filling slow hours",
    ig: "Post and hope.",
    doordash: "Pay for ad placement to be seen.",
    whatnot: "Schedule a live and hope the platform surfaces it.",
    dum: "Schedule next live. We email the customers who tapped Remind me.",
  },
  {
    label: "Bringing customers back",
    ig: "You buy ads to reach the same person twice.",
    doordash: "You don't. They reach customers; you don't.",
    whatnot: "You don't. They surface other sellers on the same screen.",
    dum: "DUM Points + automatic win-back texts. Customers return on their own.",
  },
];

/* ───────────────────────────────────────────────────────────
   2. Trade-specific cards. Seven verticals named by the founder.
   Each one says, in one sentence, the concrete way DUM Club
   helps that exact kind of shop.
   ─────────────────────────────────────────────────────────── */
type TradeCard = {
  trade: string;
  emoji: string;
  pain: string;
  win: string;
};

const TRADES: TradeCard[] = [
  {
    trade: "Pizza shops",
    emoji: "🍕",
    pain: "Slow Tuesdays. DoorDash takes a third of every order.",
    win: "Schedule a Tuesday live. Customers tap Remind me. They walk in or order direct. You keep 99 cents on the dollar.",
  },
  {
    trade: "Mechanics",
    emoji: "🔧",
    pain: "Customers shop you on Yelp and never come back. Repair scheduling is phone tag.",
    win: "List your services on your own page. Go live walking through a job. Customers book direct and get reminded for the next service.",
  },
  {
    trade: "Boutiques",
    emoji: "👗",
    pain: "Instagram shows your dress to one person and never again. New stock sits.",
    win: "Live-sell new arrivals on your storefront. Pin the dress as a buy button. Returning customers get a heads-up text when you go live.",
  },
  {
    trade: "Food trucks",
    emoji: "🌮",
    pain: "Customers can't find you. Today's spot is on Instagram and nobody saw it.",
    win: "Update today's location on your page. Customers who follow you get a same-day text. Pre-orders pin to the top.",
  },
  {
    trade: "Barbers",
    emoji: "💈",
    pain: "Friday is full, Wednesday is empty. Walk-ins are unpredictable.",
    win: "Pin a Wednesday discount. Customers earn DUM Points and come back. Schedule a live to show today's fade.",
  },
  {
    trade: "Gyms",
    emoji: "🥊",
    pain: "Class drop-ins are dead Tuesday morning. Membership pitch is hard.",
    win: "Live-stream the 7am class. Pin a drop-in package. Returning members earn points toward their next month.",
  },
  {
    trade: "Salons",
    emoji: "💅",
    pain: "Last-minute cancellations leave a chair empty. Loyalty cards get lost.",
    win: "Push a same-day deal to your customer list. Loyalty lives in their phone, not a paper punch card.",
  },
];

/* ───────────────────────────────────────────────────────────
   3. Five "what you own" promises. Each one is plain English,
   no jargon, no buzzwords.
   ─────────────────────────────────────────────────────────── */
const OWNERSHIP_PROMISES = [
  {
    title: "Own your customers",
    body:
      "Phone, email, purchase history, all yours. Not rented from a platform that can change the algorithm next week.",
  },
  {
    title: "Fill slow hours",
    body:
      "Schedule a live for a slow Tuesday. Customers who tapped Remind me get an email when you go live. Recurring weekly schedule available.",
  },
  {
    title: "Sell directly",
    body:
      "Stripe pays you, not a marketplace. 1.5% per sale is the only cut we take. Everything else hits your bank account.",
  },
  {
    title: "Lower platform dependency",
    body:
      "Your storefront lives on your own page. Embed it on your own website. Stop renting traffic from apps that take 8 to 30 percent.",
  },
  {
    title: "Live on your own site",
    body:
      "One script tag puts your live shop on your existing website. No new domain. No app store. No fighting an algorithm for who sees you.",
  },
  {
    title: "Weekly customer return loop",
    body:
      "Customers earn DUM Points on every purchase, redeemable at any DUM Club seller. Automatic win-back texts pull them back without you lifting a finger.",
  },
  {
    title: "Simple mobile setup",
    body:
      "Sign up on your phone. Take a photo, set a price, go live. You can run the whole thing from the same phone you take orders on.",
  },
];

export default function WhyDumClubPage() {
  return (
    <main className="relative min-h-screen bg-surface-page text-primary">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <Section spacing="loose" bg="page">
        <Container size="lg" className="text-center">
          <Eyebrow tone="brand">Built for local business</Eyebrow>
          <Heading level="h1" className="mt-4">
            Why local businesses pick DUM Club over{" "}
            <span className="text-brand-teal">Instagram Live</span>,{" "}
            <span className="text-brand-teal">DoorDash</span>, and{" "}
            <span className="text-brand-teal">Whatnot</span>.
          </Heading>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-secondary sm:text-lg">
            One flat monthly subscription. 1.5% per sale. Customers who come
            back on their own. Live selling that drops your slow-hour
            calendar onto autopilot.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/merchant"
              className="inline-flex h-12 items-center justify-center rounded-xl bg-brand-teal px-7 text-sm font-bold text-brand-navy transition hover:bg-brand-teal-hover hover:text-white"
            >
              Claim your founding spot
            </Link>
            <Link
              href="/pricing"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-default px-7 text-sm font-bold text-primary transition hover:border-strong"
            >
              See pricing
            </Link>
          </div>
          <p className="mx-auto mt-5 max-w-xl text-[13px] text-muted">
            From $39/month plus a 1.5% sales fee. Founding 100 merchants get
            60 days free and lock in founding pricing for life.
          </p>
        </Container>
      </Section>

      {/* ── Four-column comparison ───────────────────────────── */}
      <Section spacing="default" bg="muted">
        <Container size="lg">
          <div className="mb-10 text-center">
            <Eyebrow tone="navy">Side by side</Eyebrow>
            <Heading level="h2" as="h2" className="mt-3">
              Same goal: sell to local customers. Different math.
            </Heading>
            <p className="mx-auto mt-3 max-w-2xl text-secondary">
              Every row is one practical thing a shop owner cares about. The
              fees, the customer data, the time it takes to fill a slow
              Tuesday.
            </p>
          </div>

          <Card variant="surface" padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-default bg-surface-muted/50 text-[11px] font-bold uppercase tracking-[0.18em] text-secondary">
                    <th scope="col" className="px-4 py-3 sm:px-5"></th>
                    <th scope="col" className="px-4 py-3 sm:px-5">
                      Instagram Live
                    </th>
                    <th scope="col" className="px-4 py-3 sm:px-5">
                      DoorDash
                    </th>
                    <th scope="col" className="px-4 py-3 sm:px-5">
                      Whatnot
                    </th>
                    <th
                      scope="col"
                      className="bg-brand-teal-soft px-4 py-3 text-brand-teal sm:px-5"
                    >
                      DUM Club
                    </th>
                  </tr>
                </thead>
                <tbody className="text-[13px] text-primary">
                  {COMPARE_ROWS.map((row, i) => (
                    <tr
                      key={row.label}
                      className={
                        i % 2 === 0
                          ? "border-b border-default"
                          : "border-b border-default bg-surface-muted/30"
                      }
                    >
                      <th
                        scope="row"
                        className="px-4 py-4 align-top text-[12px] font-bold uppercase tracking-[0.14em] text-secondary sm:px-5"
                      >
                        {row.label}
                      </th>
                      <td className="px-4 py-4 align-top text-secondary sm:px-5">
                        {row.ig}
                      </td>
                      <td className="px-4 py-4 align-top text-secondary sm:px-5">
                        {row.doordash}
                      </td>
                      <td className="px-4 py-4 align-top text-secondary sm:px-5">
                        {row.whatnot}
                      </td>
                      <td className="bg-brand-teal-soft/60 px-4 py-4 align-top font-medium text-brand-navy sm:px-5">
                        {row.dum}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <p className="mt-6 text-center text-[12px] text-muted">
            Fees referenced are public list rates. DoorDash 15-30% range is
            their published partnership tiers; Whatnot&apos;s published rate is up to 8%, varying
            by category; Stripe processing 2.9% + $0.30 applies on every
            platform but is paid by the buyer at checkout on DUM Club.
          </p>
        </Container>
      </Section>

      {/* ── Trade-specific cards ──────────────────────────────── */}
      <Section spacing="default" bg="page">
        <Container size="lg">
          <div className="mb-10 text-center">
            <Eyebrow tone="brand">Your business</Eyebrow>
            <Heading level="h2" as="h2" className="mt-3">
              Built for the shops that keep a neighborhood running.
            </Heading>
            <p className="mx-auto mt-3 max-w-2xl text-secondary">
              Seven specific trades. Each one with the concrete way DUM Club
              fills the slow days and pulls customers back through the door.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TRADES.map((trade) => (
              <Card key={trade.trade} variant="surface" padding="md">
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-teal-soft text-2xl"
                    aria-hidden="true"
                  >
                    {trade.emoji}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-bold text-primary">
                      {trade.trade}
                    </div>
                    <p className="mt-2 text-[13px] leading-relaxed text-secondary">
                      <span className="font-semibold text-primary">
                        The pain:
                      </span>{" "}
                      {trade.pain}
                    </p>
                    <p className="mt-2 text-[13px] leading-relaxed text-primary">
                      <span className="font-semibold text-brand-teal">
                        With DUM Club:
                      </span>{" "}
                      {trade.win}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </Container>
      </Section>

      {/* ── Seven ownership promises ─────────────────────────── */}
      <Section spacing="default" bg="muted">
        <Container size="lg">
          <div className="mb-10 text-center">
            <Eyebrow tone="navy">What you own</Eyebrow>
            <Heading level="h2" as="h2" className="mt-3">
              The customer is yours. So is everything that comes with them.
            </Heading>
            <p className="mx-auto mt-3 max-w-2xl text-secondary">
              Seven practical promises. No buzzwords, no fine print.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {OWNERSHIP_PROMISES.map((promise, i) => (
              <Card key={promise.title} variant="surface" padding="md">
                <div className="flex items-start gap-3">
                  <Badge variant="verified">{String(i + 1).padStart(2, "0")}</Badge>
                  <div className="min-w-0">
                    <div className="text-[15px] font-bold text-primary">
                      {promise.title}
                    </div>
                    <p className="mt-2 text-[13px] leading-relaxed text-secondary">
                      {promise.body}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </Container>
      </Section>

      {/* ── Closing CTA ───────────────────────────────────────── */}
      <Section spacing="default" bg="page">
        <Container size="md" className="text-center">
          <Eyebrow tone="brand">Ready when you are</Eyebrow>
          <Heading level="h2" as="h2" className="mt-3">
            Join the first 100 merchants.
          </Heading>
          <p className="mx-auto mt-4 max-w-xl text-secondary">
            Get 60 days free and lock in founding pricing for life. Flat
            monthly subscription plus a 1.5% sales fee. Industry-low (Whatnot
            takes up to 8%). Keep more of every sale.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/merchant"
              className="inline-flex h-12 items-center justify-center rounded-xl bg-brand-teal px-7 text-sm font-bold text-brand-navy transition hover:bg-brand-teal-hover hover:text-white"
            >
              Claim your founding spot
            </Link>
            <Link
              href="/business?tab=calculator"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-default px-7 text-sm font-bold text-primary transition hover:border-strong"
            >
              Run the fee calculator
            </Link>
          </div>
          <p className="mt-6 text-[12px] text-muted">
            Questions? Email{" "}
            <a
              href="mailto:julian@dum.club"
              className="text-brand-teal underline-offset-2 hover:underline"
            >
              julian@dum.club
            </a>
            . Julian gets back same day.
          </p>
        </Container>
      </Section>
    </main>
  );
}
