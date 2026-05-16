import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Become a Merchant. Join the Founding 100 | DUM Club",
  description:
    "Join the first 100 merchants. Get 60 days free and lock in founding pricing for life. Flat monthly fee. 0% commission. Keep every sale.",
};

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return children;
}
