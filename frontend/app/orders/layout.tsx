import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Orders | DUM Club",
  description: "Your DUM Club purchases — receipts, status, and order history.",
};

export default function OrdersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
