import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "For Business. Pricing, Calculators & Comparisons | DUM Club",
  description:
    "See why sellers leave Whatnot for DUM Club. Flat $29 to $99 a month, zero commission, tools that help bring customers back, and loyalty built in. Compare fees, calculate savings, pick your tier.",
};

export default function BusinessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
