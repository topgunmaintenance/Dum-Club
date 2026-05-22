/**
 * /technology — the only consumer-facing page that mentions Solana.
 *
 * Per Master Playbook Phase 0A point 6: "Consumer-facing copy never
 * says 'Solana' unless it's on a dedicated technical page." All
 * Solana / on-chain / SPL / wallet language that used to live on the
 * homepage, /business, and other consumer surfaces is consolidated
 * here.
 *
 * Linked from the footer in 11px gray text. Not in the primary nav.
 * Visitors who land here are deliberate — developers, technical
 * partners, regulators, due diligence — not casual local-services
 * customers.
 */

import Link from "next/link";

const PROGRAM_ID = "FYgLqjJ7RHmT46xb5EiNGNa8XFbckqPWkEVLt2ztjnLV";

export const metadata = {
  title: "Technology | DUM Club",
  description:
    "How DUM Club is built. Stripe payments, Supabase database, and an SPL token rewards program on Solana for users who want on-chain claim.",
};

// ISR: static marketing content, regenerate at most hourly.
export const revalidate = 3600;

export default function TechnologyPage() {
  return (
    <div className="min-h-screen bg-zinc-950 px-6 pt-28 pb-20 text-zinc-300">
      <div className="mx-auto max-w-3xl">
        <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-emerald-400">
          Technology
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          How DUM Club is built.
        </h1>
        <p className="mt-4 text-base leading-relaxed text-zinc-400">
          DUM Club is a local-commerce platform first. Card payments, real
          merchants, real customers. The system behind DUM Club below is for
          developers, integration partners, and users who want to take
          their DUM Points balance on-chain. If you came here looking for
          a local handyman or a mobile detailer, head back to{" "}
          <Link href="/" className="text-emerald-400 underline-offset-4 hover:underline">
            the homepage
          </Link>
          .
        </p>

        {/* ── Disclosures ───────────────────────────────────────────
             Moved up to be the second section (clarity pass): the
             legal-review / Solana-mainnet warning should be visible
             before the stack details, not buried at the bottom. */}
        <section className="mt-12">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.25em] text-zinc-500">
            Disclosures
          </div>
          <h2 className="text-2xl font-bold text-white">What we&apos;re still figuring out.</h2>
          <p className="mt-3 text-[14px] leading-relaxed text-zinc-400">
            DUM Club is in early access. The cross-merchant rewards loop
            (earn at merchant A, redeem at merchant B) is the product
            wedge. The Solana SPL token is a complementary on-chain
            representation, not the primary value driver.
          </p>
          <ul className="mt-4 space-y-2 text-[13px] leading-relaxed text-zinc-500">
            <li>
              <span className="text-zinc-400">·</span>{" "}
              Purchasing DUM Points with a card is currently disabled
              pending a written legal review of US money-transmission and
              prepaid-card regulations. Earning through purchases is
              unaffected.
            </li>
            <li>
              <span className="text-zinc-400">·</span>{" "}
              The on-chain SPL token operates on Solana devnet. Mainnet
              deployment is gated on the same legal review.
            </li>
            <li>
              <span className="text-zinc-400">·</span>{" "}
              DUM Points are not an investment. There is no secondary
              market, no buyback, no expectation of price appreciation.
              They are a loyalty unit redeemable for discounts at
              participating merchants. 1 DUM = $0.10 of merchant credit.
            </li>
            <li>
              <span className="text-zinc-400">·</span>{" "}
              The content on this site is for informational purposes
              only and does not constitute financial, legal, or
              investment advice.
            </li>
          </ul>
        </section>

        {/* ── The stack ────────────────────────────────────────────── */}
        <section className="mt-16">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.25em] text-zinc-500">
            The stack
          </div>
          <h2 className="text-2xl font-bold text-white">What it actually runs on.</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {[
              {
                label: "Frontend",
                title: "Next.js on Vercel",
                body: "App Router, React 18, Tailwind, Geist typography. Statically generated where possible, server-rendered for authenticated routes.",
              },
              {
                label: "Backend",
                title: "FastAPI on Railway",
                body: "Python 3.11 with async handlers. All business logic, Stripe webhooks, and DUM Points accounting live here.",
              },
              {
                label: "Database",
                title: "Supabase / PostgreSQL",
                body: "All app data lives here: merchants, projects, offers, orders, DUM balances. Row-level security on user data, public read on listings.",
              },
              {
                label: "Payments",
                title: "Stripe + Stripe Connect",
                body: "Card payments via Stripe Checkout. Merchants onboard via Stripe Connect Standard so payouts go directly to their bank, not through DUM Club.",
              },
              {
                label: "Auth",
                title: "Privy",
                body: "Email and Google sign-in. Privy DIDs are the user identifier across the platform. Solana wallets are auto-provisioned but never required for buying.",
              },
              {
                label: "Live streaming",
                title: "AWS IVS Real-Time",
                body: "WebRTC-based live commerce streaming. Currently feature-flagged off (NEXT_PUBLIC_ENABLE_LIVE_STREAMS=false). Dormant infrastructure for future category drops.",
              },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5"
              >
                <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400">
                  {item.label}
                </div>
                <div className="text-base font-bold text-white">{item.title}</div>
                <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Solana / on-chain ─────────────────────────────────── */}
        <section className="mt-16">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.25em] text-zinc-500">
            On-chain
          </div>
          <h2 className="text-2xl font-bold text-white">Solana, for the people who want it.</h2>
          <p className="mt-3 text-[14px] leading-relaxed text-zinc-400">
            DUM Points are tracked off-chain in PostgreSQL by default. That's
            how 99% of users will ever interact with them. Customers earn
            points at participating merchants, redeem them for discounts at
            other merchants, never touch a wallet, never pay gas, never
            think about a blockchain.
          </p>
          <p className="mt-3 text-[14px] leading-relaxed text-zinc-400">
            For users who want on-chain custody, DUM Points are also issued
            as an SPL token on Solana. The mint program is deployed on
            Solana devnet today and will move to mainnet after legal review
            of the regulatory posture (see disclosures below). Connecting a
            wallet and claiming earned points to chain is opt-in and lives
            behind an &ldquo;Advanced&rdquo; toggle on the DUM Hub page.
          </p>

          <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400">
              Solana program
            </div>
            <div className="space-y-3 font-mono text-[12px]">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-widest text-zinc-600">Network</span>
                <span className="text-zinc-300">Devnet (mainnet pending legal review)</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-widest text-zinc-600">Program ID</span>
                <a
                  href={`https://explorer.solana.com/address/${PROGRAM_ID}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-emerald-400 underline-offset-4 hover:underline"
                >
                  {PROGRAM_ID}
                </a>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-widest text-zinc-600">Token model</span>
                <span className="text-zinc-300">SPL Token, mint-on-claim, platform-paid gas (~$0.00025 per mint)</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-widest text-zinc-600">Where the real data lives</span>
                <span className="text-zinc-300">Off-chain PostgreSQL. Solana mirrors it; never the master.</span>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-16 border-t border-zinc-900 pt-8">
          <Link href="/" className="text-[13px] text-zinc-500 underline-offset-4 hover:text-emerald-400 hover:underline">
            ← Back to DUM Club
          </Link>
        </div>
      </div>
    </div>
  );
}
