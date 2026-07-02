import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service | DUM Club",
  description:
    "DUM Club's terms of service: payments, accounts, DUM Points, and platform usage.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-base px-4 py-20 text-white">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="mb-8 inline-block text-sm text-zinc-500 transition hover:text-zinc-300">
          ← Back to DUM Club
        </Link>
        <h1 className="text-3xl font-black tracking-tight">Terms of Use</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated: April 2026</p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-zinc-400">
          <section>
            <h2 className="mb-2 text-lg font-bold text-white">1. Acceptance of Terms</h2>
            <p>
              By accessing or using DUM Club, you agree to be bound by these Terms of Use. If you do not agree, do not use the platform.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-white">2. Platform Description</h2>
            <p>
              DUM Club (Drive Ur Market) is a live-commerce platform for local businesses: merchants create storefronts, list offers, sell live on camera, and accept payments. Payments are processed through Stripe. Buyers can earn DUM Points loyalty rewards on purchases. DUM Club does not guarantee any sales, revenue, or business outcomes.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-white">3. User Responsibilities</h2>
            <p>
              You are responsible for the accuracy of your business information, the legality of your offers, and compliance with applicable laws. You must not use DUM Club for fraudulent, illegal, or harmful purposes.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-white">4. Payments</h2>
            <p>
              Payments are processed through Stripe. DUM Club applies a 1.5% platform sales fee on each paid order, deducted from the seller&apos;s Stripe payout via Stripe&apos;s application_fee_amount mechanism. Sellers pay their flat monthly subscription fee for platform access in addition to the 1.5% per-order fee. Stripe&apos;s standard payment-processing fees (e.g. 2.9% + $0.30) are paid by the buyer at checkout. Sellers receive payouts directly to their connected Stripe account on Stripe&apos;s standard processing timeline, less the 1.5% platform sales fee. All prices are listed in USD; Stripe handles any currency conversion at checkout.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-white">5. DUM Points</h2>
            <p>
              DUM Points are a loyalty rewards mechanism within the platform. They have no cash value, cannot be exchanged for currency, and are subject to change. DUM Club reserves the right to modify the DUM Points system at any time.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-white">6. No Guarantees</h2>
            <p>
              DUM Club does not guarantee that you will make money, attract customers, or achieve any particular business outcome. The platform provides tools; results depend on your effort and market conditions.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-white">7. Limitation of Liability</h2>
            <p>
              DUM Club is provided &quot;as is&quot; without warranties of any kind. We are not liable for any damages arising from your use of the platform, including lost profits, data loss, or business interruption.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-white">8. Contact</h2>
            <p>
              For questions about these terms, contact us at{" "}
              <a href="mailto:julian@dum.club" className="text-emerald-400 hover:text-emerald-300">
                julian@dum.club
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
