import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Upgrade Your Tier | DUM Club",
  description:
    "Starter $39/mo, Growth $99/mo, Pro $299/mo. Every tier includes a 1.5% sales fee (industry-low; Whatnot takes up to 8%), DUM Points loyalty, and Stripe direct payouts. Lock in founding pricing for life.",
};

export default function UpgradeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
