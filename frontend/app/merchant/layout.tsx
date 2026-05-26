import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Become a Merchant. Join the Founding 100 | DUM Club",
  description:
    "Join the first 100 merchants. Get 60 days free and lock in founding pricing for life. Flat monthly subscription plus a 1% sales fee. Industry-low (Whatnot takes 8%).",
};

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return children;
}
