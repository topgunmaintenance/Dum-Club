import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "For Business. Sell Live From Your Own Site | DUM Club",
  description:
    "Live selling for local business, right on your own website. Every business gets 30 days free. Your customers see you, ask questions, and buy on the spot.",
};

export default function BusinessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
