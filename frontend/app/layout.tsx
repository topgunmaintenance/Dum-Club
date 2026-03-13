import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { WalletProviders } from "../components/WalletProviders";
import { Navbar } from "../components/Navbar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "DUM Club",
  description: "Support creators by vaulting SOL",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-zinc-950 text-white min-h-screen`}>
        <WalletProviders>
          <Navbar />
          {children}
        </WalletProviders>
      </body>
    </html>
  );
}
