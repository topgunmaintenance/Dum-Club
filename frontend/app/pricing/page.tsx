"use client";

/**
 * /pricing — redirects to /business?tab=pricing.
 *
 * All pricing content lives on the /business page under the Pricing
 * sub-tab. This redirect exists because /pricing is a natural URL
 * people type or link to, and the navbar "See Pricing" CTA links
 * here from the homepage hero.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function PricingRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/business?tab=pricing");
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#060606] text-white">
      <div className="text-center">
        <p className="text-sm text-zinc-500">Redirecting to pricing...</p>
        <Link href="/business?tab=pricing" className="mt-2 text-sm text-emerald-400 hover:text-emerald-300">
          Click here if not redirected →
        </Link>
      </div>
    </div>
  );
}
