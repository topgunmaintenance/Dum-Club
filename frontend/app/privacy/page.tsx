import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-base px-4 py-20 text-white">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="mb-8 inline-block text-sm text-zinc-500 transition hover:text-zinc-300">
          ← Back to DUM Club
        </Link>
        <h1 className="text-3xl font-black tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated: April 2026</p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-zinc-400">
          <section>
            <h2 className="mb-2 text-lg font-bold text-white">1. Information We Collect</h2>
            <p>
              We collect information you provide when creating an account (email, name), business information you enter (business name, descriptions, offers), and usage data (page views, interactions). Authentication is handled through Privy, which may collect additional data per their privacy policy.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-white">2. How We Use Your Information</h2>
            <p>
              We use your information to provide the DUM Club platform, process payments through Stripe, display your business storefront publicly, send transactional emails, and improve the platform experience.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-white">3. Payment Data</h2>
            <p>
              Payment processing is handled by Stripe. DUM Club does not store credit card numbers or sensitive payment credentials. Stripe&apos;s privacy policy governs how payment data is handled.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-white">4. Public Information</h2>
            <p>
              Business storefronts, offers, and project descriptions are publicly visible. Do not include sensitive personal information in your business listings.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-white">5. Data Retention</h2>
            <p>
              We retain your data for as long as your account is active. You may request deletion of your account and associated data by contacting us.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-white">6. Third-Party Services</h2>
            <p>
              DUM Club uses Stripe (payments), Privy (authentication), Supabase (database), and Solana (wallet infrastructure). Each service has its own privacy policy governing data they process.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-white">7. Contact</h2>
            <p>
              For privacy-related inquiries, contact us at{" "}
              <a href="mailto:julian@topgunmaintenance.com" className="text-emerald-400 hover:text-emerald-300">
                julian@topgunmaintenance.com
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
