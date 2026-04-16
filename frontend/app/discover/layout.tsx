import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Discover Local Deals & Live Sellers | DUM Club",
  description:
    "Browse live sellers, local services, and the best deals this week. Every purchase earns rewards redeemable at any business on the DUM Club network.",
};

export default function DiscoverLayout({ children }: { children: React.ReactNode }) {
  return children;
}
