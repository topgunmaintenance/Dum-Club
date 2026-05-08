import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { AppProviders } from "../components/AppProviders";
import { SiteChrome } from "../components/SiteChrome";

export const metadata: Metadata = {
  title: "DUM Club — Live Selling Marketplace. Flat Fee. Zero Commission.",
  description:
    "Live selling, local deals, and rewards that bring customers back. Merchants pay one flat fee — $29 to $99/mo — and keep 100% of every sale. 0% commission, always. Founding merchants get preferred pricing after launch.",
  openGraph: {
    title: "DUM Club — Live Selling Marketplace. Zero Commission.",
    description:
      "Watch live sellers. Discover local deals. Earn rewards everywhere. Sellers keep everything — flat fee, no commission. The Whatnot alternative that doesn't tax every sale.",
    siteName: "DUM Club",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "DUM Club — Live Selling Marketplace. Zero Commission.",
    description:
      "Watch live sellers. Discover local deals. Earn rewards everywhere. Sellers keep everything — flat fee, no commission. The Whatnot alternative that doesn't tax every sale.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className={`${GeistSans.className} bg-base text-[var(--color-text-primary)] min-h-screen`}>
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
