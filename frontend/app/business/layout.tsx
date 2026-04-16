import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "For Business — Pricing, Calculators & Comparisons | DUM Club",
  description:
    "See why sellers leave Whatnot for DUM Club. Flat $29–$99/mo, zero commission, AI retention, and loyalty built in. Compare fees, calculate savings, pick your tier.",
};

export default function BusinessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
