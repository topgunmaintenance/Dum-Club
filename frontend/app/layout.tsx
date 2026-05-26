import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Caveat } from "next/font/google";
import "./globals.css";
import { AppProviders } from "../components/AppProviders";
import { SiteChrome } from "../components/SiteChrome";

// Caveat is loaded for the founder-note signature line only. Subset
// kept to "latin", weights 400 + 600, swap display so the page never
// blocks on the font. Exposed as a CSS variable + Tailwind utility
// (font-caveat) — every other text on the site continues to render
// in Geist Sans / Mono.
const caveat = Caveat({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-caveat",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DUM Club. Drive Ur Market. Live Selling. Zero Commission.",
  description:
    "Drive Ur Market. The loyalty network for local business. Live selling, local deals, and rewards that bring customers back. Merchants pay one flat fee from $39 to $299 a month and keep 100% of every sale. 0% commission, always.",
  openGraph: {
    title: "DUM Club. Drive Ur Market. Live Selling. Zero Commission.",
    description:
      "Drive Ur Market. Watch live sellers, discover local deals, earn rewards everywhere. Sellers keep every sale, with a flat fee and no commission. The Whatnot alternative that does not tax every sale.",
    siteName: "DUM Club",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "DUM Club. Drive Ur Market. Live Selling. Zero Commission.",
    description:
      "Drive Ur Market. Watch live sellers, discover local deals, earn rewards everywhere. Sellers keep every sale, with a flat fee and no commission. The Whatnot alternative that does not tax every sale.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} ${caveat.variable}`}>
      <body className={`${GeistSans.className} bg-surface-page text-primary min-h-screen`}>
        <AppProviders>
          {/* SiteChrome decides whether to render the global navbar /
              ticker / DUM Points pill / deploy badge based on the
              current pathname. /embed/* routes get a bare shell so
              the merchant's iframe shows pure DUM Club content. */}
          <SiteChrome>{children}</SiteChrome>
        </AppProviders>
      </body>
    </html>
  );
}
