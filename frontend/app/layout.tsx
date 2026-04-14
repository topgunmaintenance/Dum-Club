import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { AppProviders } from "../components/AppProviders";
import { Navbar } from "../components/Navbar";
import { DumPill } from "../components/DumPill";
import { LiveActivityTicker } from "../components/LiveActivityTicker";

export const metadata: Metadata = {
  title: "DUM Club — Book local home and auto services in Morris County",
  description:
    "DUM Club — Book local home and auto services in Morris County. Stripe payments, verified merchants, rewards that work.",
  openGraph: {
    title: "DUM Club — Local home and auto services in Morris County",
    description:
      "Book mobile detailers, handymen, lawn crews, and more — all in one place. Stripe checkout, verified merchants, rewards that work.",
    siteName: "DUM Club",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "DUM Club — Local home and auto services in Morris County",
    description:
      "Book mobile detailers, handymen, lawn crews, and more — all in one place. Stripe checkout, verified merchants, rewards that work.",
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
