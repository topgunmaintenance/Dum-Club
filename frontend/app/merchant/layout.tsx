import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Become a Merchant — Join the Founding 100 | DUM Club",
  description:
    "The first 100 merchants join free and lock in $29/month forever. Zero commission, Stripe direct payouts, AI-powered customer retention. Claim your spot now.",
};

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return children;
}
