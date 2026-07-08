import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Become a Merchant. Your Shop, Live | DUM Club",
  description:
    "Live selling for local business, right on your own website. Every business gets 30 days free. Flat monthly subscription plus a 1.5% sales fee. Industry-low (Whatnot takes up to 8%).",
};

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return children;
}
