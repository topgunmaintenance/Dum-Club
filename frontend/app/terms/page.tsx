import Link from "next/link";

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
              DUM Club (Digital Utility Market) is a platform that enables users to create business storefronts, list offers, and accept payments. The platform uses AI to generate storefront content and integrates with Stripe for payment processing. DUM Club does not guarantee any sales, revenue, or business outcomes.
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
              Payments are processed through Stripe. DUM Club does not take a commission or per-transaction cut from sellers; sellers pay only their flat monthly subscription fee for access to the platform. Stripe&apos;s standard payment-processing fees (e.g. 2.9% + $0.30) are paid by the buyer at checkout. Sellers receive payouts directly to their connected Stripe account on Stripe&apos;s standard processing timeline. All prices are listed in USD; Stripe handles any currency conversion at checkout.
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
