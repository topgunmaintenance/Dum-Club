import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppProviders } from "../components/AppProviders";
import { Navbar } from "../components/Navbar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "DUM Club — Launch AI Projects on Solana",
  description:
    "Describe an idea, launch it on-chain. AI generates the project, token, and live market instantly.",
  openGraph: {
    title: "DUM Club — Launch AI Projects on Solana",
    description:
      "Describe an idea, launch it on-chain. AI generates the project, token, and live market instantly.",
    siteName: "DUM Club",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "DUM Club — Launch AI Projects on Solana",
    description:
      "Describe an idea, launch it on-chain. AI generates the project, token, and live market instantly.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-zinc-950 text-white min-h-screen`}>
        <AppProviders>
          <Navbar />
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
