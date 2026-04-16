import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Merchant Dashboard | DUM Club",
  description:
    "Manage your storefront, view analytics, and track your offers. Your DUM Club merchant command center.",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
