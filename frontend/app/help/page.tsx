import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Buyer Help | DUM Club",
  description:
    "How payments, refunds, and disputes work when you buy from a shop on DUM Club.",
};

/**
 * Buyer-facing trust page (browser audit 2026-07-03): the Terms of Use
 * are merchant-facing; buyers (and merchants evaluating whether their
 * customers are protected) need a plain-English page covering payment
 * safety, refunds, disputes, and how to reach a seller.
 */
export default function BuyerHelpPage() {
  return (
    <div className="min-h-screen bg-surface-page px-4 pb-20 pt-28">
      <div className="mx-auto max-w-2xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-mint-text">
          Buyer help
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-primary sm:text-4xl">
          Buying on DUM Club, protected.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-secondary">
          Every purchase on DUM Club is a direct order with a real local
          business. Here is exactly how your money and your order are
          protected.
        </p>

        <div className="mt-8 space-y-6">
          <section className="rounded-2xl border border-default bg-surface-card p-5 sm:p-6">
            <h2 className="text-base font-bold text-primary">Your payment is handled by Stripe</h2>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              DUM Club never sees or stores your card number. Checkout runs on
              Stripe, the same payment company behind Amazon, Shopify, and
              Whatnot, and your card details go only to them. Every seller on
              DUM Club passed Stripe&apos;s identity verification before they
              could take a single order.
            </p>
          </section>

          <section className="rounded-2xl border border-default bg-surface-card p-5 sm:p-6">
            <h2 className="text-base font-bold text-primary">Something wrong with an order?</h2>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              Start with the seller: every shop page has a message button, and
              most issues (a reschedule, a swap, a refund) get solved there in
              a day. Sellers issue refunds directly through Stripe, and the
              money returns to your original card.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              If a seller does not respond within a few days or refuses a
              reasonable fix, email{" "}
              <a href="mailto:julian@topgunmaintenance.com" className="font-semibold text-mint-text hover:underline">
                julian@topgunmaintenance.com
              </a>{" "}
              with your order details and we will step in.
            </p>
          </section>

          <section className="rounded-2xl border border-default bg-surface-card p-5 sm:p-6">
            <h2 className="text-base font-bold text-primary">Card disputes always work</h2>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              Because you pay by card through Stripe, you always keep your
              bank&apos;s standard protections: if you paid for something that
              never arrived or was not as described and the seller will not
              make it right, you can dispute the charge with your card issuer.
              That protection sits underneath everything else and no seller
              can take it away.
            </p>
          </section>

          <section className="rounded-2xl border border-default bg-surface-card p-5 sm:p-6">
            <h2 className="text-base font-bold text-primary">What sellers can and can&apos;t do</h2>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              Sellers must deliver exactly what they show on camera, and DUM
              Club bans dangerous and illegal items outright (see the{" "}
              <Link href="/terms" className="font-semibold text-mint-text hover:underline">
                Terms of Use
              </Link>
              ). Shops that break the rules are removed, and their ability to
              take new orders is shut off the moment we act.
            </p>
          </section>
        </div>

        <p className="mt-8 text-center text-xs text-muted">
          DUM Club is in early access. Questions about anything on this page:{" "}
          <a href="mailto:julian@topgunmaintenance.com" className="font-semibold text-mint-text hover:underline">
            julian@topgunmaintenance.com
          </a>
        </p>
      </div>
    </div>
  );
}
