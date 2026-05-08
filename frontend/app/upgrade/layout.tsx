import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Upgrade Your Tier | DUM Club",
  description:
    "Starter $29/mo, Growth $49/mo, Pro $99/mo. Every tier includes 0% commission, DUM Points loyalty, and Stripe direct payouts. Founding merchants get preferred pricing after launch.",
};

export default function UpgradeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
