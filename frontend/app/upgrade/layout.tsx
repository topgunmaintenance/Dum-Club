import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Upgrade Your Tier | DUM Club",
  description:
    "Starter $29/mo, Growth $49/mo, Pro $99/mo. Every tier includes zero commission, DUM Points loyalty, and Stripe direct payouts. Founding 100 merchants join free.",
};

export default function UpgradeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
