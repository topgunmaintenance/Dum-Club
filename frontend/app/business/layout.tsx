import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "For Business. Pricing, Calculators & Comparisons | DUM Club",
  description:
    "See why sellers leave Whatnot for DUM Club. Flat $39 to $299 a month, zero commission, automatic customer win-back texts, and loyalty built in. Compare fees, calculate savings, pick your tier.",
};

export default function BusinessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
