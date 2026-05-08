import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Become a Merchant — Join the Founding 100 | DUM Club",
  description:
    "Founding merchants pay $0 today and receive preferred founding pricing after launch. 0% commission, Stripe direct payouts, AI-powered customer retention. Claim your spot now.",
};

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return children;
}
