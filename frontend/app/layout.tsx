import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { AppProviders } from "../components/AppProviders";
import { Navbar } from "../components/Navbar";
import { DumPill } from "../components/DumPill";
import { LiveActivityTicker } from "../components/LiveActivityTicker";

export const metadata: Metadata = {
  title: "DUM Club — Digital Utility Market",
  description:
    "DUM Club (Digital Utility Market) — Turn any idea into a live business with Stripe payments, AI-generated storefronts, and built-in loyalty rewards. Built on Solana.",
  openGraph: {
    title: "DUM Club — Digital Utility Market",
    description:
      "DUM Club (Digital Utility Market) — Turn any idea into a live business with Stripe payments, AI-generated storefronts, and built-in loyalty rewards. Built on Solana.",
    siteName: "DUM Club",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "DUM Club — Digital Utility Market",
    description:
      "DUM Club (Digital Utility Market) — Turn any idea into a live business with Stripe payments, AI-generated storefronts, and built-in loyalty rewards. Built on Solana.",
  },
};

const commitSha = process.env.NEXT_PUBLIC_GIT_COMMIT_SHA || "";
const isPreview = process.env.VERCEL_ENV === "preview";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className={`${GeistSans.className} bg-zinc-950 text-white min-h-screen`}>
        <AppProviders>
          <Navbar />
          {/* Spacer to offset fixed navbar: 72px mobile, 92px desktop */}
          <div className="h-[72px] lg:h-[92px]" />
          {/* Global live activity ticker — sits directly below the navbar. */}
          <LiveActivityTicker />
          {children}
          <DumPill />
          {/* Deploy indicator — low-visibility, bottom-right */}
          {commitSha && (
            <div
              className="fixed bottom-2 right-2 z-[9999] flex items-center gap-1.5 rounded-md bg-zinc-950/80 px-2 py-1 font-mono text-[9px] text-zinc-700 backdrop-blur-sm"
              title={`Deploy: ${commitSha}${isPreview ? " (preview)" : ""}`}
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${isPreview ? "bg-amber-500" : "bg-emerald-500/60"}`} />
              {commitSha.slice(0, 7)}
              {isPreview && <span className="text-amber-500">preview</span>}
            </div>
          )}
        </AppProviders>
      </body>
    </html>
  );
}
