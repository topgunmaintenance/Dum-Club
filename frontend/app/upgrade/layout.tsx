import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Upgrade Your Tier | DUM Club",
  description:
    "Starter $39/mo, Growth $99/mo, Pro $299/mo. Every tier includes 0% commission, DUM Points loyalty, and Stripe direct payouts. Founding merchants get preferred pricing after launch.",
};

export default function UpgradeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
