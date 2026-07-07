import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Become a Merchant. Join the Founding 100 | DUM Club",
  description:
    "Join the first 100 merchants. Get 30 days free and lock in founding pricing for life. Flat monthly subscription plus a 1.5% sales fee. Industry-low (Whatnot takes up to 8%).",
};

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return children;
}
