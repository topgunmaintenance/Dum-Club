import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { AppProviders } from "../components/AppProviders";
import { Navbar } from "../components/Navbar";
import { DumPill } from "../components/DumPill";
import { LiveActivityTicker } from "../components/LiveActivityTicker";

export const metadata: Metadata = {
  title: "DUM Club — Sell Live. Keep Everything. Zero Commission Marketplace.",
  description:
    "DUM Club is the flat-fee live selling marketplace. Zero commission, AI-powered customer retention, and local deals discovery. The first 100 merchants join free.",
  openGraph: {
    title: "DUM Club — Sell Live. Keep Everything.",
    description:
      "Flat $29–$99/mo. Zero commission. Live selling, AI retention, and deals discovery. It's DUM to pay per-sale fees.",
    siteName: "DUM Club",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "DUM Club — Sell Live. Keep Everything.",
    description:
      "Flat $29–$99/mo. Zero commission. Live selling, AI retention, and deals discovery. It's DUM to pay per-sale fees.",
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
      <body className={`${GeistSans.className} bg-base text-[var(--color-text-primary)] min-h-screen`}>
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
