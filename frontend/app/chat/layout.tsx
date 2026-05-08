import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DUM AI | DUM Club",
  description:
    "Ask DUM AI for growth, pricing, and merchant strategy advice — powered by Claude.",
};

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
